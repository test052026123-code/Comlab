import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { recordScan } from '../src/lab.js';

let server, base, db, admin, kiosk;
const call = async (method, path, body, token, extra = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
};
const beat = (nodeId, power) => call('POST', '/node/heartbeat', { nodeId, power }, null, { 'x-node-key': 'k' });

before(async () => {
  db = openDb(':memory:');
  server = createApp(db, { nodeKey: 'k' }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('first-run admin setup, then setup locks', async () => {
  assert.equal((await call('GET', '/setup/status')).body.needsAdmin, true);
  const r = await call('POST', '/setup/admin', { username: 'admin', name: 'Lab Admin', password: 'correct-horse' });
  assert.equal(r.status, 200); admin = r.body.token;
  assert.equal((await call('POST', '/setup/admin', { username: 'x2', name: 'X', password: 'correct-horse' })).status, 403);
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'wrong-pass' })).status, 401);
  kiosk = (await call('POST', '/kiosks/pair', { name: 'Tablet' }, admin)).body.token;
});

test('admin builds the lab: section, subject, class, students, PCs', async () => {
  const sec = (await call('POST', '/api/sections', { name: 'BSIT 2A' }, admin)).body;
  const sub = (await call('POST', '/api/subjects', { code: 'IT201', title: 'Networking' }, admin)).body;
  for (let d = 0; d < 7; d++) assert.equal((await call('POST', '/api/classes', { subjectId: sub.id, sectionId: sec.id, dayOfWeek: d, startTime: '00:00', endTime: '23:59' }, admin)).status, 200);
  assert.equal((await call('POST', '/api/students', { id: '2024-001', name: 'Ana', sectionId: sec.id, fingerprintSlot: 1 }, admin)).status, 200);
  assert.equal((await call('POST', '/api/students', { id: '2024-002', name: 'Ben', sectionId: sec.id, fingerprintSlot: 2 }, admin)).status, 200);
  assert.equal((await call('POST', '/api/students', { id: '2024-003', name: 'Dup', fingerprintSlot: 2 }, admin)).status, 409);
  for (const n of [1, 2]) await call('POST', '/api/workstations', { id: `PC-0${n}`, label: `PC ${n}`, nodeId: `node-${n}` }, admin);
});

test('kiosk cannot use dashboard CRUD; instructor cannot write students', async () => {
  assert.equal((await call('GET', '/api/students', null, kiosk)).status, 403);
  await call('POST', '/api/users', { username: 'teach', name: 'Teacher', role: 'instructor', password: 'teach-pass-1' }, admin);
  const t = (await call('POST', '/auth/login', { username: 'teach', password: 'teach-pass-1' })).body.token;
  assert.equal((await call('GET', '/api/students', null, t)).status, 200);
  assert.equal((await call('POST', '/api/students', { id: 'X-1', name: 'X' }, t)).status, 403);
  assert.equal((await call('GET', '/api/inventory', null, t)).status, 403);
});

test('statuses: offline until heartbeat, then OFF/IDLE', async () => {
  let ws = (await call('GET', '/workstations/live', null, kiosk)).body.workstations;
  assert.deepEqual(ws.map(w => w.status), ['OFFLINE', 'OFFLINE']);
  assert.equal((await beat('node-1', 'off')).status, 200);
  assert.equal((await beat('node-2', 'on')).status, 200);
  assert.equal((await call('POST', '/node/heartbeat', { nodeId: 'node-1', power: 'on' })).status, 401);
  ws = (await call('GET', '/workstations/live', null, kiosk)).body.workstations;
  assert.deepEqual(ws.map(w => w.status), ['OFF', 'IDLE']);
  assert.equal(ws[0].session, null);
});

test('hybrid assignment: auto prefers idle PC; scan is single-use; manual checks availability', async () => {
  const scanA = recordScan(db, 1);
  const who = (await call('GET', `/scans/${scanA}`, null, kiosk)).body;
  assert.equal(who.student.name, 'Ana'); assert.equal(who.currentClass.subject, 'IT201');
  const auto = await call('POST', '/checkin', { scanId: scanA }, kiosk);
  assert.equal(auto.body.workstationId, 'PC-02'); assert.equal(auto.body.assignment, 'auto');
  assert.equal((await call('POST', '/checkin', { scanId: scanA }, kiosk)).status, 409);
  const scanB = recordScan(db, 2);
  assert.equal((await call('POST', '/checkin', { scanId: scanB, workstationId: 'PC-02' }, kiosk)).status, 409);
  const man = await call('POST', '/checkin', { scanId: scanB, workstationId: 'PC-01' }, kiosk);
  assert.equal(man.body.assignment, 'manual'); assert.equal(man.body.powerOnRequired, true);
  const ws = (await call('GET', '/workstations/live', null, kiosk)).body.workstations;
  assert.deepEqual(ws.map(w => w.status), ['IN_USE', 'IN_USE']);
  assert.equal(ws[0].session.studentName, undefined, 'kiosk must not see names');
});

