// Short-lived live-credential startup check. No Firestore writes or relay requests.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { credentials } from './controller-credentials.js';

const server = fileURLToPath(new URL('..', import.meta.url));
const accountFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.comlab-secrets', 'comlab-server.json');
let child;
try {
  const project = JSON.parse(readFileSync(accountFile, 'utf8')).project_id;
  const device = credentials();
  child = spawn(process.execPath, ['src/index.js'], { cwd: server, windowsHide: true, stdio: 'ignore', env: {
    ...process.env, GOOGLE_APPLICATION_CREDENTIALS: accountFile, GOOGLE_CLOUD_PROJECT: project,
    CONTROLLER_TRANSPORT: 'cloud', CONTROLLER_ID: device.controllerId, CONTROLLER_DEVICE_KEY_SHA256: device.keySha256,
    HOST: '127.0.0.1', PORT: '18081',
  } });
  child.on('error', () => {});
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) break;
    try { const response = await fetch('http://127.0.0.1:18081/healthz', {signal:AbortSignal.timeout(1000)}); ready = response.status === 200 && (await response.json()).status === 'ok'; if (ready) break; } catch {}
    await new Promise(resolve => setTimeout(resolve,250));
  }
  assert.ok(ready);
  assert.equal((await (await fetch('http://127.0.0.1:18081/healthz')).json()).apiVersion, 'fingerprint-1');
  assert.equal((await fetch('http://127.0.0.1:18081/health')).status,401);
  assert.equal((await fetch('http://127.0.0.1:18081/controller/status')).status,401);
  assert.equal((await fetch('http://127.0.0.1:18081/fingerprint/requests', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})).status,401);
  assert.equal((await fetch('http://127.0.0.1:18081/fingerprint/requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).status,401);
  assert.equal((await fetch('http://127.0.0.1:18081/v1/controller/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})).status,401);
  console.log('PASS: cloud-mode startup, public process health and separate user/device authentication guards.');
  console.log('No Firestore write, Firebase token minting or hardware command was performed.');
} catch { console.error('Cloud startup/guard check failed. Check protected credentials, Node version and unused loopback port 18081. No credentials were printed.'); process.exitCode = 1; }
finally { child?.kill(); }
