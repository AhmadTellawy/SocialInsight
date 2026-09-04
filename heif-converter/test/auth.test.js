import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateRequest, ReplayGuard, signRequest } from '../src/auth.js';

const secret = 'a-secret-with-at-least-thirty-two-bytes';
const body = Buffer.from('binary-body');
const nowMs = 1_800_000_000_000;
const timestamp = String(Math.floor(nowMs / 1000));
const requestId = 'request_0123456789abcdef';

test('authenticates the exact timestamp, request id, and body bytes once', () => {
  const replayGuard = new ReplayGuard();
  const headers = {
    'x-si-timestamp': timestamp,
    'x-si-request-id': requestId,
    'x-si-signature': signRequest({ secret, timestamp, requestId, body }),
  };
  assert.equal(authenticateRequest({ headers, body, secret, nowMs, windowSeconds: 300, replayGuard }), requestId);
  assert.throws(
    () => authenticateRequest({ headers, body, secret, nowMs, windowSeconds: 300, replayGuard }),
    { code: 'REPLAYED_REQUEST' },
  );
});

test('rejects changed body bytes and stale timestamps', () => {
  const signature = signRequest({ secret, timestamp, requestId, body });
  assert.throws(() => authenticateRequest({
    headers: { 'x-si-timestamp': timestamp, 'x-si-request-id': requestId, 'x-si-signature': signature },
    body: Buffer.from('changed'), secret, nowMs, windowSeconds: 300, replayGuard: new ReplayGuard(),
  }), { code: 'INVALID_SIGNATURE' });
  assert.throws(() => authenticateRequest({
    headers: { 'x-si-timestamp': timestamp, 'x-si-request-id': requestId, 'x-si-signature': signature },
    body, secret, nowMs: nowMs + 301_000, windowSeconds: 300, replayGuard: new ReplayGuard(),
  }), { code: 'INVALID_SIGNATURE' });
});
