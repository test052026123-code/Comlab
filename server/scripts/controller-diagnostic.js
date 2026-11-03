// Only fixed messages and known error codes are exposed. Never echo raw HTTP
// bodies, request headers, credentials or arbitrary exception messages.
export function controllerDiagnostic(stage, error, host, timeout) {
  const codes = [error?.code, error?.cause?.code,
    ...(Array.isArray(error?.cause?.errors) ? error.cause.errors.map(e => e.code) : [])];
  if (codes.some(c => ['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME'].includes(c))) {
    return `Controller DNS lookup failed for ${host}. Windows cannot resolve the controller hostname. Check ESP32 mDNS/router DNS; this is not a pairing-secret error.`;
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || codes.some(c => ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(c))) {
    return `Controller ${stage} timed out after ${timeout} ms. Check the controller address, Wi-Fi and firewall.`;
  }
  if (codes.includes('ECONNREFUSED')) return `Controller ${stage} connection refused. Check that the ESP32 HTTP service is running on the configured port.`;
  if (codes.some(c => ['EHOSTUNREACH', 'ENETUNREACH'].includes(c))) return `Controller ${stage} network unreachable. Check that Windows is on the laboratory network.`;
  if (error instanceof SyntaxError) return `Controller ${stage} returned invalid JSON. Check that the firmware implements the expected /v1 endpoint.`;
  return `Controller ${stage} failed. Check Wi-Fi, DNS/mDNS, controller power and the expected API. Credential details are intentionally omitted.`;
}
