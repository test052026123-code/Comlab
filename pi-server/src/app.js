import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { authenticate, login, loginWithScan, logout, pairKiosk } from './auth.js';
import { crud, RESOURCES } from './crud.js';
import { Fault, requireThat } from './errors.js';
import * as lab from './lab.js';
import { REPORTS, REPORT_ROLES } from './reports.js';
import { toXlsx } from './xlsx.js';
import { registerExtras } from './extras.js';

const uuid = z.string().uuid();
const wsId = z.string().regex(/^[A-Z0-9-]{2,16}$/);

export function createApp(db, { nodeKey = process.env.COMLAB_NODE_KEY, fingerprints = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Plain HTTP on the lab LAN: do not tell browsers to upgrade to HTTPS.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } }, strictTransportSecurity: false }), express.json({ limit: '64kb' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { index: 'index.html', maxAge: 0 }));
  const h = fn => async (req, res, next) => { try { res.json(await fn(req, res)); } catch (e) { next(e); } };
  const roles = (...allowed) => (req, res, next) =>
    allowed.includes(req.actor.role) ? next() : next(new Fault(403, 'Your role cannot do this.'));

  app.get('/healthz', (req, res) => res.json({ status: 'ok', server: 'comlab-pi', time: lab.nowIso() }));

  // ---- public: login + first-run setup -------------------------------------
  const failures = new Map();   // simple per-IP login throttle
  app.post('/auth/login', h(req => {
    const key = req.ip, f = failures.get(key) ?? { n: 0, until: 0 };
    requireThat(Date.now() > f.until, 'Too many attempts. Wait a minute.', 429);
    const { username, password } = z.object({ username: z.string().max(64), password: z.string().max(128) }).parse(req.body);
    try { const r = login(db, username, password); failures.delete(key); return r; }
    catch (e) { f.n++; if (f.n >= 5) { f.n = 0; f.until = Date.now() + 60_000; } failures.set(key, f); throw e; }
  }));
  app.get('/setup/status', h(() => ({ needsAdmin: !db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get() })));
  app.post('/setup/admin', h(req => {
    requireThat(!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get(), 'Setup already done.', 403);
    const body = { ...req.body, role: 'admin', active: true };
    const user = crud(db, 'users').create({ id: 'setup', role: 'admin' }, body);
    return { user, ...login(db, body.username, body.password) };
  }));

  // ---- ESP32 nodes (shared device key; MQTT bridge uses the same handler) ---
  app.post('/node/heartbeat', h(req => {
    requireThat(nodeKey && req.headers['x-node-key'] === nodeKey, 'Bad node key.', 401);
    lab.heartbeat(db, z.object({ nodeId: z.string().max(48), power: z.enum(['on', 'off', 'unknown']), rssi: z.number().int().optional(),
      ip: z.string().max(45).optional() }).parse(req.body));
    return { ok: true };
  }));

  // ---- everything below requires a token -----------------------------------
  app.use((req, res, next) => { try { req.actor = authenticate(db, req.headers.authorization); next(); } catch (e) { next(e); } });
  app.get('/me', h(req => req.actor));
  app.post('/auth/logout', h(req => { logout(db, req.headers.authorization.slice(7)); return { ok: true }; }));
  app.post('/kiosks/pair', roles('admin'), h(req => pairKiosk(db, z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body).name)));

  // ---- kiosk / tablet flow -------------------------------------------------
  app.get('/workstations/live', h(req => ({ workstations: lab.listWorkstations(db, { withNames: req.actor.role !== 'kiosk' }), at: lab.nowIso() })));
  app.get('/scans/:id', h(req => lab.identify(db, uuid.parse(req.params.id))));
  app.post('/scans/:id/staff-login', roles('kiosk'), h(req => {
    const s = lab.readScan(db, uuid.parse(req.params.id));
    requireThat(s.person_type === 'staff', 'This fingerprint belongs to a student.', 403);
    db.prepare('UPDATE scans SET used = 1 WHERE id = ?').run(s.id);
    return loginWithScan(db, db.prepare('SELECT * FROM users WHERE id = ?').get(s.person_id));
  }));
  app.post('/checkin', roles('kiosk'), h(req => lab.checkIn(db, req.actor,
    z.object({ scanId: uuid, workstationId: wsId.optional() }).strict().parse(req.body))));
  app.post('/sessions/:id/end', h(req => lab.endSession(db, req.actor, uuid.parse(req.params.id),
    z.object({ scanId: uuid.optional(), reason: z.string().max(300).optional() }).parse(req.body))));
  app.post('/issues/report', h(req => lab.reportIssue(db, req.actor, z.object({
    scanId: uuid.optional(), sessionId: uuid.optional(), workstationId: wsId.optional(),
    category: z.enum(['hardware', 'software', 'network', 'power', 'other']).optional(),
    description: z.string().trim().min(1).max(1000), endSession: z.boolean().optional() }).parse(req.body))));
  app.get('/settings/kiosk', h(() => ({ autoAssignAfterSeconds: lab.getSetting(db, 'autoAssignAfterSeconds', 30),
    welcomeTimeoutSeconds: lab.getSetting(db, 'welcomeTimeoutSeconds', 25) })));

  // ---- fingerprint sensor --------------------------------------------------
  const fp = () => { requireThat(fingerprints, 'Fingerprint sensor is not configured on this server.', 503); return fingerprints; };
  const admin = roles('admin');
  app.get('/fingerprint/status', h(() => fp().status()));
  app.post('/fingerprint/identify', h(req => fp().identify(req.actor)));
  app.get('/fingerprint/requests/:id', h(req => fp().job(uuid.parse(req.params.id))));
  app.post('/fingerprint/requests/:id/cancel', h(req => fp().cancel(uuid.parse(req.params.id))));
  app.post('/api/fingerprint/enroll', admin, h(req => {
    const { personType, personId } = z.object({ personType: z.enum(['student', 'staff']), personId: z.string().min(1).max(64) }).strict().parse(req.body);
    return fp().enroll(req.actor, personType, personId);
  }));
  app.get('/api/fingerprint/slots', admin, h(() => fp().slots()));
  app.delete('/api/fingerprint/slots/:slot', admin, h(req => fp().removeSlot(req.actor, z.coerce.number().int().min(0).max(999).parse(req.params.slot))));

  // ---- dashboard -----------------------------------------------------------
  const staff = roles('admin', 'technician', 'instructor');
  for (const name of Object.keys(RESOURCES)) {
    const c = () => crud(db, name);
    app.get(`/api/${name}`, staff, h(req => ({ rows: c().list(req.actor) })));
    app.get(`/api/${name}/:id`, staff, h(req => c().read(req.actor, req.params.id)));
    app.post(`/api/${name}`, staff, h(req => c().create(req.actor, req.body)));
    app.put(`/api/${name}/:id`, staff, h(req => c().update(req.actor, req.params.id, req.body)));
    app.delete(`/api/${name}/:id`, staff, h(async req => {
      // Deleting a person also wipes their template from the sensor (best effort).
      const slot = ['students', 'users'].includes(name) ? db.prepare(`SELECT fingerprint_slot s FROM ${name} WHERE id = ?`).get(req.params.id)?.s : null;
      const r = c().remove(req.actor, req.params.id);
      if (slot != null && fingerprints?.ready) await fingerprints.sensor.remove(slot).catch(e => console.error('Template delete failed:', e.message));
      return r;
    }));
  }
  app.get('/api/attendance', staff, h(req => ({ rows: attendance(db, req.query) })));
  app.get('/api/attendance.csv', staff, (req, res, next) => {
    try { res.type('text/csv').attachment('attendance.csv').send('﻿' + toCsv(attendance(db, req.query))); } catch (e) { next(e); }
  });
  app.get('/api/summary', staff, h(() => summary(db)));
  // Names only, for "assigned technician" / "instructor" dropdowns (no usernames or slots).
  app.get('/api/staff-directory', staff, h(() => ({ rows: db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all() })));
  // Reports: JSON for the dashboard, .xlsx for Excel, .csv for anything else.
  app.get('/api/reports/:name', staff, (req, res, next) => {
    try {
      const m = /^(\w+?)(?:\.(xlsx|csv))?$/.exec(req.params.name), R = m && REPORTS[m[1]];
      requireThat(R, 'Unknown report.', 404);
      requireThat(REPORT_ROLES[m[1]].includes(req.actor.role), 'Your role cannot view this report.', 403);
      const rows = R.rows(db, req.query), stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      if (m[2] === 'xlsx') return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .attachment(`ComLab ${R.title} ${stamp}.xlsx`).send(toXlsx(R.title, R.columns, rows));
      if (m[2] === 'csv') return res.type('text/csv').attachment(`ComLab ${R.title} ${stamp}.csv`)
        .send('﻿' + toCsv(rows.map(r => Object.fromEntries(R.columns.map(([k, label]) => [label, r[k]])))));
      res.json({ title: R.title, columns: R.columns, rows });
    } catch (e) { next(e); }
  });
  app.get('/api/audit', roles('admin'), h(() => ({ rows: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all() })));
  app.put('/api/settings/kiosk', roles('admin'), h(req => {
    const s = z.object({ autoAssignAfterSeconds: z.number().int().min(10).max(300), welcomeTimeoutSeconds: z.number().int().min(10).max(120) }).parse(req.body);
    for (const [k, v] of Object.entries(s)) lab.setSetting(db, k, v);
    lab.audit(db, req.actor, 'settings.update', 'kiosk', s);
    return s;
  }));

  registerExtras(app, db, { h, roles, dbPath: process.env.COMLAB_DB });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const zod = err instanceof z.ZodError;
    const status = zod ? 400 : err.status || 500;
    if (status >= 500) console.error('ComLab request failed:', err);
    res.status(status).json({ error: zod ? err.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
      : err instanceof Fault ? err.message : 'Server error. Check the Pi logs.' });
  });
  return app;
}

