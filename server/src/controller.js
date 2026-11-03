import { Fault, requireThat } from './domain.js';

export class Controller {
  constructor(url, token, timeout = 4000) {
    this.url = url; this.token = token; this.timeout = timeout;
  }
  async get(path) {
    requireThat(this.url && this.token, 'Controller is not configured on the trusted server.', 503);
    try {
      const r = await fetch(`${this.url}/v1${path}`, {
        headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.timeout),
      });
      if (r.status === 404 && path.startsWith('/commands/')) return { state: 'unknown' };
      requireThat(r.ok, `Controller HTTP ${r.status}`, 502);
      return await r.json();
    } catch (e) { if (e instanceof Fault) throw e; throw new Fault(503, 'Local controller unreachable. Check router, address, and pairing.'); }
  }
  async nodes() {
    const data = await this.get('/nodes');
    requireThat(Array.isArray(data.nodes), 'Invalid controller nodes response.', 502);
    return data.nodes;
  }
  async command(command) {
    const r = await this.get(`/commands/${command.id}`);
    if (r.state !== 'unknown') requireThat(r.commandId === command.id && r.nodeId === command.nodeId &&
      r.workstationId === command.workstationId && r.action === 'power_on', 'Controller command identity mismatch.', 502);
    return r;
  }
}
