import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Fingerprints, fingerprintResultSchema } from '../src/fingerprints.js';
import { LabService } from '../src/service.js';
import { Store } from '../test-support/store.js';

function fixture() {
  const clock = { now: Date.now() }, db = new Store(() => clock.now);
  const lab = new LabService(db, {});
  const scanner = new Fingerprints(db, 'CENTRAL', lab, { now: () => clock.now });
  const actor = { uid: 'tablet', role: 'kiosk' }, admin = { uid: 'staff', role: 'admin' };
  const student = { name: 'Student', section: 'A', active: true, fingerprintSlot: 1 };
  return { clock, db, scanner, actor, admin, student };
}

test('device results resolve only matching request IDs and linked slots', async () => {
  const { scanner, actor, admin, student } = fixture();
  await scanner.saveStudent(admin, 'S1', student, true);
  const { fingerprintSlot, ...profile } = student;
  await scanner.saveStudent(admin, 'S1', { ...profile, name: 'Updated student' });
  const requestId = randomUUID();
  assert.equal((await scanner.start(actor, requestId)).state, 'waiting');
  assert.equal((await scanner.deviceExchange()).fingerprintRequest.requestId, requestId);
  await scanner.deviceExchange({ requestId: randomUUID(), state: 'matched', slot: 1 });
  assert.equal((await scanner.read(actor, requestId)).state, 'waiting');
  const result = { requestId, state: 'matched', slot: 1 };
  assert.equal((await scanner.deviceExchange(result)).acknowledgedFingerprint, requestId);
  assert.equal((await scanner.read(actor, requestId)).student.id, 'S1');
  await scanner.authorize(actor, requestId, 'S1');
  await assert.rejects(scanner.authorize(actor, requestId, 'OTHER'), { status: 403 });
  await scanner.deviceExchange({ ...result, slot: 2 });
  assert.equal((await scanner.read(actor, requestId)).student.id, 'S1');
  await assert.rejects(scanner.read({ uid: 'other' }, requestId), { status: 403 });
});

test('scan ownership, expiry, cancellation and scanner contention prevent stale acceptance', async () => {
  const { scanner, actor, admin, student, clock } = fixture();
  await scanner.saveStudent(admin, 'S1', student, true);
  const requestId = randomUUID();
  await scanner.start(actor, requestId);
  await scanner.start(actor, requestId); // idempotent start
  await assert.rejects(scanner.start({ uid: 'other' }, requestId), { status: 403 });
  await assert.rejects(scanner.start({ uid: 'other' }, randomUUID()), { status: 409 });
  await assert.rejects(scanner.cancel({ uid: 'other' }, requestId), { status: 403 });
  await scanner.cancel(actor, requestId);
  await scanner.deviceExchange({ requestId, state: 'matched', slot: 1 });
  assert.equal((await scanner.read(actor, requestId)).state, 'canceled');
  const next = randomUUID();
  await scanner.start(actor, next);
  clock.now += 61000;
  await scanner.deviceExchange({ requestId: next, state: 'matched', slot: 1 });
  assert.equal((await scanner.read(actor, next)).state, 'expired');
  assert.equal((await scanner.deviceExchange()).fingerprintRequest, null);
  await assert.rejects(scanner.authorize(actor, next, 'S1'), { status: 403 });
});

test('slot links are unique, atomically updated and cannot expose a reassigned identity', async () => {
  const { scanner, actor, admin, student } = fixture();
  const outcomes = await Promise.allSettled(['S1', 'S2'].map(id => scanner.saveStudent(admin, id, student, true)));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(scanner.saveStudent(admin, 'S1', student, true), { status: 409 });
  const requestId = randomUUID();
  await scanner.start(actor, requestId);
  await scanner.deviceExchange({ requestId, state: 'matched', slot: 1 });
  await scanner.saveStudent(admin, 'S1', { ...student, fingerprintSlot: 2 });
  await assert.rejects(scanner.read(actor, requestId), { status: 409 });
  await scanner.saveStudent(admin, 'S2', student, true);
  await assert.rejects(scanner.read(actor, requestId), { status: 409 });
});

test('unlinked, inactive and failed scans do not identify a student; proofs expire', async () => {
  const { scanner, actor, admin, student, clock } = fixture();
  for (const state of ['no_match', 'error', 'matched']) {
    const requestId = randomUUID();
    await scanner.start(actor, requestId);
    await scanner.deviceExchange({ requestId, state, slot: state === 'matched' ? 7 : null });
    assert.equal((await scanner.read(actor, requestId)).state, state === 'matched' ? 'unlinked' : state);
    await assert.rejects(scanner.authorize(actor, requestId, 'S1'), { status: 403 });
  }
  await scanner.saveStudent(admin, 'S1', { ...student, active: false }, true);
  const requestId = randomUUID();
  await scanner.start(actor, requestId);
  await scanner.deviceExchange({ requestId, state: 'matched', slot: 1 });
  await assert.rejects(scanner.read(actor, requestId), { status: 404 });
  await scanner.saveStudent(admin, 'S1', student);
  await scanner.authorize(actor, requestId, 'S1');
  clock.now += 120001;
  await assert.rejects(scanner.authorize(actor, requestId, 'S1'), { status: 403 });
  assert.equal(fingerprintResultSchema.safeParse({ requestId, state: 'matched', slot: null }).success, false);
  assert.equal(fingerprintResultSchema.safeParse({ requestId, state: 'error', slot: 1 }).success, false);
});
