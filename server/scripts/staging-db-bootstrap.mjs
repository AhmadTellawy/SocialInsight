// BUILD ONLY. No application server, email provider, interactive SQL or secret artifact.
// --readiness is remote READ ONLY; --self-check uses only disposable local PG17;
// --apply requires separately reviewed retained-backup and one-run release evidence.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_ENV, makeWorkspace, cleanupWorkspace, prepareToolchain, startLocalCluster, SNAPSHOT_SQL, parseSnapshot, remoteEnvironment } from './staging-backup-rehearsal.mjs';
import { BRANCH, PROJECT_REF, STAGING_CA_PATH, validateStagingCa } from './staging-db-precheck.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ROLE = 'otp_staging_app';
export const OTP_MIGRATIONS = ['20260905140000_otp_resend_security', '20260905200000_staging_otp_email_reservation'];
export const ACL = Object.freeze({
    users: ['SELECT', 'INSERT', 'UPDATE'], PendingRegistration: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    user_demographics: ['SELECT', 'INSERT', 'UPDATE'], NotificationSettings: ['SELECT', 'INSERT'],
    otp_challenges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], staging_otp_email_reservation: ['SELECT', 'INSERT'],
    _prisma_migrations: ['SELECT'],
    ...Object.fromEntries(['MediaAsset', 'MediaVariant', 'MediaPrivacyTransition', 'Post', 'Section', 'Question', 'Option', 'Mention',
        'MentionOccurrence', 'PostTaggedUser', 'PostMedia', '_PostTargetGroups', 'Group', 'GroupMember', 'Response', 'Answer',
        'UserLike', 'user_saved_posts', 'follows', 'user_blocks', 'user_hidden_posts', 'profile_links', 'notifications'].map(name => [name, ['SELECT']])),
});
const FORBIDDEN = ['DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET', 'OTP_HASH_SECRET', 'RESEND_API_KEY', 'STAGING_OTP_ALLOWED_EMAILS',
    'STAGING_BACKUP_S3_ACCESS_KEY_ID', 'STAGING_BACKUP_S3_SECRET_ACCESS_KEY', 'STAGING_BACKUP_ENCRYPTION_KEY',
    'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS'];
