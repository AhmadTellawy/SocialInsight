// BUILD-ONLY, single-use recovery rehearsal for the approved EMPTY Staging public
// schema. This is not a migration runner or a general backup service. No server.
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANCH, PROJECT_REF, STAGING_CA_PATH, validateStagingCa } from './staging-db-precheck.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOOLS = join(ROOT, 'server/tools/staging-backup');
// Below either interpretation of the existing bucket's 10 MB limit.
export const MAX_BYTES = 9_000_000;
export const BUCKET = 'otp-staging-backups';
export const ENDPOINT = `https://${PROJECT_REF}.storage.supabase.co/storage/v1/s3`;
export const PUBLIC_STATUS = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Staging recovery</title><p>Recovery rehearsal complete.</p></html>\n';
export const SELF_CHECK_STATUS = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Staging toolchain</title><p>Toolchain self-check complete.</p></html>\n';
export const BASE_ENV = Object.freeze({ PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' });
const FORBIDDEN = ['DATABASE_URL', 'DIRECT_URL', 'RESEND_API_KEY', 'JWT_SECRET', 'OTP_HASH_SECRET', 'STAGING_OTP_ALLOWED_EMAILS', 'CLIENT_URL', 'STAGING_TRUST_PROXY_HOPS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS'];
const ROLE_NAMES = ['postgres', 'pg_database_owner', 'anon', 'authenticated', 'service_role', 'supabase_admin', 'otp_staging_app'];
const MAGIC = Buffer.from('SIOTPBACKUP1\0', 'ascii');
const SHA = value => createHash('sha256').update(value).digest('hex');
const require = createRequire(import.meta.url);
class SafeError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new SafeError(code); };

// Identical read-only snapshot is taken before and after dump. No provider-owned
// schema or global role/password data is dumped. Objects outside public remain out
// of scope, including managed auth/storage data.
export const SNAPSHOT_SQL = `BEGIN READ ONLY;
SELECT json_build_object(
 'version',current_setting('server_version_num')::int,
 'database',current_database(),'role',current_user,
 'tls',coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false),
 'read_only',current_setting('transaction_read_only')='on',
 'objects',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_opclass c JOIN pg_namespace n ON n.oid=c.opcnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_opfamily c JOIN pg_namespace n ON n.oid=c.opfnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_ts_config c JOIN pg_namespace n ON n.oid=c.cfgnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_ts_dict c JOIN pg_namespace n ON n.oid=c.dictnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_ts_parser c JOIN pg_namespace n ON n.oid=c.prsnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_ts_template c JOIN pg_namespace n ON n.oid=c.tmplnamespace WHERE n.nspname='public')
  +(SELECT count(*) FROM pg_default_acl c JOIN pg_namespace n ON n.oid=c.defaclnamespace WHERE n.nspname='public'),
 'owner',pg_get_userbyid(n.nspowner),
 'acl',coalesce((SELECT json_agg(json_build_array(pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type) FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a),'[]'::json)
) FROM pg_namespace n WHERE n.nspname='public';
COMMIT;`;

export function parseSnapshot(raw, { remote = true } = {}) {
    let d;
    try { d = JSON.parse(raw); } catch { fail('SNAPSHOT_INVALID'); }
    const keys = ['version', 'database', 'role', 'tls', 'read_only', 'objects', 'owner', 'acl'];
    if (!d || Array.isArray(d) || Object.keys(d).length !== keys.length || keys.some(k => !Object.hasOwn(d, k))
        || !Number.isSafeInteger(d.version) || d.version < 170000 || d.version >= 180000
        || d.database !== 'postgres' || d.role !== 'postgres' || d.read_only !== true
        || typeof d.tls !== 'boolean' || (remote && !d.tls) || (!remote && d.tls)
        || d.objects !== 0 || !['postgres', 'pg_database_owner', 'supabase_admin'].includes(d.owner) || !Array.isArray(d.acl) || d.acl.length > 40) fail('SNAPSHOT_INVALID');
    for (const row of d.acl) {
        if (!Array.isArray(row) || row.length !== 4 || !ROLE_NAMES.includes(row[0])
            || ![...ROLE_NAMES, 'PUBLIC'].includes(row[1]) || !['USAGE', 'CREATE'].includes(row[2])
            || row[3] !== false || (row[2] === 'CREATE' && row[1] !== d.owner)) fail('SNAPSHOT_INVALID');
    }
    d.acl.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
    if (new Set(d.acl.map(row => JSON.stringify(row))).size !== d.acl.length) fail('SNAPSHOT_INVALID');
    return d;
}

export function validateEnvironment(env, head) {
    const sha = env.STAGING_RELEASE_SHA;
    if (!/^[a-f0-9]{40}$/.test(sha || '') || env.RENDER_GIT_COMMIT !== sha || head !== sha
        || env.RENDER_GIT_BRANCH !== BRANCH || env.STAGING_BACKUP_RUN_APPROVED !== 'true'
        || env.STAGING_DATABASE_PROJECT_REF !== PROJECT_REF) fail('TARGET_INVALID');
    if (FORBIDDEN.some(key => env[key] !== undefined)) fail('RUNTIME_ENV_FORBIDDEN');
    for (const name of ['STAGING_DB_ADMIN_PASSWORD', 'STAGING_BACKUP_S3_ACCESS_KEY_ID', 'STAGING_BACKUP_S3_SECRET_ACCESS_KEY']) {
        if (typeof env[name] !== 'string' || !env[name].length || env[name].length > 1024 || /[\x00\r\n]/.test(env[name])) fail('CREDENTIAL_INVALID');
    }
    const value = env.STAGING_BACKUP_ENCRYPTION_KEY;
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)
        || Buffer.from(value, 'base64').length !== 32 || Buffer.from(value, 'base64').toString('base64') !== value) fail('ENCRYPTION_KEY_INVALID');
    if (new Set(['STAGING_DB_ADMIN_PASSWORD', 'STAGING_BACKUP_S3_SECRET_ACCESS_KEY', 'STAGING_BACKUP_ENCRYPTION_KEY'].map(k => env[k])).size !== 3) fail('CREDENTIAL_REUSE');
    return sha;
}

