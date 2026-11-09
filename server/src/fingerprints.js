import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { requireThat } from './domain.js';

const slotStates = ['matched', 'enrolled', 'duplicate'];
export const fingerprintResultSchema = z.object({
  requestId: z.uuid(), state: z.enum(['matched', 'no_match', 'error', 'enrolled', 'duplicate', 'mismatch']),
  slot: z.number().int().min(0).max(999).nullable(),
}).strict().refine(r => slotStates.includes(r.state) === (r.slot !== null));
export const fingerprintProgressSchema = z.object({
  requestId: z.uuid(), step: z.enum(['place_first', 'lift', 'place_second']),
}).strict();
export const fingerprintCapacitySchema = z.number().int().min(1).max(1000);

// The physical scanner owns templates; Firestore holds slot links and short-lived
// requests. One scanner can serve only one kiosk request at a time.
export class Fingerprints {
  constructor(db, controllerId, lab, { now = Date.now } = {}) {
    this.db = db; this.controllerId = controllerId; this.lab = lab; this.now = now;
  }
  ref(id) { return this.db.doc(`fingerprintRequests/${id}`); }
  lock() { return this.db.doc(`fingerprintScanners/${this.controllerId}`); }
  mapping(slot) { return this.db.doc(`fingerprintMappings/${this.controllerId}-${slot}`); }
  // One scanner serves one request at a time, scan or enrollment.
  async claim(tx, actor, requestId, record) {
    const [request, lock] = await tx.getAll(this.ref(requestId), this.lock());
    if (request.exists) {
      requireThat(request.data().createdBy === actor.uid, 'Scan belongs to another kiosk.', 403);
      return null;
    }
    const currentId = lock.data()?.requestId;
    const current = currentId ? (await tx.get(this.ref(currentId))).data() : null;
    requireThat(!current || current.state !== 'waiting' || current.expiresAt.toMillis() <= this.now(),
      'Scanner is handling another request. Wait a moment and try again.', 409);
    return { lock: lock.data() ?? {}, write: (extra = {}) => {
      tx.create(this.ref(requestId), { controllerId: this.controllerId, createdBy: actor.uid, state: 'waiting', ...record, ...extra });
      tx.set(this.lock(), { requestId }, { merge: true });
    } };
  }
  async start(actor, requestId) {
    await this.db.runTransaction(async tx => {
      const claim = await this.claim(tx, actor, requestId, { expiresAt: Timestamp.fromMillis(this.now() + 60000) });
      claim?.write();
    });
    return this.read(actor, requestId);
  }
  // Admin enrollment: re-enrolls a student's existing slot, otherwise uses the
  // lowest slot with no student link inside the sensor's reported capacity.
  async startEnroll(actor, requestId, studentId) {
    requireThat(actor.role === 'admin', 'Administrator authentication required.', 403);
    await this.db.runTransaction(async tx => {
      const claim = await this.claim(tx, actor, requestId, {});
      if (!claim) return;
      const student = (await tx.get(this.db.doc(`students/${studentId}`))).data();
      requireThat(student, 'Student not found.', 404);
      const capacity = claim.lock.capacity;
      requireThat(capacity, 'Fingerprint sensor not reported yet. Check the central controller is online and updated.', 409);
      let slot = student.fingerprintSlot ?? null;
      if (slot === null) {
        const prefix = `${this.controllerId}-`;
        const used = new Set((await tx.get(this.db.collection('fingerprintMappings'))).docs
          .filter(d => d.id.startsWith(prefix)).map(d => Number(d.id.slice(prefix.length))));
        for (let i = 1; i < Math.min(capacity, 1000); i++) if (!used.has(i)) { slot = i; break; }
        requireThat(slot !== null, 'Fingerprint sensor is full.', 409);
      }
      claim.write({ mode: 'enroll', studentId, slot, step: 'place_first',
        expiresAt: Timestamp.fromMillis(this.now() + 90000) });
    });
    return this.read(actor, requestId);
  }
  async read(actor, requestId) {
    const r = (await this.ref(requestId).get()).data();
    requireThat(r?.controllerId === this.controllerId, 'Scan request not found.', 404);
    requireThat(r.createdBy === actor.uid, 'Scan belongs to another kiosk.', 403);
    if (r.mode === 'enroll') {
      const state = r.state === 'waiting' && r.expiresAt.toMillis() <= this.now() ? 'expired' : r.state;
      return { requestId, mode: 'enroll', state, step: r.step ?? null, slot: r.slot, studentId: r.studentId,
        duplicateStudentId: r.duplicateStudentId ?? null };
    }
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
  async deviceExchange(input, progressInput, capacityInput) {
    const result = input == null ? null : fingerprintResultSchema.parse(input);
    const progress = progressInput == null ? null : fingerprintProgressSchema.parse(progressInput);
    const capacity = capacityInput == null ? null : fingerprintCapacitySchema.parse(capacityInput);
    if (result) {
      await this.db.runTransaction(async tx => {
        const r = (await tx.get(this.ref(result.requestId))).data();
        if (!r || r.controllerId !== this.controllerId || r.state !== 'waiting' || r.expiresAt.toMillis() <= this.now()) return;
        if (r.mode === 'enroll') return this.finishEnroll(tx, result, r);
        if (!['matched', 'no_match', 'error'].includes(result.state)) {
          tx.update(this.ref(result.requestId), { state: 'error', expiresAt: Timestamp.fromMillis(this.now() + 120000) });
          return;
        }
        const mapping = result.state === 'matched' ? (await tx.get(this.mapping(result.slot))).data() : null;
        tx.update(this.ref(result.requestId), { state: result.state === 'matched' && !mapping ? 'unlinked' : result.state,
          slot: result.slot, studentId: mapping?.studentId ?? null,
          expiresAt: Timestamp.fromMillis(this.now() + 120000) });
      });
    }
    const lock = (await this.lock().get()).data();
    if (capacity && lock?.capacity !== capacity) await this.db.runTransaction(async tx => tx.set(this.lock(), { capacity }, { merge: true }));
    const r = lock?.requestId ? (await this.ref(lock.requestId).get()).data() : null;
    if (progress && progress.requestId === lock?.requestId && r?.mode === 'enroll' && r.state === 'waiting' && r.step !== progress.step) {
      await this.db.runTransaction(async tx => {
        const current = (await tx.get(this.ref(progress.requestId))).data();
        if (current?.state === 'waiting') tx.update(this.ref(progress.requestId), { step: progress.step });
      });
    }
    const request = r?.state === 'waiting' && r.expiresAt.toMillis() > this.now()
      ? { requestId: lock.requestId, expiresAt: r.expiresAt.toDate().toISOString(),
        ...(r.mode === 'enroll' ? { mode: 'enroll', slot: r.slot } : {}) } : null;
    return { fingerprintRequest: request, acknowledgedFingerprint: result?.requestId ?? null };
  }
  // The sensor stores the template before reporting; Firestore links it only
  // when the target slot is still free or already this student's.
  async finishEnroll(tx, result, r) {
    const ref = this.ref(result.requestId);
    if (result.state === 'duplicate') {
      const owner = (await tx.get(this.mapping(result.slot))).data();
      tx.update(ref, { state: 'duplicate', duplicateSlot: result.slot, duplicateStudentId: owner?.studentId ?? null });
      return;
    }
    if (result.state !== 'enrolled' || result.slot !== r.slot) {
      tx.update(ref, { state: result.state === 'mismatch' ? 'mismatch' : 'error' });
      return;
    }
    const studentRef = this.db.doc(`students/${r.studentId}`);
    const [mapping, student] = await tx.getAll(this.mapping(r.slot), studentRef);
    if (!student.exists || (mapping.exists && mapping.data().studentId !== r.studentId)) {
      tx.update(ref, { state: 'conflict' });
      return;
    }
    const previous = student.data().fingerprintSlot;
    if (previous != null && previous !== r.slot) tx.delete(this.mapping(previous));
    tx.set(this.mapping(r.slot), { studentId: r.studentId });
    tx.set(studentRef, { fingerprintSlot: r.slot, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(ref, { state: 'enrolled', step: null });
    this.lab.audit(tx, { uid: r.createdBy }, 'fingerprint_enroll', { studentId: r.studentId, slot: r.slot });
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
