import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS_SHA256, assertCredentialFree, selectOpenSSL, validateTLSReceipt, verifyLinuxTLS } from './verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const repeatedHash = 'a'.repeat(64);
const startedAt = '2026-09-10T00:00:00.000Z';
const finishedAt = '2026-09-10T00:00:01.000Z';
const binding = { node: process.version, startedAt: Date.parse(startedAt), finishedAt: Date.parse(finishedAt), harnessSha256: HARNESS_SHA256, contractSha256: repeatedHash, prismaCliSha256: repeatedHash, opensslSha256: repeatedHash, engineSha256: repeatedHash };
const common = ['bounded_engine_rpc_completed', 'postgres_ssl_requested_for_every_connection', 'no_unexpected_wire_messages'];
function passingReceipt() {
  return { schemaVersion: 1, kind: 'CONTROLLED_LOCAL_LOCKED_PRISMA_TLS', status: 'PASSED', platform: 'linux', node: process.version, prismaVersion: '6.19.2', startedAt, finishedAt,
    engine: { fileName: 'schema-engine-debian-openssl-3.0.x', version: 'schema-engine-cli c2990dca591cba766e3b7ef5d9e8a84796e47ab7', sha256: repeatedHash },
    harnessSha256: HARNESS_SHA256, contractSha256: repeatedHash, prismaCliSha256: repeatedHash, opensslSha256: repeatedHash, opensslVersion: 'OpenSSL 3.2.1 30 Jan 2024 (Library: OpenSSL 3.2.1 30 Jan 2024)', providerConnections: 0, realCredentialsRead: false,
    cleanup: { fixtureRemoved: true, remainingTrackedSockets: 0, childTerminated: true },
    certificates: Object.fromEntries(['ca', 'other-ca', 'valid', 'mismatch'].map(name => [name, { sha256: repeatedHash, privateKeyPersistedInEvidence: false }])),
    cases: ['valid_peer', 'wrong_ca', 'hostname_mismatch', 'tls_absent'].map((name, i) => ({ name, status: 'PASSED', exitCode: 0, signal: null, timedOut: false, malformed: false,
      startedAt, finishedAt: startedAt, connections: 1, sslRequests: 1, tlsHandshakes: i === 3 ? 0 : 1, startupMessages: i === 0 ? 1 : 0, startupIdentityMatched: i === 0,
      passwordMessages: i === 0 ? 1 : 0, passwordMatched: i === 0, queryMessages: i === 0 ? 4 : 0, targetQueryMatched: i === 0, unexpectedMessages: 0, plaintextAfterTlsRefusalBytes: 0,
      tlsProtocols: i === 3 ? [] : ['TLSv1.3'], responseKind: i === 0 ? 'RESULT' : 'ERROR', prismaErrorCode: i === 0 ? null : 'P1011',
      assertions: [...common, ...(i === 0 ? ['actual_engine_returned_success', 'encrypted_handshake_completed', 'expected_synthetic_identity_observed', 'synthetic_password_verified_inside_tls', 'target_query_reached_controlled_peer'] : ['actual_engine_rejected_connection', 'rejected_before_postgres_startup_credentials_query', 'no_cleartext_fallback'])].map(label => ({ label, passed: true })) })) };
}
function fixture(t) {
  const root = mkdtempSync(resolve(here, 'fixture-test-')); const real = realpathSync(root);
  t.after(() => { assert.equal(realpathSync(root), real); assert.equal(dirname(real), realpathSync(here)); assert.match(basename(real), /^fixture-test-/); rmSync(real, { recursive: true }); assert.equal(existsSync(real), false); });
  return root;
}

test('strict success projects only four accepted cases and excludes arbitrary receipt content', () => {
  const receipt = passingReceipt(); receipt.untrusted = 'synthetic-private-sentinel'; receipt.cases[1].sanitizedError = 'synthetic-private-sentinel'; receipt.cleanup.fixturePath = 'synthetic-private-sentinel';
  const result = validateTLSReceipt(receipt, binding);
  assert.equal(result.assertions, 26); assert.equal(result.cases.length, 4); assert.equal(JSON.stringify(result).includes('synthetic-private-sentinel'), false);
});

