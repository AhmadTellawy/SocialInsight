// Actual Linux tests against a disposable loopback TLS PostgreSQL17 fixture only.
// SQL tests call the pinned CLI directly. A separately labeled runCapture test uses existing DI
// after its fixed target guard; no alternate target is added to the production entry point.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLI_SHA256, ENGINE_SHA256, CA_SHA256, FROZEN_BINDING, SERVICE, TARGET, sourceSnapshot, frozenPackage, readRegular, directory, sha256, cleanEnvironment } from './contract.mjs';
import { ensurePrivate } from './capture.mjs';
import { cacheBase, dependencyFiles, saveCache, materializeCache } from './cache.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.resolve(process.env.RELEASE18_TEST_PACKAGE_ROOT ?? path.join(HERE, '../../server/scripts/release-db-18'));
const CA = '/tls/ca.pem';
const PASSWORD = 'settings-local-fixture'; // Public, synthetic fixture credential only.
const TEMPLATE_SHA256 = '46f20637f9e22d1c0f2e1b0c1512b927d672bbfd3aac588e5cf4b6438b57d515';
const receipt = { schemaVersion: 1, scope: 'SYNTHETIC_LINUX_CLI_SQL_AND_FILESYSTEM_PROCESS_TESTS', startedAt: new Date().toISOString(), providerConnections: 0, realCredentialsRead: false, actualHostedTransportVerified: false, applicationDeployment: false, cases: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let scratch, runtime, runner, childEnvironment, template, observer;
let assertions = 0;
const check = (condition, label) => { assertions++; assert.ok(condition, label); };
const eq = (actual, expected, label) => { assertions++; assert.equal(actual, expected, label); };
const rejects = (fn, expected, label) => { assertions++; assert.throws(fn, expected, label); };
const caseTest = (name, fn) => test(name, { timeout: 90000 }, async () => {
  const record = { name, startedAt: new Date().toISOString(), status: 'RUNNING' }, beforeCount = assertions;
  receipt.cases.push(record);
  try { await fn(record); record.status = 'PASSED'; }
  catch (error) {
    record.status = 'FAILED';
    record.failureCode = /^[A-Z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : 'TEST_ASSERTION_OR_EXECUTION_FAILED';
    throw error;
  } finally { record.finishedAt = new Date().toISOString(); record.assertions = assertions - beforeCount; }
});

function fixedUrl(tag) {
  const url = new URL('postgresql://127.0.0.1:55447/postgres');
  url.username = 'postgres'; url.password = PASSWORD;
  url.searchParams.set('schema', 'public');
  url.searchParams.set('connect_timeout', '10');
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('options', '-c timezone=UTC -c lock_timeout=5000 -c statement_timeout=120000 -c default_transaction_read_only=on');
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('sslcert', CA);
  url.searchParams.set('application_name', tag);
  return url.href;
}
function files(name, sql) {
  const cwd = path.join(scratch, name); fs.mkdirSync(cwd, { mode: 0o700 });
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"private":true}\n', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(cwd, 'schema.prisma'), 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n directUrl = env("DIRECT_URL")\n}\n', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(cwd, 'transport.sql'), sql, { flag: 'wx', mode: 0o600 });
  return { cwd, args: [runtime.cli, 'db', 'execute', '--file', path.join(cwd, 'transport.sql'), '--schema', path.join(cwd, 'schema.prisma')] };
}
function cleanProcess(result) {
  eq(result.processCleanup?.scope, 'LINUX_PROCESS_GROUP', 'real Linux process group scope');
  eq(result.processCleanup?.verified, true, 'process cleanup inspected');
  eq(result.processCleanup?.quiescent, true, 'process group quiescent');
  eq(result.processCleanup?.remainingLivePids.length, 0, 'no live process descendants');
}
function processProjection(result) {
  return { exitCode: result.status, signal: result.signal, reason: result.reason, durationMs: result.durationMs, stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes, processCleanup: result.processCleanup };
}

