import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

try {
  const root = new URL('../../', import.meta.url);
  const firmware = readFileSync(new URL('server/.local/node-firmware-build/comlab_node.ino.bin', root));
  const header = readFileSync(new URL('firmware/comlab_node/secrets.h', root), 'utf8');
  if (!firmware.includes(Buffer.from('ComLab node relay bench test v1'))) throw new Error();
  if (!firmware.includes(Buffer.from('Authenticated app relay test ready v1'))) throw new Error();
  if (!firmware.includes(Buffer.from('Node power-on executor v1'))) throw new Error();
  if (!firmware.includes(Buffer.from('Local recovery v1'))) throw new Error();
  if (!firmware.includes(Buffer.from('[Power command] Ready=%s; command=%s'))) throw new Error();
  if (/^#define\s+COMLAB_NODE_POWER_SENSE\s+1\b/m.test(header) &&
      !firmware.includes(Buffer.from('Power sense input v2'))) throw new Error();
  for (const name of ['COMLAB_NODE_WIFI_SSID', 'COMLAB_NODE_WIFI_PASSWORD', 'COMLAB_NODE_ID', 'COMLAB_WORKSTATION_ID', 'COMLAB_NODE_KEY']) {
    const match = header.match(new RegExp(String.raw`^#define\s+${name}\s+("(?:\\.|[^"\\])*")`, 'm'));
    if (!match) throw new Error();
    const value = JSON.parse(match[1]);
    if (value && !firmware.includes(Buffer.from(value))) throw new Error();
  }
  for (const name of ['comlab_node.ino.bootloader.bin', 'comlab_node.ino.partitions.bin']) {
    if (readFileSync(new URL(`server/.local/node-firmware-build/${name}`, root)).length === 0) throw new Error();
  }
  console.log('PASS: prebuilt node has the relay bench commands and matches current local node configuration.');
  console.log(`Local firmware directory: ${fileURLToPath(new URL('server/.local/node-firmware-build/', root))}`);
  console.log('No credentials printed. This checks binary identity/configuration, not arbitrary future source edits.');
} catch {
  console.error('Node binary is missing, outdated, or mismatched. Run Build-Firmware.ps1 -Target node. No credentials printed.');
  process.exitCode = 1;
}
