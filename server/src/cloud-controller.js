import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { Fault, requireThat } from './domain.js';
import { fingerprintResultSchema } from './fingerprints.js';

const stamp = () => FieldValue.serverTimestamp();
const pcId = z.string().regex(/^PC-0[1-5]$/);
const nodeId = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/);
const identity = { commandId: z.uuid(), workstationId: pcId, nodeId, action: z.literal('power_on') };
export const syncSchema = z.object({
  protocolVersion: z.literal(1), bootId: z.uuid(), sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sampledAt: z.iso.datetime(), uptimeMs: z.number().int().nonnegative(), firmwareVersion: z.string().min(1).max(64),
  capabilities: z.array(z.literal('power_on')).max(1),
  fingerprintResult: fingerprintResultSchema.optional(),
  nodes: z.array(z.object({ workstationId: pcId, nodeId,
    connectivity: z.enum(['connected', 'disconnected']), power: z.enum(['on', 'off', 'unknown']),
    reachability: z.enum(['reachable', 'unreachable', 'unknown']), input: z.enum(['active', 'idle', 'unknown']),
  }).strict()).max(5),
  results: z.array(z.object({ ...identity,
    state: z.enum(['accepted', 'pending', 'confirmed_on', 'failed', 'rejected', 'unknown']),
    detail: z.string().max(160).optional(),
  }).strict()).max(5),
}).strict();

const terminal = state => ['confirmed_on', 'failed', 'rejected'].includes(state);
const identityOf = c => ({ commandId: c.commandId, workstationId: c.workstationId, nodeId: c.nodeId, action: c.action });

