'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AiOpsClient, AiOpsError } = require('../dist/index');
const { KEY_ID_HEADER, TIMESTAMP_HEADER, SIGNATURE_HEADER } = require('../dist/signing');

function fakeResponse(status, body, headers = {}) {
  const headerMap = new Map(Object.entries(headers));
  return {
    status,
    headers: { get: (name) => headerMap.get(name) ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function client(overrides = {}) {
  return new AiOpsClient({
    agentKeyId: 'ak_test',
    agentSecret: 's3cr3t-agent-secret',
    baseUrl: 'https://example.test',
    sleep: async () => {},
    ...overrides,
  });
}

test('taskStarted posts a signed request to the events endpoint', async () => {
  let captured;
  const c = client({
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return fakeResponse(201, { id: 'evt-1' });
    },
  });

  const result = await c.taskStarted({ taskId: 'abc123' });

  assert.equal(captured.url, 'https://example.test/api/v1/events');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers[KEY_ID_HEADER], 'ak_test');
  assert.ok(captured.init.headers[TIMESTAMP_HEADER]);
  assert.ok(captured.init.headers[SIGNATURE_HEADER]);
  assert.deepEqual(JSON.parse(captured.init.body), {
    event_type: 'task_started',
    task_id: 'abc123',
  });
  assert.deepEqual(result, { id: 'evt-1' });
});

test('taskCompleted includes optional fields only when provided', async () => {
  let captured;
  const c = client({
    fetchImpl: async (url, init) => {
      captured = init;
      return fakeResponse(201, {});
    },
  });

  await c.taskCompleted({
    taskId: 'abc123',
    outcome: 'success',
    durationMs: 1420,
    category: 'incident-response',
    externalRef: 'datadog:incident:1',
  });

  assert.deepEqual(JSON.parse(captured.body), {
    event_type: 'task_completed',
    task_id: 'abc123',
    outcome: 'success',
    duration_ms: 1420,
    category: 'incident-response',
    external_ref: 'datadog:incident:1',
  });
});

test('taskCompleted omits optional fields when absent', async () => {
  let captured;
  const c = client({ fetchImpl: async (_url, init) => ((captured = init), fakeResponse(201, {})) });

  await c.taskCompleted({ taskId: 'abc123', outcome: 'failure', durationMs: 500 });

  const body = JSON.parse(captured.body);
  assert.equal('category' in body, false);
  assert.equal('external_ref' in body, false);
});

test('heartbeat posts an empty signed body', async () => {
  let captured;
  const c = client({
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return fakeResponse(201, { liveness_state: 'active' });
    },
  });

  const result = await c.heartbeat();

  assert.equal(captured.url, 'https://example.test/api/v1/heartbeat');
  assert.deepEqual(JSON.parse(captured.init.body), {});
  assert.deepEqual(result, { liveness_state: 'active' });
});

test('rate posts to the ratings endpoint', async () => {
  let captured;
  const c = client({ fetchImpl: async (url, init) => ((captured = { url, init }), fakeResponse(201, {})) });

  await c.rate({ rating: 'up', endUserAnonymousId: 'euid-1', comment: 'great job' });

  assert.equal(captured.url, 'https://example.test/api/v1/ratings');
  assert.deepEqual(JSON.parse(captured.init.body), {
    rating: 'up',
    end_user_anonymous_id: 'euid-1',
    comment: 'great job',
  });
});

test('postUpdate posts to the updates endpoint', async () => {
  let captured;
  const c = client({ fetchImpl: async (url, init) => ((captured = { url, init }), fakeResponse(201, { id: 'upd-1' })) });

  const result = await c.postUpdate({
    updateType: 'release',
    title: 'v2.0 released',
    body: 'Rewrote the retry logic.',
    versionTag: 'v2.0.0',
  });

  assert.equal(captured.url, 'https://example.test/api/v1/updates');
  assert.deepEqual(JSON.parse(captured.init.body), {
    update_type: 'release',
    title: 'v2.0 released',
    body: 'Rewrote the retry logic.',
    version_tag: 'v2.0.0',
  });
  assert.deepEqual(result, { id: 'upd-1' });
});

test('empty response body resolves to an empty object', async () => {
  const c = client({ fetchImpl: async () => fakeResponse(204, undefined) });
  const result = await c.taskStarted({ taskId: 't' });
  assert.deepEqual(result, {});
});

