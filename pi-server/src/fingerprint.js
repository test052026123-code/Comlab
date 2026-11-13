// Runs one fingerprint job at a time (identify or enroll) against the sensor.
// The tablet starts a job, then polls its state.
import { randomUUID } from 'node:crypto';
import { recordScan, audit, recordChange, nowIso } from './lab.js';
import { Fault, requireThat } from './errors.js';

const POLL_MS = 250, JOB_MS = 30_000, KEEP_MS = 5 * 60_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class FingerprintService {
  constructor(db, sensor, { pollMs = POLL_MS, jobMs = JOB_MS } = {}) {
    this.db = db; this.sensor = sensor; this.pollMs = pollMs; this.jobMs = jobMs;
    this.jobs = new Map(); this.active = null; this.capacity = 300; this.ready = false; this.lastError = null;
  }
  async start() {
    try { this.sensor.open?.(); this.capacity = (await this.sensor.handshake()).capacity; this.ready = true; this.lastError = null; }
    catch (e) { this.ready = false; this.lastError = e.message; console.error('Fingerprint sensor unavailable:', e.message); }
    return this.ready;
  }
  async status() {
    if (!this.ready) await this.start();
    if (!this.ready) return { ready: false, error: this.lastError };
    if (this.active) return { ready: true, busy: this.active.kind, capacity: this.capacity };
    const info = await this.sensor.info();
    return { ready: true, ...info };
  }

  job(id) {
    const j = this.jobs.get(id);
    requireThat(j, 'Fingerprint request not found or expired.', 404);
    const { kind, state, message, scanId, slot, at } = j;
    return { id, kind, state, message, scanId, slot, at };
  }
  cancel(id) {
    const j = this.jobs.get(id);
    if (j && !j.done) Object.assign(j, { cancelled: true });
    return { id, cancelled: true };
  }

  begin(kind, run, actor) {
    requireThat(this.ready, `Fingerprint sensor is not ready${this.lastError ? `: ${this.lastError}` : ''}.`, 503);
    // A new identify request replaces a waiting identify; it never interrupts enrollment.
    if (this.active) {
      requireThat(this.active.kind === 'identify' && kind === 'identify', 'The fingerprint sensor is busy enrolling. Try again shortly.', 409);
      this.active.cancelled = true;
    }
    const j = { id: randomUUID(), kind, state: 'waiting', message: 'Place your finger on the scanner.', at: nowIso(), actor };
    this.jobs.set(j.id, j);
    const prev = this.active?.promise ?? Promise.resolve();
    this.active = j;
    j.promise = prev.catch(() => {}).then(() => run(j)).catch(e => this.fail(j, e)).finally(() => {
      j.done = true; if (this.active === j) this.active = null;
      setTimeout(() => this.jobs.delete(j.id), KEEP_MS).unref?.();
    });
    return this.job(j.id);
  }
  fail(j, e) {
    if (j.state === 'cancelled') return;
    Object.assign(j, { state: 'error', message: e instanceof Fault ? e.message : `Scanner error: ${e.message}` });
    if (/did not answer/.test(e.message)) this.ready = false;
  }
  set(j, state, message, extra = {}) { if (!j.cancelled) Object.assign(j, { state, message, ...extra }); }

  // Wait until a finger image is captured into the given buffer.
  async waitFinger(j, buffer, deadline) {
    for (;;) {
      if (j.cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });
      if (Date.now() > deadline) throw new Fault(408, 'No finger detected. Try again.');
      try { if (await this.sensor.capture(buffer)) return; }
      catch (e) { if (![0x03, 0x06, 0x07, 0x15].includes(e.code)) throw e; this.set(j, j.state, 'Image unclear. Press your finger flat and still.'); }
      await sleep(this.pollMs);
    }
  }
  async waitRemoved(j, deadline) {
    while (await this.sensor.fingerPresent().catch(() => true)) {
      if (j.cancelled || Date.now() > deadline) throw new Fault(408, 'Lift your finger and try again.');
      await sleep(this.pollMs);
    }
  }

  identify(actor) {
    return this.begin('identify', async j => {
      const deadline = Date.now() + this.jobMs;
      try {
        await this.waitFinger(j, 1, deadline);
        const hit = await this.sensor.search(this.capacity);
        if (!hit) return this.set(j, 'no_match', 'Fingerprint not recognised. Try again or ask the administrator.');
        const scanId = recordScan(this.db, hit.slot);
        const scan = this.db.prepare('SELECT person_type FROM scans WHERE id = ?').get(scanId);
        this.set(j, scan.person_type ? 'matched' : 'no_match',
          scan.person_type ? 'Fingerprint verified.' : 'This fingerprint is stored but not linked to anyone. Ask the administrator.', { scanId });
      } catch (e) { if (e.cancelled) return Object.assign(j, { state: 'cancelled', message: 'Cancelled.' }); throw e; }
    }, actor);
  }

  // personType: 'student' | 'staff'
  enroll(actor, personType, personId) {
    const table = personType === 'student' ? 'students' : 'users';
    const person = this.db.prepare(`SELECT id, name, fingerprint_slot FROM ${table} WHERE id = ?`).get(personId);
    requireThat(person, 'Person not found.', 404);
    return this.begin('enroll', async j => {
      const deadline = Date.now() + this.jobMs * 2;
      try {
        const slot = await this.freeSlot(person.fingerprint_slot);
        this.set(j, 'first', `Enrolling ${person.name}. Place finger on the scanner.`, { slot });
        await this.waitFinger(j, 1, deadline);
        const dup = await this.sensor.search(this.capacity);
        if (dup && dup.slot !== person.fingerprint_slot) {
          const owner = this.owner(dup.slot);
          throw new Fault(409, `This finger is already enrolled${owner ? ` for ${owner}` : ` in slot ${dup.slot}`}.`);
        }
        this.set(j, 'remove', 'Lift your finger.');
        await this.waitRemoved(j, deadline);
        this.set(j, 'second', 'Place the same finger again.');
        await this.waitFinger(j, 2, deadline);
        try { await this.sensor.storeModel(slot); }
        catch (e) { if (e.code === 0x0a) throw new Fault(422, 'The two scans did not match. Start again with the same finger.'); throw e; }
        if (person.fingerprint_slot != null && person.fingerprint_slot !== slot) await this.sensor.remove(person.fingerprint_slot).catch(() => {});
        this.db.prepare(`UPDATE ${table} SET fingerprint_slot = ?, updated_at = ? WHERE id = ?`).run(slot, nowIso(), personId);
        audit(this.db, actor, 'fingerprint.enroll', personId, { personType, slot });
        recordChange(this.db, table, personId, 'upsert');
        this.set(j, 'done', `Fingerprint saved for ${person.name}.`, { slot });
      } catch (e) { if (e.cancelled) return Object.assign(j, { state: 'cancelled', message: 'Enrollment cancelled.' }); throw e; }
    }, actor);
  }

  owner(slot) {
    const r = this.db.prepare(`SELECT name FROM students WHERE fingerprint_slot = ? UNION ALL SELECT name FROM users WHERE fingerprint_slot = ?`).get(slot, slot);
    return r?.name;
  }
  async freeSlot(current) {
    if (current != null) return current;        // re-enroll overwrites the person's own slot
    const used = new Set(await this.sensor.usedSlots(this.capacity));
    for (const r of this.db.prepare('SELECT fingerprint_slot s FROM students WHERE s IS NOT NULL UNION SELECT fingerprint_slot FROM users WHERE fingerprint_slot IS NOT NULL').all()) used.add(r.s);
    for (let s = 1; s < this.capacity; s++) if (!used.has(s)) return s;
    throw new Fault(507, 'The fingerprint sensor is full.');
  }

  // Slot overview for the dashboard: which sensor slots are linked, and orphans.
  async slots() {
    requireThat(this.ready && !this.active, 'Sensor busy or not ready.', 409);
    const used = await this.sensor.usedSlots(this.capacity);
    const linked = new Map(this.db.prepare(`SELECT fingerprint_slot slot, 'student' type, id, name FROM students WHERE slot IS NOT NULL
      UNION ALL SELECT fingerprint_slot, 'staff', id, name FROM users WHERE fingerprint_slot IS NOT NULL`).all().map(r => [r.slot, r]));
    return {
      capacity: this.capacity,
      slots: used.map(s => ({ slot: s, owner: linked.get(s) ?? null })),
      missingOnSensor: [...linked.values()].filter(r => !used.includes(r.slot)),
    };
  }
  async removeSlot(actor, slot) {
    requireThat(this.ready && !this.active, 'Sensor busy or not ready.', 409);
    await this.sensor.remove(slot);
    for (const t of ['students', 'users']) {
      const r = this.db.prepare(`SELECT id FROM ${t} WHERE fingerprint_slot = ?`).get(slot);
      if (r) { this.db.prepare(`UPDATE ${t} SET fingerprint_slot = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), r.id); recordChange(this.db, t, r.id, 'upsert'); }
    }
    audit(this.db, actor, 'fingerprint.delete', String(slot));
    return { deleted: slot };
  }
}