before(async () => {
  eq(process.platform, 'linux', 'Linux execution is mandatory, never silently skipped');
  eq(process.version, 'v24.20.0', 'exact CI Node version');
  eq(process.getuid(), 0, 'isolated CI container root required for foreign-owner negative fixture');
  const frozen = frozenPackage(PACKAGE);
  eq(frozen.sourceBindingSha256, FROZEN_BINDING, 'unchanged frozen DB18 source');
  const install = await import(pathToFileURL(path.join(PACKAGE, 'install.mjs')));
  ({ childEnvironment } = await import(pathToFileURL(path.join(PACKAGE, 'contract.mjs'))));
  runner = await import(pathToFileURL(path.join(PACKAGE, 'process-runner.mjs')));
  runtime = install.verifyRuntime(PACKAGE, false);
  eq(runtime.prismaVersion, '6.19.2', 'pinned actual CLI version');
  eq(runtime.cliSha256, CLI_SHA256, 'pinned actual JS CLI bytes');
  eq(runtime.engineSha256, ENGINE_SHA256, 'pinned actual native engine bytes');
  template = readRegular(path.join(HERE, 'transport.sql')).toString('utf8');
  eq(sha256(template), TEMPLATE_SHA256, 'unchanged reviewed SQL template');
  eq(template.split('__INVOCATION_TAG__').length, 2, 'one invocation marker');
  const ca = readRegular(CA).toString('utf8');
  scratch = fs.mkdtempSync('/tmp/si-r18-linux-test-'); fs.chmodSync(scratch, 0o700);
  const require = createRequire(path.join(PACKAGE, 'package.json'));
  eq(require('pg/package.json').version, '8.23.0', 'pinned independent observer');
  const { Client } = require('pg');
  observer = new Client({ host: '127.0.0.1', port: 55447, database: 'postgres', user: 'postgres', password: PASSWORD, connectionTimeoutMillis: 10000, query_timeout: 10000, options: '-c default_transaction_read_only=on -c statement_timeout=10000', ssl: { ca, servername: 'localhost', rejectUnauthorized: true, minVersion: 'TLSv1.2' } });
  observer.on('error', () => {});
  await observer.connect();
  const { rows: [identity] } = await observer.query("SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int/10000 AS major,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl");
  eq(identity.db, 'postgres', 'fixed synthetic database'); eq(identity.role, 'postgres', 'fixed synthetic role');
  eq(identity.host, '127.0.0.1', 'loopback-only peer'); eq(identity.port, 55447, 'fixed synthetic port');
  eq(identity.major, 17, 'actual PostgreSQL17'); eq(identity.ssl, true, 'server confirms TLS');
  eq(observer.connection.stream.encrypted, true, 'observer TLS encrypted');
  eq(observer.connection.stream.authorized, true, 'observer TLS certificate authenticated');
  receipt.runtime = { nodeVersion: process.version, nodePlatform: process.platform, prismaVersion: runtime.prismaVersion, cliSha256: runtime.cliSha256, engineSha256: runtime.engineSha256 };
  receipt.sourceBindingSha256 = frozen.sourceBindingSha256;
  receipt.templateSha256 = TEMPLATE_SHA256;
  receipt.syntheticPostgresMajor = identity.major;
});

caseTest('unchanged SQL template succeeds through pinned Prisma CLI and native engine over strict local TLS', async record => {
  const tag = 'si_r18_transport_' + randomUUID().replaceAll('-', '');
  const fixture = files('positive', template.replace('__INVOCATION_TAG__', tag));
  const result = await runner.runPrismaProcess(process.execPath, fixture.args, { cwd: fixture.cwd, env: childEnvironment(cleanEnvironment(process.env), fixedUrl(tag)), timeout: 60000, maxBuffer: 65536 });
  record.process = processProjection(result);
  eq(result.status, 0, 'all template assertions passed in actual PostgreSQL');
  check(!result.signal && !result.error && !result.reason, 'no cancellation, spawn failure, or unknown result');
  cleanProcess(result);
  eq(fs.readFileSync(path.join(fixture.cwd, 'transport.sql'), 'utf8'), template.replace('__INVOCATION_TAG__', tag), 'only invocation marker substituted');
  record.assertionsEnforcedByTemplate = ['database', 'role', 'transaction_read_only', 'default_transaction_read_only', 'UTC', 'lock_timeout_5s', 'statement_timeout_120s', 'application_name', 'server_tls'];
});

