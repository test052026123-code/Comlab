export class Fault extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function approvedRole(user, kiosk) {
  if (user?.enabled !== true) return null;
  if (user.role === 'admin') return 'admin';
  return user.role === 'kiosk' && kiosk?.approved === true ? 'kiosk' : null;
}
export function requireThat(ok, message, status = 409) {
  if (!ok) throw new Fault(status, message);
}
// Status age allowed for availability. The controller only reports nodes heard
// within 6 s; this covers slow cloud round trips between controller and tablet.
export const STATUS_FRESH_MS = 30000;
export function eligible(pc, node, now = Date.now()) {
  return !!pc && pc.enabled === true && !pc.maintenance && !pc.sessionId &&
    !!node && node.nodeId === pc.nodeId && node.workstationId === pc.id &&
    node.connectivity === 'connected' && now - Date.parse(node.observedAt) < STATUS_FRESH_MS &&
    now >= Date.parse(node.observedAt) && ['on', 'off'].includes(node.power);
}
export function reservationDecision({ existing, student, active, pc, node, studentId, workstationId }) {
  if (existing) {
    requireThat(existing.studentId === studentId && existing.workstationId === workstationId,
      'Operation ID already belongs to another request.');
    return { duplicate: true };
  }
  requireThat(student?.active === true, 'Student is missing or inactive.');
  requireThat(!active, 'Student already has an active session.');
  requireThat(eligible(pc, node), 'PC unavailable, node stale, or power unknown. Refresh and choose another PC.');
  return { duplicate: false, commandRequired: node.power === 'off' };
}
// A student whose fingerprint was just verified has used the PC, which is
// stronger evidence than missing power feedback; their checkout may proceed.
export function closeDecision(session, command, { studentVerified = false } = {}) {
  requireThat(session, 'Session not found.', 404);
  if (session.status === 'closed') return false;
  requireThat(studentVerified || !command || ['confirmed_on', 'rejected', 'failed'].includes(command.state),
    'Power delivery is pending or unknown. Reconcile before releasing this PC.');
  return true;
}
export function commandResult(result) {
  requireThat(result && ['accepted', 'pending', 'confirmed_on', 'failed', 'rejected', 'unknown'].includes(result.state),
    'Controller returned an invalid command result.', 502);
  return result.state;
}
export function csv(rows) {
  const columns = ['id', 'studentId', 'name', 'section', 'workstationId', 'status', 'timeIn', 'timeOut', 'closeReason'];
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\r\n');
}
