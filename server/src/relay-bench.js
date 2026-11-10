import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { requireThat } from './domain.js';

const nodeId = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/);
export const benchResultSchema = z.object({ commandId: z.uuid(), nodeId,
  workstationId: z.string().regex(/^PC-0[1-5]$/),
  state: z.enum(['pulse_finished', 'rejected', 'unknown']),
}).strict();
const wire = r => ({ commandId: r.commandId, nodeId: r.nodeId, workstationId: r.workstationId,
  action: 'relay_bench_pulse', issuedAtMs: r.issuedAtMs, expiresAtMs: r.expiresAtMs });

// Diagnostic queue only: never creates a reservation, power command or ON/OFF report.
export class RelayBenchTests {
  constructor(db, controllerId, lab, { now = Date.now } = {}) {
    this.db = db; this.id = controllerId; this.lab = lab; this.now = now;
  }
  ref(id) { return this.db.doc(`relayBenchTests/${id}`); }
  lock() { return this.db.doc(`relayBenchControllers/${this.id}`); }
  public(r) { return { ...wire(r), state: r.state === 'pending' && r.expiresAtMs <= this.now() ? 'unknown' : r.state }; }
  async start(actor, { commandId, workstationId }) {
    requireThat(actor.role === 'admin', 'Administrator authentication required.', 403);
    const telemetry = this.lab.controller.telemetry ? await this.lab.controller.snapshot() : null;
    await this.db.runTransaction(async tx => {
      const [existing, lock, pcDoc, snapshot] = await tx.getAll(this.ref(commandId), this.lock(),
        this.db.doc(`workstations/${workstationId}`), this.db.doc(`controllerSnapshots/${this.id}`));
      const prior = existing.data(), pc = pcDoc.data(), s = telemetry ?? snapshot.data(), now = this.now();
      if (prior) {
        requireThat(prior.controllerId === this.id && prior.createdBy === actor.uid && prior.workstationId === workstationId,
          'Test request identity conflicts with an existing request.', 409);
        return;
      }
      const old = lock.data()?.commandId ? (await tx.get(this.ref(lock.data().commandId))).data() : null;
      requireThat(!old || old.state !== 'pending' || old.expiresAtMs <= now, 'Another relay test is pending. Check its result first.', 409);
      requireThat(pc && !pc.sessionId, 'Relay testing requires an unassigned workstation.', 409);
      const node = s?.nodes?.find(n => n.nodeId === pc.nodeId && n.workstationId === workstationId);
      requireThat(s?.benchSupported && s?.benchNodes?.includes(pc.nodeId), 'Update the central and node firmware for remote relay testing.', 409);
      requireThat(now - s.receivedAt.toMillis() >= 0 && now - s.receivedAt.toMillis() < 15000 &&
        node?.connectivity === 'connected' && now - Date.parse(node.observedAt) >= 0 && now - Date.parse(node.observedAt) < 15000,
        'Node status is stale or disconnected. Wait for a fresh heartbeat.', 409);
      const record = { commandId, workstationId, nodeId: pc.nodeId, controllerId: this.id,
        createdBy: actor.uid, state: 'pending', issuedAtMs: now, expiresAtMs: now + 30000,
        createdAt: Timestamp.fromMillis(now) };
      tx.create(this.ref(commandId), record);
      tx.set(this.lock(), { commandId });
      this.lab.audit(tx, actor, 'relay_bench_test', { commandId, workstationId, nodeId: pc.nodeId });
    });
    return this.read(actor, commandId);
  }
  async read(actor, id) {
    requireThat(actor.role === 'admin', 'Administrator authentication required.', 403);
    const r = (await this.ref(id).get()).data();
    requireThat(r?.controllerId === this.id, 'Relay test not found.', 404);
    return this.public(r);
  }
  async deviceExchange(input, supported = false) {
    const result = input == null ? null : benchResultSchema.parse(input);
    if (result) await this.db.runTransaction(async tx => {
      const r = (await tx.get(this.ref(result.commandId))).data();
      requireThat(r?.controllerId === this.id && r.nodeId === result.nodeId && r.workstationId === result.workstationId,
        'Relay test result identity mismatch.', 409);
      if (r.state === 'pending') {
        tx.update(this.ref(result.commandId), { state: result.state, reportedAt: Timestamp.fromMillis(this.now()) });
      }
    });
    const lock = (await this.lock().get()).data();
    const r = lock?.commandId ? (await this.ref(lock.commandId).get()).data() : null;
    return { benchCommand: supported && r?.state === 'pending' && r.expiresAtMs > this.now() ? wire(r) : null,
      acknowledgedBench: result?.commandId ?? null };
  }
}