caseTest('same SQL template fails through actual Prisma when only application_name mismatches', async record => {
  const tag = 'si_r18_transport_' + randomUUID().replaceAll('-', '');
  const fixture = files('negative', template.replace('__INVOCATION_TAG__', tag));
  const expected = new URL(fixedUrl(tag)), mismatch = new URL(fixedUrl(tag + '_wrong'));
  mismatch.searchParams.set('application_name', tag);
  eq(mismatch.href, expected.href, 'the sole changed connection input is application_name');
  const result = await runner.runPrismaProcess(process.execPath, fixture.args, { cwd: fixture.cwd, env: childEnvironment(cleanEnvironment(process.env), fixedUrl(tag + '_wrong')), timeout: 60000, maxBuffer: 65536 });
  record.process = processProjection(result);
  eq(result.status, 1, 'actual CLI rejects the failed SQL assertion');
  check(!result.error && !result.signal && !result.reason, 'failure is a normal SQL CLI exit, not timeout/spawn/cleanup failure');
  check(result.stderrBytes > 0, 'CLI produced discarded error output');
  cleanProcess(result);
  record.rawOutputRetained = false;
});

caseTest('actual Linux hardlinks and symlink ancestors cannot become trusted input files', async () => {
  const root = path.join(scratch, 'links'); fs.mkdirSync(root, { mode: 0o700 });
  const original = path.join(root, 'original'); fs.writeFileSync(original, 'synthetic\n', { mode: 0o600 });
  fs.linkSync(original, path.join(root, 'hardlink'));
  eq(fs.lstatSync(original).nlink, 2, 'actual hardlink exists');
  rejects(() => readRegular(original), /FILE_INVALID/, 'hardlinked source rejected');
  rejects(() => dependencyFiles(root), /FILE_INVALID/, 'hardlinked dependency rejected');
  fs.unlinkSync(path.join(root, 'hardlink'));
  eq(readRegular(original).toString(), 'synthetic\n', 'unlinked regular source accepted');
  fs.mkdirSync(path.join(root, 'real'), { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'real', 'child'), { mode: 0o700 });
  fs.symlinkSync(path.join(root, 'real'), path.join(root, 'alias'), 'dir');
  rejects(() => directory(path.join(root, 'alias', 'child')), /DIRECTORY_INVALID/, 'symlink ancestor rejected');
});

caseTest('actual Linux private directory modes and owner reject writable or foreign cache ancestry', async () => {
  const root = path.join(scratch, 'permissions'); fs.mkdirSync(root, { mode: 0o700 });
  ensurePrivate(root, 'linux');
  fs.chmodSync(root, 0o755);
  rejects(() => ensurePrivate(root, 'linux'), /PERMISSIONS_INVALID/, 'private run rejects group/other readability');
  fs.chmodSync(root, 0o700);
  fs.chownSync(root, 12345, 12345);
  try { rejects(() => ensurePrivate(root, 'linux'), /PERMISSIONS_INVALID/, 'foreign-owned run rejected'); }
  finally { fs.chownSync(root, process.getuid(), process.getgid()); }
  fs.chmodSync(root, 0o777);
  rejects(() => cacheBase(root, 'linux'), /PERMISSIONS_INVALID/, 'world-writable cache home rejected');
  fs.chmodSync(root, 0o700);
  const base = cacheBase(root, 'linux');
  eq(fs.statSync(base).mode & 0o777, 0o700, 'cache child is private');
  fs.chmodSync(base, 0o770);
  rejects(() => cacheBase(root, 'linux'), /PERMISSIONS_INVALID/, 'group-writable cache child rejected');
  fs.chmodSync(base, 0o700);
  fs.chownSync(root, 12345, 12345);
  try { rejects(() => cacheBase(root, 'linux'), /PERMISSIONS_INVALID/, 'foreign-owned cache home rejected'); }
  finally { fs.chownSync(root, process.getuid(), process.getgid()); }
});