class SafeError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new SafeError(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Imported helpers own a different SafeError class. Translate only their known
// synchronous boundary failures; never serialize an error or invoke its getters.
const IMPORTED_FAILURES = Object.freeze({
    TOOLCHAIN: Object.freeze(['TOOLCHAIN_PLATFORM_INVALID', 'TOOL_FAILED', 'SIGNING_KEY_INVALID',
        'APT_METADATA_FAILED', 'APT_DOWNLOAD_FAILED', 'PACKAGE_HASH_INVALID', 'PACKAGE_EXTRACT_FAILED',
        'NATIVE_DEPENDENCY_MISSING', 'TOOL_VERSION_INVALID', 'SDK_INSTALL_FAILED']),
    REMOTE_SNAPSHOT: Object.freeze(['SNAPSHOT_INVALID']),
});
export function importedPrerequisite(stage, operation) {
    if (typeof stage !== 'string' || !Object.hasOwn(IMPORTED_FAILURES, stage)) fail('DIAGNOSTIC_STAGE_INVALID');
    try { return operation(); }
    catch (error) {
        let candidate;
        try {
            const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
            if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') candidate = descriptor.value;
        } catch { /* Unknown values and hostile proxies remain unclassified. */ }
        // find returns a source-owned constant, never the untrusted candidate.
        const reason = IMPORTED_FAILURES[stage].find(value => value === candidate) || 'INTERNAL_FAILURE';
        fail(`${stage}_${reason}`);
    }
}

// Values never leave the child: only fixed-key boolean controls are returned.
// Unknown hooks, pgAudit configurations and statement-statistics paths fail closed.
export const LOGGING_CONTROLS = Object.freeze({
    password_encryption: "current_setting('password_encryption',true)='scram-sha-256'",
    statement: "current_setting('log_statement',true)='none'",
    duration: "current_setting('log_duration',true)='off' AND current_setting('log_min_duration_statement',true)='-1'",
    sampling: "current_setting('log_min_duration_sample',true)='-1' AND current_setting('log_statement_sample_rate',true) IN ('0','1') AND current_setting('log_transaction_sample_rate',true)='0'",
    errors: "current_setting('log_min_error_statement',true)='panic'",
    waits: "current_setting('log_lock_waits',true)='off'",
    debug: "current_setting('debug_print_parse',true)='off' AND current_setting('debug_print_rewritten',true)='off' AND current_setting('debug_print_plan',true)='off'",
    collector: "current_setting('logging_collector',true) IN ('on','off') AND current_setting('log_destination',true) IN ('stderr','csvlog','jsonlog','stderr,csvlog','stderr,jsonlog') AND current_setting('log_min_messages',true) IN ('warning','error','fatal','panic') AND current_setting('log_statement_stats',true)='off' AND current_setting('log_parser_stats',true)='off' AND current_setting('log_planner_stats',true)='off' AND current_setting('log_executor_stats',true)='off'",
    hooks: "NOT EXISTS (SELECT 1 FROM regexp_split_to_table(concat_ws(',',current_setting('shared_preload_libraries',true),current_setting('session_preload_libraries',true),current_setting('local_preload_libraries',true)),',') x WHERE btrim(x) NOT IN ('','pg_stat_statements','pgaudit'))",
    pgaudit: "NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgaudit') AND current_setting('pgaudit.log',true) IS NULL AND current_setting('pgaudit.log_statement',true) IS NULL AND current_setting('pgaudit.log_parameter',true) IS NULL",
    pgaudit_version: "NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgaudit' AND extversion !~ '^17[.][0-9]+$')",
    statement_statistics: "(current_setting('pg_stat_statements.track',true) IS NULL AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements')) OR current_setting('pg_stat_statements.track',true)='none' OR current_setting('pg_stat_statements.track_utility',true)='off'",
});
const loggingObject = `json_build_object(${Object.entries(LOGGING_CONTROLS).map(([key, sql]) => `'${key}',coalesce((${sql}),false)`).join(',')})`;
export const LOGGING_SQL = `BEGIN READ ONLY; SELECT ${loggingObject}; COMMIT;`;
// SAME native session immediately before \password; no SET/ALTER of audit settings.
export const LOGGING_ASSERT_SQL = `SELECT 1 / CASE WHEN ${Object.values(LOGGING_CONTROLS).map(sql => `coalesce((${sql}),false)`).join(' AND ')} THEN 1 ELSE 0 END;`;

export function parseLogging(raw) {
    let data; try { data = JSON.parse(raw); } catch { fail('LOGGING_PREFLIGHT_UNVERIFIED'); }
    const keys = Object.keys(LOGGING_CONTROLS);
    if (!data || Array.isArray(data) || Object.keys(data).length !== keys.length || keys.some(key => typeof data[key] !== 'boolean')) fail('LOGGING_PREFLIGHT_UNVERIFIED');
    return { status: keys.every(key => data[key]) ? 'VERIFIED' : 'UNVERIFIED', controls: Object.fromEntries(keys.map(key => [key, data[key] ? 'SAFE' : 'UNVERIFIED'])) };
}
export function validateEnvironment(env, head, mode) {
    if (!['--readiness', '--self-check', '--apply'].includes(mode)) fail('MODE_INVALID');
    const sha = env.STAGING_RELEASE_SHA;
    if (!/^[a-f0-9]{40}$/.test(sha || '') || sha !== head || env.RENDER_GIT_COMMIT !== sha || env.RENDER_GIT_BRANCH !== BRANCH) fail('TARGET_INVALID');
    if (FORBIDDEN.some(key => env[key] !== undefined)) fail('CREDENTIAL_BOUNDARY_INVALID');
    if (mode === '--self-check') {
        if (env.STAGING_DB_ADMIN_PASSWORD !== undefined || env.STAGING_DB_RUNTIME_PASSWORD !== undefined) fail('SELF_CHECK_SECRETS_FORBIDDEN');
    } else {
        if (env.STAGING_DATABASE_PROJECT_REF !== PROJECT_REF) fail('TARGET_INVALID');
        if (typeof env.STAGING_DB_ADMIN_PASSWORD !== 'string' || !env.STAGING_DB_ADMIN_PASSWORD.length
            || env.STAGING_DB_ADMIN_PASSWORD.length > 1024 || /[\0\r\n]/.test(env.STAGING_DB_ADMIN_PASSWORD)) fail('CREDENTIAL_INVALID');
        if (mode === '--readiness' && env.STAGING_DB_RUNTIME_PASSWORD !== undefined) fail('READINESS_RUNTIME_SECRET_FORBIDDEN');
        if (mode === '--apply') {
            if (env.STAGING_BOOTSTRAP_APPLY_APPROVED !== 'true' || env.STAGING_BACKUP_VERIFIED_SHA !== sha) fail('BACKUP_GATE_REQUIRED');
            validatePassword(env.STAGING_DB_RUNTIME_PASSWORD);
            if (env.STAGING_DB_RUNTIME_PASSWORD === env.STAGING_DB_ADMIN_PASSWORD) fail('CREDENTIAL_REUSE');
        }
    }
    return sha;
}
export function validatePassword(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(value)) fail('RUNTIME_CREDENTIAL_INVALID');
}
export function runNative(executable, args, { env = BASE_ENV, cwd = ROOT, input, timeout = 30000, maxBuffer = 65536, allowed = [0], run = spawnSync, code = 'NATIVE_OPERATION_FAILED' } = {}) {
    let result;
    try { result = run(executable, args, { env: { ...env }, cwd, input, encoding: 'utf8', timeout, maxBuffer, detached: true,
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], killSignal: 'SIGKILL' }); } catch { fail(code); }
    if (!result || result.error || result.signal || !allowed.includes(result.status) || typeof result.stdout !== 'string'
        || typeof result.stderr !== 'string' || result.stdout.length + result.stderr.length > maxBuffer) fail(code);
    return { status: result.status, output: result.stdout.trim(),
        sqlState: ['23505', '23514', '42501'].find(state => new RegExp(`(?:ERROR|FATAL):\\s+${state}(?:\\s|$)`).test(result.stderr)) || 'UNKNOWN',
        authRejected: result.status !== 0 && /FATAL:\s+password authentication failed for user/.test(result.stderr) }; // NEVER return stderr.
}