test('non-2xx response raises AiOpsError with status and detail', async () => {
  const c = client({ fetchImpl: async () => ({ status: 401, headers: { get: () => null }, text: async () => 'Invalid request signature' }) });

  await assert.rejects(c.taskStarted({ taskId: 't' }), (err) => {
    assert.ok(err instanceof AiOpsError);
    assert.equal(err.statusCode, 401);
    assert.match(err.detail, /Invalid request signature/);
    return true;
  });
});

test('retries on a transport-level failure and eventually succeeds', async () => {
  let calls = 0;
  const sleeps = [];
  const c = client({
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new Error('connection refused');
      return fakeResponse(201, { id: 'evt-1' });
    },
  });

  const result = await c.taskStarted({ taskId: 't' });

  assert.equal(calls, 3);
  assert.deepEqual(result, { id: 'evt-1' });
  assert.deepEqual(sleeps, [500, 1000]); // DEFAULT_BACKOFF_FACTOR_MS * 2**attempt
});

test('re-raises the original error after exhausting retries', async () => {
  let calls = 0;
  const c = client({
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('connection refused');
    },
  });

  await assert.rejects(c.taskStarted({ taskId: 't' }), /connection refused/);
  assert.equal(calls, 3); // first attempt + 2 retries
});

test('retries on 503 then succeeds', async () => {
  let calls = 0;
  const c = client({
    fetchImpl: async () => {
      calls += 1;
      return calls < 2 ? fakeResponse(503, undefined) : fakeResponse(201, {});
    },
  });

  await c.taskStarted({ taskId: 't' });
  assert.equal(calls, 2);
});

test('retries on 429 honoring the Retry-After header (seconds -> ms)', async () => {
  let calls = 0;
  const sleeps = [];
  const c = client({
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return calls < 2 ? fakeResponse(429, undefined, { 'Retry-After': '7' }) : fakeResponse(201, {});
    },
  });

  await c.taskStarted({ taskId: 't' });
  assert.deepEqual(sleeps, [7000]);
});

test('a non-numeric Retry-After falls back to exponential backoff', async () => {
  let calls = 0;
  const sleeps = [];
  const c = client({
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return calls < 2
        ? fakeResponse(429, undefined, { 'Retry-After': 'Wed, 15 Jul 2026 12:00:00 GMT' })
        : fakeResponse(201, {});
    },
  });

  await c.taskStarted({ taskId: 't' });
  assert.deepEqual(sleeps, [500]);
});

test('gives up after max retries and raises AiOpsError from the last response', async () => {
  let calls = 0;
  const c = client({
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      return fakeResponse(500, undefined);
    },
  });

  await assert.rejects(c.taskStarted({ taskId: 't' }), (err) => {
    assert.ok(err instanceof AiOpsError);
    assert.equal(err.statusCode, 500);
    return true;
  });
  assert.equal(calls, 3);
});

test('does not retry non-retryable 4xx responses', async () => {
  let calls = 0;
  const c = client({
    fetchImpl: async () => {
      calls += 1;
      return fakeResponse(401, undefined);
    },
  });

  await assert.rejects(c.taskStarted({ taskId: 't' }), AiOpsError);
  assert.equal(calls, 1);
});

test('maxRetries: 0 disables retrying', async () => {
  let calls = 0;
  const c = client({
    maxRetries: 0,
    fetchImpl: async () => {
      calls += 1;
      return fakeResponse(503, undefined);
    },
  });

  await assert.rejects(c.taskStarted({ taskId: 't' }), AiOpsError);
  assert.equal(calls, 1);
});

test('successful first attempt never sleeps', async () => {
  const sleeps = [];
  const c = client({
    sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async () => fakeResponse(201, {}),
  });

  await c.taskStarted({ taskId: 't' });
  assert.deepEqual(sleeps, []);
});

test('each retry attempt is freshly signed, not reusing the first attempt\'s headers', async () => {
  const capturedHeaders = [];
  const c = client({
    fetchImpl: async (_url, init) => {
      capturedHeaders.push(init.headers);
      return capturedHeaders.length < 2 ? fakeResponse(503, undefined) : fakeResponse(201, {});
    },
  });

  await c.taskStarted({ taskId: 't' });

  assert.equal(capturedHeaders.length, 2);
  for (const headers of capturedHeaders) {
    assert.match(headers[TIMESTAMP_HEADER], /^\d+$/);
    assert.match(headers[SIGNATURE_HEADER], /^[0-9a-f]{64}$/);
  }
  // Two separately-constructed header objects, not the same reference
  // reused across attempts (the loop signs fresh every iteration).
  assert.notEqual(capturedHeaders[0], capturedHeaders[1]);
});