caseTest('complete actual installed dependency tree survives cache and private consumer materialization without installation', async record => {
  const root = path.join(scratch, 'actual-cache'); fs.mkdirSync(root, { mode: 0o700 });
  const cacheHome = path.join(root, 'cache'), consumer = path.join(root, 'consumer');
  fs.mkdirSync(cacheHome, { mode: 0o700 }); fs.mkdirSync(consumer, { mode: 0o700 });
  const saved = saveCache({ cacheHome, packageRoot: PACKAGE, runnerRoot: HERE, opsRevision: 'a'.repeat(40) });
  eq(saved.reusedVerifiedCache, false, 'fresh real dependency cache created');
  const manifestFile = path.join(cacheHome, 'opiniup-db18-toolchain', saved.manifestSha256, 'manifest.json');
  const bytes = readRegular(manifestFile, 8388608), manifest = JSON.parse(bytes);
  eq(sha256(bytes), saved.manifestSha256, 'digest covers actual retained manifest bytes');
  eq(manifest.kind, 'CREDENTIAL_FREE_DB18_PUBLIC_TOOLCHAIN', 'actual public toolchain cache kind');
  eq(manifest.files.length, saved.files, 'manifest enumerates all cached dependency files');
  eq(manifest.files.reduce((total, file) => total + file.bytes, 0), saved.bytes, 'complete manifest byte count');
  check(manifest.files.some(file => file.path === 'prisma/build/index.js'), 'actual CLI is included in dependency tree');
  check(manifest.files.some(file => /^@prisma\/engines\/schema-engine-(?:debian|linux)-/.test(file.path)), 'actual native schema engine is included');
  eq(manifest.excluded, 'NPM_BIN_LINKS_ONLY', 'only npm bin links excluded');
  eq(bytes.includes(Buffer.from(PASSWORD)), false, 'manifest contains no fixture password');
  const materialized = materializeCache({ cacheHome, manifestSha256: saved.manifestSha256, packageRoot: PACKAGE, runnerRoot: HERE, runDirectory: consumer });
  ensurePrivate(materialized.runtimeRoot, 'linux');
  const install = await import(pathToFileURL(path.join(PACKAGE, 'install.mjs')));
  const copied = install.verifyRuntime(materialized.runtimeRoot, false);
  eq(copied.prismaVersion, '6.19.2', 'materialized actual Prisma version');
  eq(copied.cliSha256, CLI_SHA256, 'materialized actual CLI matches immutable pin');
  eq(copied.engineSha256, ENGINE_SHA256, 'materialized actual native engine matches immutable pin');
  const copiedFiles = dependencyFiles(path.join(materialized.runtimeRoot, 'node_modules'), { privateTree: true });
  eq(sha256(JSON.stringify(copiedFiles)), sha256(JSON.stringify(manifest.files)), 'every copied dependency matches complete approved manifest');
  const originalStat = fs.statSync(runtime.cli), copiedStat = fs.statSync(copied.cli);
  check(originalStat.dev !== copiedStat.dev || originalStat.ino !== copiedStat.ino, 'consumer CLI is an independent file copy');
  eq(copiedStat.nlink, 1, 'consumer CLI is not hardlinked');
  const tag = 'si_r18_transport_' + randomUUID().replaceAll('-', '');
  const invocation = files('actual-cache/consumer/invocation', template.replace('__INVOCATION_TAG__', tag));
  invocation.args[0] = copied.cli;
  const executed = await runner.runPrismaProcess(process.execPath, invocation.args, { cwd: invocation.cwd, env: childEnvironment(cleanEnvironment(process.env), fixedUrl(tag)), timeout: 60000, maxBuffer: 65536 });
  record.consumerExecution = processProjection(executed);
  eq(executed.status, 0, 'actual copied CLI and native engine execute unchanged positive SQL');
  check(!executed.error && !executed.signal && !executed.reason, 'actual consumer starts and completes without failure');
  cleanProcess(executed);
  eq(frozenPackage(PACKAGE).sourceBindingSha256, FROZEN_BINDING, 'frozen DB18 package source unchanged after materialization');
  record.files = saved.files; record.bytes = saved.bytes; record.manifestSha256 = saved.manifestSha256;
  record.consumerPrismaVersion = copied.prismaVersion; record.consumerCliSha256 = copied.cliSha256; record.consumerEngineSha256 = copied.engineSha256;
  record.consumerInstallCommands = 0; record.providerConnections = 0; record.localTlsDatabaseExecution = true;
  record.preparedOperationsCommitScope = 'Synthetic fixture value; not a new Git or hosted approval';
});

