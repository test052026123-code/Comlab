import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { CloudController } from '../src/cloud-controller.js';
import { authenticateDevice } from '../src/device-auth.js';
import { LabService } from '../src/service.js';
import { eligible } from '../src/domain.js';
import { Store } from '../test-support/store.js';

const controllerId = 'LAB-CONTROLLER';
function fixture() {
  const clock = { now: Date.now() }, db = new Store(() => clock.now);
  const controller = new CloudController(db, controllerId, { now: () => clock.now });
  const bootId = randomUUID();
  const body = (sequence = 1, overrides = {}) => ({ protocolVersion: 1, bootId, sequence,
    sampledAt: new Date(clock.now).toISOString(), uptimeMs: sequence * 5000, firmwareVersion: 'unit-test', capabilities: ['power_on'],
    nodes: [{ nodeId: 'NODE-01', workstationId: 'PC-01', connectivity: 'connected', power: 'off', reachability: 'unknown', input: 'unknown' }], results: [], ...overrides });
  db.docs.set('students/S1', { name: 'Unit student', section: 'Unit section', active: true });
  db.docs.set('workstations/PC-01', { nodeId: 'NODE-01', enabled: true, maintenance: false, sessionId: null });
  const lab = new LabService(db, controller), actor = { uid: 'unit-kiosk', role: 'kiosk' };
  const reserve = id => lab.reserve(actor, { operationId: id, studentId: 'S1', workstationId: 'PC-01' });
  return { clock, db, controller, body, lab, actor, reserve };
}
test('device key authentication is isolated and rejects missing/wrong credentials', () => {
  const key = 'ab'.repeat(32), hash = createHash('sha256').update(key).digest('hex');
  assert.equal(authenticateDevice({authorization:`Bearer ${key}`, 'x-comlab-controller-id':controllerId}, controllerId,hash),controllerId);
  for (const headers of [{}, {authorization:`Bearer ${'cd'.repeat(32)}`, 'x-comlab-controller-id':controllerId}, {authorization:`Bearer ${key}`, 'x-comlab-controller-id':'OTHER'}]) {
    assert.throws(() => authenticateDevice(headers,controllerId,hash), {status:401});
  }
  assert.throws(() => authenticateDevice({},controllerId,''), {status:503});
});
test('no heartbeat or stale/duplicate telemetry never makes a controller eligible', async () => {
  const {controller,body,clock,db,lab} = fixture();
  await assert.rejects(controller.nodes(),{status:503});
  const report = body(); await controller.sync(report);
  assert.equal((await lab.workstations()).workstations[0].eligible,true);
  const received = db.docs.get(`controllerSnapshots/${controllerId}`).receivedAt.toMillis();
  clock.now += 31000; await controller.sync(report);
  assert.equal(db.docs.get(`controllerSnapshots/${controllerId}`).receivedAt.toMillis(), received);
  await assert.rejects(controller.nodes(),{status:503});
  assert.equal((await lab.workstations()).workstations[0].eligible,false);
});

test('a fresh sequence after a lost response restores availability without refreshing a replay', async () => {
  const { controller, body, clock, lab, db } = fixture();
  const old = body(1);
  await controller.sync(old); // Committed, but response lost on the network.
  clock.now += 31000;
  await controller.sync(old);
  assert.equal((await lab.workstations()).workstations[0].eligible, false);
  await controller.sync(body(2));
  const pc = { ...db.docs.get('workstations/PC-01'), id: 'PC-01' };
  assert.equal(eligible(pc, (await controller.nodes())[0], clock.now), true);
});

