import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { RelayBenchTests } from '../src/relay-bench.js';
import { LabService } from '../src/service.js';
import { Store } from '../test-support/store.js';

function fixture() {
  const clock = { now: Date.now() }, db = new Store(() => clock.now);
  const bench = new RelayBenchTests(db, 'CENTRAL', new LabService(db, {}), { now: () => clock.now });
  const actor = { uid: 'staff', role: 'admin' };
  const body = () => ({ commandId: randomUUID(), workstationId: 'PC-01' });
  db.docs.set('workstations/PC-01', { nodeId: 'NODE-01', enabled: true, maintenance: false, sessionId: null });
  function fresh() { db.docs.set('controllerSnapshots/CENTRAL', {
    receivedAt: Timestamp.fromMillis(clock.now), benchSupported: true, benchNodes: ['NODE-01'],
    nodes: [{ nodeId: 'NODE-01', workstationId: 'PC-01', connectivity: 'connected', power: 'unknown', observedAt: new Date(clock.now).toISOString() }],
  }); }
  fresh();
  return { clock, db, bench, actor, body, fresh };
}

test('admin diagnostic pulses allow unknown PC power without changing availability or creating sessions', async () => {
  const { db, bench, actor, body } = fixture(), request = body();
  const before = JSON.stringify(db.docs.get('workstations/PC-01'));
  const started = await bench.start(actor, request);
  assert.equal(started.state, 'pending');
  assert.equal(started.expiresAtMs - started.issuedAtMs, 30000);
  assert.equal(started.action, 'relay_bench_pulse');
  assert.deepEqual(await bench.start(actor, request), started);
  assert.equal((await bench.deviceExchange(null, true)).benchCommand.commandId, request.commandId);
  assert.equal((await bench.deviceExchange(null, false)).benchCommand, null);
  await assert.rejects(bench.start({ uid: 'kiosk', role: 'kiosk' }, body()), { status: 403 });
  await assert.rejects(bench.read({ role: 'kiosk' }, request.commandId), { status: 403 });
  assert.equal(JSON.stringify(db.docs.get('workstations/PC-01')), before);
  assert.ok(![...db.docs.keys()].some(k => k.startsWith('sessions/') || k.startsWith('commands/')));
});

test('unknown request outcomes and duplicate device results never enqueue a new test', async () => {
  const { bench, actor, body, clock } = fixture(), request = body();
  await bench.start(actor, request);
  const result = { ...request, nodeId: 'NODE-01', state: 'pulse_finished' };
  await assert.rejects(bench.deviceExchange({ ...result, nodeId: 'OTHER' }, true), { status: 409 });
  const reply = await bench.deviceExchange(result, true);
  assert.equal(reply.acknowledgedBench, request.commandId);
  assert.equal(reply.benchCommand, null);
  await bench.deviceExchange({ ...result, state: 'unknown' }, true);
  assert.equal((await bench.read(actor, request.commandId)).state, 'pulse_finished');
  clock.now += 31000;
  assert.equal((await bench.start(actor, request)).state, 'pulse_finished');
});

test('stale, unsupported, mismapped and assigned nodes reject relay tests', async () => {
  for (const mode of ['stale', 'unsupported', 'oldNode', 'mismatch', 'assigned', 'disconnected']) {
    const { db, bench, actor, body, clock } = fixture();
    const s = db.docs.get('controllerSnapshots/CENTRAL');
    if (mode === 'stale') clock.now += 16000;
    if (mode === 'unsupported') s.benchSupported = false;
    if (mode === 'oldNode') s.benchNodes = [];
    if (mode === 'mismatch') s.nodes[0].nodeId = 'OTHER';
    if (mode === 'assigned') db.docs.get('workstations/PC-01').sessionId = 'active';
    if (mode === 'disconnected') s.nodes[0].connectivity = 'disconnected';
    await assert.rejects(bench.start(actor, body()), { status: 409 });
  }
});

test('one pending test wins concurrent requests and expires without delayed dispatch', async () => {
  const { bench, actor, body, clock, fresh } = fixture();
  const outcomes = await Promise.allSettled([bench.start(actor, body()), bench.start(actor, body())]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const first = outcomes.find(r => r.status === 'fulfilled').value;
  await assert.rejects(bench.start({ uid: 'other', role: 'admin' }, first), { status: 409 });
  clock.now += 31000;
  assert.equal((await bench.deviceExchange(null, true)).benchCommand, null);
  assert.equal((await bench.read(actor, first.commandId)).state, 'unknown');
  assert.equal((await bench.start(actor, { commandId: first.commandId, workstationId: 'PC-01' })).state, 'unknown');
  fresh();
  assert.equal((await bench.start(actor, body())).state, 'pending');
});

test('a late signed node completion resolves an expired delivery without redispatch', async () => {
  const { bench, actor, body, clock } = fixture(), request = body();
  await bench.start(actor, request);
  clock.now += 31000;
  assert.equal((await bench.read(actor, request.commandId)).state, 'unknown');
  const reply = await bench.deviceExchange({ ...request, nodeId: 'NODE-01', state: 'pulse_finished' }, true);
  assert.equal(reply.benchCommand, null);
  assert.equal((await bench.read(actor, request.commandId)).state, 'pulse_finished');
});
