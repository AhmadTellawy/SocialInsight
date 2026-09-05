import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { accessSync, constants, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECT_REF = 'mnfiixtgnlzmduunfryt';
export const BRANCH = 'codex/otp-resend-production';
export const STAGING_CA_PATH = join(ROOT, 'server/certs/supabase-staging-ca.crt');
// Public platform CA downloaded from the approved Staging dashboard link:
// https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
// Pin DER fingerprint, not PEM line endings. No private key is included.
export const STAGING_CA_FINGERPRINT = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';
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
    constructor(code, reason) { super(code); this.code = code; this.reason = reason; }
}
const fail = (code, reason) => { throw new PrecheckError(code, reason); };

export function validateStagingCa(pem, now = Date.now()) {
    try {
        if ((!Buffer.isBuffer(pem) && typeof pem !== 'string') || pem.length > 16384) return false;
        const text = pem.toString();
        if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/.test(text)) return false;
        const ca = new X509Certificate(text);
        return ca.fingerprint256 === STAGING_CA_FINGERPRINT && ca.ca === true
            && ca.subject === ca.issuer && ca.verify(ca.publicKey)
            && Number.isFinite(now) && now >= Date.parse(ca.validFrom) && now <= Date.parse(ca.validTo);
    } catch { return false; }
}

function isExecutable(path) {
    try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
}

function restoreToolAvailability(version, inspect, getUid) {
    // Version is already numeric and validated; no environment-supplied paths.
    const directory = `/usr/lib/postgresql/${Number(version.split('.')[0])}/bin`;
    const available = name => { try { return inspect(`${directory}/${name}`) === true; } catch { return false; } };
    let nonRoot = false;
    try { const uid = getUid?.(); nonRoot = Number.isSafeInteger(uid) && uid > 0; } catch { /* No UID detail is emitted. */ }
    return { initdb: available('initdb'), pg_ctl: available('pg_ctl'), postgres: available('postgres'), pg_restore: available('pg_restore'), non_root: nonRoot };
}

function databaseFailureReason(result) {
    // Classification only: never return matched text, error messages, hostnames,
    // SQL, usernames or credentials. Unexpected wording remains UNKNOWN.
    const stderr = typeof result?.stderr === 'string' ? result.stderr.slice(0, 65536) : '';
    if (/tenant or user not found|tenant[^\r\n]*(?:not found|does not exist)/i.test(stderr)) return 'TENANT_NOT_FOUND';
    if (/password authentication failed|authentication failed|no password supplied/i.test(stderr)) return 'AUTH_REJECTED';
    if (/certificate verify failed|root certificate file|server certificate|self.signed certificate|unable to get local issuer certificate|certificate[^\r\n]*(?:does not match|expired|not yet valid)/i.test(stderr)) return 'TLS_CERTIFICATE';
    if (/could not translate host name|name or service not known|temporary failure in name resolution/i.test(stderr)) return 'NETWORK_DNS';
    if (result?.error?.code === 'ETIMEDOUT' || /timeout expired|timed out|connection timeout|connect timeout/i.test(stderr)) return 'NETWORK_TIMEOUT';
    if (/connection refused/i.test(stderr)) return 'CONNECTION_REFUSED';
    if (/unsupported startup parameter|unrecognized configuration parameter|invalid value for parameter/i.test(stderr)) return 'STARTUP_OPTION_REJECTED';
    if (/permission denied/i.test(stderr)) return 'PERMISSION_DENIED';
    return 'UNKNOWN';
}

