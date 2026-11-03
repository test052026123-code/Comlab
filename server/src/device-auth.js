import { createHash, timingSafeEqual } from 'node:crypto';
import { Fault } from './domain.js';

// Device credentials are separate from Firebase users and local pairing tokens.
export function authenticateDevice(headers, controllerId, expectedHash) {
  const bearer = headers.authorization;
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(controllerId || '') || !/^[a-f0-9]{64}$/i.test(expectedHash || '')) {
    throw new Fault(503, 'Cloud controller authentication is not configured.');
  }
  if (headers['x-comlab-controller-id'] !== controllerId || !bearer?.startsWith('Bearer ')) {
    throw new Fault(401, 'Controller authentication required.');
  }
  const token = bearer.slice(7);
  const actual = createHash('sha256').update(token).digest();
  if (!/^[a-f0-9]{64}$/i.test(token) || !timingSafeEqual(actual, Buffer.from(expectedHash, 'hex'))) {
    throw new Fault(401, 'Controller authentication required.');
  }
  return controllerId;
}
