import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { protectFile } from './controller-credentials.js';

try {
  const slot = Number(process.argv[2]);
  if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error();
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const cloudHeader = readFileSync(join(root, 'firmware/comlab_cloud/secrets.h'), 'utf8');
  const value = name => {
    const match = cloudHeader.match(new RegExp(String.raw`^#define\s+${name}\s+("(?:\\.|[^"\\])*")`, 'm'));
    if (!match) throw new Error();
    return JSON.parse(match[1]);
  };
  const folder = join(homedir(), '.comlab-secrets');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, 'node-pairing.json');
  if (!existsSync(path)) {
    const nodes = Array.from({ length: 5 }, (_, i) => ({ nodeId: `NODE-0${i + 1}`, workstationId: `PC-0${i + 1}`, key: randomBytes(32).toString('hex') }));
    writeFileSync(path, JSON.stringify({ nodes }, null, 2), { mode: 0o600, flag: 'wx' });
  }
  protectFile(path);
  const { nodes } = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(nodes) || nodes.length !== 5 || nodes.some((n, i) => n.nodeId !== `NODE-0${i + 1}` || n.workstationId !== `PC-0${i + 1}` || !/^[a-f0-9]{64}$/.test(n.key))) throw new Error();
  const selected = nodes[slot - 1];
  const nodeHeader = join(root, 'firmware/comlab_node/secrets.h');
  const receiverHeader = join(root, 'firmware/comlab_cloud/node_secrets.h');
  const header = ['#pragma once', '// LOCAL ONLY. Never commit, paste or share this file.',
    `#define COMLAB_NODE_WIFI_SSID ${JSON.stringify(value('COMLAB_WIFI_SSID'))}`,
    `#define COMLAB_NODE_WIFI_PASSWORD ${JSON.stringify(value('COMLAB_WIFI_PASSWORD'))}`,
    `#define COMLAB_NODE_ID ${JSON.stringify(selected.nodeId)}`,
    `#define COMLAB_WORKSTATION_ID ${JSON.stringify(selected.workstationId)}`,
    `#define COMLAB_NODE_KEY ${JSON.stringify(selected.key)}`,
    '#define COMLAB_CONTROLLER_HOST "comlab-controller"', ''].join('\n');
  const receiver = ['#pragma once', '// LOCAL ONLY. Per-node keys; never commit or share.',
    'struct NodeCredential { const char* nodeId; const char* workstationId; const char* key; };',
    'static const NodeCredential NODE_CREDENTIALS[5] = {',
    ...nodes.map(n => `  {${JSON.stringify(n.nodeId)}, ${JSON.stringify(n.workstationId)}, ${JSON.stringify(n.key)}},`),
    '};', ''].join('\n');
  writeFileSync(nodeHeader, header, { mode: 0o600 }); protectFile(nodeHeader);
  writeFileSync(receiverHeader, receiver, { mode: 0o600 }); protectFile(receiverHeader);
  console.log(`Configured ${selected.nodeId} / ${selected.workstationId} and controller peer keys locally. No credentials were printed.`);
  console.log('Upload the updated controller first, then this node. Relay control remains disabled.');
} catch {
  console.error('Node setup failed. Run from the ComLab project: node server/scripts/configure-node.js <1-5>. Configure controller Wi-Fi first. No credentials were printed.');
  process.exitCode = 1;
}
