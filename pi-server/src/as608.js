// AS608 / R30x fingerprint sensor over the Pi UART (57600 8N1).
// Pure Node: the port is configured with stty and used as a file, so no native
// serialport module has to build on the Raspberry Pi.
import { openSync, writeSync, constants } from 'node:fs';
import { ReadStream } from 'node:tty';
import { execFileSync } from 'node:child_process';

const HEADER = [0xef, 0x01], ADDR = [0xff, 0xff, 0xff, 0xff];
const CMD = { genImg: 0x01, img2Tz: 0x02, search: 0x04, regModel: 0x05, store: 0x06, deleteChar: 0x0c, empty: 0x0d,
  verifyPassword: 0x13, readSysPara: 0x0f, templateNum: 0x1d, readIndexTable: 0x1f };
export const CODES = { 0x00: 'ok', 0x01: 'packet error', 0x02: 'no finger', 0x03: 'image capture failed', 0x06: 'image too messy',
  0x07: 'too few features', 0x09: 'no match', 0x0a: 'templates do not match', 0x0b: 'slot out of range', 0x18: 'flash write error',
  0x13: 'wrong sensor password', 0x15: 'no valid image' };

export function packet(pid, payload) {
  const len = payload.length + 2;
  const body = [pid, len >> 8, len & 0xff, ...payload];
  const sum = body.reduce((a, b) => a + b, 0) & 0xffff;
  return Buffer.from([...HEADER, ...ADDR, ...body, sum >> 8, sum & 0xff]);
}

// Pull one complete packet off the front of buf; returns { pkt, rest } or null.
export function parse(buf) {
  let i = buf.indexOf(Buffer.from(HEADER));
  if (i < 0) return null;
  buf = buf.subarray(i);
  if (buf.length < 9) return null;
  const len = buf.readUInt16BE(7), total = 9 + len;
  if (buf.length < total) return null;
  const body = buf.subarray(6, total - 2), sum = body.reduce((a, b) => a + b, 0) & 0xffff;
  if (sum !== buf.readUInt16BE(total - 2)) return { pkt: null, rest: buf.subarray(2) };   // corrupt: resync
  return { pkt: { pid: buf[6], code: buf[9], data: buf.subarray(10, total - 2) }, rest: buf.subarray(total) };
}

export class AS608 {
  constructor(path = process.env.COMLAB_FP_PORT || '/dev/serial0', baud = 57600) {
    this.path = path; this.baud = baud; this.buf = Buffer.alloc(0); this.waiters = []; this.queue = Promise.resolve();
  }
  open() {
    execFileSync('stty', ['-F', this.path, String(this.baud), 'raw', '-echo', 'cs8', '-cstopb', '-parenb', '-crtscts']);
    this.wfd = openSync(this.path, constants.O_RDWR | constants.O_NOCTTY);
    this.rs = new ReadStream(this.wfd);   // libuv tty handle: non-blocking, lets the process exit
    this.rs.setRawMode?.(true);
    this.rs.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
    this.rs.on('error', e => this.waiters.splice(0).forEach(w => w.reject(e)));
  }
  close() { this.rs?.destroy(); this.rs = null; this.wfd = null; }
  drain() {
    for (let r; (r = parse(this.buf));) { this.buf = r.rest; if (r.pkt) this.waiters.shift()?.resolve(r.pkt); }
  }
  // One command at a time; the sensor is strictly request/response.
  cmd(name, args = [], timeoutMs = 2000) {
    const run = () => new Promise((resolve, reject) => {
      const t = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); reject(new Error(`Fingerprint sensor did not answer (${name}). Check wiring and power.`)); }, timeoutMs);
      const w = { resolve: p => { clearTimeout(t); resolve(p); }, reject: e => { clearTimeout(t); reject(e); } };
      this.waiters.push(w);
      writeSync(this.wfd, packet(0x01, [CMD[name], ...args]));
    });
    return (this.queue = this.queue.then(run, run));
  }
  async ok(name, args, timeoutMs) {
    const p = await this.cmd(name, args, timeoutMs);
    if (p.code !== 0) { const e = new Error(CODES[p.code] ?? `sensor error 0x${p.code.toString(16)}`); e.code = p.code; throw e; }
    return p;
  }

  async handshake() { await this.ok('verifyPassword', [0, 0, 0, 0]); return this.info(); }
  async info() {
    const d = (await this.ok('readSysPara')).data;
    const count = (await this.ok('templateNum')).data.readUInt16BE(0);
    return { capacity: d.readUInt16BE(4), securityLevel: d.readUInt16BE(6), templates: count };
  }
  async usedSlots(capacity = 300) {
    const used = [];
    for (let page = 0; page < Math.ceil(capacity / 256); page++) {
      const d = (await this.ok('readIndexTable', [page])).data;
      d.forEach((byte, i) => { for (let b = 0; b < 8; b++) if (byte & (1 << b)) used.push(page * 256 + i * 8 + b); });
    }
    return used.filter(n => n < capacity);
  }
  // true when a finger image was captured, false when the glass is empty.
  async capture(buffer) {
    const p = await this.cmd('genImg');
    if (p.code === 0x02) return false;
    if (p.code !== 0) throw Object.assign(new Error(CODES[p.code] ?? 'capture failed'), { code: p.code });
    await this.ok('img2Tz', [buffer]);
    return true;
  }
  async fingerPresent() { return (await this.cmd('genImg')).code === 0; }
  async search(capacity = 300) {
    const p = await this.cmd('search', [1, 0, 0, capacity >> 8, capacity & 0xff]);
    if (p.code === 0x09) return null;
    if (p.code !== 0) throw Object.assign(new Error(CODES[p.code] ?? 'search failed'), { code: p.code });
    return { slot: p.data.readUInt16BE(0), score: p.data.readUInt16BE(2) };
  }
  async storeModel(slot) { await this.ok('regModel'); await this.ok('store', [1, slot >> 8, slot & 0xff], 3000); }
  async remove(slot) { await this.ok('deleteChar', [slot >> 8, slot & 0xff, 0, 1]); }
  async emptyAll() { await this.ok('empty', [], 5000); }
}
