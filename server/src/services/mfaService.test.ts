import assert from 'node:assert/strict';
import test from 'node:test';
import { base32Encode, base32Decode, totpAtStep, findTotpStep, encryptMfaSecret, decryptMfaSecret, generateRecoveryCodes, consumeMfaProof, normalizeSecurityCode } from './mfaService';

process.env.AUTH_SESSION_HASH_SECRET = 'mfa-test-only-hash-key-not-a-production-secret';
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const secret = base32Encode(Buffer.from('12345678901234567890'));

test('TOTP matches all RFC 6238 SHA-1 test vectors including timestamps beyond 2038', () => {
  const vectors: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [time, expected] of vectors) assert.equal(totpAtStep(secret, BigInt(Math.floor(time / 30)), 8), expected);
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
});
test('TOTP accepts bounded clock drift, Arabic/Persian digits and rejects replays/malformed codes', () => {
  const now = 1234567890000, step = BigInt(Math.floor(now / 30000)), code = totpAtStep(secret, step);
  assert.equal(findTotpStep(secret, code, now), step);
  assert.equal(findTotpStep(secret, code.replace(/\d/g, d => String.fromCharCode(0x660 + Number(d))), now), step);
  assert.equal(normalizeSecurityCode('۱۲۳ ٤٥٦'), '123456');
  assert.equal(findTotpStep(secret, code, now, step), null);
  assert.equal(findTotpStep(secret, code, now + 90000), null);
  assert.equal(findTotpStep(secret, '12345x', now), null);
});
test('MFA encryption is randomized, authenticated and bound to the account identity', () => {
  const encrypted = encryptMfaSecret(secret, 'account-a');
  assert.equal(decryptMfaSecret(encrypted, 'account-a'), secret);
  assert.notEqual(encryptMfaSecret(secret, 'account-a'), encrypted);
  assert.equal(encrypted.includes(secret), false);
  assert.throws(() => decryptMfaSecret(encrypted, 'account-b'));
  const parts = encrypted.split('.'); parts[3] = Buffer.alloc(20, 9).toString('base64url');
  assert.throws(() => decryptMfaSecret(parts.join('.'), 'account-a'));
});
test('encryption fails closed when its independent server key is absent', () => {
  const key = process.env.MFA_ENCRYPTION_KEY; delete process.env.MFA_ENCRYPTION_KEY;
  try { assert.throws(() => encryptMfaSecret(secret, 'a'), /MFA_NOT_CONFIGURED/); }
  finally { process.env.MFA_ENCRYPTION_KEY = key; }
});
test('recovery codes are account-scoped, contain 80 random bits, and are consumed once', async () => {
  const recovery = generateRecoveryCodes('a');
  assert.equal(new Set(recovery.codes).size, 10);
  assert.ok(recovery.codes.every(code => /^[A-F0-9]{5}(-[A-F0-9]{5}){3}$/.test(code)));
  let record: any = { userId: 'a', enabledAt: new Date(), encryptedSecret: encryptMfaSecret(secret, 'a'), recoveryCodeHashes: recovery.hashes };
  const tx = { userMfa: { findUnique: async () => record, update: async ({data}: any) => { record = {...record, ...data}; } } };
  assert.equal(await consumeMfaProof(tx, 'b', recovery.codes[0]), false);
  assert.equal(await consumeMfaProof(tx, 'a', recovery.codes[0]), true);
  assert.equal(record.recoveryCodeHashes.length, 9);
  assert.equal(await consumeMfaProof(tx, 'a', recovery.codes[0]), false);
});
