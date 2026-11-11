import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { z } from 'zod';
import { LabService } from './service.js';
import { Controller } from './controller.js';
import { CloudController, syncSchema } from './cloud-controller.js';
import { RealtimeTelemetry, ControllerWorkMonitor } from './realtime-telemetry.js';
import { authenticateDevice } from './device-auth.js';
import { Fingerprints } from './fingerprints.js';
import { RelayBenchTests } from './relay-bench.js';
import { adminWebCors } from './admin-web.js';
import { safeFailure, proxyHops } from './server-diagnostics.js';
import { Fault, requireThat, csv, approvedRole } from './domain.js';
import { issueIdSchema } from './issue-schema.js';

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('ComLab requires real Firebase services.');
const databaseURL = process.env.FIREBASE_DATABASE_URL || (process.env.GOOGLE_CLOUD_PROJECT === 'comlab-45f0c'
  ? 'https://comlab-45f0c-default-rtdb.asia-southeast1.firebasedatabase.app' : undefined);
initializeApp({ credential: applicationDefault(), ...(databaseURL ? { databaseURL } : {}) });
const db = getFirestore();
const transport = process.env.CONTROLLER_TRANSPORT || 'lan';
if (!['lan', 'cloud'].includes(transport)) throw new Error('CONTROLLER_TRANSPORT must be lan or cloud.');
if (transport === 'cloud' && (!/^[A-Za-z0-9_-]{1,48}$/.test(process.env.CONTROLLER_ID || '') || !/^[a-f0-9]{64}$/i.test(process.env.CONTROLLER_DEVICE_KEY_SHA256 || ''))) {
  throw new Error('Configure CONTROLLER_ID and CONTROLLER_DEVICE_KEY_SHA256 for cloud mode.');
}
const telemetry = transport === 'cloud' && databaseURL
  ? new RealtimeTelemetry(getDatabase(), process.env.CONTROLLER_ID) : null;
const monitor = telemetry ? new ControllerWorkMonitor(db, process.env.CONTROLLER_ID) : null;
const controller = transport === 'cloud' ? new CloudController(db, process.env.CONTROLLER_ID, { telemetry })
  : new Controller(process.env.CONTROLLER_URL, process.env.CONTROLLER_TOKEN, Number(process.env.CONTROLLER_TIMEOUT_MS || 4000));
