'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { secretHash, computeSignature, signRequest } = require('../dist/signing');

// Published test vector from https://aiopsenabler.com/api-guide.md —
// independently confirmed by direct computation before being pinned here,
// and shared verbatim with cyntra360hub/aiops-wrap and
// cyntra360hub/report-action's own copies of this same test.
const SECRET = 'correct-horse-battery-staple-test-secret';
const TIMESTAMP = '1700000000';
const BODY = '{"event_type":"task_started","task_id":"demo-task-1"}';
const EXPECTED_SECRET_HASH = '285beb7adbdb73adc3d35e65fe7d2a4b958f1e12d790e39c82703e29743034c6';
const EXPECTED_SIGNATURE = 'ea3906dd25d6ff6edd668e64634f1e10698a7b9b31d5160fa1a28951102e62e9';

test('secretHash matches the published test vector', () => {
  assert.equal(secretHash(SECRET), EXPECTED_SECRET_HASH);
});

test('computeSignature matches the published test vector', () => {
  const signature = computeSignature({ secret: SECRET, timestamp: TIMESTAMP, body: BODY });
  assert.equal(signature, EXPECTED_SIGNATURE);
  assert.equal(signature.length, 64);
});

test('signRequest sets all three headers plus Content-Type', () => {
  const headers = signRequest({ keyId: 'ak_test', secret: SECRET, body: BODY });
  assert.equal(headers['X-Agent-Key-Id'], 'ak_test');
  assert.match(headers['X-Agent-Timestamp'], /^\d+$/);
  assert.match(headers['X-Agent-Signature'], /^[0-9a-f]{64}$/);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('signRequest timestamp is close to current time', () => {
  const before = Math.floor(Date.now() / 1000);
  const headers = signRequest({ keyId: 'ak', secret: SECRET, body: '{}' });
  const after = Math.floor(Date.now() / 1000);
  const ts = Number(headers['X-Agent-Timestamp']);
  assert.ok(ts >= before && ts <= after);
});
