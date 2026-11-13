import { openDb } from './db.js';
import { createApp } from './app.js';

const db = openDb();
if (!process.env.COMLAB_NODE_KEY) console.warn('COMLAB_NODE_KEY is not set: ESP32 node heartbeats will be rejected.');
const port = Number(process.env.PORT || 8080);
createApp(db).listen(port, process.env.HOST || '0.0.0.0', () => console.log(`ComLab Pi server listening on :${port}`));
