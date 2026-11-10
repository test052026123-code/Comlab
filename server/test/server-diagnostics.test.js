import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFailure, proxyHops } from '../src/server-diagnostics.js';

test('failure diagnostics retain SDK codes without leaking request or error data', () => {
  const req = { route: { path: '/admin/students/:id' }, url: '/admin/students/PRIVATE', headers: { authorization: 'SECRET' } };
  const err = Object.assign(new Error('SECRET private credential'), { code: 7 });
  const result = safeFailure(req, err, 503);
  assert.equal(JSON.parse(result).code, 7);
  assert.equal(JSON.parse(result).route, '/admin/students/:id');
  assert.doesNotMatch(result, /SECRET|PRIVATE|credential/);
  assert.equal(JSON.parse(safeFailure({}, { code: 'SECRET' }, 503)).code, 'unclassified');
});

test('proxy trust is bounded and defaults to Render only', () => {
  assert.equal(proxyHops({}), 0);
  assert.equal(proxyHops({ RENDER: 'true' }), 1);
  assert.equal(proxyHops({ RENDER: 'true', TRUST_PROXY_HOPS: '0' }), 0);
  for (const value of ['true', '-1', '6', '1oops']) assert.throws(() => proxyHops({ TRUST_PROXY_HOPS: value }));
});
