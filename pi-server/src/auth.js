import { scryptSync, randomBytes, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { Fault } from './errors.js';

const TOKEN_HOURS = { staff: 12, kiosk: 24 * 365 };
const sha = s => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const actual = scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

function issue(db, { userId = null, kioskId = null }, hours) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO auth_tokens VALUES (?,?,?,?,?)')
    .run(sha(token), userId, kioskId, new Date(Date.now() + hours * 3600e3).toISOString(), now());
  return token;
}

export function login(db, username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // Same work whether or not the user exists, so usernames can't be probed by timing.
  const ok = verifyPassword(password, u?.password_hash ?? hashPassword('x'));
  if (!u || !ok || !u.active) throw new Fault(401, 'Wrong username or password.');
  return { token: issue(db, { userId: u.id }, TOKEN_HOURS.staff), user: publicUser(u) };
}

// Staff can unlock their role at the tablet with a fingerprint scan instead of a password.
export function loginWithScan(db, user) {
  return { token: issue(db, { userId: user.id }, 1), user: publicUser(user) };
}

export function pairKiosk(db, name) {
  const id = randomUUID();
  db.prepare('INSERT INTO kiosks VALUES (?,?,?)').run(id, name, now());
  return { kioskId: id, token: issue(db, { kioskId: id }, TOKEN_HOURS.kiosk) };
}

export function logout(db, token) {
  db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(sha(token));
}

export function authenticate(db, header) {
  if (!header?.startsWith('Bearer ')) throw new Fault(401, 'Sign in first.');
  const t = db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ?').get(sha(header.slice(7)));
  if (!t || t.expires_at < now()) throw new Fault(401, 'Session expired. Sign in again.');
  if (t.kiosk_id) {
    const k = db.prepare('SELECT * FROM kiosks WHERE id = ?').get(t.kiosk_id);
    if (!k) throw new Fault(401, 'Kiosk was unpaired.');
    return { id: k.id, role: 'kiosk', name: k.name };
  }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id);
  if (!u?.active) throw new Fault(401, 'Account disabled.');
  return { id: u.id, role: u.role, name: u.name };
}

export function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, fingerprintSlot: u.fingerprint_slot, active: !!u.active };
}