export function remoteEnvironment(password) {
    return { ...BASE_ENV, PGHOST: 'aws-0-ap-southeast-1.pooler.supabase.com', PGPORT: '5432', PGDATABASE: 'postgres',
        PGUSER: `postgres.${PROJECT_REF}`, PGPASSWORD: password, PGSSLMODE: 'verify-full', PGSSLROOTCERT: STAGING_CA_PATH,
        PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'otp-staging-backup', PGCLIENTENCODING: 'UTF8', PSQL_HISTORY: '/dev/null',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=25000' };
}

export function invoke(run, executable, args, { env = BASE_ENV, cwd = ROOT, input, maxBytes = 65536, timeout = 60000, code = 'TOOL_FAILED' } = {}) {
    let result;
    try { result = run(executable, args, { env: { ...env }, cwd, input, encoding: null, timeout, maxBuffer: maxBytes, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { fail(code); }
    if (!result || result.status !== 0 || result.signal || result.error || !Buffer.isBuffer(result.stdout) || result.stdout.length > maxBytes) fail(code);
    return result.stdout;
}

export function validateToc(raw) {
    if (typeof raw !== 'string' || raw.length > 65536 || raw.includes('\0')) fail('TOC_INVALID');
    const entries = raw.split(/\r?\n/).filter(line => line && !line.startsWith(';'));
    const seen = new Set();
    if (entries.length < 1 || entries.length > 3) fail('TOC_INVALID');
    for (const line of entries) {
        const m = line.match(/^\d+; \d+ \d+ (SCHEMA - public|COMMENT - SCHEMA public|ACL - SCHEMA public) (postgres|pg_database_owner|supabase_admin)$/);
        if (!m || seen.has(m[1])) fail('TOC_INVALID');
        seen.add(m[1]);
    }
    // public already exists in initdb. Apply only its comment/ACL, never CREATE,
    // DROP, or database/global entries. Schema owner is separately reconciled.
    return entries.filter(line => !/^\d+; \d+ \d+ SCHEMA - public /.test(line)).join('\n') + '\n';
}

export function makeObjectKey(sha, entropy = randomBytes(32)) {
    if (!/^[a-f0-9]{40}$/.test(sha) || !Buffer.isBuffer(entropy) || entropy.length !== 32) fail('OBJECT_ID_INVALID');
    return `pre-migration/${sha}/${entropy.toString('hex')}.siotpenc`;
}
function aad(sha, key) {
    if (!/^[a-f0-9]{40}$/.test(sha) || !new RegExp(`^pre-migration/${sha}/[a-f0-9]{64}\\.siotpenc$`).test(key)) fail('OBJECT_ID_INVALID');
    return Buffer.from(JSON.stringify(['SIOTPBACKUP', 1, PROJECT_REF, BUCKET, sha, key]), 'utf8');
}
export function encryptArchive(archive, key, sha, objectKey, nonce = randomBytes(12)) {
    if (!Buffer.isBuffer(archive) || archive.length < 5 || archive.subarray(0, 5).toString() !== 'PGDMP'
        || archive.length + MAGIC.length + 28 > MAX_BYTES || !Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(nonce) || nonce.length !== 12) fail('ARCHIVE_INVALID');
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad(sha, objectKey));
    return Buffer.concat([MAGIC, nonce, cipher.update(archive), cipher.final(), cipher.getAuthTag()]);
}
export function decryptArchive(envelope, key, sha, objectKey) {
    try {
        if (!Buffer.isBuffer(envelope) || envelope.length < MAGIC.length + 33 || envelope.length > MAX_BYTES
            || !envelope.subarray(0, MAGIC.length).equals(MAGIC) || !Buffer.isBuffer(key) || key.length !== 32) fail('ENVELOPE_INVALID');
        const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(MAGIC.length, MAGIC.length + 12), { authTagLength: 16 });
        decipher.setAAD(aad(sha, objectKey));
        decipher.setAuthTag(envelope.subarray(-16));
        const archive = Buffer.concat([decipher.update(envelope.subarray(MAGIC.length + 12, -16)), decipher.final()]);
        if (archive.subarray(0, 5).toString() !== 'PGDMP') fail('ENVELOPE_INVALID');
        return archive;
    } catch { fail('ENVELOPE_INVALID'); }
}

export async function storeAndRetrieve(store, objectKey, envelope, { beforePut = () => {} } = {}) {
    if (!Buffer.isBuffer(envelope) || envelope.length > MAX_BYTES) fail('ARCHIVE_INVALID');
    if (await store.exists(objectKey)) fail('OBJECT_ALREADY_EXISTS');
    // Supabase S3 does not implement IfNoneMatch on PUT. This is NOT WORM or an
    // atomic-create guarantee: a fresh 256-bit key + HEAD prevents accidental
    // reuse. There is structurally only ONE PUT, with no SDK retry. The operator
    // unlinks/revokes this temporary key after successful recovery evidence.
    // After an ambiguous transport failure only GET this exact identifier; the
    // identical encrypted bytes prove whether the one attempted PUT succeeded.
    let ambiguous = false;
    beforePut(); // Preserve the exact locator privately even if a later step fails.
    try { await store.put(objectKey, envelope); }
    catch (error) { if (error instanceof SafeError && error.code === 'PUT_AMBIGUOUS') ambiguous = true; else fail('OBJECT_PUT_FAILED'); }
    const retrieved = await store.get(objectKey);
    if (!Buffer.isBuffer(retrieved) || retrieved.length !== envelope.length
        || !timingSafeEqual(createHash('sha256').update(retrieved).digest(), createHash('sha256').update(envelope).digest())) fail('OBJECT_READBACK_INVALID');
    return { retrieved, ambiguous };
}

export function createStore(sdk, env) {
    const client = new sdk.S3Client({ endpoint: ENDPOINT, region: 'ap-southeast-1', forcePathStyle: true, maxAttempts: 1,
        credentials: { accessKeyId: env.STAGING_BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.STAGING_BACKUP_S3_SECRET_ACCESS_KEY },
        requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
        requestHandler: { connectionTimeout: 10000, requestTimeout: 30000 } });
    const send = command => client.send(command, { abortSignal: AbortSignal.timeout(35000) });
    return {
        async exists(Key) { try { await send(new sdk.HeadObjectCommand({ Bucket: BUCKET, Key })); return true; }
            catch (e) { if (e?.$metadata?.httpStatusCode === 404 && ['NotFound', 'NoSuchKey'].includes(e.name)) return false; fail('OBJECT_HEAD_FAILED'); } },
        async put(Key, Body) { try { await send(new sdk.PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentLength: Body.length,
            ContentType: 'application/octet-stream', Metadata: { format: 'siotpbackup-v1' } })); }
            // Any exception, even HTTP 403/503, may follow a committed write at
            // an intermediary. Never issue another PUT; exact GET is the only
            // permitted resolution and must match the ciphertext byte-for-byte.
            catch { fail('PUT_AMBIGUOUS'); } },
        async get(Key) {
            let response;
            try { response = await send(new sdk.GetObjectCommand({ Bucket: BUCKET, Key })); } catch { fail('OBJECT_GET_FAILED'); }
            if (!Number.isSafeInteger(response.ContentLength) || response.ContentLength < 1 || response.ContentLength > MAX_BYTES) { response.Body?.destroy?.(); fail('OBJECT_SIZE_INVALID'); }
            const chunks = []; let bytes = 0;
            const timer = setTimeout(() => response.Body?.destroy?.(), 30000); timer.unref?.();
            try { for await (const chunk of response.Body) { bytes += chunk.length; if (bytes > MAX_BYTES) fail('OBJECT_SIZE_INVALID'); chunks.push(Buffer.from(chunk)); } }
            catch { response.Body?.destroy?.(); fail('OBJECT_GET_FAILED'); }
            finally { clearTimeout(timer); }
            if (bytes !== response.ContentLength) fail('OBJECT_SIZE_INVALID');
            return Buffer.concat(chunks);
        },
        close() { client.destroy(); },
    };
}