export class CloudController {
  transport = 'cloud';
  constructor(db, controllerId, { now = Date.now } = {}) {
    this.db = db; this.id = controllerId; this.now = now;
  }
  snapshotRef() { return this.db.doc(`controllerSnapshots/${this.id}`); }
  queueRef(id) { return this.db.doc(`controllerQueue/${this.id}/commands/${id}`); }
  enqueue(tx, command) {
    tx.create(this.queueRef(command.id), { ...identityOf(command), createdAt: stamp(), expiresAt: Timestamp.fromMillis(this.now() + 30000), deliveryState: 'queued' });
  }
  async status() {
    const s = (await this.snapshotRef().get()).data();
    return { transport: 'cloud', controllerId: this.id, connected: !!s && this.now() - s.receivedAt.toMillis() >= 0 && this.now() - s.receivedAt.toMillis() < 15000,
      receivedAt: s?.receivedAt?.toDate().toISOString() ?? null, sampledAt: s?.sampledAt ?? null,
      firmwareVersion: s?.firmwareVersion ?? null, reportedNodes: s?.nodes?.length ?? 0 };
  }
  async nodes() {
    const s = (await this.snapshotRef().get()).data();
    requireThat(s && this.now() - s.receivedAt.toMillis() >= 0 && this.now() - s.receivedAt.toMillis() < 15000,
      'Cloud controller is offline. Workstations remain unavailable until fresh status arrives.', 503);
    return s.nodes;
  }
  async command(command) {
    const c = (await this.db.doc(`commands/${command.id}`).get()).data();
    requireThat(c?.controllerId === this.id, 'Controller command not found.', 404);
    return c.result ?? { ...identityOf(c), state: c.state };
  }
  async sync(input) {
    const body = syncSchema.parse(input);
    const now = this.now(), sampled = Date.parse(body.sampledAt);
    requireThat(sampled <= now + 2000, 'Controller clock is ahead. Synchronize time before sending status.', 409);
    requireThat(new Set(body.nodes.map(n => n.nodeId)).size === body.nodes.length && new Set(body.nodes.map(n => n.workstationId)).size === body.nodes.length,
      'Duplicate controller node mapping.', 400);
    requireThat(new Set(body.results.map(r => r.commandId)).size === body.results.length, 'Duplicate command results.', 400);
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return this.db.runTransaction(async tx => {
      const bootRef = this.db.doc(`controllerBoots/${this.id}-${body.bootId}`);
      const [snapshot, boot] = await tx.getAll(this.snapshotRef(), bootRef);
      const previous = snapshot.data();
      if (previous?.bootId === body.bootId && body.sequence <= previous.sequence) {
        requireThat(body.sequence === previous.sequence && digest === previous.digest, 'Old or conflicting controller sequence.', 409);
        // Replaying a request never refreshes telemetry or redispatches expired work.
        return { ...previous.response, commands: previous.response.commands.filter(c => Date.parse(c.expiresAt) > now) };
      }
      requireThat(previous?.bootId === body.bootId || !boot.exists, 'Retired controller boot cannot resume. Restart with a new boot ID.', 409);
      const queued = await tx.get(this.db.collection(`controllerQueue/${this.id}/commands`).orderBy('createdAt').limit(10));
      const queue = new Map(queued.docs.map(d => [d.id, d.data()]));
      const ids = [...new Set([...queue.keys(), ...body.results.map(r => r.commandId)])];
      const refs = ids.flatMap(id => [this.db.doc(`commands/${id}`), this.db.doc(`sessions/${id}`)]);
      const records = refs.length ? await tx.getAll(...refs) : [];
      const commands = new Map(ids.map((id, i) => [id, records[i * 2].data()]));
      const sessions = new Map(ids.map((id, i) => [id, records[i * 2 + 1].data()]));
      const pcRefs = [...new Set([...sessions.values()].filter(Boolean).map(s => s.workstationId))].map(id => this.db.doc(`workstations/${id}`));
      const pcSnaps = pcRefs.length ? await tx.getAll(...pcRefs) : [];
      const pcs = new Map(pcSnaps.map(s => [s.id, s.data()]));
      // All reads above precede every transaction write below.
      const updates = [], acknowledgedResults = [], outgoing = [];
      const record = (id, result) => {
        const c = commands.get(id);
        updates.push(() => tx.update(this.db.doc(`commands/${id}`), { state: result.state, result, checkedAt: stamp() }));
        commands.set(id, { ...c, state: result.state, result });
        if (terminal(result.state)) updates.push(() => tx.delete(this.queueRef(id)));
        if (result.state === 'confirmed_on') {
          const session = sessions.get(id), pc = pcs.get(c.workstationId);
          if (session?.status === 'active' && session.commandId === id && pc?.sessionId === id) {
            updates.push(() => tx.update(this.db.doc(`workstations/${c.workstationId}`), { assignment: 'in use' }));
          }
        }
        const audit = this.db.collection('audit').doc();
        updates.push(() => tx.create(audit, { actor: `controller:${this.id}`, action: 'controller_command_result', data: { commandId: id, state: result.state }, at: stamp() }));
      };
      for (const result of body.results) {
        const c = commands.get(result.commandId);
        requireThat(c?.controllerId === this.id && c.deliveryBootId === body.bootId &&
          c.workstationId === result.workstationId && c.nodeId === result.nodeId && c.action === result.action,
          'Controller command identity or delivery boot mismatch.', 409);
        if (terminal(c.state)) requireThat(c.state === result.state, 'Terminal command result cannot change.', 409);
        else {
          requireThat(!(c.state === 'accepted' && result.state === 'pending'), 'Command state cannot move backwards.', 409);
          if (result.state === 'confirmed_on') {
            requireThat(now - sampled < 15000 && body.nodes.some(n => n.nodeId === c.nodeId && n.workstationId === c.workstationId && n.connectivity === 'connected' && n.power === 'on'),
              'Startup confirmation requires fresh matching power feedback.', 409);
          }
          record(result.commandId, result);
          if (!terminal(result.state) && queue.has(result.commandId)) updates.push(() => tx.update(this.queueRef(result.commandId), { deliveryState: 'acknowledged' }));
        }
        acknowledgedResults.push(result.commandId);
      }
      for (const [id, q] of queue) {
        const c = commands.get(id);
        if (!c || c.controllerId !== this.id || terminal(c.state)) { updates.push(() => tx.delete(this.queueRef(id))); continue; }
        if (acknowledgedResults.includes(id)) continue;
        if (q.deliveryState !== 'queued' && c.deliveryBootId !== body.bootId) {
          if (c.state !== 'unknown') record(id, { ...identityOf(c), state: 'unknown', detail: 'Controller restarted after delivery. Verify physical state; never repeat the pulse.' });
          continue;
        }
        if (q.deliveryState === 'acknowledged') continue;
        if (q.expiresAt.toMillis() <= now) {
          if (c.state !== 'unknown') record(id, { ...identityOf(c), state: q.deliveryState === 'queued' ? 'rejected' : 'unknown', detail: 'Command expired; delivered work is never assumed safe to repeat.' });
          continue;
        }
        if (now - sampled >= 15000) continue;
        if (q.deliveryState === 'queued') {
          const node = body.nodes.find(n => n.nodeId === c.nodeId && n.workstationId === c.workstationId);
          if (node?.connectivity === 'connected' && node.power === 'on') { record(id, { ...identityOf(c), state: 'confirmed_on', detail: 'Already on; no pulse requested.' }); continue; }
          if (!body.capabilities.includes('power_on') || node?.connectivity !== 'connected' || node.power !== 'off') {
            record(id, { ...identityOf(c), state: 'rejected', detail: 'Controller capability or fresh OFF feedback is unavailable.' }); continue;
          }
          if (outgoing.length >= 5) continue;
          updates.push(() => tx.update(this.db.doc(`commands/${id}`), { deliveryBootId: body.bootId, deliveredAt: stamp() }));
          updates.push(() => tx.update(this.queueRef(id), { deliveryState: 'delivered' }));
        }
        if (outgoing.length < 5) outgoing.push({ ...identityOf(c), expiresAt: q.expiresAt.toDate().toISOString() });
      }
      const response = { protocolVersion: 1, controllerId: this.id, bootId: body.bootId, ackSequence: body.sequence,
        serverTime: new Date(now).toISOString(), acknowledgedResults, commands: outgoing };
      if (!boot.exists) tx.create(bootRef, { startedAt: stamp() });
      for (const update of updates) update();
      tx.set(this.snapshotRef(), { bootId: body.bootId, sequence: body.sequence, digest, response,
        sampledAt: body.sampledAt, receivedAt: stamp(), firmwareVersion: body.firmwareVersion, capabilities: body.capabilities,
        nodes: body.nodes.map(n => ({ ...n, observedAt: new Date(Math.min(sampled, now)).toISOString() })) });
      return response;
    });
  }
}