test('unknown finger is rejected', async () => {
  assert.equal((await call('GET', `/scans/${recordScan(db, 99)}`, null, kiosk)).status, 404);
});

test('time-out needs the owner finger; report-and-end holds the PC', async () => {
  const sessions = (await call('GET', '/api/attendance', null, admin)).body.rows;
  const ana = sessions.find(s => s.name === 'Ana'), ben = sessions.find(s => s.name === 'Ben');
  assert.equal(ana.section, 'BSIT 2A'); assert.equal(ana.subject, 'IT201');
  assert.equal((await call('POST', `/sessions/${ana.id}/end`, { scanId: recordScan(db, 2) }, kiosk)).status, 403);
  assert.equal((await call('POST', `/sessions/${ana.id}/end`, { scanId: recordScan(db, 1) }, kiosk)).body.ended, true);
  const rep = await call('POST', '/issues/report', { scanId: recordScan(db, 2), sessionId: ben.id, category: 'hardware', description: 'No display', endSession: true }, kiosk);
  assert.equal(rep.body.sessionEnded, true);
  const ws = (await call('GET', '/workstations/live', null, admin)).body.workstations;
  assert.deepEqual(ws.map(w => w.status), ['MAINTENANCE', 'IDLE']);
  const csv = (await call('GET', '/api/attendance.csv', null, admin)).body;
  assert.match(csv, /2024-001/);
});

test('maintenance: technician resolves issue with a log entry; inventory CRUD', async () => {
  await call('POST', '/api/users', { username: 'tech', name: 'Tech', role: 'technician', password: 'tech-pass-1' }, admin);
  const t = (await call('POST', '/auth/login', { username: 'tech', password: 'tech-pass-1' })).body.token;
  const issue = (await call('GET', '/api/issues', null, t)).body.rows[0];
  const log = await call('POST', '/api/maintenance', { issueId: issue.id, workstationId: 'PC-01', action: 'Reseated VGA cable' }, t);
  assert.equal(log.body.technicianId !== undefined, true);
  assert.equal((await call('PUT', `/api/issues/${issue.id}`, { ...issue, status: 'resolved', resolution: '' }, t)).status, 400);
  assert.equal((await call('PUT', `/api/issues/${issue.id}`, { workstationId: 'PC-01', category: 'hardware', description: issue.description, status: 'resolved', resolution: 'Cable fixed' }, t)).status, 200);
  const item = (await call('POST', '/api/inventory', { assetTag: 'MON-001', name: 'Monitor 22"', category: 'monitor', workstationId: 'PC-01' }, t)).body;
  assert.equal((await call('DELETE', `/api/inventory/${item.id}`, null, t)).status, 200);
  const sum = (await call('GET', '/api/summary', null, admin)).body;
  assert.equal(sum.openIssues, 0); assert.equal(sum.attendanceToday, 2);
});

