// Log only known error codes and route templates, never raw SDK errors or URLs.
const codes = new Set([
  'auth/insufficient-permission', 'auth/invalid-credential',
  'app/invalid-credential', 'app/invalid-app-options',
  'PERMISSION_DENIED', 'UNAUTHENTICATED', 'UNAVAILABLE',
  'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED', 'NOT_FOUND',
]);
export function safeFailure(req, err, status) {
  const code = Number.isInteger(err.code) && err.code >= 0 && err.code <= 16
    ? err.code : codes.has(err.code) ? err.code : 'unclassified';
  return JSON.stringify({ event: 'request_failed', status,
    route: req.route?.path || 'authentication_or_middleware', code,
    kind: err instanceof TypeError ? 'TypeError' : err instanceof RangeError ? 'RangeError' : 'Error' });
}
export function proxyHops(env) {
  const value = env.TRUST_PROXY_HOPS ?? (env.RENDER === 'true' ? '1' : '0');
  if (!/^[0-5]$/.test(value)) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
  return Number(value);
}
