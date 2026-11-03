import test from 'node:test';
import assert from 'node:assert/strict';
import { controllerDiagnostic } from '../scripts/controller-diagnostic.js';

test('controller DNS failure explains that authentication was not reached', () => {
  const message = controllerDiagnostic('DNS lookup', { code: 'ENOTFOUND', message: 'must not echo' }, 'comlab-controller.local', 4000);
  assert.match(message, /DNS lookup failed/);
  assert.match(message, /not a pairing-secret error/);
  assert.ok(!message.includes('must not echo'));
});
test('nested transport failures identify the endpoint and timeout', () => {
  assert.match(controllerDiagnostic('GET /v1/nodes', { cause: { code: 'ECONNREFUSED' } }, 'comlab-controller.local', 4000), /GET \/v1\/nodes connection refused/);
  assert.match(controllerDiagnostic('GET /v1/health', { name: 'TimeoutError' }, 'comlab-controller.local', 4000), /timed out after 4000 ms/);
});
test('invalid JSON diagnostics do not reveal the response body', () => {
  const message = controllerDiagnostic('GET /v1/health', new SyntaxError('private response content'), 'comlab-controller.local', 4000);
  assert.match(message, /returned invalid JSON/);
  assert.ok(!message.includes('private response content'));
});
