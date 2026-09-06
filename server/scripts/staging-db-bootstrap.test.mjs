import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ACL, LOGGING_CONTROLS, LOGGING_SQL, LOGGING_ASSERT_SQL, RUNTIME_PROBE_SQL, ROLE_SQL,
    aclCheckSql, checkAdvisoryLock, checkRuntime, connectionUrl, databaseEnvironment, grantSql, parseLogging,
    main, migrationChecks, passwordCommands, prismaCommand, runNative, runProcessGroup, setPassword, validateEnvironment, validatePassword } from './staging-db-bootstrap.mjs';
import { BRANCH, PROJECT_REF, STAGING_CA_PATH } from './staging-db-precheck.mjs';

const SHA = 'a'.repeat(40);
const PASSWORD = 's'.repeat(64); // Synthetic fixture, not a credential.
const ENV = { STAGING_RELEASE_SHA: SHA, RENDER_GIT_COMMIT: SHA, RENDER_GIT_BRANCH: BRANCH };
const REMOTE = { ...ENV, STAGING_DATABASE_PROJECT_REF: PROJECT_REF, STAGING_DB_ADMIN_PASSWORD: 'SYNTHETIC_ADMIN_ONLY' };
const APPLY = { ...REMOTE, STAGING_DB_RUNTIME_PASSWORD: PASSWORD, STAGING_BOOTSTRAP_APPLY_APPROVED: 'true', STAGING_BACKUP_VERIFIED_SHA: SHA };
const safeLogging = () => Object.fromEntries(Object.keys(LOGGING_CONTROLS).map(key => [key, true]));
const role = () => ({ role: 'otp_staging_app', session_role: 'otp_staging_app', row_security: true, database: 'postgres', tls: true, version: 170006, safe: true, memberships: 0, owned: 0, schema_create: false });
const success = stdout => ({ status: 0, stdout, stderr: '', signal: null });

test('three modes enforce immutable release identity and credential separation', () => {
    assert.equal(validateEnvironment(ENV, SHA, '--self-check'), SHA);
    assert.equal(validateEnvironment(REMOTE, SHA, '--readiness'), SHA);
    assert.equal(validateEnvironment(APPLY, SHA, '--apply'), SHA);
    for (const [env, mode] of [[{ ...ENV, STAGING_DB_ADMIN_PASSWORD: 'x' }, '--self-check'],
        [{ ...REMOTE, STAGING_DB_RUNTIME_PASSWORD: PASSWORD }, '--readiness'],
        [{ ...APPLY, STAGING_BACKUP_VERIFIED_SHA: 'b'.repeat(40) }, '--apply'],
        [{ ...APPLY, STAGING_BOOTSTRAP_APPLY_APPROVED: 'false' }, '--apply'],
        [{ ...APPLY, RENDER_GIT_BRANCH: 'main' }, '--apply'],
        [{ ...APPLY, RENDER_GIT_COMMIT: 'b'.repeat(40) }, '--apply'],
        [{ ...APPLY, STAGING_DATABASE_PROJECT_REF: 'other' }, '--apply']]) {
        assert.throws(() => validateEnvironment(env, SHA, mode));
    }
    assert.throws(() => validateEnvironment(ENV, 'b'.repeat(40), '--self-check'));
    assert.throws(() => validateEnvironment(ENV, SHA, '--unknown'));
});

test('even empty unrelated credentials and runtime config are rejected', () => {
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET', 'OTP_HASH_SECRET', 'RESEND_API_KEY', 'STAGING_OTP_ALLOWED_EMAILS',
        'STAGING_BACKUP_S3_ACCESS_KEY_ID', 'STAGING_BACKUP_S3_SECRET_ACCESS_KEY', 'STAGING_BACKUP_ENCRYPTION_KEY', 'NODE_OPTIONS',
        'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS']) {
        assert.throws(() => validateEnvironment({ ...APPLY, [key]: '' }, SHA, '--apply'), /CREDENTIAL_BOUNDARY_INVALID/);
    }
});

