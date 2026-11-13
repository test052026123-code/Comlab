import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { FingerprintService } from '../src/fingerprint.js';
import { packet, parse } from '../src/as608.js';

// Simulated sensor: `fingers` is a queue of what is on the glass at each poll.
class FakeSensor {
  constructor() { this.templates = new Map([[7, 'old']]); this.glass = []; this.buf = {}; }
  async handshake() { return { capacity: 300 }; }
  async info() { return { capacity: 300, templates: this.templates.size }; }
  async usedSlots() { return [...this.templates.keys()]; }
  place(...seq) { this.glass.push(...seq); }
  next() { return this.glass.length ? this.glass.shift() : null; }
  async capture(b) { const f = this.next(); if (!f) return false; this.buf[b] = f; return true; }
  async fingerPresent() { return !!this.next(); }
  async search() { for (const [slot, f] of this.templates) if (f === this.buf[1]) return { slot, score: 90 }; return null; }
  async storeModel(slot) { if (this.buf[1] !== this.buf[2]) throw Object.assign(new Error('mismatch'), { code: 0x0a }); this.templates.set(slot, this.buf[1]); }
  async remove(slot) { this.templates.delete(slot); }
}
const until = async (svc, id, states) => { for (let i = 0; i < 200; i++) { const j = svc.job(id); if (states.includes(j.state)) return j; await new Promise(r => setTimeout(r, 5)); } throw new Error('timeout'); };

function setup() {
  const db = openDb(':memory:'), s = new FakeSensor();
  const at = new Date().toISOString();
  db.prepare("INSERT INTO students (id,name,created_at,updated_at) VALUES ('S1','Ana',?,?)").run(at, at);
  db.prepare("INSERT INTO students (id,name,created_at,updated_at) VALUES ('S2','Ben',?,?)").run(at, at);
  return { db, s, svc: new FingerprintService(db, s, { pollMs: 1, jobMs: 300 }) };
}
const admin = { id: 'a', role: 'admin' };

test('packet framing round-trips with checksum', () => {
  const p = packet(0x07, [0x00, 0x01, 0x02]);
  const r = parse(Buffer.concat([Buffer.from([0x55]), p]));
  assert.equal(r.pkt.code, 0x00); assert.deepEqual([...r.pkt.data], [1, 2]);
  const bad = Buffer.from(p); bad[bad.length - 1] ^= 1;
  assert.equal(parse(bad).pkt, null);
});

test('enroll: two matching scans store a template in a free slot and link it', async () => {
  const { db, s, svc } = setup(); await svc.start();
  s.place('ana', null, 'ana');
  const j = await until(svc, svc.enroll(admin, 'student', 'S1').id, ['done', 'error']);
  assert.equal(j.state, 'done', j.message); assert.equal(j.slot, 1);
  assert.equal(db.prepare("SELECT fingerprint_slot s FROM students WHERE id='S1'").get().s, 1);
});

test('enroll rejects a finger that already belongs to someone else, and mismatched scans', async () => {
  const { s, svc } = setup(); await svc.start();
  s.place('ana', null, 'ana'); await until(svc, svc.enroll(admin, 'student', 'S1').id, ['done']);
  s.place('ana');
  let j = await until(svc, svc.enroll(admin, 'student', 'S2').id, ['done', 'error']);
  assert.equal(j.state, 'error'); assert.match(j.message, /already enrolled for Ana/);
  s.place('ben', null, 'zed');
  j = await until(svc, svc.enroll(admin, 'student', 'S2').id, ['done', 'error']);
  assert.match(j.message, /did not match/);
});

test('identify: matched gives a usable scanId; unlinked and unknown fingers do not', async () => {
  const { db, s, svc } = setup(); await svc.start();
  s.place('ana', null, 'ana'); await until(svc, svc.enroll(admin, 'student', 'S1').id, ['done']);
  s.place('ana');
  let j = await until(svc, svc.identify({ id: 'k', role: 'kiosk' }).id, ['matched', 'no_match', 'error']);
  assert.equal(j.state, 'matched');
  assert.equal(db.prepare('SELECT person_id FROM scans WHERE id = ?').get(j.scanId).person_id, 'S1');
  s.place('old');   // template on sensor (slot 7) but linked to nobody
  j = await until(svc, svc.identify({ id: 'k', role: 'kiosk' }).id, ['matched', 'no_match']);
  assert.equal(j.state, 'no_match'); assert.match(j.message, /not linked/);
  s.place('stranger');
  j = await until(svc, svc.identify({ id: 'k', role: 'kiosk' }).id, ['matched', 'no_match']);
  assert.equal(j.state, 'no_match');
});

test('identify times out and can be cancelled; enrollment cannot be interrupted', async () => {
  const { svc } = setup(); await svc.start();
  let j = await until(svc, svc.identify({ id: 'k', role: 'kiosk' }).id, ['error']);
  assert.match(j.message, /No finger/);
  const id = svc.identify({ id: 'k', role: 'kiosk' }).id; svc.cancel(id);
  assert.equal((await until(svc, id, ['cancelled'])).state, 'cancelled');
  const e = svc.enroll(admin, 'student', 'S1');
  assert.throws(() => svc.identify({ id: 'k', role: 'kiosk' }), /busy enrolling/);
  svc.cancel(e.id); await until(svc, e.id, ['cancelled']);
});

test('slot overview flags orphans; deleting a slot unlinks the person', async () => {
  const { db, s, svc } = setup(); await svc.start();
  s.place('ana', null, 'ana'); await until(svc, svc.enroll(admin, 'student', 'S1').id, ['done']);
  const o = await svc.slots();
  assert.deepEqual(o.slots.map(x => [x.slot, x.owner?.name ?? null]), [[7, null], [1, 'Ana']]);
  await svc.removeSlot(admin, 1);
  assert.equal(db.prepare("SELECT fingerprint_slot s FROM students WHERE id='S1'").get().s, null);
  assert.equal(s.templates.has(1), false);
});
