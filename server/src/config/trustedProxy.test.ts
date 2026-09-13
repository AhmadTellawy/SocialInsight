import assert from 'node:assert/strict';
import test from 'node:test';
import { readTrustedProxyHops, resolveTrustedClientAddress } from './trustedProxy';

test('trusted proxy hops default to zero outside production', () => {
  assert.equal(readTrustedProxyHops({ NODE_ENV: 'test' }), 0);
});

test('production requires an explicit bounded trusted proxy hop count', () => {
  assert.throws(() => readTrustedProxyHops({ NODE_ENV: 'production' }), /explicitly configured/);
  assert.throws(() => readTrustedProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: 'all' }), /integer/);
  assert.throws(() => readTrustedProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '4' }), /integer/);
  assert.equal(readTrustedProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '1' }), 1);
});

test('client address ignores spoofed forwarding headers without a trusted proxy', () => {
  assert.equal(resolveTrustedClientAddress('::ffff:10.0.0.8', '198.51.100.77', 0), '10.0.0.8');
});

test('client address selects the first untrusted hop from the right', () => {
  assert.equal(resolveTrustedClientAddress('10.0.0.8', '203.0.113.99', 1), '203.0.113.99');
  assert.equal(resolveTrustedClientAddress('10.0.0.8', '198.51.100.250, 203.0.113.99', 1), '203.0.113.99');
});

test('client address falls back to the connected peer for missing or invalid forwarding headers', () => {
  assert.equal(resolveTrustedClientAddress('10.0.0.8', undefined, 1), '10.0.0.8');
  assert.equal(resolveTrustedClientAddress('10.0.0.8', 'attacker-controlled', 1), '10.0.0.8');
});