caseTest('SIGTERM interrupts the real pinned Prisma CLI and its active native engine process group', async record => {
  const tag = 'si_r18_transport_' + randomUUID().replaceAll('-', '');
  const fixture = files('signal', 'BEGIN READ ONLY; SELECT pg_sleep(120); ROLLBACK;\n');
  const workerFile = path.join(fixture.cwd, 'worker.mjs');
  const source = `import {runPrismaProcess} from ${JSON.stringify(pathToFileURL(path.join(PACKAGE, 'process-runner.mjs')).href)};\nconst result=await runPrismaProcess(process.execPath,${JSON.stringify(fixture.args)},{cwd:${JSON.stringify(fixture.cwd)},env:process.env,timeout:60000,maxBuffer:65536,onSpawn:pid=>process.send({event:'SPAWN',pid})});\nprocess.send({event:'RESULT',result},()=>process.disconnect());\n`;
  fs.writeFileSync(workerFile, source, { flag: 'wx', mode: 0o600 });
  let group, result, exited = false, exitCode, workerError = false, observedBackend, observedEngine;
  const worker = spawn(process.execPath, [workerFile], { cwd: fixture.cwd, env: childEnvironment(cleanEnvironment(process.env), fixedUrl(tag)), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  worker.on('error', () => { workerError = true; });
  worker.on('message', message => { if (message.event === 'SPAWN') group = message.pid; if (message.event === 'RESULT') result = message.result; });
  worker.on('exit', code => { exited = true; exitCode = code; });
  try {
    const deadline = Date.now() + 25000;
    while (!exited && !workerError && Date.now() < deadline) {
      if (Number.isInteger(group) && group > 1) {
        observedEngine = runner.processGroupMembers(group).find(member => {
          try { return path.basename(fs.readlinkSync(`/proc/${member.pid}/exe`)).startsWith('schema-engine-'); } catch { return false; }
        });
        observedBackend = (await observer.query("SELECT pid,backend_start::text AS started FROM pg_stat_activity WHERE datname='postgres' AND usename='postgres' AND application_name=$1 AND state='active' AND query LIKE '%pg_sleep(120)%'", [tag])).rows[0];
        if (observedEngine && observedBackend) break;
      }
      await wait(50);
    }
    check(!workerError && Number.isInteger(group) && group > 1 && group !== process.pid, 'actual CLI process group spawned');
    check(Boolean(observedEngine), 'actual native schema engine running before signal');
    check(Boolean(observedBackend), 'actual tagged PostgreSQL query active before signal');
    eq(sha256(fs.readFileSync(`/proc/${observedEngine.pid}/exe`)), ENGINE_SHA256, 'running engine binary matches pin');
    record.signalSentAt = new Date().toISOString(); const signalTime = Date.now();
    eq(worker.kill('SIGTERM'), true, 'SIGTERM sent to actual wrapper process');
    while (!exited && Date.now() - signalTime < runner.PROCESS_CLEANUP_MS + 5000) await wait(25);
    check(exited && result, 'bounded result and wrapper exit observed'); eq(exitCode, 0, 'wrapper completed normally after interrupt handling');
    eq(result.reason, 'PARENT_SIGTERM', 'actual SIGTERM handler path'); eq(result.interrupted, true, 'interruption retained');
    cleanProcess(result);
    eq(runner.processGroupMembers(group).filter(member => !['Z', 'X'].includes(member.state)).length, 0, 'independent proc inspection sees no live descendants');
    record.process = processProjection(result);
    record.observedNativeEngine = true;
    record.backendCleanupScope = 'Harness cleanup on exact synthetic backend, not a claim about hosted capture backend cancellation';
  } finally {
    if (!exited) { worker.kill('SIGTERM'); const deadline = Date.now() + 6000; while (!exited && Date.now() < deadline) await wait(25); }
    if (Number.isInteger(group) && group > 1 && group !== process.pid) {
      try { if (runner.processGroupMembers(group).some(member => !['Z', 'X'].includes(member.state))) { process.kill(-group, 'SIGKILL'); record.emergencyFixtureProcessKill = true; } } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (!exited) { worker.kill('SIGKILL'); await new Promise(resolve => worker.once('exit', resolve)); }
    // Only the observed test-owned connection may be canceled; never a hosted or unrelated backend.
    if (observedBackend) {
      await observer.query("SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND application_name=$3 AND datname='postgres' AND usename='postgres'", [observedBackend.pid, observedBackend.started, tag]);
      record.syntheticBackendCleanupAttempted = true;
    }
  }
});

caseTest('actual runCapture parent retains UNKNOWN lock after SIGTERM with explicit synthetic process-adapter substitution', async record => {
  const runId = randomUUID(), tag = 'si_r18_transport_' + runId.replaceAll('-', '');
  const root = path.join(scratch, 'capture-parent'); fs.mkdirSync(root, { mode: 0o700 });
  const evidenceRoot = path.join(root, 'evidence'), runDirectory = path.join(evidenceRoot, runId);
  const opsRevision = 'a'.repeat(40), fixtureDigest = 'b'.repeat(64), stamp = Date.now();
  const runnerSourceSha256 = sourceSnapshot(HERE), binding = frozenPackage(PACKAGE);
  const approved = {
    schemaVersion: 1, authority: 'F01_INDEPENDENT_TRANSPORT_REVIEW', command: 'CAPTURE_STAGE_READ_ONLY', runId, opsRevision, serviceId: SERVICE, target: TARGET,
    sourceBindingSha256: FROZEN_BINDING, runnerSourceSha256, toolchainCacheManifestSha256: fixtureDigest,
    validFrom: new Date(stamp - 1000).toISOString(), expiresAt: new Date(stamp + 900000).toISOString(),
    gates: ['E03', 'E04', 'E01', 'D04', 'F01'].map(role => ({ role, status: 'PASSED', evidenceSha256: fixtureDigest, sourceBindingSha256: FROZEN_BINDING, runnerSourceSha256 })),
    controlledTlsProof: { status: 'PASSED', evidenceSha256: fixtureDigest, operationsCommit: opsRevision, serviceId: SERVICE, sourceBindingSha256: FROZEN_BINDING, contractSha256: binding.contractSha256, nodePlatform: 'linux', prismaVersion: '6.19.2', cliSha256: CLI_SHA256, engineSha256: ENGINE_SHA256, caSha256: CA_SHA256, validPeer: true, wrongCaRejectedBeforeCredentials: true, wrongHostnameRejectedBeforeCredentials: true, noTlsRejectedBeforeCredentials: true, noPlaintextFallback: true, observedAt: new Date(stamp - 1000).toISOString() },
    projectionMode: 'SUMMARY_ONLY', databaseMutation: false, applicationDeployment: false, unknownRunPolicy: 'STOP_AND_REVIEW_NO_AUTOMATIC_RETRY'
  };
  const approvalFile = path.join(root, 'synthetic-approval.json'), approvalBytes = JSON.stringify(approved);
  fs.writeFileSync(approvalFile, approvalBytes, { flag: 'wx', mode: 0o600 });
  const invocationEnv = { ...cleanEnvironment(process.env), RENDER_SERVICE_ID: SERVICE, RENDER_GIT_COMMIT: opsRevision, RELEASE18_TRANSPORT_APPROVED_CONFIG_SHA256: sha256(approvalBytes), RELEASE18_DB_ADMIN_PASSWORD: PASSWORD };
  const workerFile = path.join(root, 'capture-worker.mjs');
  // No production code or signal handler is changed. Existing DI replaces Git/cache fixtures and
  // translates the already-validated fixed URL only inside this test adapter. It appends a test
  // sleep after the unchanged transport assertions to create an observable in-flight operation.
  const source = [
    "import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';",
    `import {runCapture,createRun} from ${JSON.stringify(pathToFileURL(path.join(HERE, 'capture.mjs')).href)};`,
    `import {verifyRuntime} from ${JSON.stringify(pathToFileURL(path.join(PACKAGE, 'install.mjs')).href)};`,
    `import {connectionUrl,childEnvironment} from ${JSON.stringify(pathToFileURL(path.join(PACKAGE, 'contract.mjs')).href)};`,
    `import {runPrismaProcess} from ${JSON.stringify(pathToFileURL(path.join(PACKAGE, 'process-runner.mjs')).href)};`,
    `const runtime=verifyRuntime(${JSON.stringify(PACKAGE)},false); let processResult;`,
    `const result=await runCapture({argv:['capture','--approval-file',${JSON.stringify(approvalFile)},'--run-id',${JSON.stringify(runId)}],env:${JSON.stringify(invocationEnv)},runnerRoot:${JSON.stringify(HERE)},packageRoot:${JSON.stringify(PACKAGE)}},{`,
    `gitRevision:()=>${JSON.stringify(opsRevision)},createRun:(runner,id,platform)=>createRun(runner,id,platform,${JSON.stringify(evidenceRoot)}),emit:()=>{},`,
    `frozenRuntime:async()=>({runtimeRoot:${JSON.stringify(PACKAGE)},runtime,connectionUrl,childEnvironment,runPrismaProcess:async(command,args,options)=>{`,
    `assert.equal(command,process.execPath); assert.equal(args[0],runtime.cli); const fixed=new URL(options.env.DATABASE_URL);`,
    `assert.equal(fixed.hostname,${JSON.stringify(TARGET.host)}); assert.equal(fixed.port,'5432'); assert.equal(decodeURIComponent(fixed.username),${JSON.stringify(TARGET.user)}); assert.equal(fixed.pathname,'/postgres');`,
    `assert.equal(fixed.searchParams.get('options'),'-c timezone=UTC -c lock_timeout=5000 -c statement_timeout=120000 -c default_transaction_read_only=on'); assert.equal(fixed.searchParams.get('application_name'),${JSON.stringify(tag)}); assert.equal(fixed.searchParams.get('sslaccept'),'strict');`,
    `const original=fs.readFileSync(args[4],'utf8'); assert.equal(original,${JSON.stringify(template.replace('__INVOCATION_TAG__', tag))});`,
    `const waitSql=path.join(options.cwd,'test-only-wait.sql'); fs.writeFileSync(waitSql,original.replace('ROLLBACK;','SELECT pg_sleep(120);\\nROLLBACK;'),{flag:'wx',mode:0o600});`,
    `const local=new URL(${JSON.stringify(fixedUrl(tag))}); const localArgs=[...args]; localArgs[4]=waitSql;`,
    `processResult=await runPrismaProcess(command,localArgs,{...options,env:childEnvironment(options.env,local.href),onSpawn:pid=>process.send({event:'SPAWN',pid,fixedTargetValidatedBeforeTestSubstitution:true})}); return processResult;}})});`,
    "process.send({event:'RESULT',result,processResult},()=>process.disconnect());"
  ].join('\n');
  fs.writeFileSync(workerFile, source, { flag: 'wx', mode: 0o600 });
  let group, result, processResult, exited = false, exitCode, workerError = false, targetValidated = false, backend, engine;
  const worker = spawn(process.execPath, [workerFile], { cwd: root, env: cleanEnvironment(process.env), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  worker.on('error', () => { workerError = true; });
  worker.on('message', message => {
    if (message.event === 'SPAWN') { group = message.pid; targetValidated = message.fixedTargetValidatedBeforeTestSubstitution === true; }
    if (message.event === 'RESULT') { result = message.result; processResult = message.processResult; }
  });
  worker.on('exit', code => { exited = true; exitCode = code; });
  try {
    const deadline = Date.now() + 25000;
    while (!exited && !workerError && Date.now() < deadline) {
      if (Number.isInteger(group) && group > 1) {
        engine = runner.processGroupMembers(group).find(member => { try { return path.basename(fs.readlinkSync(`/proc/${member.pid}/exe`)).startsWith('schema-engine-'); } catch { return false; } });
        backend = (await observer.query("SELECT pid,backend_start::text AS started FROM pg_stat_activity WHERE datname='postgres' AND usename='postgres' AND application_name=$1 AND state='active' AND query LIKE '%pg_sleep(120)%'", [tag])).rows[0];
        if (engine && backend) break;
      }
      await wait(50);
    }
    eq(targetValidated, true, 'production fixed-target URL passed before explicit test-only local substitution');
    check(!workerError && Number.isInteger(group) && group > 1 && group !== process.pid && engine && backend, 'capture actual native CLI and tagged SQL active before signal');
    eq(sha256(fs.readFileSync(`/proc/${engine.pid}/exe`)), ENGINE_SHA256, 'capture adapter runs actual pinned native engine');
    record.signalSentAt = new Date().toISOString(); const signalTime = Date.now();
    eq(worker.kill('SIGTERM'), true, 'signal actual runCapture parent, no custom signal handler');
    while (!exited && Date.now() - signalTime < runner.PROCESS_CLEANUP_MS + 7000) await wait(25);
    check(exited && result && processResult, 'capture returned bounded failure after real helper cleanup');
    eq(exitCode, 0, 'supervisor returned handled capture disposition');
    eq(processResult.reason, 'PARENT_SIGTERM', 'frozen helper owns SIGTERM handling'); cleanProcess(processResult);
    eq(result.status, 'FAILED_OR_UNKNOWN', 'capture failure remains unknown');
    eq(result.failureCode, 'PRISMA_TRANSPORT_FAILED', 'capture classifies interrupted process');
    eq(result.lockRetained, true, 'capture retains target lock'); eq(result.proofCreated, false, 'no success proof');
    eq(result.transportAssertionsPassed, false, 'interrupted capture does not claim completed assertions');
    const lock = JSON.parse(readRegular(path.join(evidenceRoot, 'stage-session.lock')));
    eq(lock.runId, runId, 'real retained lock belongs to exact test invocation');
    const rejected = JSON.parse(readRegular(path.join(runDirectory, 'rejected.json')));
    eq(rejected.status, 'FAILED_OR_UNKNOWN', 'failure receipt persisted'); eq(rejected.childAttempted, true, 'actual child attempt recorded');
    for (const name of ['evidence.json', 'prisma-transport-proof.json', 'receipt.json']) eq(fs.existsSync(path.join(runDirectory, name)), false, 'no successful capture artifact: ' + name);
    eq(runner.processGroupMembers(group).filter(member => !['Z', 'X'].includes(member.state)).length, 0, 'no live native descendants after capture failure');
    record.process = processProjection(processResult);
    record.captureDisposition = result;
    record.testOnlySubstitutions = ['synthetic Git revision and approval/cache fixture', 'already validated fixed URL to loopback TLS', 'test sleep after unchanged SQL assertions'];
    record.productionGuardChanged = false; record.customSignalHandler = false;
  } finally {
    if (!exited) { worker.kill('SIGTERM'); const deadline = Date.now() + 6000; while (!exited && Date.now() < deadline) await wait(25); }
    if (Number.isInteger(group) && group > 1 && group !== process.pid) {
      try { if (runner.processGroupMembers(group).some(member => !['Z', 'X'].includes(member.state))) { process.kill(-group, 'SIGKILL'); record.emergencyFixtureProcessKill = true; } } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (!exited) { worker.kill('SIGKILL'); await new Promise(resolve => worker.once('exit', resolve)); }
    if (backend) {
      await observer.query("SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND application_name=$3 AND datname='postgres' AND usename='postgres'", [backend.pid, backend.started, tag]);
      record.syntheticBackendCleanupAttempted = true;
    }
  }
});

after(async () => {
  if (observer) await observer.end();
  if (scratch) {
    eq(fs.realpathSync(scratch), scratch, 'cleanup root still exact');
    check(/^\/tmp\/si-r18-linux-test-[A-Za-z0-9]+$/.test(scratch), 'cleanup stays inside unique owned test root');
    fs.rmSync(scratch, { recursive: true });
    eq(fs.existsSync(scratch), false, 'exact filesystem fixture cleanup completed');
    receipt.fixtureFilesRemoved = true;
  }
  receipt.finishedAt = new Date().toISOString(); receipt.assertions = assertions;
  receipt.status = receipt.cases.length === 7 && receipt.cases.every(item => item.status === 'PASSED') ? 'PASSED' : 'FAILED';
  receipt.databaseContainerCleanup = 'Owned GitHub always-step linux-test-setup.sh stop is separate evidence';
  console.log(JSON.stringify(receipt));
});
