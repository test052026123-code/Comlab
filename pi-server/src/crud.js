// One table-driven CRUD layer for every dashboard record type, with role checks.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit, recordChange, nowIso } from './lab.js';
import { hashPassword, publicUser } from './auth.js';
import { Fault, requireThat } from './errors.js';

const STAFF = ['admin', 'technician', 'instructor'];
// Role scopes: instructors handle classes/attendance, technicians handle equipment.
const TEACH = ['admin', 'instructor'], TECH = ['admin', 'technician'];
const text = (max = 200) => z.string().trim().min(1).max(max);
const opt = (max = 1000) => z.string().trim().max(max).default('');
const ref = z.string().min(1).max(64).nullable().default(null);
const slot = z.number().int().min(1).max(300).nullable().default(null);   // AS608 holds up to 300 templates
const time = z.string({ error: 'Pick a time.' }).regex(/^([01]\d|2[0-3]):[0-5]\d/, 'Pick a time (HH:MM).').transform(t => t.slice(0, 5));
const need = what => z.string({ error: `Choose a ${what}.` }).min(1, `Choose a ${what}.`);
const bool = z.boolean().transform(b => (b ? 1 : 0));

// columns: API field -> db column. schema validates API fields.
export const RESOURCES = {
  users: {
    table: 'users', read: ['admin'], write: ['admin'], idFrom: null,
    schema: z.object({ username: z.string().regex(/^[a-zA-Z0-9._-]{3,32}$/), name: text(), role: z.enum(['admin', 'technician', 'instructor']),
      password: z.string().min(8).max(128).optional(), fingerprintSlot: slot, active: bool.default(1) }),
    columns: { username: 'username', name: 'name', role: 'role', fingerprintSlot: 'fingerprint_slot', active: 'active' },
    out: publicUser,
  },
  students: {
    table: 'students', read: TEACH, write: ['admin'], idFrom: 'id',
    schema: z.object({ id: z.string().regex(/^[A-Za-z0-9-]{3,32}$/), name: text(), sectionId: ref, fingerprintSlot: slot, active: bool.default(1) }),
    columns: { name: 'name', sectionId: 'section_id', fingerprintSlot: 'fingerprint_slot', active: 'active' },
  },
  sections: {
    table: 'sections', read: TEACH, write: ['admin'],
    schema: z.object({ name: text(60), program: opt(60), yearLevel: opt(20) }),
    columns: { name: 'name', program: 'program', yearLevel: 'year_level' },
  },
  subjects: {
    table: 'subjects', read: TEACH, write: ['admin'],
    schema: z.object({ code: text(30), title: text() }),
    columns: { code: 'code', title: 'title' },
  },
  classes: {
    table: 'classes', read: TEACH, write: ['admin'],
    schema: z.object({ subjectId: need('subject'), sectionId: need('section'), instructorId: ref,
      dayOfWeek: z.number().int().min(0).max(6), startTime: time, endTime: time })
      .refine(c => c.startTime < c.endTime, 'End time must be after start time.'),
    columns: { subjectId: 'subject_id', sectionId: 'section_id', instructorId: 'instructor_id', dayOfWeek: 'day_of_week', startTime: 'start_time', endTime: 'end_time' },
  },
  workstations: {
    table: 'workstations', read: STAFF, write: ['admin', 'technician'], idFrom: 'id',
    schema: z.object({ id: z.string().regex(/^[A-Z0-9-]{2,16}$/), label: text(40), nodeId: ref, mapX: z.number().default(0), mapY: z.number().default(0),
      enabled: bool.default(1), maintenance: bool.default(0), notes: opt() }),
    columns: { label: 'label', nodeId: 'node_id', mapX: 'map_x', mapY: 'map_y', enabled: 'enabled', maintenance: 'maintenance', notes: 'notes' },
  },
  inventory: {
    table: 'inventory', read: ['admin', 'technician'], write: ['admin', 'technician'],
    schema: z.object({ assetTag: text(40), name: text(), category: z.enum(['system_unit', 'monitor', 'keyboard', 'mouse', 'ups', 'network', 'furniture', 'other']).default('other'),
      workstationId: ref, condition: z.enum(['working', 'defective', 'under_repair', 'disposed']).default('working'),
      serialNo: opt(80), location: opt(80), notes: opt() }),
    columns: { assetTag: 'asset_tag', name: 'name', category: 'category', workstationId: 'workstation_id', condition: 'condition', serialNo: 'serial_no', location: 'location', notes: 'notes' },
  },
  issues: {
    table: 'issues', read: TECH, write: ['admin', 'technician'],
    schema: z.object({ workstationId: ref, category: z.enum(['hardware', 'software', 'network', 'power', 'other']).default('other'), description: text(1000),
      status: z.enum(['open', 'in_progress', 'resolved']).default('open'), assignedTo: ref, resolution: opt() })
      .refine(i => i.status !== 'resolved' || i.resolution, 'Write a resolution before marking resolved.'),
    columns: { workstationId: 'workstation_id', category: 'category', description: 'description', status: 'status', assignedTo: 'assigned_to', resolution: 'resolution' },
    extra: (body, at) => ({ resolved_at: body.status === 'resolved' ? at : null }),
  },
  maintenance: {
    table: 'maintenance_logs', read: ['admin', 'technician'], write: ['admin', 'technician'],
    schema: z.object({ issueId: ref, workstationId: ref, inventoryId: ref, action: text(300), remarks: opt() }),
    columns: { issueId: 'issue_id', workstationId: 'workstation_id', inventoryId: 'inventory_id', action: 'action', remarks: 'remarks' },
    extra: (body, at, actor, isCreate) => (isCreate ? { technician_id: actor.role === 'kiosk' ? null : actor.id } : {}),
  },
};

