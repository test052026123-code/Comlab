// Report queries shared by the dashboard tables and the Excel/CSV exports.
import { z } from 'zod';
import { attendance } from './app.js';

const local = iso => (iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '');
const minutes = (a, b) => (a ? Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60000) : null);

const range = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });
function between(query, col) {
  const f = range.parse({ from: query.from || undefined, to: query.to || undefined });
  const where = [], args = [];
  if (f.from) { where.push(`${col} >= ?`); args.push(new Date(`${f.from}T00:00:00+08:00`).toISOString()); }
  if (f.to) { where.push(`${col} < ?`); args.push(new Date(Date.parse(`${f.to}T00:00:00+08:00`) + 86400e3).toISOString()); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

export const REPORTS = {
  attendance: {
    title: 'Attendance',
    columns: [['date', 'Date'], ['studentId', 'Student ID'], ['name', 'Name'], ['section', 'Section'], ['subject', 'Subject'], ['workstationId', 'PC'],
      ['assignment', 'Assignment'], ['timeInLocal', 'Time in'], ['timeOutLocal', 'Time out'], ['minutes', 'Minutes'], ['endReason', 'End reason']],
    rows: (db, q) => attendance(db, q).map(r => ({ ...r, date: new Date(r.timeIn).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }),
      timeInLocal: local(r.timeIn), timeOutLocal: r.timeOut ? local(r.timeOut) : 'Active', minutes: minutes(r.timeIn, r.timeOut) })),
  },
  usage: {
    title: 'Computer usage',
    columns: [['workstationId', 'PC'], ['label', 'Label'], ['sessions', 'Sessions'], ['students', 'Unique students'], ['hours', 'Hours used'], ['issues', 'Issues reported']],
    rows: (db, q) => {
      const { sql, args } = between(q, 's.time_in');
      const use = new Map(db.prepare(`SELECT workstation_id id, COUNT(*) sessions, COUNT(DISTINCT student_id) students,
          SUM((julianday(COALESCE(time_out, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(time_in)) * 24) hours
        FROM sessions s ${sql} GROUP BY workstation_id`).all(...args).map(r => [r.id, r]));
      const iss = between(q, 'created_at');
      const issues = new Map(db.prepare(`SELECT workstation_id id, COUNT(*) n FROM issues ${iss.sql} GROUP BY workstation_id`).all(...iss.args).map(r => [r.id, r.n]));
      return db.prepare('SELECT id, label FROM workstations ORDER BY id').all().map(w => ({ workstationId: w.id, label: w.label,
        sessions: use.get(w.id)?.sessions ?? 0, students: use.get(w.id)?.students ?? 0,
        hours: Math.round((use.get(w.id)?.hours ?? 0) * 10) / 10, issues: issues.get(w.id) ?? 0 }));
    },
  },
  maintenance: {
    title: 'Maintenance',
    columns: [['createdLocal', 'Date'], ['workstationId', 'PC'], ['category', 'Category'], ['description', 'Problem'], ['status', 'Status'],
      ['assignedTo', 'Assigned to'], ['actions', 'Actions taken'], ['resolution', 'Resolution'], ['resolvedLocal', 'Resolved']],
    rows: (db, q) => {
      const { sql, args } = between(q, 'i.created_at');
      return db.prepare(`SELECT i.*, u.name assigned FROM issues i LEFT JOIN users u ON u.id = i.assigned_to ${sql} ORDER BY i.created_at DESC`).all(...args)
        .map(i => ({ createdLocal: local(i.created_at), workstationId: i.workstation_id, category: i.category, description: i.description, status: i.status,
          assignedTo: i.assigned ?? '', resolution: i.resolution, resolvedLocal: local(i.resolved_at),
          actions: db.prepare(`SELECT m.action, m.remarks, u.name FROM maintenance_logs m LEFT JOIN users u ON u.id = m.technician_id WHERE issue_id = ? ORDER BY m.created_at`)
            .all(i.id).map(m => `${m.action}${m.remarks ? ` (${m.remarks})` : ''}${m.name ? ` – ${m.name}` : ''}`).join('; ') }));
    },
  },
  inventory: {
    title: 'Inventory',
    columns: [['assetTag', 'Asset tag'], ['name', 'Item'], ['category', 'Category'], ['workstationId', 'PC'], ['condition', 'Condition'],
      ['serialNo', 'Serial no.'], ['location', 'Location'], ['notes', 'Notes'], ['repairs', 'Maintenance entries']],
    rows: db => db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM maintenance_logs m WHERE m.inventory_id = i.id) repairs FROM inventory i ORDER BY asset_tag`).all()
      .map(i => ({ assetTag: i.asset_tag, name: i.name, category: i.category, workstationId: i.workstation_id ?? '', condition: i.condition,
        serialNo: i.serial_no, location: i.location, notes: i.notes, repairs: i.repairs })),
  },
};

export const REPORT_ROLES = { attendance: ['admin', 'instructor'], usage: ['admin', 'instructor', 'technician'],
  maintenance: ['admin', 'technician'], inventory: ['admin', 'technician'] };