test('fresh telemetry after lost command delivery retains command identity and original expiry', async () => {
  const { controller, body, clock, reserve, db } = fixture();
  await controller.sync(body(1));
  const id = randomUUID();
  await reserve(id);
  const lost = await controller.sync(body(2));
  clock.now += 5000;
  const recovered = await controller.sync(body(3));
  assert.deepEqual(recovered.commands, lost.commands);
  assert.equal(recovered.commands[0].commandId, id);
  assert.equal([...db.docs.keys()].filter(k => k.startsWith('commands/')).length, 1);
  assert.equal(db.docs.get(`commands/${id}`).deliveryBootId, body().bootId);
});
test('late samples, future clocks, duplicate mappings, and retired boots fail safely', async () => {
  const {controller,body,clock,lab} = fixture();
  await controller.sync(body(1,{sampledAt:new Date(clock.now-35000).toISOString()}));
  assert.equal((await lab.workstations()).workstations[0].eligible,false);
  await assert.rejects(controller.sync(body(2,{sampledAt:new Date(clock.now+3000).toISOString()})),{status:409});
  await assert.rejects(controller.sync(body(2,{nodes:[...body().nodes,...body().nodes]})),{status:400});
  await controller.sync(body(1,{bootId:randomUUID()}));
  await assert.rejects(controller.sync(body(3)),{status:409});
});
test('reservation and outbound command queue are atomic and retries keep one command', async () => {
  const {controller,body,reserve,db} = fixture(); await controller.sync(body());
  const id = randomUUID(), first = await reserve(id), second = await reserve(id);
  assert.equal(first.command.delivery,'cloud'); assert.equal(second.command.commandId,id);
  assert.equal([...db.docs.keys()].filter(k=>k.startsWith('commands/')).length,1);
  assert.ok(db.docs.has(`controllerQueue/${controllerId}/commands/${id}`));
  const reply = await controller.sync(body(2));
  assert.equal(reply.commands[0].commandId,id);
  assert.equal(reply.commands[0].action,'power_on');
  assert.equal(db.docs.get(`commands/${id}`).deliveryBootId,body().bootId);
});

test('cloud reconciliation only reads authoritative sync state', async () => {
  const {controller,body,reserve,lab,actor,db} = fixture();
  await controller.sync(body());
  const id = randomUUID(); await reserve(id);
  const delivered = await controller.sync(body(2));
  const {expiresAt,...identity} = delivered.commands[0];
  await controller.sync(body(3,{results:[{...identity,state:'accepted'}]}));
  db.runTransaction = async () => { throw new Error('Reconciliation must not write cloud results.'); };
  assert.equal((await lab.reconcile(actor,id)).command.state,'accepted');
});
test('acknowledgement is not confirmation and terminal success needs matching real ON feedback', async () => {
  const {controller,body,reserve,lab,actor,db} = fixture(); await controller.sync(body());
  const id=randomUUID(); await reserve(id); const delivered=await controller.sync(body(2));
  const {expiresAt,...identity}=delivered.commands[0];
  await controller.sync(body(3,{results:[{...identity,state:'accepted'}]}));
  await assert.rejects(lab.close(actor,id,'unit-checkout'), /pending or unknown/);
  await assert.rejects(controller.sync(body(4,{results:[{...identity,state:'confirmed_on'}]})), /feedback/);
  const success = body(4,{nodes:body().nodes.map(n=>({...n,power:'on'})),results:[{...identity,state:'confirmed_on'}]});
  await controller.sync(success);
  assert.equal(db.docs.get(`commands/${id}`).state,'confirmed_on');
  assert.equal(db.docs.get('workstations/PC-01').assignment,'in use');
  await controller.sync(success);
  await lab.close(actor,id,'unit-checkout');
  assert.equal(db.docs.get(`sessions/${id}`).status,'closed');
});
test('command identity mismatch and terminal-state changes cannot alter a reservation', async () => {
  const {controller,body,reserve,db}=fixture();await controller.sync(body());
  const id=randomUUID();await reserve(id);const delivered=await controller.sync(body(2));
  const {expiresAt,...identity}=delivered.commands[0];
  await assert.rejects(controller.sync(body(3,{results:[{...identity,nodeId:'OTHER',state:'rejected'}]})), /identity/);
  assert.equal(db.docs.get(`commands/${id}`).state,'pending');
  await controller.sync(body(3,{results:[{...identity,state:'rejected'}]}));
  await assert.rejects(controller.sync(body(4,{results:[{...identity,state:'failed'}]})), /Terminal/);
  assert.equal(db.docs.get(`commands/${id}`).state,'rejected');
});
test('expired undelivered commands reject; delivered/restarted work stays unknown and is never redispatched', async () => {
  for (const delivered of [false,true]) {
    const {controller,body,reserve,db,clock}=fixture();await controller.sync(body());
    const id=randomUUID();await reserve(id);
    if(delivered) await controller.sync(body(2));
    clock.now+=31000;
    const reply=await controller.sync(body(3));
    assert.deepEqual(reply.commands,[]);
    assert.equal(db.docs.get(`commands/${id}`).state,delivered?'unknown':'rejected');
    const afterRestart=await controller.sync(body(1,{bootId:randomUUID()}));
    assert.deepEqual(afterRestart.commands,[]);
  }
});
test('controller restart before expiry never redelivers a previously delivered command', async () => {
  const {controller,body,reserve,db}=fixture();await controller.sync(body());
  const id=randomUUID();await reserve(id);await controller.sync(body(2));
  const next=await controller.sync(body(1,{bootId:randomUUID()}));
  assert.deepEqual(next.commands,[]);assert.equal(db.docs.get(`commands/${id}`).state,'unknown');
});
test('acknowledged work also becomes unknown after controller restart without any new delivery', async () => {
  const {controller,body,reserve,db}=fixture();await controller.sync(body());
  const id=randomUUID();await reserve(id);const response=await controller.sync(body(2));
  const {expiresAt,...identity}=response.commands[0];
  await controller.sync(body(3,{results:[{...identity,state:'accepted'}]}));
  const next=await controller.sync(body(1,{bootId:randomUUID()}));
  assert.deepEqual(next.commands,[]);assert.equal(db.docs.get(`commands/${id}`).state,'unknown');
});
test('connection-test capabilities reject power requests and empty telemetry creates no fake nodes', async () => {
  const {controller,body,reserve,db}=fixture();await controller.sync(body());
  const id=randomUUID();await reserve(id);
  const report=body(2,{nodes:[],capabilities:[]});const reply=await controller.sync(report);
  assert.deepEqual(reply.commands,[]);assert.deepEqual(await controller.nodes(),[]);
  assert.equal(db.docs.get(`commands/${id}`).state,'rejected');
});
test('conflicting same-sequence requests cannot refresh or replace status', async () => {
  const {controller,body,db}=fixture();await controller.sync(body());
  await assert.rejects(controller.sync(body(1,{nodes:[]})),/sequence/);
  assert.equal(db.docs.get(`controllerSnapshots/${controllerId}`).nodes.length,1);
});

