import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ServiceError } from './errors.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE_PATTERN = /^v1=([a-f0-9]{64})$/;

export function bodySha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

export function canonicalSignaturePayload(timestamp, requestId, digest) {
  return `v1\n${timestamp}\n${requestId}\n${digest}`;
}

export function signRequest({ secret, timestamp, requestId, body }) {
  return `v1=${createHmac('sha256', secret)
    .update(canonicalSignaturePayload(timestamp, requestId, bodySha256(body)))
    .digest('hex')}`;
}

export class ReplayGuard {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  consume(requestId, expiresAtMs, nowMs) {
    for (const [key, expiry] of this.entries) {
      if (expiry < nowMs) this.entries.delete(key);
    }
    if (this.entries.has(requestId)) return false;
    // Fail closed instead of evicting a still-valid nonce and making replay possible.
    if (this.entries.size >= this.maxEntries) return false;
    this.entries.set(requestId, expiresAtMs);
    return true;
  }
}

export function authenticateRequest({ headers, body, secret, nowMs, windowSeconds, replayGuard }) {
  const timestamp = headers['x-si-timestamp'];
  const requestId = headers['x-si-request-id'];
  const presented = headers['x-si-signature'];
  const timestampSeconds = typeof timestamp === 'string' && /^\d{10,13}$/.test(timestamp)
    ? Number.parseInt(timestamp, 10)
    : Number.NaN;

  if (
    !Number.isSafeInteger(timestampSeconds)
    || typeof requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(requestId)
    || typeof presented !== 'string'
    || !SIGNATURE_PATTERN.test(presented)
  ) {
    throw new ServiceError(401, 'INVALID_SIGNATURE', 'Request authentication failed');
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > windowSeconds) {
    throw new ServiceError(401, 'INVALID_SIGNATURE', 'Request authentication failed');
  }

  const expected = signRequest({ secret, timestamp, requestId, body });
  const expectedBytes = Buffer.from(expected, 'ascii');
  const presentedBytes = Buffer.from(presented, 'ascii');
  if (expectedBytes.length !== presentedBytes.length || !timingSafeEqual(expectedBytes, presentedBytes)) {
    throw new ServiceError(401, 'INVALID_SIGNATURE', 'Request authentication failed');
  }

  const expiresAtMs = (timestampSeconds + windowSeconds) * 1000;
  if (!replayGuard.consume(requestId, expiresAtMs, nowMs)) {
    throw new ServiceError(409, 'REPLAYED_REQUEST', 'This signed request has already been consumed');
  }
  return requestId;
}
