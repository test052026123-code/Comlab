// Browser access for the deployed admin website only. Native apps and device
// clients have no Origin header and retain their existing authentication path.
export const adminWebOrigin = 'https://test052026123-code.github.io';
export function adminWebCors(req, res, next) {
  const origin = req.headers.origin;
  res.vary('Origin');
  if (!origin) return next();
  if (origin !== adminWebOrigin) return res.status(403).json({error:'Browser origin is not allowed.'});
  res.set('Access-Control-Allow-Origin', adminWebOrigin);
  if (req.method !== 'OPTIONS') return next();
  const method = req.headers['access-control-request-method'];
  const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (!['GET','POST','PUT'].includes(method) || requested.some(h => !['authorization','content-type'].includes(h))) return res.status(403).json({error:'Browser request is not allowed.'});
  res.set('Access-Control-Allow-Methods','GET, POST, PUT');
  res.set('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.set('Access-Control-Max-Age','600');
  res.status(204).end();
}
