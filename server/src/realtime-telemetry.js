import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { requireThat } from './domain.js';

// Durable monotonic telemetry is independent of the Firestore command journal.
// Never remove boot IDs: they prevent a retired device boot becoming current again.
export class RealtimeTelemetry {
  constructor(database, controllerId, { now = Date.now } = {}) {
    this.ref = database.ref(`controllerTelemetry/${controllerId}`);
    this.id = controllerId; this.now = now;
  }
  async read() {
    const value = (await this.ref.child('current').get()).val();
    return value ? { ...value, nodes: value.nodes ?? [], capabilities: value.capabilities ?? [],
      benchNodes: value.benchNodes ?? [], receivedAt: Timestamp.fromMillis(value.receivedAtMs) } : null;
  }
  async confirmBoot(bootId) {
    await this.ref.child('current').transaction(value => {
      // A fresh SDK reference may initially supply null despite server data.
      // Returning null lets CAS fetch/retry; aborting here would skip checkpointing.
      if (!value) return null;
      if (value.bootId !== bootId || value.durableBoot) return;
      return { ...value, durableBoot: true };
    }, undefined, false);
  }
  async accept(body, idle) {
    const now = this.now();
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const idleResponse = { protocolVersion: 1, controllerId: this.id, bootId: body.bootId,
      ackSequence: body.sequence, serverTime: new Date(now).toISOString(), acknowledgedResults: [], commands: [],
      fingerprintRequest: null, acknowledgedFingerprint: null, benchCommand: null, acknowledgedBench: null };
    const result = await this.ref.transaction(value => {
      value ??= {};
      const previous = value.current;
      if (previous?.bootId === body.bootId && body.sequence <= previous.sequence) return;
      if (previous?.bootId !== body.bootId && value.boots?.[body.bootId]) return;
      return { boots: { ...value.boots, [body.bootId]: true }, current: {
        bootId: body.bootId, sequence: body.sequence, digest, receivedAtMs: now,
        sampledAt: body.sampledAt, firmwareVersion: body.firmwareVersion,
        capabilities: body.capabilities, benchSupported: body.benchSupported === true,
        benchNodes: body.benchNodes ?? [],
        nodes: body.nodes.map(n => ({ ...n, observedAt: new Date(Math.min(Date.parse(body.sampledAt), now)).toISOString() })),
        durableBoot: previous?.bootId === body.bootId && previous.durableBoot === true,
        idle: idle && previous?.bootId === body.bootId && previous.durableBoot === true,
      } };
    }, undefined, false);
    // An aborted transaction's returned snapshot can be empty in the SDK local
    // cache, so explicitly fetch server state before validating a duplicate.
    const current = result.committed ? result.snapshot.val().current : (await this.ref.child('current').get()).val();
    requireThat(current?.bootId === body.bootId && current.sequence === body.sequence && current.digest === digest,
      'Old, conflicting, or retired controller telemetry.', 409);
    // RTDB omits empty arrays/null children; rebuild the complete wire response.
    return { idle: current.idle === true, response: { ...idleResponse, serverTime: new Date(current.receivedAtMs).toISOString() } };
  }
}

// Firestore listeners avoid polling empty queues on every ESP32 heartbeat.
// Before initial snapshots or after a listener error, always use durable sync.
export class ControllerWorkMonitor {
  constructor(db, id) {
    this.values = new Map(); this.stops = [];
    const watch = (key, ref, project) => this.stops.push(ref.onSnapshot(
      snap => this.values.set(key, project(snap)),
      () => this.values.delete(key),
    ));
    watch('queue', db.collection(`controllerQueue/${id}/commands`), s => s.docs.map(d => d.data()));
    watch('scan', db.collection('fingerprintRequests').where('state', '==', 'waiting'), s => s.docs.map(d => d.data()).filter(r => r.controllerId === id));
    watch('bench', db.collection('relayBenchTests').where('state', '==', 'pending'), s => s.docs.map(d => d.data()).filter(r => r.controllerId === id));
    watch('scanner', db.doc(`fingerprintScanners/${id}`), s => s.data() ?? {});
  }
  idle(body, now = Date.now()) {
    if (this.values.size !== 4 || body.results.length || body.fingerprintResult || body.fingerprintProgress || body.benchResult) return false;
    if (body.fingerprintCapacity && this.values.get('scanner').capacity !== body.fingerprintCapacity) return false;
    return !this.values.get('queue').length &&
      !this.values.get('scan').some(r => r.expiresAt.toMillis() > now) &&
      !this.values.get('bench').some(r => r.expiresAtMs > now);
  }
  close() { this.stops.forEach(stop => stop()); }
}
