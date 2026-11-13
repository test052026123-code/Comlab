// Dashboard extras: role overviews, alerts, analytics, class attendance, account,
// student import, kiosk devices and database backup.
import { randomUUID } from 'node:crypto';
import { rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './auth.js';
import { requireThat } from './errors.js';
import { audit, recordChange, nowIso, listWorkstations, localClock } from './lab.js';
import { tx } from './db.js';

const TZ = process.env.COMLAB_TZ || 'Asia/Manila';
const LONG_SESSION_HOURS = 5, STALE_ISSUE_HOURS = 24;
const dayKey = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const hourOf = iso => Number(new Date(iso).toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }));
const startOfDay = date => new Date(`${date}T00:00:00+08:00`).toISOString();

export function alerts(db) {
  const out = [], now = Date.now();
  for (const w of listWorkstations(db)) {
    if (w.status === 'OFFLINE' && w.enabled) out.push({ level: 'warning', kind: 'offline', target: w.id, text: `${w.label} is disconnected${w.lastSeen ? ` since ${new Date(w.lastSeen).toLocaleString('en-PH', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })}` : ' (never connected)'}.` });
    if (w.status === 'MAINTENANCE') out.push({ level: 'info', kind: 'maintenance', target: w.id, text: `${w.label} is under maintenance.` });
    if (w.session && now - Date.parse(w.session.timeIn) > LONG_SESSION_HOURS * 3600e3)
      out.push({ level: 'warning', kind: 'long_session', target: w.session.id, text: `${w.session.studentName} has been on ${w.label} for over ${LONG_SESSION_HOURS} hours — they may have forgotten to time out.` });
  }
  for (const i of db.prepare("SELECT id, workstation_id, description, created_at FROM issues WHERE status != 'resolved' AND created_at < ?")
    .all(new Date(now - STALE_ISSUE_HOURS * 3600e3).toISOString()))
    out.push({ level: 'danger', kind: 'stale_issue', target: i.id, text: `Error report on ${i.workstation_id ?? 'the lab'} pending for more than ${STALE_ISSUE_HOURS} h: “${i.description}”.` });
  const bad = db.prepare("SELECT COUNT(*) n FROM inventory WHERE condition = 'defective'").get().n;
  if (bad) out.push({ level: 'warning', kind: 'defective', target: null, text: `${bad} inventory item${bad > 1 ? 's are' : ' is'} marked defective.` });
  const order = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// Each role only gets the alerts it acts on; technicians never see student names.
export function alertsFor(db, role) {
  const all = alerts(db);
  if (role === 'admin') return all;
  if (role === 'instructor') return all.filter(a => ['long_session', 'offline', 'maintenance'].includes(a.kind));
  return all.filter(a => a.kind !== 'long_session')
    .concat(all.filter(a => a.kind === 'long_session').map(a => ({ ...a, text: a.text.replace(/^.+? has been on/, 'A student has been on') })));
}

export function analytics(db, days = 14) {
  const today = dayKey(nowIso());
  const from = new Date(Date.parse(startOfDay(today)) - (days - 1) * 86400e3).toISOString();
  const rows = db.prepare(`SELECT s.student_id, s.time_in, s.time_out, s.section_name, s.subject_code, s.assignment FROM sessions s WHERE s.time_in >= ?`).all(from);
  const daily = [];
  for (let i = days - 1; i >= 0; i--) daily.push({ date: dayKey(new Date(Date.parse(startOfDay(today)) - i * 86400e3).toISOString()), sessions: 0, students: new Set() });
  const byDay = new Map(daily.map(d => [d.date, d]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: 0 }));
  const sections = new Map(), subjects = new Map();
  let minutes = 0, auto = 0;
  for (const r of rows) {
    const d = byDay.get(dayKey(r.time_in)); if (d) { d.sessions++; d.students.add(r.student_id); }
    hours[hourOf(r.time_in)].sessions++;
    const sec = r.section_name || 'No section', sub = r.subject_code || 'No class';
    sections.set(sec, (sections.get(sec) ?? 0) + 1); subjects.set(sub, (subjects.get(sub) ?? 0) + 1);
    minutes += ((r.time_out ? Date.parse(r.time_out) : Date.now()) - Date.parse(r.time_in)) / 60000;
    if (r.assignment === 'auto') auto++;
  }
  const top = m => [...m].map(([name, sessions]) => ({ name, sessions })).sort((a, b) => b.sessions - a.sessions);
  return {
    days, from: daily[0].date, to: today,
    totals: { sessions: rows.length, students: new Set(rows.map(r => r.student_id)).size, hours: Math.round(minutes / 6) / 10,
      avgMinutes: rows.length ? Math.round(minutes / rows.length) : 0, autoAssignedPct: rows.length ? Math.round((auto / rows.length) * 100) : 0 },
    daily: daily.map(d => ({ date: d.date, sessions: d.sessions, students: d.students.size })),
    // Lab hours 6 AM–9 PM, widened to include any hour that actually had check-ins.
    hours: (() => { const used = hours.filter(h => h.sessions).map(h => h.hour);
      const lo = Math.min(6, ...used), hi = Math.max(21, ...used); return hours.filter(h => h.hour >= lo && h.hour <= hi); })(),
    sections: top(sections), subjects: top(subjects),
  };
}

