import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { credentials, protectFile } from './controller-credentials.js';

try {
  const origin = new URL(process.argv[2]);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Invalid origin');
  const source = process.argv[3];
  if (!source) throw new Error('Existing sketch path required');
  const sketch = readFileSync(source, 'utf8');
  const literal = name => {
    const found = sketch.match(new RegExp(String.raw`${name}\s*=\s*("(?:\\.|[^"\\])*")`));
    if (!found) throw new Error('Wi-Fi definition missing');
    return JSON.parse(found[1]);
  };
  const data = credentials();
  const header = fileURLToPath(new URL('../../firmware/comlab_cloud/secrets.h', import.meta.url));
  writeFileSync(header, ['#pragma once', '// LOCAL ONLY. Never commit or share this file.',
    `#define COMLAB_WIFI_SSID ${JSON.stringify(literal('WIFI_SSID'))}`,
    `#define COMLAB_WIFI_PASSWORD ${JSON.stringify(literal('WIFI_PASSWORD'))}`,
    `#define COMLAB_API_ORIGIN ${JSON.stringify(origin.origin)}`,
    `#define COMLAB_CONTROLLER_ID ${JSON.stringify(data.controllerId)}`,
    `#define COMLAB_DEVICE_KEY ${JSON.stringify(data.deviceKey)}`, ''].join('\n'), { mode: 0o600 });
  protectFile(header);
  console.log('Configured ignored, protected firmware secrets.h. No credentials were printed.');
  console.log('Compile and upload only after the Render endpoint is deployed and verified.');
} catch { console.error('Firmware configuration failed. Supply the actual HTTPS origin and existing ComLab sketch path. No credential contents were printed.'); process.exitCode = 1; }
