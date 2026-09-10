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

export function authenticateHeaders({ headers, secret, nowMs, windowSeconds, replayGuard }) {
  const timestamp = headers['x-si-timestamp'];
  const requestId = headers['x-si-request-id'];
  const presented = headers['x-si-signature'];
  const digest = headers['x-si-body-sha256'];
  const timestampSeconds = typeof timestamp === 'string' && /^\d{10,13}$/.test(timestamp)
    ? Number.parseInt(timestamp, 10)
    : Number.NaN;

  if (
    typeof digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(digest)
    || !Number.isSafeInteger(timestampSeconds)
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

  const expected = `v1=${createHmac('sha256', secret).update(canonicalSignaturePayload(timestamp, requestId, digest)).digest('hex')}`;
  const expectedBytes = Buffer.from(expected, 'ascii');
  const presentedBytes = Buffer.from(presented, 'ascii');
  if (expectedBytes.length !== presentedBytes.length || !timingSafeEqual(expectedBytes, presentedBytes)) {
    throw new ServiceError(401, 'INVALID_SIGNATURE', 'Request authentication failed');
  }

  const expiresAtMs = (timestampSeconds + windowSeconds + 1) * 1000;
  if (!replayGuard.consume(requestId, expiresAtMs, nowMs)) {
    throw new ServiceError(409, 'REPLAYED_REQUEST', 'This signed request has already been consumed');
  }
  return requestId;
}

export function verifyBodyDigest(body, digest) {
  const actual = Buffer.from(bodySha256(body), 'hex');
  const expected = Buffer.from(digest, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ServiceError(401, 'INVALID_SIGNATURE', 'Request authentication failed');
  }
}

// Full-body helper retained for callers that already own the complete bounded body.
export function authenticateRequest({ headers, body, ...options }) {
  const authenticatedHeaders = { ...headers, 'x-si-body-sha256': headers['x-si-body-sha256'] || bodySha256(body) };
  const requestId = authenticateHeaders({ headers: authenticatedHeaders, ...options });
  verifyBodyDigest(body, authenticatedHeaders['x-si-body-sha256']);
  return requestId;
}
