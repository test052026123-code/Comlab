import test from 'node:test';
import assert from 'node:assert/strict';
import { issueIdSchema } from '../src/issue-schema.js';

test('admin issue updates accept legacy report IDs and report-and-close UUIDs', () => {
  for (const id of ['abcdefghijklmnopqrst', '52b4e728-b01e-4102-84ed-05768972fb4e']) {
    assert.equal(issueIdSchema.parse(id), id);
  }
  for (const id of ['', 'unknown', '../students/S1', 'issues/report', '52b4e728-b01e-4102-84ed-05768972fb4e/extra']) {
    assert.equal(issueIdSchema.safeParse(id).success, false);
  }
});
