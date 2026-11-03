import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
const [role, uid] = process.argv.slice(2);
if (!['admin', 'kiosk', 'revoke'].includes(role) || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid || '')) throw new Error('Usage: npm run provision -- admin|kiosk|revoke EXISTING_FIREBASE_AUTH_UID');
initializeApp({ credential: applicationDefault() });
const auth = getAuth(), db = getFirestore();
const user = await auth.getUser(uid);
if (user.disabled && role !== 'revoke') throw new Error('Auth user is disabled.');
await db.runTransaction(async tx => {
  tx.set(db.doc(`users/${uid}`), { role: role === 'revoke' ? 'revoked' : role, enabled: role !== 'revoke', updatedAt: FieldValue.serverTimestamp() });
  tx.set(db.doc(`kiosks/${uid}`), { approved: role === 'kiosk', updatedAt: FieldValue.serverTimestamp() });
  tx.create(db.doc(`audit/${randomUUID()}`), { actor: 'trusted-provisioning-cli', action: `provision_${role}`, data: { uid }, at: FieldValue.serverTimestamp() });
});
await auth.revokeRefreshTokens(uid);
console.log(`Provisioned ${role} for UID ${uid}. Sign in again on the tablet.`);
