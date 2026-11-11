import test from 'node:test';
import assert from 'node:assert/strict';
import { LabService } from '../src/service.js';
import { commandResult, csv, eligible, approvedRole } from '../src/domain.js';

import { Store } from '../test-support/store.js';

function fixture(power = 'off') {
  const db = new Store();
  for (const student of ['S1','S2']) db.docs.set(`students/${student}`, { name: student, section: 'Test section', active: true });
  for (const pc of ['PC-01','PC-02']) db.docs.set(`workstations/${pc}`, { nodeId: `NODE-${pc}`, enabled: true, maintenance: false, sessionId: null, assignment:'available' });
  const controller = { nodes: async () => ['PC-01','PC-02'].map(pc => ({ workstationId:pc,nodeId:`NODE-${pc}`,power,connectivity:'connected',observedAt:new Date().toISOString() })), command: async c => ({ ...c, state:'accepted' }) };
  return { db, controller, lab:new LabService(db,controller), actor:{uid:'approved-kiosk',role:'kiosk'} };
}
const request = (operationId, studentId='S1', workstationId='PC-01') => ({operationId,studentId,workstationId});

for (const power of ['off', 'on']) test(`report ends a session atomically and holds the PC: ${power}`, async () => {
  const { lab, actor, db } = fixture(power);
  await lab.reserve(actor, request('report-op'));
  const command = db.docs.get('commands/report-op');
  if (command) {
    db.docs.set('commands/report-op', { ...command, state: 'unknown', delivery: 'cloud', controllerId: 'CENTRAL' });
    db.docs.set('controllerQueue/CENTRAL/commands/report-op', { commandId: 'report-op' });
  }
  const report = await lab.issue(actor, { sessionId: 'report-op', description: 'PC did not start' });
  assert.equal(report.sessionClosed, true);
  assert.equal(db.docs.get('sessions/report-op').status, 'closed');
  assert.equal(db.docs.get('issues/report-op').description, 'PC did not start');
  assert.ok(!db.docs.has('activeStudents/S1'));
  assert.equal(db.docs.get('workstations/PC-01').sessionId, null);
  assert.equal(db.docs.get('workstations/PC-01').maintenance, true);
  assert.equal(db.docs.get('workstations/PC-01').assignment, 'maintenance');
  assert.ok(!db.docs.has('controllerQueue/CENTRAL/commands/report-op'));
  if (command) assert.equal(db.docs.get('commands/report-op').state, 'unknown');
  const end = db.docs.get('sessions/report-op').timeOut;
  assert.deepEqual(await lab.issue(actor, { sessionId: 'report-op', description: 'Retry' }), report);
  assert.equal(db.docs.get('sessions/report-op').timeOut, end);
  assert.equal([...db.docs.keys()].filter(k => k.startsWith('issues/')).length, 1);
});

test('report repairs a manually deleted session only from matching records', async () => {
  const { lab, actor, db } = fixture();
  await lab.reserve(actor, request('deleted-op'));
  db.docs.delete('sessions/deleted-op');
  await lab.issue(actor, { sessionId: 'deleted-op', description: 'Failed startup' });
  assert.equal(db.docs.get('sessions/deleted-op').status, 'closed');
  assert.equal(db.docs.get('sessions/deleted-op').recoveredAfterDeletion, true);
  assert.equal(db.docs.get('sessions/deleted-op').studentId, 'S1');
  assert.ok(!db.docs.has('activeStudents/S1'));
});

test('report refuses another kiosk and conflicting assignments without partial writes', async () => {
  const { lab, actor, db } = fixture();
  await lab.reserve(actor, request('owned-op'));
  const other = { role: 'kiosk', uid: 'other-kiosk' };
  await assert.rejects(lab.issue(other, { sessionId: 'owned-op', description: 'Wrong owner' }), /another kiosk/);
  db.docs.delete('sessions/owned-op');
  await assert.rejects(lab.issue(other, { sessionId: 'owned-op', description: 'Wrong owner' }), /another kiosk/);
  db.docs.set('workstations/PC-01', { ...db.docs.get('workstations/PC-01'), sessionId: 'new-session' });
  await assert.rejects(lab.issue(actor, { sessionId: 'owned-op', description: 'Stale' }), /Assignment changed/);
  assert.ok(!db.docs.has('issues/owned-op'));
  assert.ok(!db.docs.has('sessions/owned-op'));
  assert.equal(db.docs.get('activeStudents/S1').sessionId, 'owned-op');
  assert.equal(db.docs.get('workstations/PC-01').sessionId, 'new-session');
});