test('extras: alerts, analytics, class attendance, import, password, backup', async () => {
  assert.ok((await call('GET', '/api/alerts', null, admin)).body.rows.some(a => a.kind === 'maintenance'));
  const an = (await call('GET', '/api/analytics?days=7', null, admin)).body;
  assert.equal(an.daily.length, 7); assert.equal(an.totals.sessions, 2); assert.equal(an.sections[0].name, 'BSIT 2A');
  const cls = (await call('GET', '/api/classes', null, admin)).body.rows[0];
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const sheet = (await call('GET', `/api/class-attendance?classId=${cls.id}&date=${date}`, null, admin)).body;
  assert.equal(sheet.roster.length, 2);
  const imp = await call('POST', '/api/students/import', { rows: [{ id: '2024-010', name: 'Imported One', section: 'BSIT 3B' }, { id: '2024-001', name: 'Ana Renamed', section: 'BSIT 2A' }] }, admin);
  assert.deepEqual(imp.body, { created: 1, updated: 1, sectionsCreated: 1 });
  const t = (await call('POST', '/auth/login', { username: 'teach', password: 'teach-pass-1' })).body.token;
  assert.equal((await call('POST', '/api/students/import', { rows: [{ id: 'X-01', name: 'X' }] }, t)).status, 403);
  assert.equal((await call('POST', '/api/me/password', { current: 'wrong', next: 'new-pass-123' }, t)).status, 400);
  assert.equal((await call('POST', '/api/me/password', { current: 'teach-pass-1', next: 'new-pass-123' }, t)).status, 200);
  assert.equal((await call('GET', '/me', null, t)).status, 401, 'old sessions are signed out');
  assert.equal((await call('POST', '/auth/login', { username: 'teach', password: 'new-pass-123' })).status, 200);
  const r = await fetch(base + '/api/backup', { headers: { authorization: `Bearer ${admin}` } });
  assert.equal(r.status, 200);
  const head = Buffer.from(await r.arrayBuffer()).subarray(0, 15).toString();
  assert.equal(head, 'SQLite format 3');
  assert.ok((await call('GET', '/api/kiosks', null, admin)).body.rows.length >= 1);
});

test('role limits: technician sees equipment only, instructor sees classes only', async () => {
  const tech = (await call('POST', '/auth/login', { username: 'tech', password: 'tech-pass-1' })).body.token;
  for (const p of ['/api/students', '/api/sections', '/api/classes', '/api/attendance', '/api/analytics', '/api/reports/attendance', '/api/users'])
    assert.equal((await call('GET', p, null, tech)).status, 403, `technician must not read ${p}`);
  for (const p of ['/api/issues', '/api/inventory', '/api/maintenance', '/api/workstations', '/api/reports/usage', '/api/my/issues'])
    assert.equal((await call('GET', p, null, tech)).status, 200, `technician can read ${p}`);
  const live = (await call('GET', '/workstations/live', null, tech)).body.workstations;
  assert.ok(live.every(w => !w.session || w.session.studentName === undefined), 'no student names for technicians');
  assert.equal((await call('GET', '/api/summary', null, tech)).body.attendanceToday, undefined);

  const teach = (await call('POST', '/auth/login', { username: 'teach', password: 'new-pass-123' })).body.token;
  for (const p of ['/api/issues', '/api/inventory', '/api/maintenance', '/api/reports/maintenance', '/api/my/issues'])
    assert.equal((await call('GET', p, null, teach)).status, 403, `instructor must not read ${p}`);
  for (const p of ['/api/students', '/api/classes', '/api/attendance', '/api/analytics', '/api/my/classes'])
    assert.equal((await call('GET', p, null, teach)).status, 200, `instructor can read ${p}`);
});

test('nodes: power-on command rides the heartbeat; failures raise automatic reports', async () => {
  await call('POST', '/api/workstations', { id: 'PC-09', label: 'PC 9', nodeId: 'node-9' }, admin);
  const off = await beat('node-9', 'off');
  assert.ok(off.body.serverTimeMs > 1700000000000); assert.equal(off.body.command, undefined);
  const tech = (await call('POST', '/auth/login', { username: 'tech', password: 'tech-pass-1' })).body.token;
  const { commandId } = (await call('POST', '/api/workstations/PC-09/power-on', null, tech)).body;
  const cmd = (await beat('node-9', 'off')).body.command;
  assert.equal(cmd.commandId, commandId); assert.equal(cmd.action, 'power_on'); assert.equal(cmd.workstationId, 'PC-09');
  assert.equal(Object.keys(cmd).length, 6, 'node firmware requires exactly 6 fields');
  // Node reports the pulse failed -> automatic report for the technician.
  const r = await call('POST', '/node/heartbeat', { nodeId: 'node-9', power: 'off', powerResult: { commandId, state: 'unknown' } }, null, { 'x-node-key': 'k' });
  assert.equal(r.body.command, undefined);
  const auto = (await call('GET', '/api/issues', null, tech)).body.rows.filter(i => i.workstationId === 'PC-09');
  assert.equal(auto.length, 1); assert.match(auto[0].description, /did not power on/);
  // Successful power-on clears the command without a report.
  await call('POST', '/api/workstations/PC-09/power-on', null, tech);
  assert.equal((await beat('node-9', 'on')).body.command, undefined);
  assert.equal((await call('GET', '/api/issues', null, tech)).body.rows.filter(i => i.workstationId === 'PC-09').length, 1);
});
