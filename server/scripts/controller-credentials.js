import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const credentialPath = join(homedir(), '.comlab-secrets', 'controller-cloud.json');
export function protectFile(path) {
  if (process.platform !== 'win32') return;
  const output = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = output.match(/S-1-5-[\d-]+/)?.[0];
  if (!sid) throw new Error('Could not identify the current Windows account.');
  execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `*${sid}:F`, '*S-1-5-18:F'], { stdio: 'ignore', windowsHide: true });
}
export function credentials() {
  mkdirSync(join(homedir(), '.comlab-secrets'), { recursive: true, mode: 0o700 });
  if (!existsSync(credentialPath)) {
    const deviceKey = randomBytes(32).toString('hex');
    writeFileSync(credentialPath, JSON.stringify({ controllerId: 'LAB-CONTROLLER', deviceKey,
      keySha256: createHash('sha256').update(deviceKey).digest('hex') }, null, 2), { mode: 0o600, flag: 'wx' });
  }
  protectFile(credentialPath);
  const data = JSON.parse(readFileSync(credentialPath, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(data.deviceKey || '') || createHash('sha256').update(data.deviceKey).digest('hex') !== data.keySha256) throw new Error('Invalid protected controller credentials.');
  return data;
}