// Prisma may spawn a schema engine. Own its whole POSIX process group, not just
// the CLI PID; never retry ambiguous migration outcomes. No shell is involved.
export async function runProcessGroup(executable, argv, { env = BASE_ENV, cwd = ROOT, timeout = 180000, maxBuffer = 2 * 1024 * 1024,
    allowed = [0], spawnChild = spawn, kill = process.kill.bind(process), platform = process.platform, code = 'PRISMA_OPERATION_FAILED' } = {}) {
    if (platform !== 'linux') fail('LINUX_PROCESS_GROUP_REQUIRED');
    return await new Promise((resolveResult, reject) => {
        let child, timer, settled = false, closed = false, status, bytes = 0, stdout = '';
        const exists = () => { try { kill(-child.pid, 0); return true; } catch (e) { if (e?.code === 'ESRCH') return false; throw e; } };
        async function finish(reason) {
            if (settled) return; settled = true; clearTimeout(timer);
            let uncertain = false;
            try {
                if (Number.isSafeInteger(child?.pid) && child.pid > 1) {
                    if (reason || exists()) {
                        reason ||= 'PROCESS_DESCENDANTS_REMAINED';
                        try { kill(-child.pid, 'SIGKILL'); } catch (e) { if (e?.code !== 'ESRCH') uncertain = true; }
                        const deadline = Date.now() + 2000;
                        while ((!closed || exists()) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
                        if (!closed || exists()) uncertain = true;
                    }
                } else if (!closed) uncertain = true;
            } catch { uncertain = true; }
            if (uncertain) return reject(new SafeError('PROCESS_GROUP_STOP_UNVERIFIED'));
            if (reason) return reject(new SafeError(reason));
            resolveResult({ status, output: stdout.trim() });
        }
        try { child = spawnChild(executable, argv, { cwd, env: { ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch { return reject(new SafeError(code)); }
        child.once('error', () => {
            if (!child.pid) { closed = true; void finish(code); }
            else void finish(code);
        });
        child.once('close', exitCode => { closed = true; status = exitCode; void finish(allowed.includes(exitCode) ? null : code); });
        for (const [stream, keep] of [[child.stdout, true], [child.stderr, false]]) stream.on('data', chunk => {
            bytes += chunk.length; if (bytes > maxBuffer) { void finish('PROCESS_OUTPUT_LIMIT'); return; }
            if (keep && !settled) stdout += chunk.toString();
        });
        timer = setTimeout(() => { void finish('PROCESS_TIMEOUT_OUTCOME_UNCERTAIN'); }, timeout);
    });
}
const args = ['-X', '-w', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'];
function sql(bin, env, input, options = {}) { return runNative(join(bin, 'psql'), args, { env, input, ...options }).output; }
function command(bin, env, commands, options = {}) { return runNative(join(bin, 'psql'), [...args, ...commands.flatMap(value => ['-c', value])], { env, ...options }); }

export function databaseEnvironment(password, { runtime = false, readOnly = false } = {}) {
    const env = remoteEnvironment(password);
    env.PGUSER = `${runtime ? ROLE : 'postgres'}.${PROJECT_REF}`;
    env.PGAPPNAME = 'otp-staging-bootstrap';
    env.PGOPTIONS = `-c statement_timeout=20000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=25000${readOnly ? ' -c default_transaction_read_only=on' : ''}`;
    return env;
}
export function connectionUrl(env) {
    // Only caller-constructed fixed environments, never an inherited DATABASE_URL.
    if (env.PGHOST !== 'aws-0-ap-southeast-1.pooler.supabase.com' || env.PGPORT !== '5432'
        || ![`postgres.${PROJECT_REF}`, `${ROLE}.${PROJECT_REF}`].includes(env.PGUSER) || env.PGSSLMODE !== 'verify-full'
        || env.PGSSLROOTCERT !== STAGING_CA_PATH) fail('URL_TARGET_INVALID');
    const url = new URL('postgresql://aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres');
    url.username = env.PGUSER; url.password = env.PGPASSWORD;
    url.searchParams.set('sslmode', 'require'); url.searchParams.set('sslaccept', 'strict');
    url.searchParams.set('sslcert', STAGING_CA_PATH); url.searchParams.set('connection_limit', '2');
    return url.toString();
}
export const ROLE_SQL = `SELECT json_build_object('role',current_user,'session_role',session_user,'database',current_database(),
 'row_security',current_setting('row_security')='on',
 'tls',coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false),
 'version',current_setting('server_version_num')::int,'safe',NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolinherit AND r.rolcanlogin,
 'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=r.oid),
 'owned',(SELECT count(*) FROM pg_class WHERE relowner=r.oid)+(SELECT count(*) FROM pg_namespace WHERE nspowner=r.oid),
 'schema_create',has_schema_privilege(current_user,'public','CREATE')) FROM pg_roles r WHERE rolname=current_user;`;
export function checkRuntime(raw, remote = true) {
    let d; try { d = JSON.parse(raw); } catch { fail('RUNTIME_IDENTITY_INVALID'); }
    if (!d || Object.keys(d).length !== 10 || d.role !== ROLE || d.session_role !== ROLE || d.row_security !== true || d.database !== 'postgres' || d.tls !== remote
        || !Number.isInteger(d.version) || d.version < 170000 || d.version >= 180000 || d.safe !== true
        || d.memberships !== 0 || d.owned !== 0 || d.schema_create !== false) fail('RUNTIME_IDENTITY_INVALID');
}

export function passwordCommands() { return [LOGGING_ASSERT_SQL, `\\password ${ROLE}`]; }
export function setPassword(bin, env, password, options = {}) {
    validatePassword(password);
    const input = Buffer.from(`${password}\n${password}\n`, 'ascii');
    try { command(bin, env, passwordCommands(), { ...options, input, code: 'PASSWORD_APPLICATION_FAILED' }); }
    finally { input.fill(0); }
}
export function grantSql() {
    return `BEGIN; GRANT CONNECT ON DATABASE postgres TO "${ROLE}"; GRANT USAGE ON SCHEMA public TO "${ROLE}";\n`
        + Object.entries(ACL).map(([table, permissions]) => `GRANT ${permissions.join(',')} ON TABLE public."${table}" TO "${ROLE}";`).join('\n') + '\nCOMMIT;';
}
export function aclCheckSql() {
    const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const clauses = Object.entries({ ...ACL, OTPCode: [] }).flatMap(([table, expected]) => privileges.flatMap(privilege => [
        `has_table_privilege(current_user,'public."${table}"','${privilege}')=${expected.includes(privilege) ? 'true' : 'false'}`,
        `NOT has_table_privilege(current_user,'public."${table}"','${privilege} WITH GRANT OPTION')`,
        ...(['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'].includes(privilege) ? [
            ...(expected.includes(privilege) ? [] : [`NOT has_any_column_privilege(current_user,'public."${table}"','${privilege}')`]),
            `NOT has_any_column_privilege(current_user,'public."${table}"','${privilege} WITH GRANT OPTION')`] : []),
    ]));
    return `SELECT ${clauses.join(' AND ')};`;
}
export const RLS_SQL = `SELECT (SELECT count(*)=2 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('otp_challenges','staging_otp_email_reservation') AND c.relrowsecurity AND c.relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user))
 AND NOT EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN (VALUES('otp_challenges'),('staging_otp_email_reservation')) t(name) WHERE r.rolname IN ('anon','authenticated') AND (${['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'].map(p => `has_table_privilege(r.oid,format('public.%I',t.name),'${p}')`).concat(['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'].map(p => `has_any_column_privilege(r.oid,format('public.%I',t.name),'${p}')`)).join(' OR ')}));`;
export const RUNTIME_PROBE_SQL = `BEGIN;
 INSERT INTO otp_challenges(id,destination_hash,purpose,subject,code_hash,delivery_status,expires_at,cooldown_until,updated_at)
 VALUES ('si-bootstrap-rollback-only',repeat('a',64),'REGISTRATION','si-bootstrap-rollback-only','synthetic-hash-only','PENDING',CURRENT_TIMESTAMP+interval '5 minutes',CURRENT_TIMESTAMP+interval '30 seconds',CURRENT_TIMESTAMP);
 UPDATE otp_challenges SET attempts=1 WHERE id='si-bootstrap-rollback-only';
 SELECT count(*)=1 AND bool_and(attempts=1) FROM otp_challenges WHERE id='si-bootstrap-rollback-only';
 DELETE FROM otp_challenges WHERE id='si-bootstrap-rollback-only';
 INSERT INTO staging_otp_email_reservation(slot) VALUES (1);
 SELECT count(*)=1 FROM staging_otp_email_reservation;
 ROLLBACK;`;
export function verifyRuntime(bin, env, { remote = true } = {}) {
    checkRuntime(sql(bin, env, ROLE_SQL), remote);
    if (sql(bin, env, aclCheckSql()) !== 't' || sql(bin, env, RLS_SQL) !== 't') fail('RUNTIME_ACL_INVALID');
    const untouched = "SELECT (SELECT count(*) FROM staging_otp_email_reservation)=0 AND NOT EXISTS(SELECT 1 FROM otp_challenges WHERE id='si-bootstrap-rollback-only');";
    if (sql(bin, env, untouched) !== 't') fail('FIXTURE_NOT_EMPTY');
    if (sql(bin, env, RUNTIME_PROBE_SQL).replace(/\r/g, '') !== 't\nt') fail('RUNTIME_PROBE_FAILED');
    // Deliberate invalid row, rolled back by the failed connection. Never release a slot.
    const denied = command(bin, env, ['BEGIN; INSERT INTO staging_otp_email_reservation(slot) VALUES (2); ROLLBACK;'], { allowed: [0, 1, 3] });
    if (denied.status === 0 || !['42501', '23514'].includes(denied.sqlState) || sql(bin, env, untouched) !== 't') fail('SINGLETON_PROBE_FAILED');
    const duplicate = command(bin, env, ['BEGIN; INSERT INTO staging_otp_email_reservation(slot) VALUES (1); INSERT INTO staging_otp_email_reservation(slot) VALUES (1); ROLLBACK;'], { allowed: [0, 1, 3] });
    if (duplicate.status === 0 || duplicate.sqlState !== '23505' || sql(bin, env, untouched) !== 't') fail('SINGLETON_DUPLICATE_PROBE_FAILED');
    if (sql(bin, env, 'SELECT count(*)=0 FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;') !== 't') fail('MIGRATION_STATE_INVALID');
}

// Two independent connections. Parent drives bounded events, not timing assumptions.
export async function checkAdvisoryLock(bin, env, { spawnChild = spawn, kill = process.kill.bind(process),
    query = input => sql(bin, env, input), platform = process.platform, timeoutMs = 10000 } = {}) {
    if (platform !== 'linux') fail('LINUX_PROCESS_GROUP_REQUIRED');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) fail('LOCK_TIMEOUT_INVALID');
    let child; let output = ''; let closed = false, ioFailed = false, bytes = 0, closeCode;
    let closePromise;
    const groupExists = () => { try { kill(-child.pid, 0); return true; } catch (e) { if (e?.code === 'ESRCH') return false; throw e; } };
    try {
        child = spawnChild(join(bin, 'psql'), args, { env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        closePromise = new Promise(resolveClosed => {
            child.once('error', () => { ioFailed = true; });
            child.once('close', code => { closed = true; closeCode = code; resolveClosed(); });
        });
        // EPIPE is an ordinary bounded failure, never an uncaught stream error.
        for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => { ioFailed = true; });
        child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) ioFailed = true; });
        child.stdout.on('data', chunk => {
            bytes += chunk.length; if (bytes > 65536 || output.length + chunk.length > 1024) { ioFailed = true; return; }
            output += chunk.toString();
        });
        child.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('si-bootstrap-isolated-probe',0)); SELECT 'LOCKED';\n");
        const start = Date.now();
        while (!output.includes('LOCKED')) {
            if (closed || ioFailed || Date.now() - start > timeoutMs) fail('LOCK_PROBE_FAILED');
            await new Promise(r => setTimeout(r, 25));
        }
        const probe = "SELECT pg_try_advisory_xact_lock(hashtextextended('si-bootstrap-isolated-probe',0));";
        if (ioFailed || query(probe) !== 'f') fail('LOCK_NOT_EXCLUSIVE');
        child.stdin.end('ROLLBACK;\n');
        let timeout;
        try { await Promise.race([closePromise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new SafeError('LOCK_PROBE_FAILED')), timeoutMs); })]); }
        finally { clearTimeout(timeout); }
        if (ioFailed || closeCode !== 0 || query(probe) !== 't') fail('LOCK_NOT_RELEASED');
    } finally {
        if (child && Number.isSafeInteger(child.pid) && child.pid > 1) {
            let uncertain = false;
            try {
                if (!closed || groupExists()) {
                    child.stdin.destroy();
                    try { kill(-child.pid, 'SIGKILL'); } catch (e) { if (e?.code !== 'ESRCH') uncertain = true; }
                    const deadline = Date.now() + 2000;
                    while ((!closed || groupExists()) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
                    if (!closed || groupExists()) uncertain = true;
                }
            } catch { uncertain = true; }
            if (uncertain) fail('PROCESS_GROUP_STOP_UNVERIFIED');
        } else if (child && !closed) fail('PROCESS_GROUP_STOP_UNVERIFIED');
    }
}