test('runtime credentials cannot be empty, reused, non-ASCII or prompt-injecting', () => {
    for (const value of ['', undefined, 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(63)}\n`, 'ك'.repeat(64), ' '.repeat(64)]) {
        assert.throws(() => validatePassword(value), /RUNTIME_CREDENTIAL_INVALID/);
    }
    assert.throws(() => validateEnvironment({ ...APPLY, STAGING_DB_ADMIN_PASSWORD: PASSWORD }, SHA, '--apply'), /CREDENTIAL_REUSE/);
    validatePassword(PASSWORD);
});

test('logging metadata is fixed-key booleans, every unknown or false control blocks verification', () => {
    assert.equal(parseLogging(JSON.stringify(safeLogging())).status, 'VERIFIED');
    for (const key of Object.keys(LOGGING_CONTROLS)) {
        const changed = safeLogging(); changed[key] = false;
        assert.equal(parseLogging(JSON.stringify(changed)).status, 'UNVERIFIED');
        assert.equal(parseLogging(JSON.stringify(changed)).controls[key], 'UNVERIFIED');
        delete changed[key]; assert.throws(() => parseLogging(JSON.stringify(changed)), /LOGGING_PREFLIGHT_UNVERIFIED/);
    }
    for (const raw of ['null', '[]', '{}', JSON.stringify({ ...safeLogging(), secret: PASSWORD }), JSON.stringify({ ...safeLogging(), hooks: PASSWORD })]) {
        assert.throws(() => parseLogging(raw), error => !error.message.includes(PASSWORD));
    }
});

test('logging checks include core errors, sampling, hooks, pgAudit and statement statistics without disabling anything', () => {
    for (const name of ['password_encryption', 'log_statement', 'log_min_duration_statement', 'log_min_duration_sample',
        'log_statement_sample_rate', 'log_transaction_sample_rate', 'log_min_error_statement', 'log_lock_waits',
        'debug_print_parse', 'debug_print_rewritten', 'debug_print_plan', 'shared_preload_libraries', 'session_preload_libraries',
        'local_preload_libraries', 'pgaudit.log', 'pgaudit.log_statement', 'pgaudit.log_parameter', 'pg_stat_statements.track', 'pg_stat_statements.track_utility']) {
        assert.ok(LOGGING_SQL.includes(name), name);
    }
    assert.match(LOGGING_SQL, /^BEGIN READ ONLY;/);
    assert.doesNotMatch(LOGGING_SQL + LOGGING_ASSERT_SQL, /\b(?:SET|ALTER|INSERT|UPDATE|DELETE|CREATE)\s/i);
    assert.match(LOGGING_ASSERT_SQL, /^SELECT 1 \/ CASE WHEN/);
});

test('native password command is same-session preceded by logging guard and uses private stdin only', () => {
    let privateBuffer;
    setPassword('/pinned/bin', { SAFE: 'only' }, PASSWORD, { run(executable, argv, options) {
        assert.match(executable.replaceAll('\\', '/'), /\/psql$/);
        assert.deepEqual(argv.slice(-4), ['-c', LOGGING_ASSERT_SQL, '-c', '\\password otp_staging_app']);
        assert.ok(!JSON.stringify(argv).includes(PASSWORD));
        assert.deepEqual(options.env, { SAFE: 'only' });
        assert.equal(options.detached, true); assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
        assert.equal(options.input.toString(), `${PASSWORD}\n${PASSWORD}\n`);
        privateBuffer = options.input;
        return success('1');
    } });
    assert.ok(privateBuffer.every(byte => byte === 0));
    assert.deepEqual(passwordCommands(), [LOGGING_ASSERT_SQL, '\\password otp_staging_app']);
});

test('failure never leaks native stderr/exception/secret and private password buffer is wiped', () => {
    let buffer;
    assert.throws(() => setPassword('/x', {}, PASSWORD, { run(_x, _a, options) {
        buffer = options.input; return { ...success(PASSWORD), status: 1, stderr: PASSWORD };
    } }), /PASSWORD_APPLICATION_FAILED/);
    assert.ok(buffer.every(byte => byte === 0));
    assert.throws(() => runNative('/x', [], { run() { throw new Error(PASSWORD); } }), error => !error.message.includes(PASSWORD));
    assert.throws(() => runNative('/x', [], { run() { return { ...success(''), error: { code: 'ETIMEDOUT', message: PASSWORD } }; } }), /NATIVE_OPERATION_FAILED/);
    assert.throws(() => runNative('/x', [], { maxBuffer: 2, run() { return success('abc'); } }), /NATIVE_OPERATION_FAILED/);
});

test('database connections are hard pinned and administrator credentials never enter runtime URL', () => {
    const admin = databaseEnvironment('SYNTHETIC_ADMIN_ONLY');
    const runtime = databaseEnvironment(PASSWORD, { runtime: true });
    assert.equal(admin.PGUSER, `postgres.${PROJECT_REF}`);
    assert.equal(runtime.PGUSER, `otp_staging_app.${PROJECT_REF}`);
    assert.equal(runtime.PGSSLMODE, 'verify-full'); assert.equal(runtime.PGSSLROOTCERT, STAGING_CA_PATH);
    assert.equal(runtime.PGPORT, '5432');
    assert.doesNotMatch(runtime.PGOPTIONS, /log_statement|pgaudit|ssl/);
    const url = new URL(connectionUrl(runtime));
    assert.equal(decodeURIComponent(url.password), PASSWORD);
    assert.equal(url.searchParams.get('sslmode'), 'require'); assert.equal(url.searchParams.get('sslaccept'), 'strict');
    assert.equal(url.searchParams.get('sslcert'), STAGING_CA_PATH);
    for (const delta of [{ PGHOST: 'localhost' }, { PGPORT: '6543' }, { PGUSER: 'postgres' }, { PGSSLMODE: 'disable' }, { PGSSLROOTCERT: '/wrong' }]) {
        assert.throws(() => connectionUrl({ ...runtime, ...delta }), /URL_TARGET_INVALID/);
    }
});

test('actual runtime identity requires LOGIN/nonowner/NOBYPASS/no membership and correct TLS version', () => {
    checkRuntime(JSON.stringify(role()));
    checkRuntime(JSON.stringify({ ...role(), tls: false, version: 170011 }), false);
    for (const delta of [{ role: 'postgres' }, { session_role: 'postgres' }, { row_security: false }, { tls: false }, { version: 160014 }, { database: 'other' }, { safe: false }, { memberships: 1 }, { owned: 1 }, { schema_create: true }, { extra: PASSWORD }]) {
        assert.throws(() => checkRuntime(JSON.stringify({ ...role(), ...delta })), /RUNTIME_IDENTITY_INVALID/);
    }
    assert.match(ROLE_SQL, /pg_auth_members/);
});

test('ACL is explicit, singleton and health minimal, no legacy OTP access/default/all-table grants', () => {
    assert.deepEqual(ACL.staging_otp_email_reservation, ['SELECT', 'INSERT']);
    assert.deepEqual(ACL._prisma_migrations, ['SELECT']);
    assert.equal(ACL.OTPCode, undefined);
    assert.deepEqual(ACL.MediaPrivacyTransition, ['SELECT']);
    const grants = grantSql();
    assert.doesNotMatch(grants, /ALL TABLES|DEFAULT PRIVILEGES|TRUNCATE|CREATE|BYPASSRLS|OTPCode/);
    for (const table of Object.keys(ACL)) assert.ok(grants.includes(`public."${table}"`));
    assert.ok(aclCheckSql().includes(`'public."staging_otp_email_reservation"','DELETE')=false`));
    assert.ok(aclCheckSql().includes(`'public."staging_otp_email_reservation"','TRUNCATE')=false`));
    assert.ok(aclCheckSql().includes(`has_any_column_privilege(current_user,'public."OTPCode"','SELECT')`));
    assert.ok(aclCheckSql().includes('UPDATE WITH GRANT OPTION'));
});

test('runtime fixture budget is rollback-only and is never deleted updated truncated or reset', () => {
    assert.match(RUNTIME_PROBE_SQL, /^BEGIN;/); assert.match(RUNTIME_PROBE_SQL, /ROLLBACK;$/);
    assert.match(RUNTIME_PROBE_SQL, /INSERT INTO staging_otp_email_reservation\(slot\) VALUES \(1\)/);
    assert.doesNotMatch(RUNTIME_PROBE_SQL, /(?:DELETE FROM|UPDATE|TRUNCATE) staging_otp_email_reservation/);
});

test('Prisma has a strict command allowlist, direct executable, scoped credentials, and captured output', async () => {
    const url = connectionUrl(databaseEnvironment('SYNTHETIC_ADMIN_ONLY'));
    const calls = [];
    assert.equal(await prismaCommand({ path: '/private/prisma-tool' }, url, 'migrate deploy', { async execute(executable, argv, options) {
        calls.push(argv); assert.equal(executable, process.execPath);
        assert.equal(options.env.DATABASE_URL, url); assert.equal(options.env.DIRECT_URL, url);
        assert.equal(options.env.RESEND_API_KEY, undefined); assert.equal(options.env.STAGING_DB_RUNTIME_PASSWORD, undefined);
        return success('Applied');
    } }), 0);
    assert.deepEqual(calls[0].slice(-2), ['migrate', 'deploy']);
    await assert.rejects(prismaCommand({ path: '/private' }, url, 'migrate reset'), /PRISMA_COMMAND_INVALID/);
    await assert.rejects(prismaCommand({ path: '/private' }, url, 'migrate status', { async execute() { return { output: PASSWORD, status: 1 }; } }), /MIGRATION_STATUS_FAILED/);
});

test('negative probes classify authentication versus network failures and safe SQLSTATE only', () => {
    const execute = stderr => runNative('/fake', [], { allowed: [2], run: () => ({ ...success(''), status: 2, stderr }) });
    assert.equal(execute('FATAL:  password authentication failed for user "synthetic"').authRejected, true);
    assert.equal(execute('connection refused').authRejected, false);
    assert.equal(execute('connection timed out').authRejected, false);
    for (const state of ['23505', '23514', '42501']) assert.equal(execute(`ERROR:  ${state}\n`).sqlState, state);
    assert.equal(execute(`ERROR: ${PASSWORD}`).sqlState, 'UNKNOWN');
});

function fakeProcess() {
    const child = new EventEmitter(); child.pid = 81234; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    return child;
}
const absent = () => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }); };
test('Prisma group execution returns only captured stdout after confirmed exit', async () => {
    const child = fakeProcess();
    const result = await runProcessGroup('/fixed/node', ['fixed-cli'], { platform: 'linux', kill: absent, spawnChild(_exe, _argv, options) {
        assert.equal(options.detached, true); assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
        queueMicrotask(() => { child.stdout.write('bounded output'); child.stderr.write(PASSWORD); child.emit('close', 0); }); return child;
    } });
    assert.deepEqual(result, { status: 0, output: 'bounded output' });
});
test('Prisma timeout kills exact owned process group and requires close, never retries', async () => {
    const child = fakeProcess(); const kills = []; let alive = true, spawns = 0;
    await assert.rejects(runProcessGroup('/fixed', [], { platform: 'linux', timeout: 5, spawnChild() { spawns++; return child; }, kill(pid, signal) {
        assert.equal(pid, -81234); kills.push(signal);
        if (signal === 'SIGKILL') { alive = false; queueMicrotask(() => child.emit('close', null)); return; }
        if (!alive) absent();
    } }), /PROCESS_TIMEOUT_OUTCOME_UNCERTAIN/);
    assert.equal(spawns, 1); assert.ok(kills.includes('SIGKILL'));
});
test('Prisma uncertain group termination fails with dedicated preservation code', async () => {
    const child = fakeProcess();
    await assert.rejects(runProcessGroup('/fixed', [], { platform: 'linux', timeout: 5, spawnChild: () => child,
        kill() { throw Object.assign(new Error(PASSWORD), { code: 'EPERM' }); } }), /PROCESS_GROUP_STOP_UNVERIFIED/);
});

function orchestration(overrides = {}) {
    const events = [];
    return { events, options: { mode: '--self-check', env: ENV, platform: 'linux', getUid: () => 1001,
        log: value => events.push(value), run: () => ({ output: SHA }), workspaceFactory: () => ({ path: '/owned' }),
        prepare: () => ({ bin: '/pinned' }), start: () => ({ stop() { events.push('STOP'); } }),
        rehearse: async () => ({ names: [] }), cleanup: () => events.push('CLEANUP'), publishResult: () => events.push('PUBLISH'), ...overrides } };
}
test('self-check completion is emitted only after stop cleanup and safe publish', async () => {
    const { events, options } = orchestration(); assert.equal(await main(options), 0);
    assert.deepEqual(events.slice(0, 3), ['STOP', 'CLEANUP', 'PUBLISH']);
    assert.match(events[3], /^STAGING_BOOTSTRAP_CHECKS_OK /);
});
test('imported start stop-uncertainty preserves workspace and never publishes success', async () => {
    const { events, options } = orchestration({ start() { throw Object.assign(new Error(PASSWORD), { code: 'LOCAL_STOP_FAILED' }); } });
    assert.equal(await main(options), 1);
    assert.equal(events.length, 1); assert.equal(events[0], 'STAGING_BOOTSTRAP_FAILED LOCAL_STOP_FAILED');
});
test('uncertain engine descendants preserve scratch and do not publish', async () => {
    const { events, options } = orchestration({ rehearse() { throw Object.assign(new Error(PASSWORD), { code: 'PROCESS_GROUP_STOP_UNVERIFIED' }); } });
    assert.equal(await main(options), 1);
    assert.ok(events.includes('STOP')); assert.ok(!events.includes('CLEANUP')); assert.ok(!events.includes('PUBLISH'));
    assert.ok(events.includes('STAGING_BOOTSTRAP_FAILED PROCESS_GROUP_STOP_UNVERIFIED'));
    assert.ok(events.every(value => !value.includes(PASSWORD) && !value.includes('CHECKS_OK')));
});
test('cleanup failure cannot coexist with a success event', async () => {
    const { events, options } = orchestration({ cleanup() { throw new Error(PASSWORD); } });
    assert.equal(await main(options), 1); assert.ok(!events.some(value => value.includes('CHECKS_OK') || value === 'PUBLISH'));
});

test('two-connection advisory probe proves contention and release after confirmed child close', async () => {
    const child = fakeProcess(); child.stdin = new PassThrough(); const calls = [];
    child.stdin.on('data', bytes => {
        if (bytes.toString().startsWith('BEGIN')) child.stdout.write('LOCKED\n');
        else child.emit('close', 0);
    });
    await checkAdvisoryLock('/bin', {}, { platform: 'linux', spawnChild: () => child, kill: absent,
        query: value => { calls.push(value); return calls.length === 1 ? 'f' : 't'; } });
    assert.equal(calls.length, 2); assert.equal(calls[0], calls[1]);
});
test('advisory early exit is failure without publishing or pretending the lock was held', async () => {
    const child = fakeProcess(); child.stdin = new PassThrough();
    await assert.rejects(checkAdvisoryLock('/bin', {}, { platform: 'linux', kill: absent,
        spawnChild() { queueMicrotask(() => child.emit('close', 1)); return child; },
        query() { assert.fail('must not query after failed handshake'); } }), /LOCK_PROBE_FAILED/);
});
test('advisory stdin EPIPE is contained and owned process group is stopped and reaped', async () => {
    const child = fakeProcess(); child.stdin = new PassThrough(); let alive = true; let killed = false;
    child.stdin.on('data', () => child.stdin.emit('error', new Error(PASSWORD)));
    await assert.rejects(checkAdvisoryLock('/bin', {}, { platform: 'linux', spawnChild: () => child,
        kill(pid, signal) { assert.equal(pid, -81234); if (signal === 'SIGKILL') { killed = true; alive = false; queueMicrotask(() => child.emit('close', null)); } else if (!alive) absent(); }
    }), error => error.message === 'LOCK_PROBE_FAILED' && !error.message.includes(PASSWORD));
    assert.equal(killed, true);
});
test('advisory timeout stops only its owned child group and never retries connection', async () => {
    const child = fakeProcess(); child.stdin = new PassThrough(); let alive = true, spawns = 0;
    await assert.rejects(checkAdvisoryLock('/bin', {}, { platform: 'linux', timeoutMs: 5,
        spawnChild() { spawns++; return child; },
        kill(pid, signal) { assert.equal(pid, -81234); if (signal === 'SIGKILL') { alive = false; queueMicrotask(() => child.emit('close', null)); } else if (!alive) absent(); }
    }), /LOCK_PROBE_FAILED/);
    assert.equal(spawns, 1);
});

test('implementation retains explicit gaps and no provider/email/production execution path', () => {
    const source = readFileSync(fileURLToPath(new URL('./staging-db-bootstrap.mjs', import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /render-build|migrate reset|accept-data-loss|sendAuthEmail|new PrismaClient/);
    assert.match(source, /previous_server_execution: 'NOT_PERFORMED'/);
    assert.match(source, /staging-bootstrap-public/);
    assert.match(source, /STAGING_BOOTSTRAP_READINESS/);
});

test('catalog verification checks exact migration checksums, clean journal and all five OTP indexes', () => {
    const name = '20260905140000_otp_resend_security';
    const bytes = Buffer.from('synthetic migration');
    const manifest = [{ name, checksum: createHash('sha256').update(bytes).digest('hex') }];
    const queries = [];
    const query = input => { queries.push(input); return input.includes('json_agg') ? JSON.stringify(manifest) : 't'; };
    migrationChecks('/bin', {}, [name], { query, readMigration: () => bytes });
    assert.ok(queries.some(input => input.includes("pg_index WHERE indrelid='public.otp_challenges'::regclass)=5")));
    assert.ok(queries.some(input => input.includes('bool_and(finished_at IS NOT NULL AND rolled_back_at IS NULL)')));
    assert.throws(() => migrationChecks('/bin', {}, [name], { query, readMigration: () => Buffer.from('changed migration') }), /MIGRATION_MANIFEST_MISMATCH/);
    assert.throws(() => migrationChecks('/bin', {}, [name], { query: input => input.includes('json_agg') ? JSON.stringify(manifest) : 'f', readMigration: () => bytes }), /MIGRATION_MANIFEST_MISMATCH/);
    assert.throws(() => migrationChecks('/bin', {}, ['../escape'], { query, readMigration: () => bytes }), /MIGRATION_MANIFEST_INVALID/);
});