test('receipt rejects false success, incomplete cases, wrong TLS errors, credentials and incomplete cleanup', () => {
  const mutations = [
    r => { r.platform = 'win32'; }, r => { r.prismaVersion = '6.19.1'; }, r => { r.engine.version = 'wrong'; }, r => { r.harnessSha256 = repeatedHash; },
    r => { r.engine.sha256 = 'b'.repeat(64); }, r => { r.contractSha256 = 'b'.repeat(64); }, r => { r.opensslSha256 = 'b'.repeat(64); }, r => { r.prismaCliSha256 = 'b'.repeat(64); },
    r => { r.status = 'RUNNING'; }, r => { delete r.finishedAt; }, r => { r.finishedAt = '2026-02-30T00:00:00.000Z'; }, r => { r.startedAt = '2025-09-10T00:00:00.000Z'; },
    r => { r.cases.pop(); }, r => { r.cases[1].name = 'tls_absent'; }, r => { r.cases[1].prismaErrorCode = 'P1001'; },
    r => { r.cases[1].startupMessages = 1; }, r => { r.cases[2].passwordMessages = 1; }, r => { r.cases[3].queryMessages = 1; }, r => { r.cases[3].plaintextAfterTlsRefusalBytes = 1; },
    r => { r.cases[0].passwordMatched = false; }, r => { r.cases[0].tlsProtocols = ['TLSv1.1']; }, r => { r.cases[1].assertions.pop(); }, r => { r.cases[2].assertions[0].passed = false; },
    r => { r.cleanup.fixtureRemoved = false; }, r => { r.cleanup.remainingTrackedSockets = 1; }, r => { r.cleanup.childTerminated = false; },
    r => { r.certificates.valid.privateKeyPersistedInEvidence = true; }, r => { r.providerConnections = 1; }, r => { r.realCredentialsRead = true; }
  ];
  for (const [i, mutate] of mutations.entries()) { const receipt = passingReceipt(); mutate(receipt); assert.throws(() => validateTLSReceipt(receipt, binding), /TLS_RECEIPT_INVALID/, `mutation ${i}`); }
  for (const invalid of [null, [], false, 0]) assert.throws(() => validateTLSReceipt(invalid, binding), /TLS_RECEIPT_INVALID/);
});

test('OpenSSL selection requires one executable real path and deduplicates aliases', t => {
  const root = fixture(t); const first = resolve(root, 'openssl-a'); const second = resolve(root, 'openssl-b');
  writeFileSync(first, 'controlled'); writeFileSync(second, 'controlled'); chmodSync(first, 0o700); chmodSync(second, 0o700);
  assert.equal(selectOpenSSL([first, first]), realpathSync(first)); assert.throws(() => selectOpenSSL([]), /OPENSSL_SELECTION_AMBIGUOUS_OR_MISSING/);
  assert.throws(() => selectOpenSSL([first, second]), /OPENSSL_SELECTION_AMBIGUOUS_OR_MISSING/);
});

test('controlled child verifies argument/env wiring and receipt hashes before success projection', t => {
  const root = fixture(t); const tlsDir = resolve(root, 'stage-engine-tls'); const prisma = resolve(root, 'stage-initial-install/node_modules/prisma'); const engines = resolve(prisma, '../@prisma/engines');
  mkdirSync(tlsDir, { recursive: true }); mkdirSync(resolve(prisma, 'build'), { recursive: true }); mkdirSync(engines, { recursive: true });
  copyFileSync(resolve(here, 'run-engine-tls.mjs'), resolve(tlsDir, 'run-engine-tls.mjs'));
  const paths = [resolve(root, 'openssl'), resolve(root, 'stage-initial-install/contract.mjs'), resolve(prisma, 'build/index.js'), resolve(engines, 'schema-engine-debian-openssl-3.0.x')];
  for (const path of paths) writeFileSync(path, 'controlled-file'); chmodSync(paths[0], 0o700);
  const receipt = passingReceipt(); for (const key of ['contractSha256', 'prismaCliSha256', 'opensslSha256']) receipt[key] = hash('controlled-file'); receipt.engine.sha256 = hash('controlled-file');
  const script = resolve(root, 'controlled-child.mjs');
  writeFileSync(script, "import {writeFileSync} from 'node:fs'; const data=JSON.parse(process.argv[3]); if(process.env.RENDER_SERVICE_ID || process.env.STAGING_DB_ADMIN_PASSWORD || process.env.UNKNOWN_PRIVATE || process.env.NODE_OPTIONS) process.exit(8); writeFileSync(process.argv[2],JSON.stringify(data),{flag:'wx'}); process.stdout.write('synthetic-untrusted-output');");
  let invocation;
  const result = verifyLinuxTLS({ here: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, RENDER_SERVICE_ID: 'srv-controlled', RENDER_GIT_COMMIT: 'a'.repeat(40), UNKNOWN_PRIVATE: 'synthetic-private-sentinel' }, opensslCandidates: [paths[0]], now: () => Date.parse(finishedAt), run: (command, args, options) => {
    invocation = { command, args, options };
    assert.equal(args[0], resolve(tlsDir, 'run-engine-tls.mjs')); assert.equal(args[2], prisma); assert.equal(args[6], paths[1]);
    // Replace only the controlled child process; no TLS, npm, Prisma or provider execution.
    return spawnSync(process.execPath, [script, args[8], JSON.stringify({ ...receipt, startedAt: finishedAt, cases: receipt.cases.map(c => ({ ...c, startedAt: finishedAt, finishedAt })) })], { ...options, encoding: 'utf8' });
  } });
  assert.equal(invocation.options.timeout, 180000); assert.deepEqual(invocation.options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(result.providerService, 'srv-controlled'); assert.equal(result.assertions, 26); assert.equal(JSON.stringify(result).includes('synthetic'), false);
  assert.equal(existsSync(resolve(root, 'public-result')), false);
});

test('TLS gate rejects credential names and missing provider binding before child execution', () => {
  assert.throws(() => assertCredentialFree({ PRIVACY_SECRET: '' }), /VERIFY_CREDENTIAL_CONFIGURATION_PRESENT/);
  assert.throws(() => verifyLinuxTLS({ here, env: {}, run: () => assert.fail('must not execute') }), /PROVIDER_IDENTITY_INVALID/);
});
