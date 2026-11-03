import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

// Unit-test store only. Production exclusively uses real Firestore.
export class Store {
  docs = new Map(); queue = Promise.resolve();
  constructor(now = Date.now) { this.now = now; }
  doc(path) { return { path, id: path.split('/').at(-1), get: async () => this.snap(path) }; }
  snap(path) { return { id: path.split('/').at(-1), exists: this.docs.has(path), data: () => this.docs.get(path) }; }
  async getAll(...refs) { return refs.map(r => this.snap(r.path)); }
  collection(path) {
    const query = (filters = [], order, max = Infinity) => ({
      query: true,
      doc: id => this.doc(`${path}/${id || randomUUID().replaceAll('-', '').slice(0, 20)}`),
      where: (field, op, value) => { assert.equal(op, '=='); return query([...filters, [field, value]], order, max); },
      orderBy: field => query(filters, field, max), limit: count => query(filters, order, count),
      get: async () => {
        let docs = [...this.docs.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/') && filters.every(([f,v]) => this.docs.get(k)[f] === v)).map(k => this.snap(k));
        if (order) docs.sort((a,b) => {
          const x = a.data()[order], y = b.data()[order];
          return (x?.toMillis?.() ?? x) - (y?.toMillis?.() ?? y);
        });
        return { docs: docs.slice(0, max) };
      },
    });
    return query();
  }
  async runTransaction(fn) {
    const before = this.queue; let release;
    this.queue = new Promise(r => { release = r; }); await before;
    const mutations = []; let writing = false;
    const stamp = value => {
      if (value?.constructor?.name === 'ServerTimestampTransform') return Timestamp.fromMillis(this.now());
      if (value instanceof Timestamp) return value;
      if (Array.isArray(value)) return value.map(stamp);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,stamp(v)]));
      return value;
    };
    const read = () => assert.equal(writing, false, 'All Firestore transaction reads must precede writes');
    const tx = {
      get: async r => { read(); return r.query ? r.get() : this.snap(r.path); },
      getAll: async (...refs) => { read(); return this.getAll(...refs); },
      create: (ref,data) => { writing = true; assert.ok(!this.docs.has(ref.path)); mutations.push(() => this.docs.set(ref.path,stamp(data))); },
      update: (ref,data) => { writing = true; assert.ok(this.docs.has(ref.path)); mutations.push(() => this.docs.set(ref.path,{...this.docs.get(ref.path),...stamp(data)})); },
      set: (ref,data,opts) => { writing = true; mutations.push(() => this.docs.set(ref.path, {...(opts?.merge ? this.docs.get(ref.path) : {}), ...stamp(data)})); },
      delete: ref => { writing = true; mutations.push(() => this.docs.delete(ref.path)); },
    };
    try { const value = await fn(tx); mutations.forEach(f => f()); return value; } finally { release(); }
  }
}
