import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { credentials, credentialPath, protectFile } from './controller-credentials.js';
try {
  const data = credentials();
  const hashPath = join(dirname(credentialPath), 'controller-cloud-sha256.txt');
  writeFileSync(hashPath, `${data.keySha256}\n`, { mode: 0o600 });
  protectFile(hashPath);
  console.log(`Controller credentials are protected at: ${credentialPath}`);
  console.log(`Copy the hash file value into Render CONTROLLER_DEVICE_KEY_SHA256: ${hashPath}`);
  console.log('No device key was printed. The Firebase service-account key is separate.');
} catch { console.error('Controller credential setup failed. Check access to your protected .comlab-secrets folder. No credential contents were printed.'); process.exitCode = 1; }
