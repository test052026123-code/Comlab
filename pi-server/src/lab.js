import { randomUUID } from 'node:crypto';
import { tx } from './db.js';
import { Fault, requireThat } from './errors.js';

export const NODE_STALE_MS = 30_000;
export const SCAN_VALID_MS = 120_000;
const TZ = process.env.COMLAB_TZ || 'Asia/Manila';
const EARLY_MINUTES = 15;   // a scan up to 15 min before class still counts for that class

export const nowIso = () => new Date().toISOString();

export function audit(db, actor, action, target = null, detail = null) {
  db.prepare('INSERT INTO audit (at, actor, action, target, detail) VALUES (?,?,?,?,?)')
    .run(nowIso(), actor ? `${actor.role}:${actor.id}` : 'system', action, target, detail == null ? null : JSON.stringify(detail));
}
export function recordChange(db, tbl, rowId, op) {
  db.prepare('INSERT INTO changes (tbl, row_id, op, at) VALUES (?,?,?,?)').run(tbl, String(rowId), op, nowIso());
}

// ON / OFF / IDLE / IN_USE (manuscript states) plus OFFLINE / MAINTENANCE / DISABLED.
export function workstationStatus(pc, openSession, at = Date.now()) {
  if (!pc.enabled) return 'DISABLED';
  if (pc.maintenance) return 'MAINTENANCE';
  const online = pc.last_seen && at - Date.parse(pc.last_seen) < NODE_STALE_MS;
  if (!online) return openSession ? 'IN_USE' : 'OFFLINE';
  if (pc.power === 'on') return openSession ? 'IN_USE' : 'IDLE';
  if (pc.power === 'off') return openSession ? 'IN_USE' : 'OFF';
  return openSession ? 'IN_USE' : 'UNKNOWN';
}
export const AVAILABLE = new Set(['IDLE', 'OFF']);

export function listWorkstations(db, { withNames = true } = {}) {
  const open = new Map(db.prepare(`SELECT s.*, st.name student_name FROM sessions s JOIN students st ON st.id = s.student_id
    WHERE s.time_out IS NULL`).all().map(s => [s.workstation_id, s]));
  return db.prepare('SELECT * FROM workstations ORDER BY id').all().map(pc => {
    const s = open.get(pc.id);
    return {
      id: pc.id, label: pc.label, nodeId: pc.node_id, mapX: pc.map_x, mapY: pc.map_y,
      enabled: !!pc.enabled, maintenance: !!pc.maintenance, power: pc.power,
      lastSeen: pc.last_seen, rssi: pc.rssi, ip: pc.ip,
      online: !!pc.last_seen && Date.now() - Date.parse(pc.last_seen) < NODE_STALE_MS,
      status: workstationStatus(pc, s),
      ...(withNames ? { notes: pc.notes } : {}),
      session: s ? { id: s.id, timeIn: s.time_in, ...(withNames ? { studentId: s.student_id, studentName: s.student_name } : {}) } : null,
    };
  });
}

