import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const HARNESS_SHA256 = '0d73fb8c77e3a232e7c63c3accf121ca7a48805c926c157a5b98cf9fdb2409b1';
const ENGINE_VERSION = 'schema-engine-cli c2990dca591cba766e3b7ef5d9e8a84796e47ab7';
const CASES = ['valid_peer', 'wrong_ca', 'hostname_mismatch', 'tls_absent'];
const COMMON = ['bounded_engine_rpc_completed', 'postgres_ssl_requested_for_every_connection', 'no_unexpected_wire_messages'];
const POSITIVE = ['actual_engine_returned_success', 'encrypted_handshake_completed', 'expected_synthetic_identity_observed', 'synthetic_password_verified_inside_tls', 'target_query_reached_controlled_peer'];
const NEGATIVE = ['actual_engine_rejected_connection', 'rejected_before_postgres_startup_credentials_query', 'no_cleartext_fallback'];
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const check = (condition, code = 'TLS_RECEIPT_INVALID') => { if (!condition) throw new Error(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

const isCredentialVariable = key => /(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DIRECT_URL|(?:^|_)API_KEY(?:_|$))/i.test(key) || /^PG(?:USER|HOST|PORT|DATABASE|SERVICE|SSLKEY|SSLCERT|PASSFILE)/i.test(key);

export function credentialDiagnosticNames(env) {
  // Values are never accessed. Accept only bounded ordinary identifiers or the
  // exact Bash exported-function wrapper. Full-match equality excludes final newlines.
  const safeName = key => /^(?:[A-Za-z_][A-Za-z0-9_]{0,63}|BASH_FUNC_[A-Za-z_][A-Za-z0-9_]{0,63}%%)$/.exec(key)?.[0] === key;
  const names = [...new Set(Object.keys(env).filter(isCredentialVariable).map(key => safeName(key) ? key : 'UNSAFE_VARIABLE_NAME'))].sort();
  return { variableNames: names.slice(0, 16), variableNamesTruncated: names.length > 16 };
}

export function assertCredentialFree(env) {
  // Same rejection predicate as before; no provider variable is exempted.
  for (const key of Object.keys(env)) check(!isCredentialVariable(key), 'VERIFY_CREDENTIAL_CONFIGURATION_PRESENT');
}

export function selectOpenSSL(candidates = ['/usr/bin/openssl', '/usr/local/bin/openssl', '/bin/openssl']) {
  const matches = new Set();
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const real = realpathSync(path);
    check(lstatSync(real).isFile(), 'OPENSSL_SELECTION_INVALID');
    accessSync(real, constants.X_OK);
    matches.add(real);
  }
  check(matches.size === 1, 'OPENSSL_SELECTION_AMBIGUOUS_OR_MISSING');
  return [...matches][0];
}

export function validateTLSReceipt(receipt, binding) {
  check(object(receipt) && object(receipt.engine) && object(receipt.cleanup));
  check(receipt.schemaVersion === 1 && receipt.kind === 'CONTROLLED_LOCAL_LOCKED_PRISMA_TLS' && receipt.status === 'PASSED');
  check(receipt.platform === 'linux' && receipt.node === binding.node && receipt.prismaVersion === '6.19.2');
  check(instant(receipt.startedAt) && instant(receipt.finishedAt) && Date.parse(receipt.startedAt) >= binding.startedAt && Date.parse(receipt.finishedAt) <= binding.finishedAt && receipt.startedAt <= receipt.finishedAt);
  check(receipt.providerConnections === 0 && receipt.realCredentialsRead === false);
  check(receipt.engine.version === ENGINE_VERSION && /^schema-engine-[a-z0-9.-]+$/.test(receipt.engine.fileName) && !receipt.engine.fileName.includes('windows'));
  for (const name of ['harnessSha256', 'contractSha256', 'prismaCliSha256', 'opensslSha256']) check(/^[a-f0-9]{64}$/.test(receipt[name]) && receipt[name] === binding[name]);
  check(receipt.harnessSha256 === HARNESS_SHA256 && /^[a-f0-9]{64}$/.test(receipt.engine.sha256) && receipt.engine.sha256 === binding.engineSha256);
  check(typeof receipt.opensslVersion === 'string' && /^OpenSSL [0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9 .():+-]*$/.test(receipt.opensslVersion) && receipt.opensslVersion.length <= 160);
  check(receipt.cleanup.fixtureRemoved === true && receipt.cleanup.remainingTrackedSockets === 0 && receipt.cleanup.childTerminated === true);
  check(Array.isArray(receipt.cases) && receipt.cases.length === 4 && receipt.cases.every((c, i) => object(c) && c.name === CASES[i]));
  check(object(receipt.certificates) && Object.keys(receipt.certificates).sort().join(',') === 'ca,mismatch,other-ca,valid');
  for (const cert of Object.values(receipt.certificates)) check(object(cert) && /^[a-f0-9]{64}$/.test(cert.sha256) && cert.privateKeyPersistedInEvidence === false);
  const cases = receipt.cases.map((c, index) => {
    check(c.status === 'PASSED' && c.exitCode === 0 && c.signal === null && c.timedOut === false && c.malformed === false);
    check(instant(c.startedAt) && instant(c.finishedAt) && c.startedAt >= receipt.startedAt && c.finishedAt <= receipt.finishedAt && c.startedAt <= c.finishedAt);
    if (index > 0) check(c.startedAt >= receipt.cases[index - 1].finishedAt);
    for (const name of ['connections', 'sslRequests', 'tlsHandshakes', 'startupMessages', 'passwordMessages', 'queryMessages', 'unexpectedMessages', 'plaintextAfterTlsRefusalBytes']) check(count(c[name]));
    check(c.connections > 0 && c.sslRequests === c.connections && c.unexpectedMessages === 0 && c.plaintextAfterTlsRefusalBytes === 0);
    const labels = [...COMMON, ...(index === 0 ? POSITIVE : NEGATIVE)];
    check(Array.isArray(c.assertions) && c.assertions.length === labels.length && c.assertions.every((a, i) => object(a) && a.label === labels[i] && a.passed === true));
    if (index === 0) {
      check(c.responseKind === 'RESULT' && c.prismaErrorCode === null && c.tlsHandshakes > 0 && Array.isArray(c.tlsProtocols) && c.tlsProtocols.length > 0 && c.tlsProtocols.every(p => ['TLSv1.2', 'TLSv1.3'].includes(p)));
      check(c.startupMessages > 0 && c.startupIdentityMatched === true && c.passwordMessages > 0 && c.passwordMatched === true && c.queryMessages > 0 && c.targetQueryMatched === true);
    } else {
      check(c.responseKind === 'ERROR' && c.prismaErrorCode === 'P1011' && c.startupMessages === 0 && c.passwordMessages === 0 && c.queryMessages === 0);
    }
    return { name: c.name, status: 'PASSED', assertions: c.assertions.length, prismaErrorCode: c.prismaErrorCode, startupMessages: c.startupMessages, passwordMessages: c.passwordMessages, queryMessages: c.queryMessages, plaintextAfterTlsRefusalBytes: 0 };
  });
  return { status: 'PASSED', platform: 'linux', node: receipt.node, prismaVersion: '6.19.2', engineVersion: ENGINE_VERSION, engineSha256: receipt.engine.sha256,
    prismaCliSha256: receipt.prismaCliSha256, contractSha256: receipt.contractSha256, harnessSha256: receipt.harnessSha256,
    opensslVersion: receipt.opensslVersion, opensslSha256: receipt.opensslSha256, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt,
    providerConnections: 0, realCredentialsRead: false, cases, assertions: 26,
    cleanup: { fixtureRemoved: true, remainingTrackedSockets: 0, childTerminated: true } };
}

export function verifyLinuxTLS({ here, env, run = spawnSync, opensslCandidates, now = Date.now }) {
  assertCredentialFree(env);
  check(/^srv-[a-z0-9]+$/.test(env.RENDER_SERVICE_ID ?? '') && /^[a-f0-9]{40}$/.test(env.RENDER_GIT_COMMIT ?? ''), 'PROVIDER_IDENTITY_INVALID');
  const harnessDir = resolve(here, 'stage-engine-tls');
  const harness = resolve(harnessDir, 'run-engine-tls.mjs');
  check(sha(harness) === HARNESS_SHA256, 'TLS_HARNESS_BINDING_INVALID');
  const openssl = selectOpenSSL(opensslCandidates);
  const prismaDir = resolve(here, 'stage-initial-install/node_modules/prisma');
  const contract = resolve(here, 'stage-initial-install/contract.mjs');
  const runId = randomUUID();
  const result = resolve(harnessDir, `result-${runId}.json`);
  const startedAt = now();
  // Only filtered OS/CI variables are passed by the launcher; provider identity
  // is added to the projected log afterward, not inherited by the harness.
  const childEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'CI', 'NO_COLOR', 'PRISMA_HIDE_UPDATE_MESSAGE', 'CHECKPOINT_DISABLE']) if (env[key]) childEnv[key] = env[key];
  const execution = run(process.execPath, [harness, '--prisma-dir', prismaDir, '--openssl', openssl, '--contract', contract, '--result', result], {
    cwd: harnessDir, env: childEnv, timeout: 180000, encoding: 'utf8', maxBuffer: 65536, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  check(execution.status === 0 && !execution.error && !execution.signal, 'TLS_HARNESS_FAILED');
  check(lstatSync(result).isFile() && !lstatSync(result).isSymbolicLink() && lstatSync(result).size <= 65536, 'TLS_RECEIPT_FILE_INVALID');
  const receipt = JSON.parse(readFileSync(result, 'utf8'));
  check(object(receipt) && object(receipt.engine) && /^schema-engine-[a-z0-9.-]+$/.test(receipt.engine.fileName ?? ''), 'TLS_ENGINE_FILE_INVALID');
  const engine = resolve(prismaDir, '../@prisma/engines', basename(receipt.engine.fileName));
  const projected = validateTLSReceipt(receipt, { node: process.version, startedAt, finishedAt: now(), harnessSha256: sha(harness), contractSha256: sha(contract),
    prismaCliSha256: sha(resolve(prismaDir, 'build/index.js')), opensslSha256: sha(openssl), engineSha256: sha(engine) });
  return { event: 'STAGE_LINUX_ENGINE_TLS_VERIFIED', runId, providerCommit: env.RENDER_GIT_COMMIT, providerService: env.RENDER_SERVICE_ID, ...projected };
}
