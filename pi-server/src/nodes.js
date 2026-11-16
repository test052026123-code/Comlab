import { randomUUID } from 'node:crypto';
import { audit, nowIso, recordChange } from './lab.js';

// Power-on/off commands for ESP32 nodes plus automatic fault detection.
// The node polls via its heartbeat; the reply carries at most one command.
const COMMAND_TTL_MS = 25_000;     // node refuses commands older than 30s
const BOOT_DEADLINE_MS = 45_000;   // PC must report ON this long after a power-on
const SHUTDOWN_DEADLINE_MS = 150_000; // Windows may take a while to shut down

export function createNodeHub(db) {
  const pending = new Map();   // workstationId -> command
  const watching = new Map();  // workstationId -> { commandId, deadline }
  const lastPower = new Map(); // workstationId -> 'on' | 'off' | 'unknown'

  function autoIssue(pcId, description) {
    // One open automatic report per PC and problem is enough.
    if (db.prepare("SELECT 1 FROM issues WHERE workstation_id = ? AND description = ? AND status != 'resolved' AND reported_by = 'system:node'")
      .get(pcId, description)) return;
    const id = randomUUID(), at = nowIso();
    db.prepare(`INSERT INTO issues (id, workstation_id, reported_by, category, description, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(id, pcId, 'system:node', 'hardware', description, at, at);
    audit(db, null, 'issue.auto', id, { workstationId: pcId, description });
    recordChange(db, 'issues', id, 'upsert');
  }

  function request(pcId, action) {
    const pc = db.prepare('SELECT id, node_id FROM workstations WHERE id = ?').get(pcId);
    if (!pc?.node_id) return null;
    const on = action === 'power_on';
    // Turning off a PC that is already off (or on one already on) needs no press.
    if (lastPower.get(pc.id) === (on ? 'on' : 'off')) return null;
    const issuedAtMs = Date.now();
    const cmd = { action, commandId: randomUUID(), nodeId: pc.node_id, workstationId: pc.id, issuedAtMs, expiresAtMs: issuedAtMs + COMMAND_TTL_MS };
    pending.set(pc.id, cmd);
    watching.set(pc.id, { commandId: cmd.commandId, want: on ? 'on' : 'off', deadline: issuedAtMs + (on ? BOOT_DEADLINE_MS : SHUTDOWN_DEADLINE_MS) });
    return cmd.commandId;
  }
  const requestPowerOn = pcId => request(pcId, 'power_on');
  const requestPowerOff = pcId => request(pcId, 'power_off');

  // Called for every heartbeat after the workstation row is updated.
  function onHeartbeat(nodeId, { power, powerResult }) {
    const pc = db.prepare('SELECT id FROM workstations WHERE node_id = ?').get(nodeId);
    if (!pc) return {};
    const now = Date.now();
    const prev = lastPower.get(pc.id);
    lastPower.set(pc.id, power);
    const open = db.prepare('SELECT 1 FROM sessions WHERE workstation_id = ? AND time_out IS NULL').get(pc.id);
    if (prev === 'on' && power === 'off' && open && !watching.has(pc.id))
      autoIssue(pc.id, 'PC turned off unexpectedly while a student was using it.');

    const w = watching.get(pc.id);
    if (w) {
      const result = powerResult?.commandId === w.commandId ? powerResult.state : null;
      if (power === w.want || result === `confirmed_${w.want}`) watching.delete(pc.id);
      else if (result === 'rejected' || result === 'unknown' || now > w.deadline) {
        watching.delete(pc.id);
        autoIssue(pc.id, w.want === 'on' ? 'PC did not power on after the node pressed the power button.'
          : 'PC did not shut down after checkout. Check that Windows is set to shut down when the power button is pressed.');
      }
    }
    let cmd = pending.get(pc.id);
    const target = cmd?.action === 'power_off' ? 'off' : 'on';
    if (cmd && (now > cmd.expiresAtMs || powerResult?.commandId === cmd.commandId || power === target)) { pending.delete(pc.id); cmd = null; }
    return cmd ? { command: cmd } : {};
  }

  return { requestPowerOn, requestPowerOff, onHeartbeat };
}