const lab = new LabService(db, controller);
const fingerprints = new Fingerprints(db, process.env.CONTROLLER_ID || 'LAB-CONTROLLER', lab);
const relayBench = new RelayBenchTests(db, process.env.CONTROLLER_ID || 'LAB-CONTROLLER', lab);
const app = express();
app.set('trust proxy', proxyHops(process.env));
app.disable('x-powered-by');
app.use(helmet(), adminWebCors, express.json({ limit: '16kb' }));
// Process liveness only. Firebase/controller checks stay authenticated.
app.get('/healthz', (req, res) => res.json({ status: 'ok', apiVersion: 'status-fresh-30s' }));
if (transport === 'cloud') {
  app.post('/v1/controller/sync', rateLimit({ windowMs: 60000, limit: 60 }), async (req, res, next) => {
    try {
      authenticateDevice(req.headers, process.env.CONTROLLER_ID, process.env.CONTROLLER_DEVICE_KEY_SHA256);
      if (telemetry) {
        const body = syncSchema.parse(req.body), now = Date.now();
        requireThat(Date.parse(body.sampledAt) <= now + 2000, 'Controller clock is ahead.', 409);
        requireThat(new Set(body.nodes.map(n => n.nodeId)).size === body.nodes.length &&
          new Set(body.nodes.map(n => n.workstationId)).size === body.nodes.length &&
          new Set(body.results.map(r => r.commandId)).size === body.results.length, 'Duplicate controller identity.', 400);
        const accepted = await telemetry.accept(body, monitor.idle(body, now));
        if (accepted.idle) return res.json(accepted.response);
      }
      const response = await controller.sync(req.body);
      if (telemetry) await telemetry.confirmBoot(req.body.bootId);
      res.json({ ...response, ...await fingerprints.deviceExchange(req.body.fingerprintResult, req.body.fingerprintProgress, req.body.fingerprintCapacity),
        ...await relayBench.deviceExchange(req.body.benchResult, req.body.benchSupported === true) });
    } catch (e) { next(e); }
  });
}
app.use(rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
const id = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/);
const pcId = z.string().regex(/^PC-0[1-5]$/);
const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(300);
const reservation = z.object({ operationId: uuid, studentId: id, workstationId: pcId, scanRequestId: uuid.optional() }).strict();
const studentRecord = z.object({ name: text, section: text, active: z.boolean(), fingerprintSlot: z.number().int().min(0).max(999).nullable().optional() });
app.use(async (req, res, next) => {
  try {
    const bearer = req.headers.authorization;
    requireThat(bearer?.startsWith('Bearer '), 'Sign in with an approved administrator or kiosk account.', 401);
    let token;
    try { token = await getAuth().verifyIdToken(bearer.slice(7), true); }
    catch { throw new Fault(401, 'Authentication expired or revoked. Sign in again.'); }
    const [user, kiosk] = await db.getAll(db.doc(`users/${token.uid}`), db.doc(`kiosks/${token.uid}`));
    const role = approvedRole(user.data(), kiosk.data());
    requireThat(role, 'Account is not approved for ComLab.', 403);
    req.actor = { uid: token.uid, role };
    next();
  } catch (e) { next(e); }
});
const admin = (req, res, next) => req.actor.role === 'admin' ? next() : next(new Fault(403, 'Administrator authentication required.'));
app.get('/me', (req, res) => res.json(req.actor));
app.get('/health', async (req, res) => {
  await db.doc('settings/lab').get();
  res.json({ firebase: 'reachable', controllerTransport: transport, at: new Date().toISOString() });
});
app.get('/controller/status', async (req, res) => res.json(transport === 'cloud' ? await controller.status() : { transport: 'lan' }));
app.post('/lookup', rateLimit({ windowMs: 60000, limit: 15 }), async (req, res) => {
  requireThat(req.actor.role === 'admin', 'Use the fingerprint scanner to identify a student.', 403);
  res.json(await lab.lookup(id.parse(req.body.studentId)));
});
app.post('/fingerprint/requests', rateLimit({ windowMs: 60000, limit: 15 }), async (req, res) => {
  requireThat(transport === 'cloud', 'Fingerprint scanning requires cloud controller mode.', 503);
  const { requestId } = z.object({ requestId: uuid }).strict().parse(req.body);
  res.json(await fingerprints.start(req.actor, requestId));
});
app.post('/admin/fingerprint/enroll', rateLimit({ windowMs: 60000, limit: 15 }), async (req, res) => {
  requireThat(transport === 'cloud', 'Fingerprint enrollment requires cloud controller mode.', 503);
  const { requestId, studentId } = z.object({ requestId: uuid, studentId: id }).strict().parse(req.body);
  res.json(await fingerprints.startEnroll(req.actor, requestId, studentId));
});
app.get('/fingerprint/requests/:id', async (req, res) => res.json(await fingerprints.read(req.actor, uuid.parse(req.params.id))));
app.post('/fingerprint/requests/:id/cancel', async (req, res) => res.json(await fingerprints.cancel(req.actor, uuid.parse(req.params.id))));
app.get('/workstations', async (req, res) => {
  const data = await lab.workstations();
  // Kiosks do not receive student names or internal maintenance notes.
  if (req.actor.role === 'kiosk') data.workstations = data.workstations.map(p => ({ id: p.id, nodeId: p.nodeId, enabled: p.enabled, maintenance: p.maintenance, assignment: p.assignment, eligible: p.eligible, node: p.node }));
  res.json(data);
});
app.post('/reserve', async (req, res) => {
  const data = reservation.parse(req.body);
  if (req.actor.role !== 'admin') await fingerprints.authorize(req.actor, uuid.parse(data.scanRequestId), data.studentId);
  res.json(await lab.reserve(req.actor, data));
});
app.get('/operations/:id', async (req, res) => res.json(await lab.operation(req.actor, uuid.parse(req.params.id))));
app.post('/operations/:id/reconcile', async (req, res) => res.json(await lab.reconcile(req.actor, uuid.parse(req.params.id))));
app.post('/sessions/:id/close', async (req, res) => {
  const reason = req.actor.role === 'admin' ? text.parse(req.body.reason) : 'Student checkout — fingerprint identification';
  if (req.actor.role !== 'admin') {
    const session = (await db.doc(`sessions/${uuid.parse(req.params.id)}`).get()).data();
    await fingerprints.authorize(req.actor, uuid.parse(req.body.scanRequestId), session?.studentId);
  }
  // Only a fresh matched scan of the session's own student counts as verification.
  res.json(await lab.close(req.actor, uuid.parse(req.params.id), reason, { studentVerified: req.actor.role !== 'admin' }));
});
app.post('/issues', async (req, res) => {
  const data = z.object({ sessionId: uuid, description: text, scanRequestId: uuid.optional() }).strict().parse(req.body);
  let verifiedStudentId;
  if (req.actor.role !== 'admin') {
    const session = (await db.doc(`sessions/${data.sessionId}`).get()).data();
    // The creating kiosk can report its own failed startup even after the scan
    // expires. A different kiosk still needs a fresh proof for this student.
    if (session && session.createdBy !== req.actor.uid) {
      await fingerprints.authorize(req.actor, uuid.parse(data.scanRequestId), session.studentId);
      verifiedStudentId = session.studentId;
    }
  }
  res.json(await lab.issue(req.actor, data, { verifiedStudentId }));
});
app.get('/settings', async (req, res) => {
  const s = (await db.doc('settings/lab').get()).data();
  res.json({ welcomeTimeoutSeconds: s?.welcomeTimeoutSeconds ?? 25, shutdownOnCheckout: false });
});
app.use('/admin', admin);
app.post('/admin/relay-tests', rateLimit({ windowMs: 60000, limit: 15 }), async (req, res) => {
  requireThat(transport === 'cloud', 'Remote relay testing requires cloud controller mode.', 503);
  res.json(await relayBench.start(req.actor, z.object({ commandId: uuid, workstationId: pcId }).strict().parse(req.body)));
});
app.get('/admin/relay-tests/:id', async (req, res) => res.json(await relayBench.read(req.actor, uuid.parse(req.params.id))));
app.post('/admin/connection-settings', async (req, res) => {
  const data = z.object({ apiUrl: z.url(), controllerUrl: z.string().max(300), timeoutMs: z.number().int().min(1000).max(15000), pairingChanged: z.boolean() }).strict().parse(req.body);
  res.json(await lab.save(req.actor, 'settings', `device-${req.actor.uid}`, data));
});
app.post('/admin/operations/:id/cancel-uncommitted', async (req, res) => res.json(await lab.cancelUncommitted(req.actor, uuid.parse(req.params.id))));
app.get('/admin/students', async (req, res) => res.json({ rows: await lab.list('students') }));
app.post('/admin/students', async (req, res) => {
  const { id: studentId, ...data } = studentRecord.extend({ id }).strict().parse(req.body);
  res.json(await fingerprints.saveStudent(req.actor, studentId, data, true));
});
app.put('/admin/students/:id', async (req, res) => res.json(await fingerprints.saveStudent(req.actor, id.parse(req.params.id), studentRecord.strict().parse(req.body))));
app.put('/admin/workstations/:id', async (req, res) => res.json(await lab.save(req.actor, 'workstations', pcId.parse(req.params.id), z.object({ nodeId: id, enabled: z.boolean(), maintenance: z.boolean(), notes: z.string().max(1000) }).strict().parse(req.body))));
async function history(query) {
  const filter = z.object({ student: z.string().optional(), pc: z.string().optional(), section: z.string().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }).parse(query);
  return (await lab.list('sessions')).filter(r => (!filter.student || r.studentId.includes(filter.student.toUpperCase())) &&
    (!filter.pc || r.workstationId === filter.pc) && (!filter.section || r.section.toLowerCase().includes(filter.section.toLowerCase())) &&
    (!filter.from || Date.parse(r.timeIn) >= Date.parse(`${filter.from}T00:00:00+08:00`)) &&
    (!filter.to || Date.parse(r.timeIn) < Date.parse(`${filter.to}T00:00:00+08:00`) + 86400000)).sort((a,b) => b.timeIn.localeCompare(a.timeIn));
}
app.get('/admin/history', async (req, res) => res.json({ rows: await history(req.query) }));
app.get('/admin/history.csv', async (req, res) => res.type('text/csv').send('\uFEFF' + csv(await history(req.query))));
app.get('/admin/issues', async (req, res) => res.json({ rows: await lab.list('issues') }));
app.put('/admin/issues/:id', async (req, res) => {
  const data = z.object({ status: z.enum(['open', 'investigating', 'resolved']), remarks: z.string().max(1000), resolution: z.string().max(1000) }).strict().parse(req.body);
  requireThat(data.status !== 'resolved' || data.resolution.trim(), 'Provide a resolution before resolving.');
  const issueId = issueIdSchema.parse(req.params.id);
  requireThat((await db.doc(`issues/${issueId}`).get()).exists, 'Issue not found.', 404);
  res.json(await lab.save(req.actor, 'issues', issueId, data));
});
app.get('/admin/audit', async (req, res) => res.json({ rows: (await lab.list('audit')).sort((a,b) => b.at.localeCompare(a.at)) }));
app.put('/admin/settings', async (req, res) => res.json(await lab.save(req.actor, 'settings', 'lab', z.object({ welcomeTimeoutSeconds: z.number().int().min(10).max(120) }).strict().parse(req.body))));
app.post('/admin/reassign', async (req, res) => {
  res.json(await lab.reassign(req.actor, z.object({ sessionId: uuid, operationId: uuid, workstationId: pcId, reason: text }).strict().parse(req.body)));
});
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err instanceof z.ZodError ? 400 : err.status || 503;
  // Never log tokens, pairing secrets, submitted student IDs, or ADC errors.
  console.error(safeFailure(req, err, status));
  res.status(status).json({ error: err instanceof z.ZodError ? 'Invalid input. Check required fields and identifier format.' : err instanceof Fault ? err.message : 'Cloud operation unavailable. Check server logs, Firebase permissions and internet; retry using the same operation.' });
});
app.listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1', () => console.log('ComLab API ready behind your HTTPS reverse proxy.'));
