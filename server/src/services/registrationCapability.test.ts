import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPendingRegistrationReference,
  createRegistrationCapability,
  parsePendingRegistrationReference,
  verifyRegistrationSecret
} from './registrationCapability';

test('registration capability has 256 bits of entropy and stores only a SHA-256 hash', () => {
  const first = createRegistrationCapability();
  const second = createRegistrationCapability();
  assert.match(first.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.secretHash, /^[a-f0-9]{64}$/);
  assert.equal(first.secretHash.includes(first.secret), false);
  assert.notEqual(first.secret, second.secret);
  assert.equal(verifyRegistrationSecret(first.secretHash, first.secret), true);
  assert.equal(verifyRegistrationSecret(first.secretHash, second.secret), false);
  assert.equal(verifyRegistrationSecret(null, first.secret), false);
  const reference = buildPendingRegistrationReference('pending-id', first.secret);
  assert.deepEqual(parsePendingRegistrationReference(reference), { id: 'pending-id', secret: first.secret });
  assert.equal(parsePendingRegistrationReference('pending-id'), null);
});