// Local weekday + HH:MM in the lab's timezone.
export function localClock(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const mins = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function currentClass(db, sectionId, date = new Date()) {
  if (!sectionId) return null;
  const { day, minutes } = localClock(date);
  return db.prepare(`SELECT c.*, sb.code subject_code, sc.name section_name FROM classes c
      JOIN subjects sb ON sb.id = c.subject_id JOIN sections sc ON sc.id = c.section_id
      WHERE c.section_id = ? AND c.day_of_week = ?`).all(sectionId, day)
    .find(c => minutes >= mins(c.start_time) - EARLY_MINUTES && minutes < mins(c.end_time)) ?? null;
}

// --- fingerprint scans ------------------------------------------------------
// The sensor driver calls recordScan() for every match; the tablet then uses the
// scan id as one-time proof of who is standing at the kiosk.
export function recordScan(db, slot) {
  const student = db.prepare('SELECT id FROM students WHERE fingerprint_slot = ? AND active = 1').get(slot);
  const staff = student ? null : db.prepare('SELECT id FROM users WHERE fingerprint_slot = ? AND active = 1').get(slot);
  const id = randomUUID();
  db.prepare('INSERT INTO scans VALUES (?,?,?,?,?,0)')
    .run(id, slot, student ? 'student' : staff ? 'staff' : null, student?.id ?? staff?.id ?? null, nowIso());
  return id;
}

export function readScan(db, scanId) {
  const s = db.prepare('SELECT * FROM scans WHERE id = ?').get(scanId);
  requireThat(s, 'Scan not found. Scan your finger again.', 404);
  requireThat(Date.now() - Date.parse(s.at) < SCAN_VALID_MS, 'Scan expired. Scan your finger again.', 410);
  requireThat(!s.used, 'This scan was already used. Scan your finger again.', 409);
  requireThat(s.person_type, 'Fingerprint not registered. Ask the administrator to enroll you.', 404);
  return s;
}
const useScan = (db, id) => db.prepare('UPDATE scans SET used = 1 WHERE id = ?').run(id);

export function identify(db, scanId) {
  const s = readScan(db, scanId);
  if (s.person_type === 'staff') {
    const u = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(s.person_id);
    return { type: 'staff', user: u };
  }
  const st = db.prepare(`SELECT s.id, s.name, s.section_id, sc.name section FROM students s
    LEFT JOIN sections sc ON sc.id = s.section_id WHERE s.id = ?`).get(s.person_id);
  const open = db.prepare('SELECT id, workstation_id, time_in FROM sessions WHERE student_id = ? AND time_out IS NULL').get(st.id);
  const cls = currentClass(db, st.section_id);
  return { type: 'student', student: { id: st.id, name: st.name, section: st.section },
    openSession: open ? { id: open.id, workstationId: open.workstation_id, timeIn: open.time_in } : null,
    currentClass: cls ? { id: cls.id, subject: cls.subject_code, start: cls.start_time, end: cls.end_time } : null };
}

// Pick a PC automatically: an already-on idle PC first, then a switched-off one.
export function autoAssign(db) {
  const free = listWorkstations(db).filter(w => AVAILABLE.has(w.status));
  return (free.find(w => w.status === 'IDLE') ?? free[0])?.id ?? null;
}

// Hybrid assignment: workstationId given = manual, omitted = auto.
export function checkIn(db, actor, { scanId, workstationId }) {
  return tx(db, () => {
    const scan = readScan(db, scanId);
    requireThat(scan.person_type === 'student', 'Only students check in to a workstation.', 403);
    const st = db.prepare('SELECT * FROM students WHERE id = ?').get(scan.person_id);
    requireThat(!db.prepare('SELECT 1 FROM sessions WHERE student_id = ? AND time_out IS NULL').get(st.id),
      'You already have an active session. End it first.');
    const mode = workstationId ? 'manual' : 'auto';
    const pcId = workstationId ?? autoAssign(db);
    requireThat(pcId, 'No workstation is available right now.');
    const pc = listWorkstations(db).find(w => w.id === pcId);
    requireThat(pc, 'Workstation not found.', 404);
    requireThat(AVAILABLE.has(pc.status), `${pc.label} is not available (${pc.status}). Choose another.`);
    const cls = currentClass(db, st.section_id);
    const section = st.section_id ? db.prepare('SELECT name FROM sections WHERE id = ?').get(st.section_id)?.name : null;
    const id = randomUUID();
    db.prepare(`INSERT INTO sessions (id, student_id, workstation_id, class_id, section_name, subject_code, assignment, time_in)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, st.id, pcId, cls?.id ?? null, section ?? null, cls?.subject_code ?? null, mode, nowIso());
    useScan(db, scanId);
    audit(db, actor, 'session.start', id, { studentId: st.id, workstationId: pcId, assignment: mode });
    recordChange(db, 'sessions', id, 'upsert');
    return { sessionId: id, workstationId: pcId, label: pc.label, assignment: mode, powerOnRequired: pc.status === 'OFF',
      subject: cls?.subject_code ?? null };
  });
}

// A student ends with their own fresh scan; instructors/admins end with a reason.
export function endSession(db, actor, sessionId, { scanId, reason } = {}) {
  return tx(db, () => {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    requireThat(s, 'Session not found.', 404);
    if (s.time_out) return { sessionId, alreadyEnded: true };
    let endReason;
    if (actor.role === 'kiosk') {
      const scan = readScan(db, scanId);
      requireThat(scan.person_id === s.student_id, 'This fingerprint does not match the session owner.', 403);
      useScan(db, scanId);
      endReason = 'Student time-out (fingerprint)';
    } else {
      requireThat(['admin', 'instructor', 'technician'].includes(actor.role), 'Not allowed.', 403);
      requireThat(reason?.trim(), 'Give a reason for ending this session.', 400);
      endReason = reason.trim();
    }
    db.prepare('UPDATE sessions SET time_out = ?, end_reason = ?, ended_by = ? WHERE id = ?')
      .run(nowIso(), endReason, `${actor.role}:${actor.id}`, sessionId);
    audit(db, actor, 'session.end', sessionId, { reason: endReason });
    recordChange(db, 'sessions', sessionId, 'upsert');
    return { sessionId, ended: true };
  });
}

// Kiosk "Report a problem": save the issue; optionally end the session and hold the PC.
export function reportIssue(db, actor, { workstationId, sessionId, scanId, category, description, endSession: end }) {
  return tx(db, () => {
    let reporter = `${actor.role}:${actor.id}`;
    if (actor.role === 'kiosk') {
      const scan = readScan(db, scanId);
      reporter = `${scan.person_type}:${scan.person_id}`;
      if (sessionId) {
        const s = db.prepare('SELECT student_id FROM sessions WHERE id = ?').get(sessionId);
        requireThat(s?.student_id === scan.person_id, 'This fingerprint does not match the session owner.', 403);
      }
      useScan(db, scanId);
    }
    if (sessionId && !workstationId) workstationId = db.prepare('SELECT workstation_id FROM sessions WHERE id = ?').get(sessionId)?.workstation_id;
    requireThat(!workstationId || db.prepare('SELECT 1 FROM workstations WHERE id = ?').get(workstationId), 'Workstation not found.', 404);
    const id = randomUUID(), at = nowIso();
    db.prepare(`INSERT INTO issues (id, workstation_id, session_id, reported_by, category, description, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, workstationId ?? null, sessionId ?? null, reporter, category ?? 'other', description, at, at);
    if (end && sessionId) {
      db.prepare('UPDATE sessions SET time_out = ?, end_reason = ?, ended_by = ? WHERE id = ? AND time_out IS NULL')
        .run(at, 'Ended by problem report', reporter, sessionId);
      if (workstationId) db.prepare('UPDATE workstations SET maintenance = 1, updated_at = ? WHERE id = ?').run(at, workstationId);
      recordChange(db, 'sessions', sessionId, 'upsert');
      if (workstationId) recordChange(db, 'workstations', workstationId, 'upsert');
    }
    audit(db, actor, 'issue.report', id, { workstationId, endSession: !!end });
    recordChange(db, 'issues', id, 'upsert');
    return { issueId: id, sessionEnded: !!(end && sessionId) };
  });
}

// Node heartbeat (HTTP now; MQTT bridge in a later step feeds the same function).
export function heartbeat(db, { nodeId, power, rssi, ip }) {
  const r = db.prepare('UPDATE workstations SET power = ?, last_seen = ?, rssi = ?, ip = ? WHERE node_id = ?')
    .run(power, nowIso(), rssi ?? null, ip ?? null, nodeId);
  if (!r.changes) throw new Fault(404, 'Unknown node. Link it to a workstation in the dashboard.');
}

export function getSetting(db, key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
