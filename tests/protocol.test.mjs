import test from 'node:test';
import assert from 'node:assert/strict';
import { strictJson } from '../src/protocol.mjs';

test('transport JSON rejects duplicate/escaped keys and deep nesting', () => {
  assert.throws(() => strictJson('{"a":1,"\\u0061":2}'), { code: 'duplicate_json_key' });
  assert.throws(() => strictJson('['.repeat(81) + '0' + ']'.repeat(81)), { code: 'json_too_deep' });
  assert.deepEqual(strictJson('{"a":[true,null]}'), { a: [true, null] });
});