export function attendance(db, query) {
  const f = z.object({ student: z.string().optional(), section: z.string().optional(), subject: z.string().optional(),
    workstation: z.string().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }).parse(query);
  const where = [], args = [];
  if (f.student) { where.push('(s.student_id LIKE ? OR st.name LIKE ?)'); args.push(`%${f.student}%`, `%${f.student}%`); }
  if (f.section) { where.push('s.section_name = ?'); args.push(f.section); }
  if (f.subject) { where.push('s.subject_code = ?'); args.push(f.subject); }
  if (f.workstation) { where.push('s.workstation_id = ?'); args.push(f.workstation); }
  if (f.from) { where.push('s.time_in >= ?'); args.push(new Date(`${f.from}T00:00:00+08:00`).toISOString()); }
  if (f.to) { where.push('s.time_in < ?'); args.push(new Date(Date.parse(`${f.to}T00:00:00+08:00`) + 86400e3).toISOString()); }
  return db.prepare(`SELECT s.id, s.student_id studentId, st.name, s.section_name section, s.subject_code subject,
      s.workstation_id workstationId, s.assignment, s.time_in timeIn, s.time_out timeOut, s.end_reason endReason
    FROM sessions s JOIN students st ON st.id = s.student_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.time_in DESC LIMIT 5000`).all(...args);
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
}

function summary(db) {
  const ws = lab.listWorkstations(db);
  const count = s => ws.filter(w => w.status === s).length;
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) + 'T00:00:00+08:00').toISOString();
  return {
    workstations: { total: ws.length, inUse: count('IN_USE'), idle: count('IDLE'), off: count('OFF'), offline: count('OFFLINE'), maintenance: count('MAINTENANCE') },
    activeSessions: db.prepare('SELECT COUNT(*) n FROM sessions WHERE time_out IS NULL').get().n,
    attendanceToday: db.prepare('SELECT COUNT(DISTINCT student_id) n FROM sessions WHERE time_in >= ?').get(today).n,
    openIssues: db.prepare("SELECT COUNT(*) n FROM issues WHERE status != 'resolved'").get().n,
  };
}
