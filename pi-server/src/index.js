import { openDb } from './db.js';
import { createApp } from './app.js';
import { AS608 } from './as608.js';
import { FingerprintService } from './fingerprint.js';

const db = openDb();
if (!process.env.COMLAB_NODE_KEY) console.warn('COMLAB_NODE_KEY is not set: ESP32 node heartbeats will be rejected.');
const fingerprints = process.env.COMLAB_FP_PORT === 'none' ? null : new FingerprintService(db, new AS608());
if (fingerprints) console.log(await fingerprints.start() ? 'Fingerprint sensor ready.' : 'Fingerprint sensor not ready; will retry on next request.');
const port = Number(process.env.PORT || 8080);
createApp(db, { fingerprints }).listen(port, process.env.HOST || '0.0.0.0', () => console.log(`ComLab Pi server listening on :${port}`));
