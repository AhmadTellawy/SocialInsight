import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { connectionContract, childEnvironment, PROJECT, sha256 } from './contract.mjs';

const ca = Buffer.from('-----BEGIN CERTIFICATE-----\nSYNTHETIC_TEST_ONLY\n-----END CERTIFICATE-----');
const secret = 'synthetic:a/@% password-sentinel';
const base = () => ({ STAGING_INITIAL_INSTALL_PROJECT: PROJECT, STAGING_DB_TRANSPORT: 'session', STAGING_DB_ADMIN_PASSWORD: secret, STAGING_DB_CA_FILE: resolve('synthetic-ca.pem'), STAGING_DB_CA_SHA256: sha256(ca) });

test('session transport binds exact Stage endpoint and URI-encodes the injected password', () => {
  const result = connectionContract(base(), ca);
  const url = new URL(result.url);
  assert.equal(url.hostname, 'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.equal(url.port, '5432');
  assert.equal(decodeURIComponent(url.username), `postgres.${PROJECT}`);
  assert.equal(decodeURIComponent(url.password), secret);
  assert.equal(url.pathname, '/postgres');
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('sslaccept'), 'strict');
  assert.equal(url.searchParams.get('schema'), 'public');
  assert.equal(url.searchParams.get('options'), '-c statement_timeout=60000 -c lock_timeout=2000');
});
test('direct transport uses only the exact Stage IPv6 endpoint', () => {
  const url = new URL(connectionContract({ ...base(), STAGING_DB_TRANSPORT: 'direct' }, ca).url);
  assert.equal(url.hostname, `db.${PROJECT}.supabase.co`);
  assert.equal(url.username, 'postgres');
});
test('missing or different project acknowledgement fails before URL construction', () => {
  for (const value of [undefined, 'production', 'different-project']) assert.throws(() => connectionContract({ ...base(), STAGING_INITIAL_INSTALL_PROJECT: value }, ca), /^Error: STAGE_TARGET_NOT_ACKNOWLEDGED$/);
});
test('arbitrary hosts, transaction poolers and unknown transports fail closed', () => {
  for (const value of ['transaction', 'localhost', 'session.attacker', undefined]) assert.throws(() => connectionContract({ ...base(), STAGING_DB_TRANSPORT: value }, ca), /^Error: STAGE_TRANSPORT_INVALID$/);
});
test('inherited app/admin/JIT/debug configurations cannot override the fixed target', () => {
  for (const key of ['DATABASE_URL','DIRECT_URL','STAGING_DB_JIT_TOKEN','SUPABASE_ACCESS_TOKEN','NODE_OPTIONS','DEBUG']) {
    assert.throws(() => connectionContract({ ...base(), [key]: secret }, ca), error => error.message === 'UNEXPECTED_INHERITED_CONFIGURATION' && !error.message.includes(secret));
  }
});
test('CA content must match the supplied fingerprint and use an absolute path', () => {
  assert.throws(() => connectionContract({ ...base(), STAGING_DB_CA_SHA256: '0'.repeat(64) }, ca), /^Error: CA_BINDING_INVALID$/);
  assert.throws(() => connectionContract({ ...base(), STAGING_DB_CA_FILE: 'relative.pem' }, ca), /^Error: CA_PATH_INVALID$/);
  const bytes = Buffer.from('not-a-certificate');
  assert.throws(() => connectionContract({ ...base(), STAGING_DB_CA_SHA256: sha256(bytes) }, bytes), /^Error: CA_BINDING_INVALID$/);
});
test('absent and control-character passwords yield only fixed nonsecret errors', () => {
  for (const value of ['', undefined, 'secret\nvalue', 'secret\0value']) assert.throws(() => connectionContract({ ...base(), STAGING_DB_ADMIN_PASSWORD: value }, ca), /^Error: ADMIN_PASSWORD_MISSING_OR_INVALID$/);
});
test('child receives only explicit DB URLs and OS support values, no provider token/password variable', () => {
  const input = { ...base(), PATH: 'synthetic-path', PRIVATE_OTHER_SECRET: secret, NODE_OPTIONS: '--inspect', SUPABASE_ACCESS_TOKEN: secret, PGHOST: 'wrong-host', PGPASSWORD: secret };
  const result = childEnvironment(input, 'synthetic-url');
  assert.deepEqual(Object.keys(result).sort(), ['CHECKPOINT_DISABLE','DATABASE_URL','DIRECT_URL','NO_COLOR','PATH','PRISMA_HIDE_UPDATE_MESSAGE'].sort());
  assert.equal(result.DATABASE_URL, 'synthetic-url');
  assert.equal(result.DIRECT_URL, 'synthetic-url');
  assert.ok(!JSON.stringify(result).includes(secret));
});
