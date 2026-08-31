import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFeedRetryDelayMs,
  shouldRetryFeedRequest,
  waitForAbortableDelay
} from './feedRequest.ts';

test('retries only transient feed failures', () => {
  assert.equal(shouldRetryFeedRequest({ status: 503 }), true);
  assert.equal(shouldRetryFeedRequest({ status: 429 }), true);
  assert.equal(shouldRetryFeedRequest({ status: 0, code: 'NETWORK_ERROR' }), true);
  assert.equal(shouldRetryFeedRequest({ status: 408, code: 'REQUEST_TIMEOUT' }), true);

  assert.equal(shouldRetryFeedRequest({ status: 401 }), false);
  assert.equal(shouldRetryFeedRequest({ status: 404 }), false);
  assert.equal(shouldRetryFeedRequest({ status: 502, code: 'INVALID_FEED_RESPONSE' }), false);
  assert.equal(shouldRetryFeedRequest({ name: 'AbortError' }), false);
  assert.equal(shouldRetryFeedRequest(new SyntaxError('bad JSON')), false);
});

test('retry delay is short and bounded', () => {
  assert.equal(getFeedRetryDelayMs(0), 750);
  assert.equal(getFeedRetryDelayMs(1), 1_500);
  assert.equal(getFeedRetryDelayMs(20), 1_500);
});

test('retry delay can be cancelled', async () => {
  const controller = new AbortController();
  const pending = waitForAbortableDelay(10_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    return !!error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError';
  });
});
