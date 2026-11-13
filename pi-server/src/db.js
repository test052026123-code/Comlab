// Local SQLite store. Uses Node's built-in driver, so nothing native has to
// compile on the Raspberry Pi. WAL mode survives sudden power loss.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (            -- staff: admin, technician, instructor
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','technician','instructor')),
  password_hash TEXT NOT NULL,
  fingerprint_slot INTEGER UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kiosks (           -- the tablet(s); paired device tokens
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT, kiosk_id TEXT,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, program TEXT NOT NULL DEFAULT '', year_level TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (          -- a weekly schedule slot
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  section_id TEXT NOT NULL REFERENCES sections(id),
  instructor_id TEXT REFERENCES users(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,                  -- 'HH:MM' local
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,                        -- student number
  name TEXT NOT NULL,
  section_id TEXT REFERENCES sections(id),
  fingerprint_slot INTEGER UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workstations (
  id TEXT PRIMARY KEY,                        -- e.g. PC-01
  label TEXT NOT NULL,
  node_id TEXT UNIQUE,                        -- ESP32 node id
  map_x REAL NOT NULL DEFAULT 0, map_y REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  maintenance INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  power TEXT NOT NULL DEFAULT 'unknown' CHECK (power IN ('on','off','unknown')),
  last_seen TEXT, rssi INTEGER, ip TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scans (            -- fingerprint matches from the sensor
  id TEXT PRIMARY KEY, slot INTEGER NOT NULL,
  person_type TEXT, person_id TEXT,
  at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (         -- attendance + workstation use
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  workstation_id TEXT NOT NULL REFERENCES workstations(id),
  class_id TEXT REFERENCES classes(id),
  section_name TEXT, subject_code TEXT,       -- snapshot for reports
  assignment TEXT NOT NULL CHECK (assignment IN ('manual','auto')),
  time_in TEXT NOT NULL, time_out TEXT,
  end_reason TEXT, ended_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_student ON sessions(student_id) WHERE time_out IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_pc ON sessions(workstation_id) WHERE time_out IS NULL;
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  workstation_id TEXT REFERENCES workstations(id),
  session_id TEXT REFERENCES sessions(id),
  reported_by TEXT, category TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  assigned_to TEXT REFERENCES users(id),
  resolution TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id TEXT PRIMARY KEY,
  issue_id TEXT REFERENCES issues(id),
  workstation_id TEXT REFERENCES workstations(id),
  inventory_id TEXT REFERENCES inventory(id),
  technician_id TEXT REFERENCES users(id),
  action TEXT NOT NULL, remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  asset_tag TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  workstation_id TEXT REFERENCES workstations(id),
  condition TEXT NOT NULL DEFAULT 'working' CHECK (condition IN ('working','defective','under_repair','disposed')),
  serial_no TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, target TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS changes (          -- outbox for the optional Firebase sync
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL, at TEXT NOT NULL
);
`;

export function openDb(path = process.env.COMLAB_DB || 'comlab.db') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  return db;
}

// Run fn inside one transaction; rolls back on any throw.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
