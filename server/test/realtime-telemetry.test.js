import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtimeTelemetry, ControllerWorkMonitor } from '../src/realtime-telemetry.js';
import { CloudController } from '../src/cloud-controller.js';
import { Store } from '../test-support/store.js';

function fixture() {
  const state = {}, clock = { now: Date.now() };
  const ref = (path = []) => ({
    child: key => ref([...path, key]),
    get: async () => ({ val: () => structuredClone(path.reduce((v, k) => v?.[k], state.root) ?? null) }),
    transaction: async fn => {
      const current = path.reduce((v, k) => v?.[k], state.root) ?? null;
      // Model the Admin SDK's initially empty child-reference cache.
      const initial = path.length ? fn(null) : null;
      const result = path.length && initial === undefined ? undefined : fn(structuredClone(current));
      if (result !== undefined) {
        if (!path.length) state.root = result;
        else { let parent = state.root; for (const key of path.slice(0, -1)) parent = parent[key]; parent[path.at(-1)] = result; }
      }
      return { committed: result !== undefined, snapshot: await ref(path).get() };
    },
  });
  const telemetry = new RealtimeTelemetry({ ref: () => ref() }, 'CENTRAL', { now: () => clock.now });
  const bootId = randomUUID();
  const body = sequence => ({ protocolVersion: 1, bootId, sequence, sampledAt: new Date(clock.now).toISOString(),
    firmwareVersion: 'test', capabilities: [], nodes: [{ nodeId: 'NODE-01', workstationId: 'PC-01', connectivity: 'connected', power: 'off' }], results: [] });
  return { telemetry, clock, body, state };
}

test('idle telemetry requires a durable boot checkpoint and duplicates never refresh freshness', async () => {
  const { telemetry, clock, body } = fixture();
  const first = body(1);
  assert.equal((await telemetry.accept(first, true)).idle, false);
  assert.equal((await telemetry.accept(body(2), true)).idle, false);
  await telemetry.confirmBoot(first.bootId);
  const idle = body(3), reply = await telemetry.accept(idle, true);
  assert.equal(reply.idle, true);
  const received = (await telemetry.read()).receivedAt.toMillis();
  clock.now += 20000;
  assert.deepEqual(await telemetry.accept(idle, false), reply);
  assert.equal((await telemetry.read()).receivedAt.toMillis(), received);
  await assert.rejects(telemetry.accept({ ...idle, firmwareVersion: 'conflict' }, true), { status: 409 });
  await assert.rejects(telemetry.accept(first, true), { status: 409 });
});

test('retired boots cannot return and failed checkpoints cannot enable idle sync', async () => {
  const { telemetry, body } = fixture();
  const a = body(1); await telemetry.accept(a, true); await telemetry.confirmBoot(a.bootId);
  const b = { ...body(1), bootId: randomUUID() }; await telemetry.accept(b, true);
  await telemetry.confirmBoot(a.bootId); // completion from the old boot
  assert.equal((await telemetry.accept({ ...b, sequence: 2 }, true)).idle, false);
  await assert.rejects(telemetry.accept({ ...a, sequence: 100 }, true), { status: 409 });
});

test('workstation status reads realtime telemetry and expires it without Firestore writes', async () => {
  const { telemetry, clock, body } = fixture();
  const db = new Store(), controller = new CloudController(db, 'CENTRAL', { telemetry, now: () => clock.now });
  const report = body(1);
  await telemetry.accept(report, true);
  assert.equal((await controller.status()).connected, false);
  await assert.rejects(controller.nodes(), { status: 503 });
  await telemetry.confirmBoot(report.bootId);
  assert.equal((await controller.status()).connected, true);
  assert.equal((await controller.nodes())[0].power, 'off');
  clock.now += 31000;
  assert.equal((await controller.status()).connected, false);
  await assert.rejects(controller.nodes(), { status: 503 });
  assert.equal(db.docs.size, 0);
});

test('work monitor cannot skip durable exchanges before readiness, on work, or listener failure', () => {
  const callbacks = new Map();
  const target = path => ({ where: () => target(path), onSnapshot: (ok, error) => { callbacks.set(path, { ok, error }); return () => {}; } });
  const monitor = new ControllerWorkMonitor({ collection: target, doc: target }, 'CENTRAL');
  const body = { results: [], fingerprintCapacity: 300 };
  assert.equal(monitor.idle(body), false);
  for (const [path, cb] of callbacks) cb.ok(path.startsWith('fingerprintScanners') ? { data: () => ({ capacity: 300 }) } : { docs: [] });
  assert.equal(monitor.idle(body), true);
  for (const extra of [{ results: [{}] }, { fingerprintResult: {} }, { fingerprintProgress: {} }, { benchResult: {} }, { fingerprintCapacity: 200 }]) assert.equal(monitor.idle({ ...body, ...extra }), false);
  callbacks.get('controllerQueue/CENTRAL/commands').ok({ docs: [{ data: () => ({}) }] });
  assert.equal(monitor.idle(body), false);
  callbacks.get('controllerQueue/CENTRAL/commands').ok({ docs: [] });
  callbacks.get('fingerprintScanners/CENTRAL').error(new Error('offline'));
  assert.equal(monitor.idle(body), false);
  monitor.close();
});