// Runtime scratch only: never under the checkout, publish directory, or npm/Render
// cache. The marker is a public random ownership token, not a credential.
export function makeWorkspace({ base = '/tmp' } = {}) {
    const parent = realpathSync(base);
    const path = mkdtempSync(join(parent, 'si-otp-backup-')); chmodSync(path, 0o700);
    const marker = randomBytes(24).toString('hex');
    writeFileSync(join(path, '.owned'), marker, { flag: 'wx', mode: 0o600 });
    return { path, parent, marker };
}
export function cleanupWorkspace(workspace) {
    const { path, parent, marker } = workspace;
    if (resolve(path) !== path || dirname(path) !== parent || !path.startsWith(parent + sep)
        || !/^si-otp-backup-[A-Za-z0-9]+$/.test(path.slice(parent.length + 1))
        || lstatSync(path).isSymbolicLink() || realpathSync(path) !== path
        || lstatSync(join(path, '.owned')).isSymbolicLink() || readFileSync(join(path, '.owned'), 'utf8') !== marker) fail('CLEANUP_TARGET_INVALID');
    rmSync(path, { recursive: true, force: false });
}

export function verifyPackage(bytes, entry) {
    if (!Buffer.isBuffer(bytes) || bytes.length !== entry.bytes || SHA(bytes) !== entry.sha256) fail('PACKAGE_HASH_INVALID');
}

