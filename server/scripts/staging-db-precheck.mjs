import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECT_REF = 'mnfiixtgnlzmduunfryt';
export const BRANCH = 'codex/otp-resend-production';
export const PUBLIC_STATUS = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Staging precheck</title><p>Staging precheck complete.</p></html>\n';
const FORBIDDEN_ENV = ['DATABASE_URL', 'DIRECT_URL', 'RESEND_API_KEY', 'JWT_SECRET',
    'OTP_HASH_SECRET', 'STAGING_OTP_ALLOWED_EMAILS', 'CLIENT_URL', 'STAGING_TRUST_PROXY_HOPS'];
const BASE_ENV = Object.freeze({ PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' });

// Constant SQL only. Neither connection credentials nor user input enter SQL.
export const PRECHECK_SQL = `BEGIN READ ONLY;
SELECT json_build_object(
  'server_version_num', current_setting('server_version_num')::integer,
  'database', current_database(),
  'role', current_user,
  'superuser', r.rolsuper,
  'bypass_rls', r.rolbypassrls,
  'create_database', r.rolcreatedb,
  'create_role', r.rolcreaterole,
  'public_table_count', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')),
  'tls', coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false),
  'read_only', current_setting('transaction_read_only') = 'on'
)
FROM pg_roles r WHERE r.rolname = current_user;
COMMIT;
`;

class PrecheckError extends Error {
    constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new PrecheckError(code); };

function invoke(run, command, args, env, input, code) {
    let result;
    try {
        result = run(command, args, {
            cwd: ROOT, env, input, encoding: 'utf8', timeout: 20000,
            maxBuffer: 65536, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch { return fail(code); }
    // Never emit a subprocess error or stderr: providers can echo credentials.
    if (!result || result.error || result.signal || result.status !== 0
        || typeof result.stdout !== 'string' || result.stdout.length > 65536) fail(code);
    return result.stdout.trim();
}

function clientVersion(run, executable, label) {
    const output = invoke(run, executable, ['--version'], { ...BASE_ENV }, undefined, 'CLIENT_VERSION_FAILED');
    const match = output.length <= 256 && output.match(new RegExp(`^${label} \\(PostgreSQL\\) ([0-9]{1,2}\\.[0-9]{1,3}(?:\\.[0-9]{1,3})?)(?: [^\\r\\n]*)?$`));
    if (!match) fail('CLIENT_VERSION_INVALID');
    return match[1];
}

function parseEvidence(output) {
    let data;
    try { data = JSON.parse(output); } catch { return fail('DATABASE_EVIDENCE_INVALID'); }
    const keys = ['server_version_num', 'database', 'role', 'superuser', 'bypass_rls',
        'create_database', 'create_role', 'public_table_count', 'tls', 'read_only'];
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || Object.keys(data).length !== keys.length || keys.some(key => !Object.hasOwn(data, key))
        || data.database !== 'postgres' || data.role !== 'postgres'
        || !Number.isSafeInteger(data.server_version_num) || data.server_version_num < 100000 || data.server_version_num > 999999
        || !Number.isSafeInteger(data.public_table_count) || data.public_table_count < 0 || data.public_table_count > 1000000000
        || ['superuser', 'bypass_rls', 'create_database', 'create_role'].some(key => typeof data[key] !== 'boolean')
        || data.tls !== true || data.read_only !== true) fail('DATABASE_EVIDENCE_INVALID');
    return data;
}

// The root argument is only for explicit temporary test fixtures. The CLI never
// accepts a filesystem path from environment variables or command-line input.
export function publishStatus(content, { root = ROOT } = {}) {
    if (content !== PUBLIC_STATUS) fail('PUBLISH_CONTENT_INVALID');
    const directory = join(root, 'staging-precheck-public');
    try { mkdirSync(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
        || readdirSync(directory).some(name => name !== 'index.html')) fail('PUBLISH_PATH_INVALID');
    const target = join(directory, 'index.html');
    try { writeFileSync(target, content, { flag: 'wx', mode: 0o644 }); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = lstatSync(target);
        if (!existing.isFile() || existing.isSymbolicLink() || readFileSync(target, 'utf8') !== content) fail('PUBLISH_PATH_INVALID');
    }
}

// Dependencies are injectable so tests never need network access or real secrets.
export function runPrecheck({ env = process.env, run = spawnSync, publish = publishStatus, log = console.log } = {}) {
    try {
        const sha = env.STAGING_RELEASE_SHA;
        if (!/^[a-f0-9]{40}$/.test(sha || '') || env.RENDER_GIT_COMMIT !== sha
            || env.RENDER_GIT_BRANCH !== BRANCH
            || (env.STAGING_DATABASE_PROJECT_REF !== undefined && env.STAGING_DATABASE_PROJECT_REF !== PROJECT_REF)) fail('TARGET_INVALID');
        if (FORBIDDEN_ENV.some(key => env[key] !== undefined)) fail('RUNTIME_ENV_FORBIDDEN');
        const password = env.STAGING_DB_ADMIN_PASSWORD;
        if (typeof password !== 'string' || password.length === 0 || password.length > 1024 || /[\u0000\r\n]/.test(password)) fail('ADMIN_CREDENTIAL_MISSING_OR_INVALID');
        const head = invoke(run, '/usr/bin/git', ['rev-parse', '--verify', 'HEAD'], { ...BASE_ENV }, undefined, 'GIT_IDENTITY_FAILED');
        if (head !== sha) fail('GIT_IDENTITY_MISMATCH');
        const psqlVersion = clientVersion(run, '/usr/bin/psql', 'psql');
        const dumpVersion = clientVersion(run, '/usr/bin/pg_dump', 'pg_dump');
        const databaseEnv = {
            ...BASE_ENV,
            PGHOST: 'aws-0-ap-southeast-1.pooler.supabase.com', PGPORT: '5432',
            PGDATABASE: 'postgres', PGUSER: `postgres.${PROJECT_REF}`, PGPASSWORD: password,
            PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/etc/ssl/certs/ca-certificates.crt',
            PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'otp-staging-precheck', PGCLIENTENCODING: 'UTF8',
            PSQL_HISTORY: '/dev/null',
            PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000',
        };
        const raw = invoke(run, '/usr/bin/psql', ['-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], databaseEnv, PRECHECK_SQL, 'DATABASE_PRECHECK_FAILED');
        const evidence = parseEvidence(raw);
        publish(PUBLIC_STATUS);
        log(`STAGING_DB_PRECHECK_OK ${JSON.stringify({
            project_ref: PROJECT_REF, sha, psql_version: psqlVersion, pg_dump_version: dumpVersion,
            pg_dump_compatible: Number(dumpVersion.split('.')[0]) >= Math.floor(evidence.server_version_num / 10000),
            ...evidence,
        })}`);
        return 0;
    } catch (error) {
        log(`STAGING_DB_PRECHECK_FAILED ${error instanceof PrecheckError ? error.code : 'INTERNAL_FAILURE'}`);
        return 1;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runPrecheck();