const toApi = (r, cols) => {
  if (!r) return r;
  const o = { id: r.id };
  for (const [api, col] of Object.entries(cols)) o[api] = r[col];
  for (const k of ['created_at', 'updated_at', 'resolved_at', 'technician_id', 'reported_by', 'session_id', 'last_seen', 'power'])
    if (k in r) o[k.replace(/_(\w)/g, (_, c) => c.toUpperCase())] = r[k];
  return o;
};

function conflict(e) {
  const m = String(e.message);
  if (m.includes('UNIQUE')) return new Fault(409, `Already exists: ${m.split('UNIQUE constraint failed: ')[1] ?? 'duplicate value'}.`);
  if (m.includes('FOREIGN KEY')) return new Fault(409, 'Linked record is missing or still in use.');
  return e;
}

export function crud(db, name) {
  const R = RESOURCES[name];
  const allowed = (actor, kind) => requireThat(R[kind].includes(actor.role), 'Your role cannot do this.', 403);
  const view = r => (R.out ? R.out(r) : toApi(r, R.columns));
  const get = id => db.prepare(`SELECT * FROM ${R.table} WHERE id = ?`).get(id);
  const write = (actor, id, body, isCreate) => {
    const data = (isCreate ? R.schema : R.schema).parse(body);
    const at = nowIso();
    const row = Object.fromEntries(Object.entries(R.columns).filter(([api]) => api in data && data[api] !== undefined).map(([api, col]) => [col, data[api]]));
    if (name === 'users' && data.password) row.password_hash = hashPassword(data.password);
    if (name === 'users' && isCreate) requireThat(data.password, 'Set a password for the new account.', 400);
    Object.assign(row, R.extra?.(data, at, actor, isCreate) ?? {}, { updated_at: at });
    try {
      if (isCreate) {
        id = R.idFrom ? data[R.idFrom] : randomUUID();
        Object.assign(row, { id, created_at: at });
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO ${R.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c]));
      } else {
        requireThat(get(id), 'Not found.', 404);
        const cols = Object.keys(row);
        db.prepare(`UPDATE ${R.table} SET ${cols.map(c => `${c} = ?`).join(',')} WHERE id = ?`).run(...cols.map(c => row[c]), id);
      }
    } catch (e) { throw conflict(e); }
    audit(db, actor, `${name}.${isCreate ? 'create' : 'update'}`, id);
    recordChange(db, R.table, id, 'upsert');
    return view(get(id));
  };
  return {
    list(actor) { allowed(actor, 'read'); return db.prepare(`SELECT * FROM ${R.table} ORDER BY created_at DESC`).all().map(view); },
    read(actor, id) { allowed(actor, 'read'); const r = get(id); requireThat(r, 'Not found.', 404); return view(r); },
    create(actor, body) { allowed(actor, 'write'); return write(actor, null, body, true); },
    update(actor, id, body) { allowed(actor, 'write'); return write(actor, id, body, false); },
    remove(actor, id) {
      allowed(actor, 'write');
      requireThat(get(id), 'Not found.', 404);
      requireThat(!(name === 'users' && id === actor.id), 'You cannot delete your own account.');
      try { db.prepare(`DELETE FROM ${R.table} WHERE id = ?`).run(id); } catch (e) { throw conflict(e); }
      audit(db, actor, `${name}.delete`, id);
      recordChange(db, R.table, id, 'delete');
      return { deleted: id };
    },
  };
}
