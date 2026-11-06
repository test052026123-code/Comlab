import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { requireThat } from './domain.js';

export const fingerprintResultSchema = z.object({
  requestId: z.uuid(), state: z.enum(['matched', 'no_match', 'error']),
  slot: z.number().int().min(0).max(999).nullable(),
}).strict().refine(r => (r.state === 'matched') === (r.slot !== null));

// The physical scanner owns templates; Firestore holds slot links and short-lived
// requests. One scanner can serve only one kiosk request at a time.
export class Fingerprints {
  constructor(db, controllerId, lab, { now = Date.now } = {}) {
    this.db = db; this.controllerId = controllerId; this.lab = lab; this.now = now;
  }
  ref(id) { return this.db.doc(`fingerprintRequests/${id}`); }
  lock() { return this.db.doc(`fingerprintScanners/${this.controllerId}`); }
  mapping(slot) { return this.db.doc(`fingerprintMappings/${this.controllerId}-${slot}`); }
  async start(actor, requestId) {
    await this.db.runTransaction(async tx => {
      const [request, lock] = await tx.getAll(this.ref(requestId), this.lock());
      if (request.exists) {
        requireThat(request.data().createdBy === actor.uid, 'Scan belongs to another kiosk.', 403);
        return;
      }
      const currentId = lock.data()?.requestId;
      const current = currentId ? (await tx.get(this.ref(currentId))).data() : null;
      requireThat(!current || current.state !== 'waiting' || current.expiresAt.toMillis() <= this.now(),
        'Scanner is handling another request. Wait a moment and try again.', 409);
      tx.create(this.ref(requestId), { controllerId: this.controllerId, createdBy: actor.uid,
        state: 'waiting', expiresAt: Timestamp.fromMillis(this.now() + 60000) });
      tx.set(this.lock(), { requestId });
    });
    return this.read(actor, requestId);
  }
  async read(actor, requestId) {
    const r = (await this.ref(requestId).get()).data();
    requireThat(r?.controllerId === this.controllerId, 'Scan request not found.', 404);
    requireThat(r.createdBy === actor.uid, 'Scan belongs to another kiosk.', 403);
    if (r.expiresAt.toMillis() <= this.now()) return { requestId, state: 'expired' };
    if (r.state !== 'matched') return { requestId, state: r.state };
    // A slot unlinked/reassigned after scanning must not resolve a new identity.
    const mapping = (await this.mapping(r.slot).get()).data();
    requireThat(mapping?.studentId === r.studentId, 'Fingerprint link changed. Scan again.', 409);
    return { requestId, state: 'matched', ...await this.lab.lookup(r.studentId) };
  }
  async authorize(actor, requestId, studentId) {
    const result = await this.read(actor, requestId);
    requireThat(result.state === 'matched' && result.student.id === studentId,
      'Scan your registered fingerprint again before continuing.', 403);
  }
  async cancel(actor, requestId) {
    await this.db.runTransaction(async tx => {
      const r = (await tx.get(this.ref(requestId))).data();
      requireThat(r?.createdBy === actor.uid, 'Scan belongs to another kiosk.', 403);
      if (r.state === 'waiting') tx.update(this.ref(requestId), { state: 'canceled' });
    });
    return { canceled: true };
  }
  async deviceExchange(input) {
    const result = input == null ? null : fingerprintResultSchema.parse(input);
    if (result) {
      await this.db.runTransaction(async tx => {
        const r = (await tx.get(this.ref(result.requestId))).data();
        if (!r || r.controllerId !== this.controllerId || r.state !== 'waiting' || r.expiresAt.toMillis() <= this.now()) return;
        const mapping = result.state === 'matched' ? (await tx.get(this.mapping(result.slot))).data() : null;
        tx.update(this.ref(result.requestId), { state: result.state === 'matched' && !mapping ? 'unlinked' : result.state,
          slot: result.slot, studentId: mapping?.studentId ?? null,
          expiresAt: Timestamp.fromMillis(this.now() + 120000) });
      });
    }
    const lock = (await this.lock().get()).data();
    const r = lock?.requestId ? (await this.ref(lock.requestId).get()).data() : null;
    const request = r?.state === 'waiting' && r.expiresAt.toMillis() > this.now()
      ? { requestId: lock.requestId, expiresAt: r.expiresAt.toDate().toISOString() } : null;
    return { fingerprintRequest: request, acknowledgedFingerprint: result?.requestId ?? null };
  }
  async saveStudent(actor, studentId, data, create = false) {
    await this.db.runTransaction(async tx => {
      const ref = this.db.doc(`students/${studentId}`), old = await tx.get(ref);
      requireThat(create ? !old.exists : old.exists, create ? 'Student ID already exists.' : 'Student not found.', create ? 409 : 404);
      const slot = data.fingerprintSlot === undefined ? (old.data()?.fingerprintSlot ?? null) : data.fingerprintSlot;
      const previousSlot = old.data()?.fingerprintSlot;
      const mapping = slot === null ? null : await tx.get(this.mapping(slot));
      requireThat(!mapping?.exists || mapping.data().studentId === studentId, 'Fingerprint slot is linked to another student.', 409);
      if (previousSlot != null && previousSlot !== slot) tx.delete(this.mapping(previousSlot));
      if (slot !== null) tx.set(this.mapping(slot), { studentId });
      tx.set(ref, { ...data, fingerprintSlot: slot, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      this.lab.audit(tx, actor, create ? 'student_create' : 'students_save', { studentId, ...data });
    });
    return { saved: true };
  }
}
