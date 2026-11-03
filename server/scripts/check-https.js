// No credentials sent. A 401 verifies HTTPS transport + the API authentication
// guard, NOT Firebase access. Never disable certificate verification.
async function check() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Certificate validation is disabled in this shell. Remove NODE_TLS_REJECT_UNAUTHORIZED=0.');
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/check-https.js ACTUAL_HTTPS_ORIGIN');
  const base = new URL(input);
  const local = base.protocol === 'http:' && base.hostname === '127.0.0.1';
  if ((!local && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Use an HTTPS origin, or HTTP loopback only for the local check.');
  const r = await fetch(`${base.origin}/health`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (r.status !== 401) throw new Error(`Expected unauthenticated HTTP 401, received ${r.status}. Check that the correct ComLab API is running.`);
  const body = await r.json();
  if (body.error !== 'Sign in with an approved administrator or kiosk account.') throw new Error('Response is not the expected ComLab authentication guard.');
  console.log(`PASS: ${local ? 'loopback HTTP' : 'HTTPS with certificate verification'} and ComLab authentication guard.`);
  if (!local) console.log(`Trusted API HTTPS address: ${base.origin}`);
  console.log('This is not an authenticated Firebase health check; verify /health from the approved app account next.');
}
check().catch(() => { console.error('Probe failed: check the origin, TLS certificate trust, API process and authentication-guard response. No validation bypass was attempted.'); process.exitCode = 1; });
