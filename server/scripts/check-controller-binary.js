import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

try {
  const root = new URL('../../', import.meta.url);
  const firmware = readFileSync(new URL('server/.local/cloud-firmware-build/comlab_cloud.ino.bin', root));
  const header = readFileSync(new URL('firmware/comlab_cloud/secrets.h', root), 'utf8');
  const peers = readFileSync(new URL('firmware/comlab_cloud/node_secrets.h', root), 'utf8');
  for (const required of ['ComLab outbound HTTPS + authenticated node discovery.', '[Nodes] Authenticated heartbeat receiver ready']) {
    if (!firmware.includes(Buffer.from(required))) throw new Error();
  }
  for (const name of ['COMLAB_WIFI_SSID', 'COMLAB_WIFI_PASSWORD', 'COMLAB_API_ORIGIN', 'COMLAB_CONTROLLER_ID', 'COMLAB_DEVICE_KEY']) {
    const match = header.match(new RegExp(String.raw`^#define\s+${name}\s+("(?:\\.|[^"\\])*")`, 'm'));
    if (!match) throw new Error();
    const value = JSON.parse(match[1]);
    if (value && !firmware.includes(Buffer.from(value))) throw new Error();
  }
  const keys = [...peers.matchAll(/"([a-f0-9]{64})"/g)].map(match => match[1]);
  if (keys.length !== 5 || keys.some(key => !firmware.includes(Buffer.from(key)))) throw new Error();
  for (const name of ['comlab_cloud.ino.bootloader.bin', 'comlab_cloud.ino.partitions.bin']) {
    if (readFileSync(new URL(`server/.local/cloud-firmware-build/${name}`, root)).length === 0) throw new Error();
  }
  console.log('PASS: prebuilt firmware contains the updated node receiver and matches current local controller/peer configuration.');
  console.log(`Local firmware directory: ${fileURLToPath(new URL('server/.local/cloud-firmware-build/', root))}`);
  console.log('No firmware was uploaded and no credentials were printed. This does not validate future source edits.');
} catch {
  console.error('Prebuilt controller firmware is missing, outdated, or does not match local configuration. Rebuild with Build-Firmware.ps1 after freeing Windows memory. No credentials were printed.');
  process.exitCode = 1;
}