test('report retry cannot close a newer assignment or expose another kiosk report', async () => {
  const { lab, actor, db } = fixture('on');
  await lab.reserve(actor, request('old-op'));
  await lab.issue(actor, { sessionId: 'old-op', description: 'Keyboard broken' });
  db.docs.set('workstations/PC-01', { ...db.docs.get('workstations/PC-01'), maintenance: false });
  await lab.reserve(actor, request('new-op'));
  await lab.issue(actor, { sessionId: 'old-op', description: 'Retry' });
  assert.equal(db.docs.get('workstations/PC-01').sessionId, 'new-op');
  assert.equal(db.docs.get('sessions/new-op').status, 'active');
  await assert.rejects(lab.issue({ uid: 'other', role: 'kiosk' }, { sessionId: 'old-op', description: 'Retry' }), /another kiosk/);
});
test('competing students cannot receive the same PC', async () => {
  const {lab,actor,db} = fixture();
  const results = await Promise.allSettled([lab.reserve(actor,request('op1')),lab.reserve(actor,request('op2','S2'))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal([...db.docs.keys()].filter(k=>k.startsWith('sessions/')).length,1);
});
test('same student cannot hold two active PCs', async () => {
  const {lab,actor} = fixture();
  const results=await Promise.allSettled([lab.reserve(actor,request('op1')),lab.reserve(actor,request('op2','S1','PC-02'))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('duplicate operation produces one session and command, even after controller outage', async()=>{
  const {lab,actor,db,controller}=fixture(); await lab.reserve(actor,request('op1'));
  controller.nodes=async()=>{throw new Error('offline');};
  await lab.reserve(actor,request('op1'));
  assert.equal([...db.docs.keys()].filter(k=>k.startsWith('sessions/')).length,1);
  assert.equal([...db.docs.keys()].filter(k=>k.startsWith('commands/')).length,1);
  await assert.rejects(lab.reserve(actor,request('op1','S2')),/another request/);
});
test('pending and accepted power commands block checkout; confirmed checkout is idempotent',async()=>{
  const {lab,actor,db}=fixture();await lab.reserve(actor,request('op1'));
  await assert.rejects(lab.close(actor,'op1','checkout'),/pending or unknown/);
  await lab.reconcile(actor,'op1');assert.equal(db.docs.get('commands/op1').state,'accepted');
  await assert.rejects(lab.close(actor,'op1','checkout'),/pending or unknown/);
  db.docs.set('commands/op1',{...db.docs.get('commands/op1'),state:'confirmed_on'});
  await lab.close(actor,'op1','checkout');const end=db.docs.get('sessions/op1').timeOut;
  await lab.close(actor,'op1','checkout');assert.equal(db.docs.get('sessions/op1').timeOut,end);
  assert.ok(!db.docs.has('activeStudents/S1'));assert.equal(db.docs.get('workstations/PC-01').sessionId,null);
});
for (const state of ['pending', 'accepted', 'unknown']) test(`fingerprint-verified student ends a session with unconfirmed power: ${state}`, async () => {
  const { lab, actor, db } = fixture();
  await lab.reserve(actor, request('op1'));
  const command = { ...db.docs.get('commands/op1'), state, delivery: 'cloud', controllerId: 'LAB' };
  db.docs.set('commands/op1', command);
  db.docs.set('controllerQueue/LAB/commands/op1', { createdAt: 1 });
  await assert.rejects(lab.close(actor, 'op1', 'checkout'), /pending or unknown/);
  await lab.close(actor, 'op1', 'checkout', { studentVerified: true });
  assert.equal(db.docs.get('sessions/op1').status, 'closed');
  assert.ok(!db.docs.has('activeStudents/S1'));
  assert.equal(db.docs.get('workstations/PC-01').sessionId, null);
  assert.equal(db.docs.get('workstations/PC-01').assignment, 'available');
  assert.ok(!db.docs.has('controllerQueue/LAB/commands/op1'));
  assert.ok([...db.docs.entries()].some(([path, record]) => path.startsWith('audit/') &&
    record.action === 'close_session' && record.data.studentEndedUnconfirmedPower === true && record.data.commandState === state));
});
test('PC already on creates no command',async()=>{
  const {lab,actor,db}=fixture('on');const result=await lab.reserve(actor,request('op1'));
  assert.equal(result.command,null);assert.equal(db.docs.get('workstations/PC-01').assignment,'in use');
  await lab.close(actor,'op1','checkout');assert.equal(db.docs.get('sessions/op1').status,'closed');
});

test('staff closure repairs a missing student marker when the PC still belongs to that session', async () => {
  const { lab, actor, db } = fixture('on');
  await lab.reserve(actor, request('repair-op'));
  db.docs.delete('activeStudents/S1');
  await assert.rejects(lab.close(actor, 'repair-op', 'Checkout'), /Assignment integrity/);
  await lab.close({ uid: 'staff', role: 'admin' }, 'repair-op', 'Repair manually deleted marker');
  assert.equal(db.docs.get('sessions/repair-op').status, 'closed');
  assert.equal(db.docs.get('workstations/PC-01').sessionId, null);
  assert.ok([...db.docs.entries()].some(([path, record]) => path.startsWith('audit/') &&
    record.action === 'close_session' && record.data.repairedMissingStudentAssignment === true));
});

test('staff missing-marker recovery never bypasses unresolved power or another student assignment', async () => {
  const { lab, actor, db } = fixture();
  const staff = { uid: 'staff', role: 'admin' };
  await lab.reserve(actor, request('blocked-op'));
  db.docs.delete('activeStudents/S1');
  await assert.rejects(lab.close(staff, 'blocked-op', 'Close'), /pending or unknown/);
  db.docs.set('commands/blocked-op', { ...db.docs.get('commands/blocked-op'), state: 'rejected' });
  db.docs.set('activeStudents/S1', { sessionId: 'another-session' });
  await assert.rejects(lab.close(staff, 'blocked-op', 'Close'), /Assignment integrity/);
  assert.equal(db.docs.get('sessions/blocked-op').status, 'active');
  assert.equal(db.docs.get('activeStudents/S1').sessionId, 'another-session');
  assert.equal(db.docs.get('workstations/PC-01').sessionId, 'blocked-op');
});
test('disabled, maintenance, stale, disconnected, unmapped and unknown-power nodes are excluded',()=>{
  const pc={id:'PC-01',nodeId:'N1',enabled:true,maintenance:false,sessionId:null};
  const n={workstationId:'PC-01',nodeId:'N1',power:'off',connectivity:'connected',observedAt:new Date().toISOString()};
  assert.ok(eligible(pc,n));
  for(const p of [{...pc,enabled:false},{...pc,maintenance:true},{...pc,sessionId:'busy'}]) assert.ok(!eligible(p,n));
  for(const node of [{...n,power:'unknown'},{...n,connectivity:'disconnected'},{...n,nodeId:'other'},{...n,observedAt:new Date(Date.now()-16000).toISOString()}]) assert.ok(!eligible(pc,node));
});
test('reassignment atomically closes old session and changes active assignment',async()=>{
  const {lab,actor,db}=fixture('on');await lab.reserve(actor,request('op1'));const admin={uid:'staff',role:'admin'};
  await lab.reassign(admin,{sessionId:'op1',operationId:'op2',workstationId:'PC-02',reason:'Keyboard failure'});
  assert.equal(db.docs.get('sessions/op1').status,'closed');assert.equal(db.docs.get('activeStudents/S1').sessionId,'op2');
  assert.equal(db.docs.get('workstations/PC-01').sessionId,null);assert.equal(db.docs.get('workstations/PC-02').sessionId,'op2');
});
test('canceled uncommitted operation cannot commit late',async()=>{
  const {lab,actor,db}=fixture(); await lab.cancelUncommitted({uid:'staff',role:'admin'},'op1');
  await assert.rejects(lab.reserve(actor,request('op1')),/canceled/);assert.ok(!db.docs.has('sessions/op1'));
});
test('cannot cancel a committed reservation',async()=>{
  const {lab,actor}=fixture();await lab.reserve(actor,request('op1'));
  await assert.rejects(lab.cancelUncommitted({uid:'staff',role:'admin'},'op1'),/already committed/);
});
test('controller accepted result is not startup confirmation; invalid result is rejected',()=>{
  assert.equal(commandResult({state:'accepted'}),'accepted');assert.throws(()=>commandResult({state:'on'}),/invalid/);
});
test('CSV quotes names and protects spreadsheet formula injection',()=>{
  const output=csv([{id:'one',name:'=1+1',section:'A,"B"'}]);assert.ok(output.includes('"\'=1+1"'));assert.ok(output.includes('"A,""B"""'));
});
test('unapproved, disabled and missing users cannot receive kiosk or admin access',()=>{
  assert.equal(approvedRole(null,null),null);
  assert.equal(approvedRole({enabled:true,role:'kiosk'},null),null);
  assert.equal(approvedRole({enabled:false,role:'admin'},{approved:true}),null);
  assert.equal(approvedRole({enabled:true,role:'unknown'},{approved:true}),null);
  assert.equal(approvedRole({enabled:true,role:'kiosk'},{approved:true}),'kiosk');
  assert.equal(approvedRole({enabled:true,role:'admin'},null),'admin');
});
test('two PC editors cannot map the same node and active mapping cannot change',async()=>{
  const {lab,db}=fixture(); const admin={uid:'staff',role:'admin'};
  const values={nodeId:'SHARED',enabled:true,maintenance:false,notes:''};
  const attempts=await Promise.allSettled([lab.save(admin,'workstations','PC-03',values),lab.save(admin,'workstations','PC-04',values)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  db.docs.set('workstations/PC-01',{nodeId:'NODE-PC-01',sessionId:'busy'});
  await assert.rejects(lab.save(admin,'workstations','PC-01',{...values,nodeId:'NEW'}),/Close the active session/);
});
