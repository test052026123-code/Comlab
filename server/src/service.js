import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { closeDecision, commandResult, eligible, requireThat, reservationDecision } from './domain.js';

const stamp = () => FieldValue.serverTimestamp();
export const serialize = value => {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  return value;
};
export class LabService {
  constructor(db, controller) { this.db = db; this.controller = controller; }
  ref(path) { return this.db.doc(path); }
  createCommand(tx, actor, commandId, workstationId, nodeId) {
    const command = { id: commandId, commandId, workstationId, nodeId, action: 'power_on', state: 'pending', createdBy: actor.uid, at: stamp(),
      ...(this.controller.transport === 'cloud' ? { delivery: 'cloud', controllerId: this.controller.id } : {}) };
    tx.create(this.ref(`commands/${commandId}`), command);
    this.controller.enqueue?.(tx, command);
  }
  async list(collection) {
    const q = await this.db.collection(collection).get();
    return q.docs.map(d => serialize({ ...d.data(), id: d.id }));
  }
  audit(tx, actor, action, data) {
    tx.create(this.ref(`audit/${randomUUID()}`), { actor: actor.uid, action, data, at: stamp() });
  }
  async lookup(id) {
    const [s, a] = await this.db.getAll(this.ref(`students/${id}`), this.ref(`activeStudents/${id}`));
    requireThat(s.exists && (s.data().active || a.exists), 'Registered active student not found. Ask a staff member.', 404);
    let session = null;
    if (a.exists) session = serialize((await this.ref(`sessions/${a.data().sessionId}`).get()).data());
    return { student: { id, name: s.data().name, section: s.data().section }, session };
  }
  async workstations() {
    const pcs = await this.list('workstations');
    let nodes = [], controllerError = null;
    try { nodes = await this.controller.nodes(); } catch (e) { controllerError = e.message; }
    return { controllerError, workstations: pcs.map(pc => {
      const node = nodes.find(n => n.nodeId === pc.nodeId && n.workstationId === pc.id);
      const fresh = node && Date.now() - Date.parse(node.observedAt) < 15000 && Date.now() >= Date.parse(node.observedAt);
      return { ...pc, node: fresh ? node : { connectivity: node ? 'stale' : 'disconnected', power: 'unknown', reachability: 'unknown', input: 'unknown' }, eligible: eligible(pc, node) };
    }) };
  }
  async reserve(actor, body) {
    const { operationId, studentId, workstationId } = body;
    // A retry returns the committed operation even if the controller is now down.
    const old = await this.ref(`sessions/${operationId}`).get();
    if (old.exists) {
      requireThat(old.data().createdBy === actor.uid || actor.role === 'admin', 'Operation belongs to another kiosk.', 403);
      reservationDecision({ existing: old.data(), studentId, workstationId });
      return this.operation(actor, operationId);
    }
    const nodes = await this.controller.nodes();
    await this.db.runTransaction(async tx => {
      const sr = this.ref(`students/${studentId}`), ar = this.ref(`activeStudents/${studentId}`);
      const pr = this.ref(`workstations/${workstationId}`), rr = this.ref(`sessions/${operationId}`);
      const [s, a, p, r, canceled] = await tx.getAll(sr, ar, pr, rr, this.ref(`canceledOperations/${operationId}`));
      requireThat(!canceled.exists, 'Operation was canceled by staff. Start a new check-in.');
      if (r.exists) requireThat(r.data().createdBy === actor.uid || actor.role === 'admin', 'Operation belongs to another kiosk.', 403);
      const pc = p.exists ? { ...p.data(), id: p.id } : null;
      const node = nodes.find(n => n.nodeId === pc?.nodeId && n.workstationId === workstationId);
      const decision = reservationDecision({ existing: r.data(), student: s.data(), active: a.exists, pc, node, studentId, workstationId });
      if (decision.duplicate) return;
      const commandId = decision.commandRequired ? operationId : null;
      const session = { id: operationId, studentId, workstationId, name: s.data().name, section: s.data().section,
        status: 'active', timeIn: stamp(), timeOut: null, createdBy: actor.uid, commandId };
      tx.create(rr, session);
      tx.create(ar, { sessionId: operationId });
      tx.update(pr, { sessionId: operationId, assignment: 'reserved' });
      if (commandId) this.createCommand(tx, actor, commandId, workstationId, pc.nodeId);
      else tx.update(pr, { assignment: 'in use' });
      this.audit(tx, actor, 'reserve', { operationId, studentId, workstationId, commandId });
    });
    return this.operation(actor, operationId);
  }
  async operation(actor, id) {
    const s = await this.ref(`sessions/${id}`).get();
    requireThat(s.exists, 'Operation not found.', 404);
    requireThat(s.data().createdBy === actor.uid || actor.role === 'admin', 'Operation belongs to another kiosk.', 403);
    let command = null;
    if (s.data().commandId) command = (await this.ref(`commands/${s.data().commandId}`).get()).data();
    return serialize({ session: s.data(), command });
  }
  async reconcile(actor, id) {
    const op = await this.operation(actor, id);
    // Cloud sync owns result transitions. A polling read must not overwrite a
    // newer controller result that arrived after operation() returned.
    if (this.controller.transport === 'cloud') return op;
    if (!op.command || ['confirmed_on', 'failed', 'rejected'].includes(op.command.state)) return op;
    const result = await this.controller.command(op.command);
    const state = commandResult(result);
    await this.db.runTransaction(async tx => {
      const cr = this.ref(`commands/${id}`), sr = this.ref(`sessions/${id}`);
      const [c, s] = await tx.getAll(cr, sr);
      if (['confirmed_on', 'failed', 'rejected'].includes(c.data().state)) return;
      tx.update(cr, { state, result, checkedAt: stamp() });
      if (state === 'confirmed_on' && s.data().status === 'active') tx.update(this.ref(`workstations/${s.data().workstationId}`), { assignment: 'in use' });
      if (state !== c.data().state) this.audit(tx, actor, 'command_result', { commandId: id, state });
    });
    return this.operation(actor, id);
  }
  async close(actor, id, reason, { studentVerified = false } = {}) {
    await this.db.runTransaction(async tx => {
      const sr = this.ref(`sessions/${id}`), s = await tx.get(sr);
      requireThat(s.exists, 'Session not found.', 404);
      const data = s.data();
      // Approved kiosks may close an active session found by exact student-ID lookup.
      const refs = [this.ref(`activeStudents/${data.studentId}`), this.ref(`workstations/${data.workstationId}`)];
      if (data.commandId) refs.push(this.ref(`commands/${data.commandId}`));
      const [a, p, c] = await tx.getAll(...refs);
      if (!closeDecision(data, c?.data(), { studentVerified })) return;
      const command = c?.data();
      const unconfirmedPower = !!command && !['confirmed_on', 'rejected', 'failed'].includes(command.state);
      const repairedMissingStudentAssignment = actor.role === 'admin' && !a.exists && p.data()?.sessionId === id;
      // Staff may already have released the PC and student marker by hand. A
      // verified student may still close their own record, provided neither
      // marker now belongs to another session.
      const ownsMarker = a.data()?.sessionId === id, ownsPc = p.data()?.sessionId === id;
      const repairedReleasedAssignment = studentVerified && !(ownsMarker && ownsPc) &&
        (ownsMarker || !a.exists) && (ownsPc || !p.data()?.sessionId);
      requireThat((ownsMarker && ownsPc) || repairedMissingStudentAssignment || repairedReleasedAssignment,
        'Assignment integrity error. Contact administrator.');
      tx.update(sr, { status: 'closed', timeOut: stamp(), closeReason: reason, closedBy: actor.uid });
      if (ownsMarker) tx.delete(refs[0]);
      if (ownsPc) tx.update(refs[1], { sessionId: null, assignment: p.data().maintenance ? 'maintenance' : 'available' });
      // Never let an undelivered power pulse reach a PC that has been released.
      if (unconfirmedPower && command.delivery === 'cloud' && command.controllerId) {
        tx.delete(this.db.doc(`controllerQueue/${command.controllerId}/commands/${data.commandId}`));
      }
      this.audit(tx, actor, 'close_session', { id, reason,
        ...(repairedMissingStudentAssignment ? { repairedMissingStudentAssignment: true } : {}),
        ...(repairedReleasedAssignment ? { repairedReleasedAssignment: true } : {}),
        ...(unconfirmedPower ? { studentEndedUnconfirmedPower: true, commandState: command.state } : {}) });
    });
    return { closed: true };
  }
  async save(actor, collection, id, data) {
    await this.db.runTransaction(async tx => {
      const ref = this.ref(`${collection}/${id}`), old = await tx.get(ref);
      if (collection === 'workstations') {
        const mappingRef = this.ref(`nodeMappings/${data.nodeId}`);
        const mapping = await tx.get(mappingRef);
        const pcs = await tx.get(this.db.collection('workstations').where('nodeId', '==', data.nodeId));
        requireThat(!mapping.exists || mapping.data().workstationId === id, 'Node is already mapped to another workstation.');
        requireThat(!pcs.docs.some(d => d.id !== id), 'Node is already mapped to another workstation.');
        requireThat(!old.data()?.sessionId || old.data().nodeId === data.nodeId, 'Close the active session before changing node mapping.');
        if (old.exists && old.data().nodeId !== data.nodeId) tx.delete(this.ref(`nodeMappings/${old.data().nodeId}`));
        tx.set(mappingRef, { workstationId: id });
      }
      if (collection === 'students') requireThat(old.exists, 'Student not found. Use Add student to register.', 404);
      tx.set(ref, { ...data, updatedAt: stamp(), ...(collection === 'workstations' && !old.data()?.sessionId ? { sessionId: null, assignment: data.maintenance ? 'maintenance' : 'available' } : {}) }, { merge: true });
      this.audit(tx, actor, `${collection}_save`, { id, changes: data });
    });
    return { saved: true };
  }
  async reassign(actor, { sessionId, operationId, workstationId, reason }) {
    const prior = await this.ref(`sessions/${operationId}`).get();
    if (prior.exists) {
      requireThat(prior.data().replaces === sessionId && prior.data().workstationId === workstationId, 'Operation ID belongs to another reassignment.');
      return this.operation(actor, operationId);
    }
    const nodes = await this.controller.nodes();
    await this.db.runTransaction(async tx => {
      const oldRef = this.ref(`sessions/${sessionId}`), newRef = this.ref(`sessions/${operationId}`);
      const [old, retry, canceled] = await tx.getAll(oldRef, newRef, this.ref(`canceledOperations/${operationId}`));
      requireThat(!canceled.exists, 'Operation was canceled by staff.');
      if (retry.exists) {
        requireThat(retry.data().replaces === sessionId && retry.data().workstationId === workstationId, 'Operation ID belongs to another reassignment.');
        return;
      }
      requireThat(old.exists && old.data().status === 'active', 'Original session is no longer active.');
      const s = old.data();
      requireThat(s.workstationId !== workstationId, 'Choose a different PC.');
      const oldPcRef = this.ref(`workstations/${s.workstationId}`), newPcRef = this.ref(`workstations/${workstationId}`), activeRef = this.ref(`activeStudents/${s.studentId}`);
      const refs = [oldPcRef, newPcRef, activeRef, this.ref(`students/${s.studentId}`)];
      if (s.commandId) refs.push(this.ref(`commands/${s.commandId}`));
      const [oldPc, newPc, active, student, command] = await tx.getAll(...refs);
      closeDecision(s, command?.data());
      requireThat(oldPc.data()?.sessionId === sessionId && active.data()?.sessionId === sessionId, 'Assignment integrity error.');
      const pc = { ...newPc.data(), id: workstationId }, node = nodes.find(n => n.workstationId === workstationId && n.nodeId === pc.nodeId);
      const decision = reservationDecision({ student: student.data(), active: false, pc, node, studentId: s.studentId, workstationId });
      const commandId = decision.commandRequired ? operationId : null;
      tx.update(oldRef, { status: 'closed', timeOut: stamp(), closeReason: reason, closedBy: actor.uid, replacedBy: operationId });
      tx.update(oldPcRef, { sessionId: null, assignment: oldPc.data().maintenance ? 'maintenance' : 'available' });
      tx.create(newRef, { id: operationId, studentId: s.studentId, name: student.data().name, section: student.data().section, workstationId, status: 'active', timeIn: stamp(), timeOut: null, createdBy: actor.uid, commandId, replaces: sessionId });
      tx.set(activeRef, { sessionId: operationId });
      tx.update(newPcRef, { sessionId: operationId, assignment: commandId ? 'reserved' : 'in use' });
      if (commandId) this.createCommand(tx, actor, commandId, workstationId, pc.nodeId);
      this.audit(tx, actor, 'reassign', { sessionId, operationId, workstationId, reason });
    });
    return this.operation(actor, operationId);
  }
  async cancelUncommitted(actor, operationId) {
    await this.db.runTransaction(async tx => {
      const [session, canceled] = await tx.getAll(this.ref(`sessions/${operationId}`), this.ref(`canceledOperations/${operationId}`));
      requireThat(!session.exists, 'Reservation already committed. Reconcile the command; it cannot be canceled here.');
      if (canceled.exists) return;
      // Tombstone read by reservation transactions prevents a late commit after clearing local state.
      tx.create(this.ref(`canceledOperations/${operationId}`), { at: stamp(), actor: actor.uid });
      this.audit(tx, actor, 'cancel_uncommitted', { operationId });
    });
    return { canceled: true };
  }
  async issue(actor, data, { verifiedStudentId } = {}) {
    // The session ID makes report-and-close retries idempotent after a lost reply.
    const ref = this.ref(`issues/${data.sessionId}`), sr = this.ref(`sessions/${data.sessionId}`);
    await this.db.runTransaction(async tx => {
      const [prior, original] = await tx.getAll(ref, sr);
      const permitted = record => actor.role === 'admin' || record.createdBy === actor.uid ||
        (verifiedStudentId && record.studentId === verifiedStudentId);
      if (prior.exists) {
        requireThat(permitted(prior.data()), 'Report belongs to another kiosk.', 403);
        requireThat(prior.data().sessionClosed === true, 'Existing report requires staff review.');
        return;
      }
      let session = original.data();
      const commandId = session?.commandId ?? data.sessionId;
      const command = (await tx.get(this.ref(`commands/${commandId}`))).data();
      if (!session) {
        // Recover a manually deleted session only from matching trusted records.
        requireThat(command, 'Session is missing. Ask staff to repair its assignment.', 404);
        requireThat(actor.role === 'admin' || command.createdBy === actor.uid, 'Operation belongs to another kiosk.', 403);
        const active = await tx.get(this.db.collection('activeStudents').where('sessionId', '==', data.sessionId));
        requireThat(active.docs.length === 1, 'Missing session assignment requires staff repair.');
        const studentId = active.docs[0].id;
        const student = (await tx.get(this.ref(`students/${studentId}`))).data();
        requireThat(student, 'Student record is missing.', 404);
        session = { id: data.sessionId, studentId, name: student.name, section: student.section,
          workstationId: command.workstationId, createdBy: command.createdBy,
          commandId, status: 'active', timeIn: command.at ?? null, recoveredAfterDeletion: true };
      }
      requireThat(permitted(session), 'Session belongs to another kiosk.', 403);
      requireThat(session.status === 'active', 'Session is already closed.');
      if (command) requireThat(command.workstationId === session.workstationId && command.createdBy === session.createdBy,
        'Power command does not match this assignment.');
      const ar = this.ref(`activeStudents/${session.studentId}`), pr = this.ref(`workstations/${session.workstationId}`);
      const [active, pc] = await tx.getAll(ar, pr);
      requireThat(active.data()?.sessionId === data.sessionId && pc.data()?.sessionId === data.sessionId,
        'Assignment changed. Ask staff to inspect the session.');
      tx.create(ref, { sessionId: data.sessionId, description: data.description,
        studentId: session.studentId, workstationId: session.workstationId,
        status: 'open', remarks: '', resolution: '', createdBy: actor.uid, at: stamp(), sessionClosed: true });
      const closed = { status: 'closed', timeOut: stamp(), closeReason: 'Problem reported: ' + data.description,
        closedBy: actor.uid, issueId: ref.id };
      if (original.exists) tx.update(sr, closed);
      else tx.create(sr, { ...session, ...closed });
      tx.delete(ar);
      // An in-flight relay pulse cannot be recalled. Quarantine the PC and retain
      // the actual command result for staff instead of inventing power success.
      tx.update(pr, { sessionId: null, assignment: 'maintenance', maintenance: true });
      if (command?.delivery === 'cloud' && command.controllerId) {
        tx.delete(this.db.doc(`controllerQueue/${command.controllerId}/commands/${commandId}`));
      }
      this.audit(tx, actor, 'report_and_close_session', { id: ref.id, sessionId: data.sessionId,
        recoveredAfterDeletion: !original.exists, workstationId: session.workstationId });
    });
    return { id: ref.id, sessionClosed: true, workstationUnderMaintenance: true };
  }
}
