import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { TLSSocket, createSecureContext } from 'node:tls';
import { dirname, basename, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Controlled PostgreSQL v3 wire peer, not a database or Prisma substitute.
// The actual schema engine is the client. It is spawned directly using the
// same dbExecute JSON-RPC method used by Prisma CLI db execute, avoiding an
// untracked CLI grandchild on timeout. No real provider credentials are read.
const here = dirname(fileURLToPath(import.meta.url));
const evidenceHere = resolve(here, '../evidence');
mkdirSync(evidenceHere, { recursive: true, mode: 0o700 });
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--prisma-dir', '--openssl', '--contract', '--result'].includes(process.argv[i]), 'ARGUMENT_INVALID');
  assert(process.argv[i + 1] && !args.has(process.argv[i]), 'ARGUMENT_INVALID');
  args.set(process.argv[i], process.argv[i + 1]);
}
for (const name of ['--prisma-dir', '--openssl', '--contract', '--result']) assert(args.has(name), 'ARGUMENT_MISSING');
const prismaDir = realpathSync(args.get('--prisma-dir'));
const openssl = realpathSync(args.get('--openssl'));
const contractPath = realpathSync(args.get('--contract'));
const resultPath = resolve(args.get('--result'));
assert(dirname(resultPath) === evidenceHere && !existsSync(resultPath), 'RESULT_MUST_BE_NEW_OWNED_FILE');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = path => sha(readFileSync(path));
const baseEnv = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[key]) baseEnv[key] = process.env[key];
}
const env = { ...baseEnv, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', NO_COLOR: '1' };
const version = JSON.parse(readFileSync(resolve(prismaDir, 'package.json'))).version;
assert.equal(version, '6.19.2', 'PRISMA_VERSION_MISMATCH');
const enginesDir = resolve(prismaDir, '../@prisma/engines');
const { readdirSync } = await import('node:fs');
const engineNames = readdirSync(enginesDir).filter(name => /^schema-engine-(?:windows\.exe|[a-z0-9.-]+)$/.test(name) && !name.endsWith('.sha256'));
assert.equal(engineNames.length, 1, 'ENGINE_SELECTION_AMBIGUOUS');
const engine = realpathSync(resolve(enginesDir, engineNames[0]));
assert.equal(hashFile(resolve(prismaDir, 'build/index.js')), '69a2bd6412521259b90c653aff9822b6d2fc63a17f9c46d46d07d319ea0dbb3e', 'CLI_BYTES_MISMATCH');
if (process.platform === 'linux') assert.equal(hashFile(engine), '5d42b181631fd20bb0ecc5abcdba72575e7f467a0d52f4d5ef1ff28f0c74e6e9', 'ENGINE_BYTES_MISMATCH');
const versionRun = spawnSync(engine, ['--version'], { env, encoding: 'utf8', timeout: 5000, windowsHide: true });
assert.equal(versionRun.status, 0, 'ENGINE_VERSION_FAILED');
assert.match(versionRun.stdout.trim(), /^schema-engine-cli c2990dca591cba766e3b7ef5d9e8a84796e47ab7$/, 'ENGINE_COMMIT_MISMATCH');
const opensslRun = spawnSync(openssl, ['version'], { env, encoding: 'utf8', timeout: 5000, windowsHide: true });
assert.equal(opensslRun.status, 0, 'OPENSSL_VERSION_FAILED');
assert.equal(contractPath, realpathSync(resolve(here, '../contract.mjs')), 'CONTRACT_PATH_MISMATCH');
const { connectionUrl, childEnvironment, targetFor, CONNECTION_OPTIONS } = await import(pathToFileURL(contractPath));
const receipt = {
  schemaVersion: 1, kind: 'CONTROLLED_LOCAL_LOCKED_PRISMA_TLS', startedAt: new Date().toISOString(),
  platform: process.platform, node: process.version, prismaVersion: version,
  engine: { fileName: basename(engine), version: versionRun.stdout.trim(), sha256: hashFile(engine) },
  prismaCliSha256: hashFile(resolve(prismaDir, 'build/index.js')),
  contractSha256: hashFile(contractPath), harnessSha256: hashFile(fileURLToPath(import.meta.url)),
  opensslVersion: opensslRun.stdout.trim(), opensslSha256: hashFile(openssl),
  providerConnections: 0, realCredentialsRead: false, serverBinding: '127.0.0.1 ephemeral TCP port',
  protocol: 'PostgreSQL SSLRequest + TLS + StartupMessage + cleartext-password challenge inside TLS + simple query',
  engineInvocation: 'schema-engine binary without arguments; dbExecute JSON-RPC over stdin with datasourceType tag=url; same method as locked Prisma CLI db execute',
  query: 'SELECT 1;', cases: [], cleanup: {}, status: 'RUNNING'
};
let fixture;
let fixtureReal;
let failureCode;
let activeChild;
const activeSockets = new Set();
let activeServer;
function opensslCommand(argv) {
  const run = spawnSync(openssl, argv, { env, cwd: fixture, encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 65536 });
  assert(run.status === 0 && !run.error, 'CERTIFICATE_GENERATION_FAILED');
}
function generateCertificates() {
  opensslCommand(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=Controlled TLS Test CA', '-days', '2', '-sha256', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  opensslCommand(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'other-ca.key', '-out', 'other-ca.crt', '-subj', '/CN=Other Controlled TLS Test CA', '-days', '2', '-sha256', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  for (const name of ['valid', 'mismatch']) {
    opensslCommand(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name === 'valid' ? 'localhost' : 'wrong.invalid'}`]);
    writeFileSync(resolve(fixture, `${name}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${name === 'valid' ? 'DNS:localhost,IP:127.0.0.1' : 'DNS:wrong.invalid'}\n`, { flag: 'wx' });
    opensslCommand(['x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key', '-set_serial', name === 'valid' ? '2' : '3', '-out', `${name}.crt`, '-days', '2', '-sha256', '-extfile', `${name}.ext`]);
  }
}
const u32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const u16 = n => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const message = (tag, bytes) => Buffer.concat([Buffer.from(tag), u32(bytes.length + 4), bytes]);
const auth = n => message('R', u32(n));
const ready = () => message('Z', Buffer.from('I'));
const parameter = (key, value) => message('S', Buffer.from(`${key}\0${value}\0`));
const sessionInfoQuery = "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1), version(), current_setting('server_version_num')::integer as numeric_version;";
const queryKind = text => text.trim() === sessionInfoQuery ? 'session_info' : /^SELECT\s+version\(\)\s*;?$/i.test(text.trim()) ? 'version' : /^SELECT\s+1\s*;?$/i.test(text.trim()) ? 'target' : /^SET\s+[a-z_]+\s*(?:=|TO)\s*(?:[0-9]+|"[a-z_0-9]+"|'[a-z_0-9]+')\s*;?$/i.test(text.trim()) ? 'session_setup' : 'unexpected';
const rowDescription = kind => {
  const fields = kind === 'session_info' ? [['exists', 16, 1], ['version', 25, -1], ['numeric_version', 23, 4]] : [[kind === 'version' ? 'version' : '?column?', kind === 'version' ? 25 : 23, kind === 'version' ? -1 : 4]];
  return message('T', Buffer.concat([u16(fields.length), ...fields.flatMap(([name, oid, size]) => [Buffer.from(`${name}\0`), u32(0), u16(0), u32(oid), u16(size), u32(-1), u16(0)])]));
};
const rowData = (kind, binary = false) => {
  const version = Buffer.from('PostgreSQL 17.0 on controlled local TLS peer');
  const values = kind === 'session_info' ? [binary ? Buffer.from([1]) : Buffer.from('t'), version, binary ? u32(170000) : Buffer.from('170000')] : [kind === 'version' ? version : binary ? u32(1) : Buffer.from('1')];
  return message('D', Buffer.concat([u16(values.length), ...values.flatMap(value => [u32(value.length), value])]));
};

async function runCase(name, certName, caName, refuseTls) {
  const startedAt = new Date().toISOString();
  const syntheticPassword = randomBytes(24).toString('base64url');
  const obs = { connections: 0, sslRequests: 0, tlsHandshakes: 0, tlsErrors: 0, startupMessages: 0, startupIdentityMatched: false, startupOptionsMatched: true, passwordMessages: 0, passwordMatched: false, queryMessages: 0, targetQueryMatched: false, unexpectedMessages: 0, plaintextAfterTlsRefusalBytes: 0, tlsProtocols: [], observedMessageTags: [], queryKinds: [] };
  const server = createServer(raw => {
    activeSockets.add(raw); raw.on('close', () => activeSockets.delete(raw)); raw.on('error', () => {});
    obs.connections++;
    let initial = Buffer.alloc(0);
    const initialListener = chunk => {
      initial = Buffer.concat([initial, chunk]);
      if (initial.length < 8) return;
      raw.removeListener('data', initialListener);
      if (initial.readUInt32BE(0) !== 8 || initial.readUInt32BE(4) !== 80877103 || initial.length !== 8) { obs.unexpectedMessages++; raw.destroy(); return; }
      obs.sslRequests++;
      if (refuseTls) {
        raw.on('data', bytes => { obs.plaintextAfterTlsRefusalBytes += bytes.length; raw.destroy(); });
        raw.write('N');
        return;
      }
      raw.write('S');
      const peer = new TLSSocket(raw, { isServer: true, secureContext: createSecureContext({ key: readFileSync(resolve(fixture, `${certName}.key`)), cert: readFileSync(resolve(fixture, `${certName}.crt`)), minVersion: 'TLSv1.2' }) });
      activeSockets.add(peer); peer.on('close', () => activeSockets.delete(peer));
      peer.on('secure', () => { obs.tlsHandshakes++; obs.tlsProtocols.push(peer.getProtocol()); });
      peer.on('error', () => { obs.tlsErrors++; });
      let pending = Buffer.alloc(0); let startup = true; let authenticated = false;
      const statements = new Map(); const portals = new Map();
      peer.on('data', data => {
        pending = Buffer.concat([pending, data]);
        if (pending.length > 65536) { obs.unexpectedMessages++; peer.destroy(); return; }
        if (startup) {
          if (pending.length < 4) return;
          const length = pending.readUInt32BE(0);
          if (length < 8 || length > 65536) { obs.unexpectedMessages++; peer.destroy(); return; }
          if (pending.length < length) return;
          const startupBytes = pending.subarray(0, length); pending = pending.subarray(length); startup = false;
          obs.startupMessages++;
          const parts = startupBytes.subarray(8).toString().split('\0');
          const fields = new Map(); for (let i = 0; i + 1 < parts.length; i += 2) fields.set(parts[i], parts[i + 1]);
          obs.startupIdentityMatched = startupBytes.readUInt32BE(4) === 196608 && fields.get('user') === 'postgres' && fields.get('database') === 'postgres';
          obs.startupOptionsMatched = obs.startupOptionsMatched && fields.get('options') === CONNECTION_OPTIONS;
          peer.write(auth(3));
        }
        while (pending.length >= 5) {
          const tag = String.fromCharCode(pending[0]); const length = pending.readUInt32BE(1);
          if (length < 4 || length > 65536) { obs.unexpectedMessages++; peer.destroy(); return; }
          if (pending.length < length + 1) return;
          const body = pending.subarray(5, length + 1); pending = pending.subarray(length + 1);
          obs.observedMessageTags.push(tag);
          if (tag === 'p' && !authenticated) {
            obs.passwordMessages++; obs.passwordMatched = body.toString() === `${syntheticPassword}\0`;
            if (!obs.passwordMatched) { peer.destroy(); return; }
            authenticated = true;
            peer.write(Buffer.concat([auth(0), parameter('server_version', '17.0'), parameter('client_encoding', 'UTF8'), parameter('standard_conforming_strings', 'on'), parameter('DateStyle', 'ISO, MDY'), parameter('TimeZone', 'UTC'), message('K', Buffer.concat([u32(999), u32(999)])), ready()]));
          } else if (tag === 'Q' && authenticated) {
            obs.queryMessages++;
            const query = body.toString().replace(/\0$/, '');
            const kind = queryKind(query); obs.queryKinds.push(kind);
            if (kind === 'target') obs.targetQueryMatched = true;
            if (kind === 'unexpected') { obs.unexpectedQuery = query.replaceAll(syntheticPassword, '<redacted>').replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '<redacted-url>').slice(0, 1000); obs.unexpectedMessages++; peer.destroy(); return; }
            // Fixed wire responses, not SQL execution or a database assertion.
            peer.write(Buffer.concat([...(kind === 'session_setup' ? [] : [rowDescription(kind), rowData(kind)]), message('C', Buffer.from(kind === 'session_setup' ? 'SET\0' : 'SELECT 1\0')), ready()]));
          } else if (tag === 'P' && authenticated) {
            const parts = body.toString().split('\0'); const kind = queryKind(parts[1] ?? '');
            obs.queryKinds.push(kind);
            if (kind === 'unexpected') { obs.unexpectedQuery = parts[1].replaceAll(syntheticPassword, '<redacted>').replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '<redacted-url>').slice(0, 1000); obs.unexpectedMessages++; peer.destroy(); return; }
            statements.set(parts[0], kind); peer.write(message('1', Buffer.alloc(0)));
          } else if (tag === 'D' && authenticated) {
            const kind = body[0] === 83 ? statements.get(body.subarray(1).toString().replace(/\0$/, '')) : portals.get(body.subarray(1).toString().replace(/\0$/, ''))?.kind;
            if (!kind) { obs.unexpectedMessages++; peer.destroy(); return; }
            peer.write(Buffer.concat([...(body[0] === 83 ? [message('t', kind === 'session_info' ? Buffer.concat([u16(1), u32(25)]) : u16(0))] : []), rowDescription(kind)]));
          } else if (tag === 'B' && authenticated) {
            const parts = body.toString().split('\0'); const kind = statements.get(parts[1]);
            if (!kind) { obs.unexpectedMessages++; peer.destroy(); return; }
            let offset = body.indexOf(0, body.indexOf(0) + 1) + 1;
            const formatCount = body.readUInt16BE(offset); offset += 2 + formatCount * 2;
            const paramCount = body.readUInt16BE(offset); offset += 2;
            for (let i = 0; i < paramCount; i++) { const size = body.readInt32BE(offset); offset += 4 + Math.max(0, size); }
            const resultFormatCount = body.readUInt16BE(offset); offset += 2;
            const binary = resultFormatCount > 0 && body.readUInt16BE(offset) === 1;
            portals.set(parts[0], { kind, binary }); peer.write(message('2', Buffer.alloc(0)));
          } else if (tag === 'E' && authenticated) {
            const portal = body.subarray(0, body.indexOf(0)).toString(); const bound = portals.get(portal); const kind = bound?.kind;
            if (!bound) { obs.unexpectedMessages++; peer.destroy(); return; }
            obs.queryMessages++; if (kind === 'target') obs.targetQueryMatched = true;
            peer.write(Buffer.concat([rowData(kind, bound.binary), message('C', Buffer.from('SELECT 1\0'))]));
          } else if (tag === 'S' && authenticated) peer.write(ready());
          else if (tag === 'H' && authenticated) { /* All writes are immediate. */ }
          else if (tag === 'C' && authenticated) {
            const name = body.subarray(1).toString().replace(/\0$/, '');
            if (body[0] === 83) statements.delete(name); else portals.delete(name);
            peer.write(message('3', Buffer.alloc(0)));
          } else if (tag === 'X') peer.end();
          else { obs.unexpectedMessages++; peer.destroy(); }
        }
      });
    };
    raw.on('data', initialListener);
  });
  activeServer = server;
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const caFile = resolve(fixture, `${caName}.crt`); const caBytes = readFileSync(caFile);
  const conn = { url: connectionUrl(targetFor('PROD_10', 'direct'), syntheticPassword, caFile) };
  const url = new URL(conn.url); url.hostname = '127.0.0.1'; url.port = String(server.address().port);
  // Only endpoint is overridden from the real contract, never TLS options.
  const childEnv = childEnvironment(env, url.href);
  const request = { jsonrpc: '2.0', id: 1, method: 'dbExecute', params: { script: 'SELECT 1;', datasourceType: { tag: 'url', url: url.href } } };
  let response; let timeout = false; let output = ''; let outputBytes = 0; let stderrBytes = 0; let malformed = false;
  const child = spawn(engine, [], { cwd: fixture, env: childEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  activeChild = child;
  child.stdin.on('error', () => {});
  child.stdout.on('data', chunk => {
    outputBytes += chunk.length;
    if (outputBytes > 1048576) { malformed = true; child.kill('SIGKILL'); return; }
    output += chunk.toString();
    let newline;
    while ((newline = output.indexOf('\n')) !== -1) {
      const line = output.slice(0, newline); output = output.slice(newline + 1);
      try { const obj = JSON.parse(line); if (obj.id === 1 && ('result' in obj || 'error' in obj)) { response = obj; child.stdin.end(); } }
      catch { malformed = true; child.kill('SIGKILL'); }
    }
  });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 1048576) child.kill('SIGKILL'); });
  const timer = setTimeout(() => { timeout = true; child.kill('SIGKILL'); }, 20000);
  const terminated = new Promise(resolveDone => {
    child.on('error', () => { malformed = true; });
    child.on('close', (exitCode, signal) => { clearTimeout(timer); resolveDone({ exitCode, signal }); });
  });
  child.stdin.write(JSON.stringify(request) + '\n');
  const termination = await terminated; activeChild = undefined;
  for (const socket of activeSockets) socket.destroy();
  await new Promise(done => server.close(done)); activeServer = undefined;
  const rawCode = response?.error?.data?.error_code ?? response?.error?.data?.user_facing_error?.error_code;
  const prismaErrorCode = typeof rawCode === 'string' && /^P\d{4}$/.test(rawCode) ? rawCode : null;
  // Inputs are synthetic; still redact full URLs, credentials and ephemeral paths.
  const sanitizedError = response?.error ? JSON.stringify(response.error)
    .replaceAll(conn.url, '<redacted-url>').replaceAll(url.href, '<redacted-url>')
    .replaceAll(syntheticPassword, '<redacted-synthetic-password>')
    .replaceAll(fixture, '<fixture>').replaceAll(fixture.replaceAll('\\', '/'), '<fixture>')
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '<redacted-url>').slice(0, 1500) : null;
  const caseRecord = { name, startedAt, finishedAt: new Date().toISOString(), port: Number(url.port), ...obs, responseKind: response && 'result' in response ? 'RESULT' : response?.error ? 'ERROR' : 'MISSING', prismaErrorCode, sanitizedError, timedOut: timeout, malformed, ...termination, capturedStdoutBytes: outputBytes, suppressedStderrBytes: stderrBytes, assertions: [], status: 'RUNNING' };
  receipt.cases.push(caseRecord);
  const check = (condition, label) => { caseRecord.assertions.push({ label, passed: Boolean(condition) }); assert(condition, `CASE_ASSERTION_${name}_${label}`); };
  try {
    check(!timeout && !malformed && termination.exitCode === 0, 'bounded_engine_rpc_completed');
    check(obs.connections > 0 && obs.sslRequests === obs.connections, 'postgres_ssl_requested_for_every_connection');
    check(obs.unexpectedMessages === 0, 'no_unexpected_wire_messages');
    if (name === 'valid_peer') {
      check(caseRecord.responseKind === 'RESULT', 'actual_engine_returned_success');
      check(obs.tlsHandshakes > 0 && obs.tlsProtocols.every(p => ['TLSv1.2', 'TLSv1.3'].includes(p)), 'encrypted_handshake_completed');
      check(obs.startupMessages > 0 && obs.startupIdentityMatched, 'expected_synthetic_identity_observed');
      check(obs.startupOptionsMatched, 'actual_engine_forwarded_utc_and_timeout_startup_options');
      check(obs.passwordMessages > 0 && obs.passwordMatched, 'synthetic_password_verified_inside_tls');
      check(obs.queryMessages > 0 && obs.targetQueryMatched, 'target_query_reached_controlled_peer');
    } else {
      check(caseRecord.responseKind === 'ERROR', 'actual_engine_rejected_connection');
      check(obs.startupMessages === 0 && obs.passwordMessages === 0 && obs.queryMessages === 0, 'rejected_before_postgres_startup_credentials_query');
      check(obs.plaintextAfterTlsRefusalBytes === 0, 'no_cleartext_fallback');
    }
    caseRecord.status = 'PASSED';
  } catch (error) { caseRecord.status = 'FAILED'; throw error; }
}

try {
  fixture = mkdtempSync(resolve(evidenceHere, 'tls-fixture-')); fixtureReal = realpathSync(fixture);
  assert(dirname(fixtureReal) === realpathSync(evidenceHere) && basename(fixtureReal).startsWith('tls-fixture-'), 'FIXTURE_OUTSIDE_OWNERSHIP');
  generateCertificates();
  receipt.certificates = Object.fromEntries(['ca', 'other-ca', 'valid', 'mismatch'].map(name => [name, { sha256: hashFile(resolve(fixture, `${name}.crt`)), privateKeyPersistedInEvidence: false }]));
  for (const [name, cert, ca, refuse] of [['valid_peer', 'valid', 'ca', false], ['wrong_ca', 'valid', 'other-ca', false], ['hostname_mismatch', 'mismatch', 'ca', false], ['tls_absent', 'valid', 'ca', true]]) await runCase(name, cert, ca, refuse);
  receipt.status = 'PASSED';
} catch (error) {
  failureCode = typeof error?.message === 'string' && /^[A-Z][A-Za-z0-9_]+$/.test(error.message) ? error.message : 'HARNESS_FAILURE';
  receipt.failureCode = failureCode; receipt.status = 'FAILED'; process.exitCode = 1;
} finally {
  if (activeChild && activeChild.exitCode === null) activeChild.kill('SIGKILL');
  for (const socket of activeSockets) socket.destroy();
  if (activeServer) await new Promise(done => activeServer.close(done));
  if (fixtureReal) {
    assert(realpathSync(fixture) === fixtureReal && dirname(fixtureReal) === realpathSync(evidenceHere) && basename(fixtureReal).startsWith('tls-fixture-'), 'CLEANUP_TARGET_INVALID');
    rmSync(fixtureReal, { recursive: true, force: false });
    receipt.cleanup.fixtureRemoved = !existsSync(fixtureReal);
    receipt.cleanup.fixturePath = relative(here, fixtureReal).split(sep).join('/');
  }
  receipt.cleanup.remainingTrackedSockets = activeSockets.size;
  receipt.cleanup.childTerminated = !activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null;
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(resultPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: receipt.status, completedCases: receipt.cases.length, result: basename(resultPath), failureCode: failureCode ?? null }));
}