function invoke(run, command, args, env, input, code) {
    let result;
    try {
        result = run(command, args, {
            cwd: ROOT, env, input, encoding: 'utf8', timeout: 20000,
            maxBuffer: 65536, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch (error) { return fail(code, code === 'DATABASE_PRECHECK_FAILED' ? databaseFailureReason({ error }) : undefined); }
    // Never emit a subprocess error or stderr: providers can echo credentials.
    if (!result || result.error || result.signal || result.status !== 0
        || typeof result.stdout !== 'string' || result.stdout.length > 65536) {
        fail(code, code === 'DATABASE_PRECHECK_FAILED' ? databaseFailureReason(result) : undefined);
    }
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
export function runPrecheck({ env = process.env, run = spawnSync, publish = publishStatus, log = console.log,
    readCertificate = readFileSync, now = Date.now(), inspectRestoreTool = isExecutable, getUid = process.getuid?.bind(process) } = {}) {
    let clientVersions;
    try {
        const sha = env.STAGING_RELEASE_SHA;
        if (!/^[a-f0-9]{40}$/.test(sha || '') || env.RENDER_GIT_COMMIT !== sha
            || env.RENDER_GIT_BRANCH !== BRANCH
            || (env.STAGING_DATABASE_PROJECT_REF !== undefined && env.STAGING_DATABASE_PROJECT_REF !== PROJECT_REF)) fail('TARGET_INVALID');
        if (FORBIDDEN_ENV.some(key => env[key] !== undefined)) fail('RUNTIME_ENV_FORBIDDEN');
        const password = env.STAGING_DB_ADMIN_PASSWORD;
        if (typeof password !== 'string' || password.length === 0 || password.length > 1024 || /[\u0000\r\n]/.test(password)) fail('ADMIN_CREDENTIAL_MISSING_OR_INVALID');
        let certificate;
        try { certificate = readCertificate(STAGING_CA_PATH); } catch { fail('STAGING_CA_INVALID'); }
        if (!validateStagingCa(certificate, now)) fail('STAGING_CA_INVALID');
        const head = invoke(run, '/usr/bin/git', ['rev-parse', '--verify', 'HEAD'], { ...BASE_ENV }, undefined, 'GIT_IDENTITY_FAILED');
        if (head !== sha) fail('GIT_IDENTITY_MISMATCH');
        const psqlVersion = clientVersion(run, '/usr/bin/psql', 'psql');
        const dumpVersion = clientVersion(run, '/usr/bin/pg_dump', 'pg_dump');
        clientVersions = { psql_version: psqlVersion, pg_dump_version: dumpVersion,
            restore_tools: restoreToolAvailability(dumpVersion, inspectRestoreTool, getUid) };
        const databaseEnv = {
            ...BASE_ENV,
            PGHOST: 'aws-0-ap-southeast-1.pooler.supabase.com', PGPORT: '5432',
            PGDATABASE: 'postgres', PGUSER: `postgres.${PROJECT_REF}`, PGPASSWORD: password,
            PGSSLMODE: 'verify-full', PGSSLROOTCERT: STAGING_CA_PATH,
            PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'otp-staging-precheck', PGCLIENTENCODING: 'UTF8',
            PSQL_HISTORY: '/dev/null',
            PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000',
        };
        const raw = invoke(run, '/usr/bin/psql', ['-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], databaseEnv, PRECHECK_SQL, 'DATABASE_PRECHECK_FAILED');
        const evidence = parseEvidence(raw);
        publish(PUBLIC_STATUS);
        log(`STAGING_DB_PRECHECK_OK ${JSON.stringify({
            project_ref: PROJECT_REF, sha, psql_version: psqlVersion, pg_dump_version: dumpVersion,
            restore_tools: clientVersions.restore_tools,
            pg_dump_compatible: Number(dumpVersion.split('.')[0]) >= Math.floor(evidence.server_version_num / 10000),
            ...evidence,
        })}`);
        return 0;
    } catch (error) {
        const detail = error instanceof PrecheckError && error.code === 'DATABASE_PRECHECK_FAILED'
            ? ` ${JSON.stringify({ reason: error.reason, ...clientVersions })}` : '';
        log(`STAGING_DB_PRECHECK_FAILED ${error instanceof PrecheckError ? error.code : 'INTERNAL_FAILURE'}${detail}`);
        return 1;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runPrecheck();