export function prepareToolchain(workspace, run = spawnSync) {
    const path = workspace.path;
    const manifest = JSON.parse(readFileSync(join(TOOLS, 'toolchain-manifest.json'), 'utf8'));
    const os = readFileSync('/etc/os-release', 'utf8');
    if (process.platform !== 'linux' || process.arch !== 'x64' || !/^ID=debian$/m.test(os) || !/^VERSION_ID="12"$/m.test(os)
        || manifest.postgresVersion !== '17.11' || manifest.signingFingerprint !== 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8') fail('TOOLCHAIN_PLATFORM_INVALID');
    for (const d of ['gnupg', 'apt', 'apt/lists', 'apt/lists/partial', 'apt/cache', 'apt/cache/archives', 'apt/cache/archives/partial', 'packages', 'prefix', 'sdk', 'npm-cache']) mkdirSync(join(path, d), { mode: 0o700 });
    const keyPath = join(TOOLS, 'pgdg.asc');
    const keyInfo = invoke(run, '/usr/bin/gpg', ['--no-options', '--homedir', join(path, 'gnupg'), '--batch', '--with-colons', '--show-keys', keyPath], { cwd: path }).toString();
    const fingerprints = keyInfo.split('\n').filter(x => x.startsWith('fpr:')).map(x => x.split(':')[9]);
    if (fingerprints.length !== 1 || fingerprints[0] !== manifest.signingFingerprint) fail('SIGNING_KEY_INVALID');
    const config = join(path, 'apt/apt.conf');
    writeFileSync(join(path, 'apt/sources.list'), `deb [arch=amd64 signed-by=${keyPath}] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main\n`, { mode: 0o600, flag: 'wx' });
    // APT_CONFIG is read before normal config. Repoint main/parts too, so inherited
    // machine-wide update hooks/proxies cannot execute in this isolated invocation.
    writeFileSync(config, `Dir::Etc::main "-"; Dir::Etc::parts "-";\nDir::Etc::sourcelist "${join(path, 'apt/sources.list')}"; Dir::Etc::sourceparts "-";\nDir::Etc::trusted "-"; Dir::Etc::trustedparts "-";\nDir::State "${join(path, 'apt')}"; Dir::State::lists "${join(path, 'apt/lists')}"; Dir::State::status "/var/lib/dpkg/status";\nDir::Cache "${join(path, 'apt/cache')}"; Dir::Log "${join(path, 'apt')}";\nAPT::Architecture "amd64"; Acquire::Languages "none"; Acquire::Retries "0"; Acquire::https::Timeout "30";\nAcquire::AllowInsecureRepositories "false"; Acquire::AllowDowngradeToInsecureRepositories "false"; APT::Get::AllowUnauthenticated "false";\n`, { mode: 0o600, flag: 'wx' });
    const aptEnv = { ...BASE_ENV, APT_CONFIG: config, HOME: path };
    invoke(run, '/usr/bin/apt-get', ['--error-on=any', 'update'], { env: aptEnv, cwd: path, timeout: 180000, maxBytes: 2 * 1024 * 1024, code: 'APT_METADATA_FAILED' });
    for (const entry of manifest.packages) {
        invoke(run, '/usr/bin/apt-get', ['download', `${entry.name}=${entry.version}`], { env: aptEnv, cwd: join(path, 'packages'), timeout: 180000, code: 'APT_DOWNLOAD_FAILED' });
        const deb = join(path, 'packages', entry.filename);
        verifyPackage(readFileSync(deb), entry);
        invoke(run, '/usr/bin/dpkg-deb', ['--extract', deb, join(path, 'prefix')], { cwd: path, code: 'PACKAGE_EXTRACT_FAILED' });
    }
    const bin = join(path, 'prefix/usr/lib/postgresql/17/bin');
    for (const name of ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump', 'pg_restore']) {
        const output = invoke(run, join(bin, name), ['--version'], { cwd: path, code: 'NATIVE_DEPENDENCY_MISSING' }).toString().trim();
        if (!new RegExp(`^${name === 'postgres' ? 'postgres' : name} \\(PostgreSQL\\) 17\\.11(?: [^\\r\\n]*)?$`).test(output)) fail('TOOL_VERSION_INVALID');
    }
    for (const name of ['package.json', 'package-lock.json']) copyFileSync(join(TOOLS, name), join(path, 'sdk', name));
    writeFileSync(join(path, 'npm-user.conf'), '', { mode: 0o600, flag: 'wx' });
    writeFileSync(join(path, 'npm-global.conf'), '', { mode: 0o600, flag: 'wx' });
    const npmCli = resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
    invoke(run, process.execPath, [npmCli, 'ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], {
        env: { ...BASE_ENV, PATH: `${dirname(process.execPath)}:${BASE_ENV.PATH}`, HOME: path, NPM_CONFIG_USERCONFIG: join(path, 'npm-user.conf'), NPM_CONFIG_GLOBALCONFIG: join(path, 'npm-global.conf'), NPM_CONFIG_CACHE: join(path, 'npm-cache'), NPM_CONFIG_FETCH_RETRIES: '0' },
        cwd: join(path, 'sdk'), timeout: 180000, maxBytes: 2 * 1024 * 1024, code: 'SDK_INSTALL_FAILED',
    });
    return { bin, sdk: require(join(path, 'sdk/node_modules/@aws-sdk/client-s3/dist-cjs/index.js')) };
}

export function startLocalCluster(workspace, tools, run = spawnSync) {
    const data = join(workspace.path, 'data'); const socket = join(workspace.path, 'socket');
    mkdirSync(socket, { mode: 0o700 });
    invoke(run, join(tools.bin, 'initdb'), ['-D', data, '-L', join(workspace.path, 'prefix/usr/share/postgresql/17'), '--username=postgres', '--auth-local=trust', '--auth-host=reject', '--locale=C', '--encoding=UTF8', '--no-instructions'], { cwd: workspace.path, code: 'LOCAL_INIT_FAILED' });
    const options = `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c jit=off -c shared_buffers=16MB -c work_mem=1MB -c maintenance_work_mem=16MB -c max_connections=5 -c max_wal_size=80MB -c log_statement=none -c log_min_messages=fatal -c log_min_error_statement=panic -c log_connections=off -c log_disconnections=off`;
    writeFileSync(join(workspace.path, 'postgres.log'), '', { flag: 'wx', mode: 0o600 });
    try { invoke(run, join(tools.bin, 'pg_ctl'), ['-D', data, '-l', join(workspace.path, 'postgres.log'), '-w', '-t', '20', '-o', options, 'start'], { cwd: workspace.path, timeout: 30000, code: 'LOCAL_START_FAILED' }); }
    catch {
        // A timed-out pg_ctl could have started postgres. Prove it stopped before
        // allowing any cleanup; uncertainty deliberately retains private scratch.
        invoke(run, join(tools.bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', '-t', '20', 'stop'], { cwd: workspace.path, timeout: 30000, code: 'LOCAL_STOP_FAILED' });
        fail('LOCAL_START_FAILED');
    }
    const env = { ...BASE_ENV, PGHOST: socket, PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'postgres', PGSSLMODE: 'disable', PSQL_HISTORY: '/dev/null', PGOPTIONS: '-c statement_timeout=20000 -c lock_timeout=3000' };
    return { env, stop() { invoke(run, join(tools.bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', '-t', '20', 'stop'], { cwd: workspace.path, timeout: 30000, code: 'LOCAL_STOP_FAILED' }); } };
}

export function publishStatus({ root = ROOT, selfCheck = false } = {}) {
    if (typeof selfCheck !== 'boolean') fail('PUBLISH_PATH_INVALID');
    const content = selfCheck ? SELF_CHECK_STATUS : PUBLIC_STATUS;
    const directory = join(root, selfCheck ? 'staging-backup-self-check-public' : 'staging-backup-public');
    try { mkdirSync(directory); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink() || readdirSync(directory).some(n => n !== 'index.html')) fail('PUBLISH_PATH_INVALID');
    const target = join(directory, 'index.html');
    try { writeFileSync(target, content, { flag: 'wx', mode: 0o644 }); }
    catch (e) { if (e.code !== 'EEXIST' || lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile() || readFileSync(target, 'utf8') !== content) fail('PUBLISH_PATH_INVALID'); }
}

// Deploy this FIRST, with no credential environment group linked. It exercises
// authenticated package retrieval, native libraries, initdb, dump, TOC and restore
// against local synthetic/empty data only. It can never access Supabase or S3.
export async function runSelfCheck({ env = process.env, run = spawnSync, log = console.log,
    prepare = prepareToolchain, start = startLocalCluster, workspaceFactory = makeWorkspace,
    cleanup = cleanupWorkspace, publish = publishStatus, getUid = process.getuid?.bind(process) } = {}) {
    let workspace, local, unsafeCleanup = false, result = 1;
    try {
        const secretNames = ['STAGING_DB_ADMIN_PASSWORD', 'STAGING_BACKUP_ENCRYPTION_KEY', 'STAGING_BACKUP_S3_ACCESS_KEY_ID', 'STAGING_BACKUP_S3_SECRET_ACCESS_KEY', ...FORBIDDEN];
        if (secretNames.some(key => env[key] !== undefined)) fail('SELF_CHECK_SECRETS_FORBIDDEN');
        if (!Number.isSafeInteger(getUid?.()) || getUid() <= 0) fail('NON_ROOT_REQUIRED');
        const sha = env.STAGING_RELEASE_SHA;
        if (!/^[a-f0-9]{40}$/.test(sha || '') || env.RENDER_GIT_COMMIT !== sha || env.RENDER_GIT_BRANCH !== BRANCH) fail('TARGET_INVALID');
        if (invoke(run, '/usr/bin/git', ['rev-parse', '--verify', 'HEAD']).toString().trim() !== sha) fail('TARGET_INVALID');
        workspace = workspaceFactory(); const tools = prepare(workspace, run); local = start(workspace, tools, run);
        const psql = () => parseSnapshot(invoke(run, join(tools.bin, 'psql'), ['-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], { env: local.env, cwd: workspace.path, input: SNAPSHOT_SQL }).toString(), { remote: false });
        const before = psql(); if (before.version !== 170011) fail('LOCAL_VERSION_INVALID');
        const archive = invoke(run, join(tools.bin, 'pg_dump'), ['-w', '--format=custom', '--schema=public', '--no-owner'], { env: local.env, cwd: workspace.path, maxBytes: MAX_BYTES });
        const toc = validateToc(invoke(run, join(tools.bin, 'pg_restore'), ['--list'], { cwd: workspace.path, input: archive }).toString());
        const list = join(workspace.path, 'self-check.list'); writeFileSync(list, toc, { flag: 'wx', mode: 0o600 });
        invoke(run, join(tools.bin, 'pg_restore'), ['-w', '--exit-on-error', '--single-transaction', '--no-owner', '--use-list', list, '--dbname=postgres'], { env: local.env, cwd: workspace.path, input: archive });
        if (JSON.stringify(before) !== JSON.stringify(psql())) fail('RESTORE_EVIDENCE_MISMATCH');
        local.stop(); local = undefined; cleanup(workspace); workspace = undefined;
        publish({ selfCheck: true });
        log(`STAGING_BACKUP_SELF_CHECK_OK ${JSON.stringify({ sha, toolchain_version: '17.11', non_root: true, unix_socket_only: true, local_restore: true, provider_calls: 0 })}`);
        result = 0;
    } catch (error) {
        unsafeCleanup = error instanceof SafeError && error.code === 'LOCAL_STOP_FAILED';
        log(`STAGING_BACKUP_SELF_CHECK_FAILED ${error instanceof SafeError ? error.code : 'INTERNAL_FAILURE'}`);
    } finally {
        if (local) { try { local.stop(); local = undefined; } catch { log('STAGING_BACKUP_SELF_CHECK_FAILED LOCAL_STOP_FAILED'); result = 1; } }
        if (workspace && !local && !unsafeCleanup) { try { cleanup(workspace); } catch { log('STAGING_BACKUP_SELF_CHECK_FAILED CLEANUP_FAILED'); result = 1; } }
    }
    return result;
}

export async function runRehearsal({ env = process.env, run = spawnSync, log = console.log, prepare = prepareToolchain,
    start = startLocalCluster, workspaceFactory = makeWorkspace, cleanup = cleanupWorkspace, storeFactory = createStore,
    publish = publishStatus, getUid = process.getuid?.bind(process), readCertificate = readFileSync } = {}) {
    let workspace, local, store, encryptionKey, archive, decrypted, result = 1, unsafeCleanup = false;
    try {
        if (!Number.isSafeInteger(getUid?.()) || getUid() <= 0) fail('NON_ROOT_REQUIRED');
        const head = invoke(run, '/usr/bin/git', ['rev-parse', '--verify', 'HEAD']).toString().trim();
        const sha = validateEnvironment(env, head);
        if (!validateStagingCa(readCertificate(STAGING_CA_PATH))) fail('STAGING_CA_INVALID');
        workspace = workspaceFactory();
        const tools = prepare(workspace, run); // No secret-bearing child before all tools and cluster work.
        local = start(workspace, tools, run);
        const psql = (dbEnv, sql) => invoke(run, join(tools.bin, 'psql'), ['-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], { env: dbEnv, cwd: workspace.path, input: sql, code: 'DATABASE_OPERATION_FAILED' }).toString().trim();
        const localBefore = parseSnapshot(psql(local.env, SNAPSHOT_SQL), { remote: false });
        if (localBefore.version !== 170011) fail('LOCAL_VERSION_INVALID');
        const remoteEnv = remoteEnvironment(env.STAGING_DB_ADMIN_PASSWORD);
        const before = parseSnapshot(psql(remoteEnv, SNAPSHOT_SQL));
        archive = invoke(run, join(tools.bin, 'pg_dump'), ['-w', '--format=custom', '--schema=public', '--no-owner', '--lock-wait-timeout=3000'], { env: remoteEnv, cwd: workspace.path, maxBytes: MAX_BYTES - MAGIC.length - 28, code: 'DUMP_FAILED' });
        const after = parseSnapshot(psql(remoteEnv, SNAPSHOT_SQL));
        if (JSON.stringify(before) !== JSON.stringify(after)) fail('SOURCE_CHANGED');
        const toc = validateToc(invoke(run, join(tools.bin, 'pg_restore'), ['--list'], { cwd: workspace.path, input: archive, code: 'TOC_FAILED' }).toString());
        const objectKey = makeObjectKey(sha);
        encryptionKey = Buffer.from(env.STAGING_BACKUP_ENCRYPTION_KEY, 'base64');
        const envelope = encryptArchive(archive, encryptionKey, sha, objectKey);
        store = storeFactory(tools.sdk, env);
        const { retrieved, ambiguous } = await storeAndRetrieve(store, objectKey, envelope, {
            beforePut: () => log(`STAGING_BACKUP_OBJECT_ATTEMPT ${JSON.stringify({ sha, project_ref: PROJECT_REF, retained_object: objectKey })}`),
        });
        decrypted = decryptArchive(retrieved, encryptionKey, sha, objectKey);
        if (SHA(decrypted) !== SHA(archive)) fail('ARCHIVE_HASH_MISMATCH');
        validateToc(invoke(run, join(tools.bin, 'pg_restore'), ['--list'], { cwd: workspace.path, input: decrypted, code: 'TOC_FAILED' }).toString());
        // Fixed no-login local roles only; no credentials or remote operations.
        psql(local.env, ROLE_NAMES.filter(n => !['postgres', 'pg_database_owner'].includes(n)).map(n => `CREATE ROLE "${n}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`).join('\n') + `\nALTER SCHEMA public OWNER TO "${before.owner}";`);
        const list = join(workspace.path, 'restore.list');
        writeFileSync(list, toc, { flag: 'wx', mode: 0o600 });
        invoke(run, join(tools.bin, 'pg_restore'), ['-w', '--exit-on-error', '--single-transaction', '--no-owner', '--use-list', list, '--dbname=postgres'], { env: local.env, cwd: workspace.path, input: decrypted, code: 'RESTORE_FAILED' });
        const restored = parseSnapshot(psql(local.env, SNAPSHOT_SQL), { remote: false });
        if (restored.owner !== before.owner || JSON.stringify(restored.acl) !== JSON.stringify(before.acl)) fail('RESTORE_EVIDENCE_MISMATCH');
        local.stop(); local = undefined;
        cleanup(workspace); workspace = undefined;
        publish();
        log(`STAGING_BACKUP_REHEARSAL_OK ${JSON.stringify({ sha, project_ref: PROJECT_REF, server_major: 17, toolchain_version: '17.11', public_objects: 0, acl_equal: true, retained_object: objectKey, ciphertext_sha256: SHA(envelope), ciphertext_bytes: envelope.length, retained_readback: true, put_ambiguous_recovered: ambiguous, local_restore: true })}`);
        result = 0;
    } catch (error) {
        unsafeCleanup = error instanceof SafeError && error.code === 'LOCAL_STOP_FAILED';
        log(`STAGING_BACKUP_REHEARSAL_FAILED ${error instanceof SafeError ? error.code : 'INTERNAL_FAILURE'}`);
    }
    finally {
        encryptionKey?.fill(0); archive?.fill(0); decrypted?.fill(0);
        try { store?.close(); } catch { /* Never expose SDK details. */ }
        if (local) { try { local.stop(); local = undefined; } catch { log('STAGING_BACKUP_REHEARSAL_FAILED LOCAL_STOP_FAILED'); result = 1; } }
        // If stop failed, do not remove a possibly live cluster. Build termination
        // provides isolation; no artifact/cache points at its private /tmp path.
        if (workspace && !local && !unsafeCleanup) { try { cleanup(workspace); } catch { log('STAGING_BACKUP_REHEARSAL_FAILED CLEANUP_FAILED'); result = 1; } }
    }
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length === 3 && process.argv[2] === '--self-check') process.exitCode = await runSelfCheck();
    else if (process.argv.length === 2) process.exitCode = await runRehearsal();
    else { console.log('STAGING_BACKUP_REHEARSAL_FAILED ARGUMENTS_INVALID'); process.exitCode = 1; }
}