test('discovery-only connected nodes stay unavailable while power is unknown', async () => {
  const {controller,body,lab,reserve,db}=fixture();
  const report=body(1,{capabilities:[],nodes:body().nodes.map(n=>({...n,power:'unknown',reachability:'unknown',input:'unknown'}))});
  const reply=await controller.sync(report);
  assert.deepEqual(reply.commands,[]);
  const pc=(await lab.workstations()).workstations[0];
  assert.equal(pc.node.connectivity,'connected');
  assert.equal(pc.node.power,'unknown');
  assert.equal(pc.eligible,false);
  await assert.rejects(reserve(randomUUID()));
  assert.equal([...db.docs.keys()].some(k=>k.startsWith('sessions/')),false);
});

test('fresh higher sequence recovers aged startup feedback without redispatching the command', async () => {
  const {controller,body,reserve,clock,db}=fixture();
  await controller.sync(body());
  const id=randomUUID(); await reserve(id);
  const delivered=await controller.sync(body(2));
  const {expiresAt,...identity}=delivered.commands[0];
  await controller.sync(body(3,{results:[{...identity,state:'accepted'}]}));
  const oldSample=new Date(clock.now).toISOString();
  clock.now+=16000;
  const on=body().nodes.map(n=>({...n,power:'on'}));
  await assert.rejects(controller.sync(body(4,{sampledAt:oldSample,nodes:on,
    results:[{...identity,state:'confirmed_on'}]})),/fresh matching power feedback/);
  const refreshed=body(5,{nodes:on,results:[{...identity,state:'confirmed_on'}]});
  const reply=await controller.sync(refreshed);
  assert.deepEqual(reply.commands,[]);
  assert.equal(db.docs.get(`commands/${id}`).state,'confirmed_on');
  assert.equal(db.docs.has(`controllerQueue/${controllerId}/commands/${id}`),false);
  assert.deepEqual((await controller.sync(refreshed)).commands,[]);
});
