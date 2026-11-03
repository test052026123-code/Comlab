import { readFile } from 'node:fs/promises';
import dns from 'node:dns/promises';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { controllerDiagnostic } from './controller-diagnostic.js';

// Read-only checks. Do not print credentials, access tokens, or controller bodies.
async function check() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS certificate validation must remain enabled. Remove NODE_TLS_REJECT_UNAUTHORIZED=0.');
  for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'CONTROLLER_URL', 'CONTROLLER_TOKEN']) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Remove Firebase emulator variables. Real Firebase services are required.');
  let credentials;
  try { credentials = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')); }
  catch { throw new Error('Cannot read valid service-account JSON. File contents are intentionally omitted.'); }
  if (credentials.type !== 'service_account' || !credentials.private_key || !credentials.client_email) throw new Error('Choose a real service-account JSON file. Web firebaseConfig is not a server credential.');
  if (credentials.project_id !== process.env.GOOGLE_CLOUD_PROJECT) throw new Error('Credential project does not match GOOGLE_CLOUD_PROJECT. Do not use an eSURSECO credential.');
  const url = new URL(process.env.CONTROLLER_URL);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('Controller URL must be an HTTP(S) origin without embedded credentials.');
  const timeout = Number(process.env.CONTROLLER_TIMEOUT_MS || 4000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 15000) throw new Error('Controller timeout must be 1000–15000 milliseconds.');
  let firebase;
  try {
    firebase = initializeApp({ credential: applicationDefault(), projectId: process.env.GOOGLE_CLOUD_PROJECT }, 'comlab-preflight');
    await getFirestore(firebase).doc('settings/lab').get();
    console.log('PASS: real Firestore read with server credentials.');
  } catch {
    throw new Error('Firebase preflight failed. Check project/database creation, service-account roles, key validity, computer clock and internet. Credential details are intentionally omitted.');
  } finally {
    if (firebase) await deleteApp(firebase);
  }
  let controllerStage = 'DNS lookup';
  try {
    await dns.lookup(url.hostname);
    console.log('PASS: controller hostname resolves on Windows.');
    controllerStage = 'GET /v1/health';
    const result = await fetch(`${url.origin}/v1/health`, {
      headers: { Authorization: `Bearer ${process.env.CONTROLLER_TOKEN}` },
      signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
    if (result.status === 401 || result.status === 403) throw new Error('Controller rejected the pairing secret. Use the same secret configured in firmware.');
    if (!result.ok) throw new Error(`Controller health returned HTTP ${result.status}.`);
    const health = await result.json();
    if (!health || typeof health !== 'object' || Array.isArray(health)) throw new Error('Controller health must return a JSON object.');
    console.log('PASS: authenticated controller health read.');
    controllerStage = 'GET /v1/nodes';
    const nodes = await fetch(`${url.origin}/v1/nodes`, {
      headers: { Authorization: `Bearer ${process.env.CONTROLLER_TOKEN}` },
      signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
    if (!nodes.ok) throw new Error(`Controller nodes returned HTTP ${nodes.status}.`);
    const status = await nodes.json();
    if (!Array.isArray(status.nodes)) throw new Error('Controller /v1/nodes must return an object containing a nodes array.');
    console.log(`PASS: authenticated controller health and node-status reads (${status.nodes.length} reported nodes).`);
    console.log('No relay command was sent. Auth-user approval and HTTPS still need separate verification.');
  } catch (e) {
    if (e.message.startsWith('Controller')) throw e;
    throw new Error(controllerDiagnostic(controllerStage, e, url.hostname, timeout));
  }
}
check().catch(e => { console.error(e.message); process.exitCode = 1; });