// Roster of the class's section, marked present/absent for one date.
export function classAttendance(db, classId, date) {
  const c = db.prepare(`SELECT c.*, sb.code subject_code, sb.title subject_title, sc.name section_name, u.name instructor
    FROM classes c JOIN subjects sb ON sb.id = c.subject_id JOIN sections sc ON sc.id = c.section_id LEFT JOIN users u ON u.id = c.instructor_id WHERE c.id = ?`).get(classId);
  requireThat(c, 'Class not found.', 404);
  const lo = startOfDay(date), hi = new Date(Date.parse(lo) + 86400e3).toISOString();
  const sessions = db.prepare('SELECT * FROM sessions WHERE class_id = ? AND time_in >= ? AND time_in < ? ORDER BY time_in').all(classId, lo, hi);
  const first = new Map();
  for (const s of sessions) if (!first.has(s.student_id)) first.set(s.student_id, s);
  const [sh, sm] = c.start_time.split(':').map(Number);
  const late = s => { const t = new Date(s.time_in); const local = Number(t.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })) * 60 + t.getMinutes(); return local > sh * 60 + sm + 15; };
  const roster = db.prepare('SELECT id, name FROM students WHERE section_id = ? AND active = 1 ORDER BY name').all(c.section_id).map(st => {
    const s = first.get(st.id);
    return { studentId: st.id, name: st.name, status: s ? (late(s) ? 'late' : 'present') : 'absent', workstationId: s?.workstation_id ?? null, timeIn: s?.time_in ?? null, timeOut: s?.time_out ?? null };
  });
  return { class: { id: c.id, subject: c.subject_code, title: c.subject_title, section: c.section_name, instructor: c.instructor, day: c.day_of_week, start: c.start_time, end: c.end_time },
    date, roster, counts: { present: roster.filter(r => r.status === 'present').length, late: roster.filter(r => r.status === 'late').length, absent: roster.filter(r => r.status === 'absent').length } };
}

export function myClassesToday(db, actor) {
  const { day } = localClock();
  const all = actor.role === 'instructor';
  return db.prepare(`SELECT c.id, c.start_time, c.end_time, sb.code, sb.title, sc.name section FROM classes c JOIN subjects sb ON sb.id = c.subject_id
      JOIN sections sc ON sc.id = c.section_id WHERE c.day_of_week = ? ${all ? 'AND c.instructor_id = ?' : ''} ORDER BY c.start_time`).all(...(all ? [day, actor.id] : [day]))
    .map(c => ({ ...c, ...classAttendance(db, c.id, dayKey(nowIso())).counts }));
}