export function copyMigrationTree(target, baseline = false) {
    const source = join(ROOT, 'server/prisma/migrations');
    mkdirSync(target, { recursive: true, mode: 0o700 });
    copyFileSync(join(source, 'migration_lock.toml'), join(target, 'migration_lock.toml'));
    const names = readdirSync(source).filter(name => /^\d{14}_[a-z0-9_]+$/.test(name)).sort();
    if (OTP_MIGRATIONS.some(name => !names.includes(name))) fail('MIGRATION_MANIFEST_INVALID');
    for (const name of names.filter(name => !baseline || !OTP_MIGRATIONS.includes(name))) {
        if (lstatSync(join(source, name)).isSymbolicLink()) fail('MIGRATION_MANIFEST_INVALID');
        const bytes = readFileSync(join(source, name, 'migration.sql'));
        const path = join(target, name); mkdirSync(path, { recursive: true, mode: 0o700 });
        writeFileSync(join(path, 'migration.sql'), bytes, { mode: 0o600 });
    }
    return names;
}
async function preparePrisma(workspace, { execute = runProcessGroup } = {}) {
    const path = join(workspace.path, 'prisma-tool'); mkdirSync(path, { mode: 0o700 });
    for (const name of ['package.json', 'package-lock.json', 'prisma.config.ts']) copyFileSync(join(ROOT, 'server', name), join(path, name));
    mkdirSync(join(path, 'prisma'), { mode: 0o700 });
    copyFileSync(join(ROOT, 'server/prisma/schema.prisma'), join(path, 'prisma/schema.prisma'));
    const names = copyMigrationTree(join(path, 'prisma/migrations'), true);
    const cli = resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
    const env = { ...BASE_ENV, PATH: `${dirname(process.execPath)}:${BASE_ENV.PATH}`, HOME: workspace.path,
        NPM_CONFIG_USERCONFIG: join(workspace.path, 'npm-user.conf'), NPM_CONFIG_GLOBALCONFIG: join(workspace.path, 'npm-global.conf'),
        NPM_CONFIG_CACHE: join(workspace.path, 'npm-cache'), NPM_CONFIG_FETCH_RETRIES: '0' };
    await execute(process.execPath, [cli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], { cwd: path, env, timeout: 180000, maxBuffer: 4 * 1024 * 1024, code: 'PRISMA_INSTALL_FAILED' });
    return { path, names };
}
export async function prismaCommand(prepared, url, verb, { execute = runProcessGroup } = {}) {
    if (!['validate', 'migrate status', 'migrate deploy'].includes(verb)) fail('PRISMA_COMMAND_INVALID');
    const result = await execute(process.execPath, [join(prepared.path, 'node_modules/prisma/build/index.js'), ...verb.split(' ')], {
        env: { ...BASE_ENV, PATH: `${dirname(process.execPath)}:${BASE_ENV.PATH}`, HOME: dirname(prepared.path), DATABASE_URL: url, DIRECT_URL: url,
            CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' }, cwd: prepared.path, timeout: 180000,
        maxBuffer: 2 * 1024 * 1024, allowed: verb === 'migrate status' ? [0, 1] : [0], code: 'PRISMA_OPERATION_FAILED' });
    if (result.status !== 0 && !/not yet been applied|not yet managed by Prisma Migrate/.test(result.output)) fail('MIGRATION_STATUS_FAILED');
    return result.status;
}
const LEGACY_INSERT = `INSERT INTO users(id,name,handle,email,birthday,created_at,updated_at) VALUES('si-local-legacy-user','Synthetic fixture','si_local_legacy_user','local-user@example.test',DATE '1990-01-01',TIMESTAMP '2026-01-01',TIMESTAMP '2026-01-01');
INSERT INTO "OTPCode"(id,identifier,code,"expiresAt") VALUES('si-local-legacy-otp','synthetic@example.test','LOCAL_ONLY_UNUSED',TIMESTAMP '2030-01-01');
INSERT INTO "PendingRegistration"(id,email,"fullName",dob,handle,password,"otpCode","otpExpiresAt","updatedAt") VALUES('si-local-legacy-pending','synthetic@example.test','Synthetic fixture',DATE '1990-01-01','synthetic_fixture','SYNTHETIC_HASH','LOCAL_ONLY_UNUSED',TIMESTAMP '2030-01-01',TIMESTAMP '2026-01-01');`;
const LEGACY_CHECK = `SELECT row_to_json(t)::text FROM (SELECT * FROM users WHERE id='si-local-legacy-user') t;
SELECT row_to_json(t)::text FROM (SELECT id,identifier,code,"expiresAt","createdAt" FROM "OTPCode" WHERE id='si-local-legacy-otp') t;
SELECT row_to_json(t)::text FROM (SELECT id,email,"fullName",dob,handle,password,"otpCode","otpExpiresAt","updatedAt","createdAt","currentStep" FROM "PendingRegistration" WHERE id='si-local-legacy-pending') t;`;
export function migrationChecks(bin, env, names, { query = input => sql(bin, env, input), readMigration = name => readFileSync(join(ROOT, 'server/prisma/migrations', name, 'migration.sql')) } = {}) {
    if (!Array.isArray(names) || !names.length || names.some(name => !/^\d{14}_[a-z0-9_]+$/.test(name)) || new Set(names).size !== names.length) fail('MIGRATION_MANIFEST_INVALID');
    const manifest = names.map(name => ({ name, checksum: hash(readMigration(name)) }));
    let rows;
    try { rows = JSON.parse(query("SELECT coalesce(json_agg(json_build_object('name',migration_name,'checksum',checksum) ORDER BY migration_name),'[]'::json) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;")); }
    catch { fail('MIGRATION_MANIFEST_MISMATCH'); }
    if (JSON.stringify(rows) !== JSON.stringify(manifest)
        || query(`SELECT count(*)=${names.length} AND bool_and(finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM _prisma_migrations;`) !== 't') fail('MIGRATION_MANIFEST_MISMATCH');
    if (query("SELECT count(*)=1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PendingRegistration' AND column_name='registration_secret_hash' AND is_nullable='YES';") !== 't') fail('ADDITIVE_COLUMN_INVALID');
    const expected = { otp_challenges: { constraints: 14, indexes: 5 }, staging_otp_email_reservation: { constraints: 2, indexes: 1 } };
    for (const [name, count] of Object.entries(expected)) {
        if (query(`SELECT (SELECT count(*) FROM pg_constraint WHERE conrelid='public.${name}'::regclass)=${count.constraints} AND (SELECT count(*) FROM pg_index WHERE indrelid='public.${name}'::regclass)=${count.indexes};`) !== 't') fail('MIGRATION_OBJECTS_INVALID');
    }
}
async function localRehearsal(workspace, tools, local) {
    const env = { ...local.env };
    const readiness = parseLogging(sql(tools.bin, env, LOGGING_SQL));
    if (readiness.status !== 'VERIFIED') fail('LOCAL_LOGGING_UNVERIFIED');
    const password = randomBytes(48).toString('base64url');
    sql(tools.bin, env, `CREATE ROLE "${ROLE}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`);
    setPassword(tools.bin, env, password);
    if (sql(tools.bin, env, `SELECT left(rolpassword,14)='SCRAM-SHA-256$' FROM pg_authid WHERE rolname='${ROLE}';`) !== 't') fail('LOCAL_SCRAM_INVALID');
    // Only this owned, synthetic cluster. Require actual SCRAM rather than trusting a socket login.
    writeFileSync(join(workspace.path, 'data/pg_hba.conf'), `local all ${ROLE} scram-sha-256\nlocal all all trust\nhost all all 127.0.0.1/32 reject\nhost all all ::1/128 reject\n`, { mode: 0o600 });
    runNative(join(tools.bin, 'pg_ctl'), ['-D', join(workspace.path, 'data'), 'reload']);
    const runtime = { ...env, PGUSER: ROLE, PGPASSWORD: password };
    // Reload is asynchronous; retry only the non-mutating wrong-password probe until SCRAM is effective.
    let rejected = false;
    for (let i = 0; i < 20 && !rejected; i++) {
        const wrong = command(tools.bin, { ...runtime, PGPASSWORD: randomBytes(48).toString('base64url') }, ['SELECT 1;'], { allowed: [0, 1, 2, 3] });
        rejected = wrong.authRejected;
        if (wrong.status !== 0 && !rejected) fail('LOCAL_AUTH_REJECTION_UNVERIFIED');
        if (!rejected) await new Promise(r => setTimeout(r, 50));
    }
    if (!rejected || sql(tools.bin, runtime, 'SELECT current_user;') !== ROLE) fail('LOCAL_SCRAM_LOGIN_FAILED');
    const prepared = await preparePrisma(workspace);
    const localUrl = new URL('postgresql://postgres@localhost/postgres'); localUrl.searchParams.set('host', env.PGHOST); localUrl.searchParams.set('sslmode', 'disable');
    await prismaCommand(prepared, localUrl.toString(), 'validate');
    await prismaCommand(prepared, localUrl.toString(), 'migrate deploy');
    sql(tools.bin, env, LEGACY_INSERT);
    const before = hash(sql(tools.bin, env, LEGACY_CHECK));
    copyMigrationTree(join(prepared.path, 'prisma/migrations'));
    await prismaCommand(prepared, localUrl.toString(), 'migrate status');
    await prismaCommand(prepared, localUrl.toString(), 'migrate deploy');
    await prismaCommand(prepared, localUrl.toString(), 'migrate deploy');
    if (await prismaCommand(prepared, localUrl.toString(), 'migrate status') !== 0) fail('MIGRATION_STATUS_FAILED');
    if (before !== hash(sql(tools.bin, env, LEGACY_CHECK))) fail('LEGACY_ROWS_CHANGED');
    migrationChecks(tools.bin, env, prepared.names);
    sql(tools.bin, env, grantSql()); verifyRuntime(tools.bin, runtime, { remote: false });
    await checkAdvisoryLock(tools.bin, runtime);
    const log = readFileSync(join(workspace.path, 'postgres.log'), 'utf8');
    if (log.includes(password) || /SCRAM-SHA-256\$\d+:/.test(log)) fail('LOCAL_CREDENTIAL_LOGGED');
    return prepared;
}

function publish(mode) {
    const path = join(ROOT, 'staging-bootstrap-public');
    if (!existsSync(path)) mkdirSync(path);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || readdirSync(path).some(name => name !== 'index.html')) fail('PUBLIC_PATH_INVALID');
    const target = join(path, 'index.html');
    const bytes = '<!doctype html><meta name="robots" content="noindex,nofollow"><title>Staging prerequisite</title><p>Prerequisite check completed. This is not the application.</p>\n';
    if (existsSync(target)) {
        if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink() || readFileSync(target, 'utf8') !== bytes) fail('PUBLIC_PATH_INVALID');
    } else writeFileSync(target, bytes, { flag: 'wx', mode: 0o644 });
}
export async function main({ mode = process.argv[2], env = process.env, log = console.log, platform = process.platform,
    getUid = process.getuid?.bind(process), run = runNative, workspaceFactory = makeWorkspace, prepare = prepareToolchain,
    start = startLocalCluster, cleanup = cleanupWorkspace, rehearse = localRehearsal, publishResult = publish } = {}) {
    let workspace, local, unsafeCleanup = false, completion; let result = 1;
    try {
        if (platform !== 'linux' || !Number.isSafeInteger(getUid?.()) || getUid() <= 0) fail('LINUX_NONROOT_REQUIRED');
        const head = run('/usr/bin/git', ['rev-parse', '--verify', 'HEAD']).output;
        const sha = validateEnvironment(env, head, mode);
        run('/usr/bin/git', ['diff', '--exit-code', 'HEAD', '--', 'server']);
        if (mode !== '--self-check' && !validateStagingCa(readFileSync(STAGING_CA_PATH))) fail('CA_INVALID');
        workspace = workspaceFactory(); const tools = importedPrerequisite('TOOLCHAIN', () => prepare(workspace));
        if (mode === '--readiness') {
            const remote = databaseEnvironment(env.STAGING_DB_ADMIN_PASSWORD, { readOnly: true });
            const snapshot = sql(tools.bin, remote, SNAPSHOT_SQL);
            importedPrerequisite('REMOTE_SNAPSHOT', () => parseSnapshot(snapshot));
            const logging = parseLogging(sql(tools.bin, remote, LOGGING_SQL));
            log(`STAGING_BOOTSTRAP_READINESS ${JSON.stringify({ sha, project_ref: PROJECT_REF, logging, remote_writes: 0 })}`);
            if (logging.status !== 'VERIFIED') fail('LOGGING_PREFLIGHT_UNVERIFIED');
        } else {
            local = start(workspace, tools);
            const prepared = await rehearse(workspace, tools, local);
            if (mode === '--apply') {
                const admin = databaseEnvironment(env.STAGING_DB_ADMIN_PASSWORD);
                const snapshot = sql(tools.bin, { ...admin, PGOPTIONS: `${admin.PGOPTIONS} -c default_transaction_read_only=on` }, SNAPSHOT_SQL);
                importedPrerequisite('REMOTE_SNAPSHOT', () => parseSnapshot(snapshot));
                const logging = parseLogging(sql(tools.bin, admin, LOGGING_SQL));
                if (logging.status !== 'VERIFIED') fail('LOGGING_PREFLIGHT_UNVERIFIED');
                // Role must preexist, be unprivileged/unowned, and have no memberships.
                const roleGuard = `SELECT count(*)=1 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid) AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)) FROM pg_roles r WHERE rolname='${ROLE}';`;
                if (sql(tools.bin, admin, roleGuard) !== 't') fail('BOOTSTRAP_ROLE_INVALID');
                setPassword(tools.bin, admin, env.STAGING_DB_RUNTIME_PASSWORD);
                const runtime = databaseEnvironment(env.STAGING_DB_RUNTIME_PASSWORD, { runtime: true });
                const wrong = command(tools.bin, { ...runtime, PGPASSWORD: randomBytes(48).toString('base64url') }, ['SELECT 1;'], { allowed: [0, 1, 2, 3] });
                if (!wrong.authRejected) fail('RUNTIME_AUTH_REJECTION_UNVERIFIED');
                checkRuntime(sql(tools.bin, runtime, ROLE_SQL));
                const url = connectionUrl(admin);
                await prismaCommand(prepared, url, 'validate'); await prismaCommand(prepared, url, 'migrate status');
                await prismaCommand(prepared, url, 'migrate deploy'); await prismaCommand(prepared, url, 'migrate deploy');
                if (await prismaCommand(prepared, url, 'migrate status') !== 0) fail('MIGRATION_STATUS_FAILED');
                migrationChecks(tools.bin, admin, prepared.names);
                sql(tools.bin, admin, grantSql()); verifyRuntime(tools.bin, runtime);
                await checkAdvisoryLock(tools.bin, runtime);
            }
            completion = { sha, mode: mode === '--apply' ? 'STAGING_APPLY' : 'LOCAL_SELF_CHECK', pg_major: 17,
                migrations_twice: true, local_synthetic_legacy_rows_unchanged: true, native_scram: true, runtime_acl: true, singleton_unspent: true, advisory_two_connections: true,
                previous_server_execution: 'NOT_PERFORMED', real_email_attempts: 0 };
        }
        if (local) { local.stop(); local = undefined; }
        cleanup(workspace); workspace = undefined; publishResult(mode);
        if (completion) log(`STAGING_BOOTSTRAP_CHECKS_OK ${JSON.stringify(completion)}`);
        result = 0;
    } catch (error) {
        // The imported cluster starter may itself fail to prove a timed-out
        // server stopped. Preserve its owned private scratch in that case.
        unsafeCleanup = ['LOCAL_STOP_FAILED', 'PROCESS_GROUP_STOP_UNVERIFIED'].includes(error?.code);
        log(`STAGING_BOOTSTRAP_FAILED ${error instanceof SafeError ? error.code : unsafeCleanup ? error.code : 'INTERNAL_FAILURE'}`);
    }
    finally {
        if (local) { try { local.stop(); local = undefined; } catch { log('STAGING_BOOTSTRAP_FAILED LOCAL_STOP_FAILED'); result = 1; } }
        if (workspace && !local && !unsafeCleanup) { try { cleanup(workspace); } catch { log('STAGING_BOOTSTRAP_FAILED CLEANUP_FAILED'); result = 1; } }
    }
    return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 3) { console.log('STAGING_BOOTSTRAP_FAILED MODE_INVALID'); process.exitCode = 1; }
    else process.exitCode = await main();
}