export function registerExtras(app, db, { h, roles, dbPath }) {
  const staff = roles('admin', 'technician', 'instructor'), admin = roles('admin');
  const teach = roles('admin', 'instructor'), tech = roles('admin', 'technician');
  app.get('/api/alerts', staff, h(req => ({ rows: alertsFor(db, req.actor.role) })));
  app.get('/api/analytics', teach, h(req => analytics(db, z.coerce.number().int().min(7).max(90).catch(14).parse(req.query.days))));
  app.get('/api/my/classes', teach, h(req => ({ rows: myClassesToday(db, req.actor) })));
  app.get('/api/my/issues', tech, h(req => ({ rows: db.prepare("SELECT * FROM issues WHERE assigned_to = ? AND status != 'resolved' ORDER BY created_at").all(req.actor.id)
    .map(i => ({ id: i.id, workstationId: i.workstation_id, category: i.category, description: i.description, status: i.status, createdAt: i.created_at })) })));
  app.get('/api/class-attendance', teach, h(req => {
    const q = z.object({ classId: z.string().min(1), date: z.iso.date() }).parse(req.query);
    return classAttendance(db, q.classId, q.date);
  }));
  app.get('/api/issues/:id/history', tech, h(req => ({
    rows: db.prepare(`SELECT m.created_at at, m.action, m.remarks, u.name technician FROM maintenance_logs m LEFT JOIN users u ON u.id = m.technician_id
      WHERE m.issue_id = ? ORDER BY m.created_at`).all(req.params.id),
    audit: db.prepare("SELECT at, actor, action FROM audit WHERE target = ? ORDER BY id").all(req.params.id),
  })));

  app.post('/api/me/password', staff, h(req => {
    const { current, next } = z.object({ current: z.string(), next: z.string().min(8).max(128) }).parse(req.body);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.actor.id);
    requireThat(verifyPassword(current, u.password_hash), 'Current password is wrong.', 400);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(next), nowIso(), u.id);
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND token_hash != ?').run(u.id, '');   // sign out other devices
    audit(db, req.actor, 'users.password', u.id);
    return { ok: true, signedOut: true };
  }));

  // Bulk student import: [{ id, name, section }]; sections are created when missing.
  app.post('/api/students/import', admin, h(req => {
    const rows = z.array(z.object({ id: z.string().trim().regex(/^[A-Za-z0-9-]{3,32}$/), name: z.string().trim().min(1).max(200),
      section: z.string().trim().max(60).optional().default('') })).min(1).max(2000).parse(req.body.rows);
    return tx(db, () => {
      let created = 0, updated = 0, sectionsCreated = 0;
      const at = nowIso();
      for (const r of rows) {
        let sectionId = null;
        if (r.section) {
          sectionId = db.prepare('SELECT id FROM sections WHERE name = ?').get(r.section)?.id;
          if (!sectionId) { sectionId = randomUUID(); db.prepare('INSERT INTO sections (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(sectionId, r.section, at, at); sectionsCreated++; recordChange(db, 'sections', sectionId, 'upsert'); }
        }
        if (db.prepare('SELECT 1 FROM students WHERE id = ?').get(r.id)) {
          db.prepare('UPDATE students SET name = ?, section_id = COALESCE(?, section_id), updated_at = ? WHERE id = ?').run(r.name, sectionId, at, r.id); updated++;
        } else {
          db.prepare('INSERT INTO students (id, name, section_id, active, created_at, updated_at) VALUES (?,?,?,1,?,?)').run(r.id, r.name, sectionId, at, at); created++;
        }
        recordChange(db, 'students', r.id, 'upsert');
      }
      audit(db, req.actor, 'students.import', null, { created, updated, sectionsCreated });
      return { created, updated, sectionsCreated };
    });
  }));

  app.get('/api/kiosks', admin, h(() => ({ rows: db.prepare(`SELECT k.id, k.name, k.created_at createdAt, MAX(t.expires_at) expiresAt FROM kiosks k
    LEFT JOIN auth_tokens t ON t.kiosk_id = k.id GROUP BY k.id ORDER BY k.created_at DESC`).all() })));
  app.delete('/api/kiosks/:id', admin, h(req => {
    db.prepare('DELETE FROM auth_tokens WHERE kiosk_id = ?').run(req.params.id);
    db.prepare('DELETE FROM kiosks WHERE id = ?').run(req.params.id);
    audit(db, req.actor, 'kiosks.unpair', req.params.id);
    return { deleted: req.params.id };
  }));

  // Consistent snapshot of the live database (safe while the server runs).
  app.get('/api/backup', admin, (req, res, next) => {
    const file = join(tmpdir(), `comlab-backup-${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
      const buf = readFileSync(file);
      audit(db, req.actor, 'backup.download', null, { bytes: buf.length, db: dbPath });
      res.type('application/octet-stream').attachment(`comlab-backup-${dayKey(nowIso())}.db`).send(buf);
    } catch (e) { next(e); } finally { rmSync(file, { force: true }); }
  });
}
