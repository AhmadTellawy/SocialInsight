import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { BASE_ENV, BUCKET, ENDPOINT, MAX_BYTES, PUBLIC_STATUS, SNAPSHOT_SQL, cleanupWorkspace, createStore,
    decryptArchive, encryptArchive, invoke, makeObjectKey, makeWorkspace, parseSnapshot, publishStatus,
    remoteEnvironment, runRehearsal, runSelfCheck, startLocalCluster, storeAndRetrieve, validateEnvironment, validateToc, verifyPackage } from './staging-backup-rehearsal.mjs';
import { PROJECT_REF, BRANCH, STAGING_CA_PATH } from './staging-db-precheck.mjs';

const SHA = '2'.repeat(40);
const SECRET = 'TEST_ONLY_credential_never_log';
const ENV = { STAGING_RELEASE_SHA: SHA, RENDER_GIT_COMMIT: SHA, RENDER_GIT_BRANCH: BRANCH,
    STAGING_DATABASE_PROJECT_REF: PROJECT_REF, STAGING_BACKUP_RUN_APPROVED: 'true',
    STAGING_DB_ADMIN_PASSWORD: SECRET, STAGING_BACKUP_S3_ACCESS_KEY_ID: 'TEST_ONLY_S3_ID',
    STAGING_BACKUP_S3_SECRET_ACCESS_KEY: 'TEST_ONLY_S3_SECRET', STAGING_BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
const FIXTURE = { version: 170006, database: 'postgres', role: 'postgres', tls: true, read_only: true,
    objects: 0, owner: 'pg_database_owner', acl: [['pg_database_owner', 'PUBLIC', 'USAGE', false], ['pg_database_owner', 'pg_database_owner', 'CREATE', false], ['pg_database_owner', 'pg_database_owner', 'USAGE', false]] };
const localFixture = () => ({ ...structuredClone(FIXTURE), version: 170011, tls: false });
const ARCHIVE = Buffer.from('PGDMPsynthetic-empty-archive');
const TOC = '; Archive created at an untrusted date\n6; 2615 2200 SCHEMA - public pg_database_owner\n3370; 0 0 COMMENT - SCHEMA public pg_database_owner\n3371; 0 0 ACL - SCHEMA public pg_database_owner\n';
const success = value => ({ status: 0, stdout: Buffer.from(value), stderr: Buffer.alloc(0) });

function fixture(t) {
    const parent = realpathSync(tmpdir()); const root = mkdtempSync(join(parent, 'si-backup-test-'));
    t.after(() => {
        assert.equal(dirname(root), parent); assert.match(root.slice(parent.length + 1), /^si-backup-test-[A-Za-z0-9]+$/);
        assert.equal(lstatSync(root).isSymbolicLink(), false); assert.equal(realpathSync(root), root);
        rmSync(root, { recursive: true, force: false });
    });
    return root;
}

test('exact SHA, branch, project, explicit one-shot approval and distinct canonical credentials', () => {
    assert.equal(validateEnvironment(ENV, SHA), SHA);
    for (const [key, value] of [['RENDER_GIT_BRANCH', 'main'], ['RENDER_GIT_COMMIT', '3'.repeat(40)], ['STAGING_DATABASE_PROJECT_REF', 'other-project'], ['STAGING_BACKUP_RUN_APPROVED', undefined], ['DATABASE_URL', SECRET], ['RESEND_API_KEY', SECRET], ['JWT_SECRET', SECRET], ['STAGING_DB_ADMIN_PASSWORD', 'bad\nvalue'], ['STAGING_BACKUP_ENCRYPTION_KEY', Buffer.alloc(31).toString('base64')], ['STAGING_BACKUP_ENCRYPTION_KEY', ENV.STAGING_BACKUP_ENCRYPTION_KEY.replace(/=$/, '')]]) {
        assert.throws(() => validateEnvironment({ ...ENV, [key]: value }, SHA), error => !error.message.includes(SECRET));
    }
    assert.throws(() => validateEnvironment(ENV, '4'.repeat(40)), /TARGET_INVALID/);
    assert.throws(() => validateEnvironment({ ...ENV, STAGING_BACKUP_S3_SECRET_ACCESS_KEY: SECRET }, SHA), /CREDENTIAL_REUSE/);
});

test('remote environment fixed Stage only, verify-full pinned CA, read-only, password in child env only', () => {
    const env = remoteEnvironment(SECRET);
    assert.equal(env.PGUSER, `postgres.${PROJECT_REF}`); assert.equal(env.PGHOST, 'aws-0-ap-southeast-1.pooler.supabase.com');
    assert.equal(env.PGPORT, '5432'); assert.equal(env.PGSSLMODE, 'verify-full'); assert.equal(env.PGSSLROOTCERT, STAGING_CA_PATH);
    assert.equal(env.PGPASSWORD, SECRET); assert.match(env.PGOPTIONS, /default_transaction_read_only=on/);
    for (const key of ['RESEND_API_KEY', 'JWT_SECRET', 'DATABASE_URL', 'STAGING_BACKUP_S3_SECRET_ACCESS_KEY', 'STAGING_BACKUP_ENCRYPTION_KEY']) assert.equal(env[key], undefined);
    assert.ok(SNAPSHOT_SQL.startsWith('BEGIN READ ONLY;')); assert.ok(SNAPSHOT_SQL.endsWith('COMMIT;'));
    for (const catalog of ['pg_class', 'pg_proc', 'pg_type', 'pg_extension', 'pg_operator', 'pg_collation', 'pg_conversion', 'pg_opclass', 'pg_opfamily', 'pg_ts_config', 'pg_ts_dict', 'pg_ts_parser', 'pg_ts_template', 'pg_default_acl']) assert.ok(SNAPSHOT_SQL.includes(catalog));
    assert.doesNotMatch(SNAPSHOT_SQL, /(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\s/i);
});

test('strict zero-object snapshot refuses hostile fields, roles, ACL and uncertain TLS/readonly', () => {
    assert.equal(parseSnapshot(JSON.stringify(FIXTURE)).objects, 0);
    assert.equal(parseSnapshot(JSON.stringify(localFixture()), { remote: false }).version, 170011);
    const mutations = [{ objects: 1 }, { objects: '0' }, { tls: false }, { read_only: false }, { role: SECRET }, { database: 'other' }, { version: 180000 }, { owner: 'attacker' }, { extra: SECRET }, { acl: [['postgres', SECRET, 'CREATE', false]] }, { acl: [['postgres', 'PUBLIC', 'DELETE', false]] }, { acl: [['postgres', 'PUBLIC', 'CREATE', 'yes']] }];
    for (const mutation of mutations) assert.throws(() => parseSnapshot(JSON.stringify({ ...FIXTURE, ...mutation })), /^Error: SNAPSHOT_INVALID$/);
    for (const raw of [SECRET, 'null', '[]', '{}']) assert.throws(() => parseSnapshot(raw), /^Error: SNAPSHOT_INVALID$/);
    assert.throws(() => parseSnapshot(JSON.stringify(FIXTURE), { remote: false }), /SNAPSHOT_INVALID/);
});

test('TOC accepts only reviewed empty public schema metadata and never executes CREATE schema', () => {
    const filtered = validateToc(TOC);
    assert.equal(filtered.split('\n').filter(Boolean).length, 2); assert.doesNotMatch(filtered, /\d+ SCHEMA - public/);
    for (const input of ['', TOC + '44; 0 123 TABLE public User postgres\n', TOC + '45; 0 0 FUNCTION public malicious() postgres\n', TOC.replace('ACL - SCHEMA public', 'ACL - DATABASE postgres'), TOC.replace('pg_database_owner', SECRET), TOC + TOC, TOC + '\0']) assert.throws(() => validateToc(input), /TOC_INVALID/);
});

test('fresh object identifier has 256-bit entropy and cannot come from an arbitrary SHA/path', () => {
    const one = makeObjectKey(SHA); const two = makeObjectKey(SHA);
    assert.match(one, new RegExp(`^pre-migration/${SHA}/[a-f0-9]{64}\\.siotpenc$`)); assert.notEqual(one, two);
    assert.throws(() => makeObjectKey('../secret'), /OBJECT_ID_INVALID/); assert.throws(() => makeObjectKey(SHA, Buffer.alloc(24)), /OBJECT_ID_INVALID/);
});

test('AES-GCM roundtrip binds exact project, bucket, version, release and object identifier', () => {
    const key = randomBytes(32); const object = makeObjectKey(SHA);
    const ciphertext = encryptArchive(ARCHIVE, key, SHA, object);
    assert.ok(ciphertext.length > ARCHIVE.length); assert.equal(ciphertext.includes(ARCHIVE), false);
    assert.deepEqual(decryptArchive(ciphertext, key, SHA, object), ARCHIVE);
    for (const position of [0, 13, ciphertext.length - 1]) { const changed = Buffer.from(ciphertext); changed[position] ^= 1; assert.throws(() => decryptArchive(changed, key, SHA, object), /ENVELOPE_INVALID/); }
    assert.throws(() => decryptArchive(ciphertext, randomBytes(32), SHA, object), /ENVELOPE_INVALID/);
    assert.throws(() => decryptArchive(ciphertext, key, SHA, makeObjectKey(SHA)), /ENVELOPE_INVALID/);
    assert.throws(() => decryptArchive(ciphertext, key, '3'.repeat(40), object), /ENVELOPE_INVALID/);
});

test('encryption enforces canonical archive magic, nonce/key lengths and total bucket limit', () => {
    const key = randomBytes(32); const object = makeObjectKey(SHA);
    for (const archive of [Buffer.from('wrong'), Buffer.alloc(MAX_BYTES)]) assert.throws(() => encryptArchive(archive, key, SHA, object), /ARCHIVE_INVALID/);
    assert.throws(() => encryptArchive(ARCHIVE, key, SHA, object, Buffer.alloc(11)), /ARCHIVE_INVALID/);
    assert.throws(() => encryptArchive(ARCHIVE, Buffer.alloc(31), SHA, object), /ARCHIVE_INVALID/);
    assert.throws(() => decryptArchive(Buffer.alloc(MAX_BYTES + 1), key, SHA, object), /ENVELOPE_INVALID/);
});

function sdkFixture({ exists = false, headError, putError, persistPut = true, tamper = false, length } = {}) {
    const calls = []; let body; let config;
    class HeadObjectCommand { constructor(input) { this.input = input; } }
    class PutObjectCommand { constructor(input) { this.input = input; } }
    class GetObjectCommand { constructor(input) { this.input = input; } }
    class S3Client {
        constructor(input) { config = input; }
        async send(command, options) {
            calls.push({ name: command.constructor.name, input: command.input }); assert.ok(options.abortSignal);
            if (command instanceof HeadObjectCommand) { if (headError) throw headError; if (exists) return {}; throw Object.assign(new Error(SECRET), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }); }
            if (command instanceof PutObjectCommand) { if (persistPut) body = Buffer.from(command.input.Body); if (putError) throw putError; return {}; }
            if (command instanceof GetObjectCommand) { if (!body) throw Object.assign(new Error(SECRET), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }); const result = Buffer.from(body); if (tamper) result[0] ^= 1; return { ContentLength: length ?? result.length, Body: Readable.from([result]) }; }
            assert.fail('No other operation is authorized');
        }
        destroy() { calls.push({ name: 'destroy' }); }
    }
    const store = createStore({ S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand }, ENV);
    return { store, calls, config: () => config };
}

test('SDK uses fixed endpoint and explicit Stage S3 credentials; single PUT has no unsupported conditional claim', async () => {
    const s = sdkFixture(); const key = makeObjectKey(SHA); const body = Buffer.from('encrypted-only');
    const result = await storeAndRetrieve(s.store, key, body);
    assert.deepEqual(result.retrieved, body); assert.equal(result.ambiguous, false);
    assert.equal(s.config().endpoint, ENDPOINT); assert.equal(s.config().maxAttempts, 1); assert.equal(s.config().forcePathStyle, true);
    assert.deepEqual(Object.keys(s.config().credentials).sort(), ['accessKeyId', 'secretAccessKey']);
    assert.deepEqual(s.calls.map(c => c.name), ['HeadObjectCommand', 'PutObjectCommand', 'GetObjectCommand']);
    for (const call of s.calls) { assert.equal(call.input.Key, key); assert.equal(call.input.Bucket, BUCKET); }
    assert.equal(s.calls[1].input.IfNoneMatch, undefined); assert.equal(s.calls[1].input.ContentLength, body.length);
    s.store.close();
});

test('an ambiguous PUT result performs exact GET only, never retry/overwrite', async () => {
    const s = sdkFixture({ putError: new Error(SECRET) });
    const result = await storeAndRetrieve(s.store, makeObjectKey(SHA), Buffer.from('encrypted-only'));
    assert.equal(result.ambiguous, true); assert.equal(s.calls.filter(c => c.name === 'PutObjectCommand').length, 1);
    assert.equal(s.calls.filter(c => c.name === 'GetObjectCommand').length, 1);
});

test('existing object, unknown HEAD404 and forbidden HEAD fail before PUT or GET', async () => {
    const scenarios = [{ exists: true }, { headError: Object.assign(new Error(SECRET), { name: 'Unknown', $metadata: { httpStatusCode: 404 } }) }, { headError: Object.assign(new Error(SECRET), { $metadata: { httpStatusCode: 403 } }) }];
    for (const options of scenarios) {
        const s = sdkFixture(options);
        await assert.rejects(storeAndRetrieve(s.store, makeObjectKey(SHA), Buffer.from('encrypted')), e => !e.message.includes(SECRET));
        assert.ok(s.calls.filter(c => c.name === 'PutObjectCommand').length <= 1);
        assert.equal(s.calls.some(c => c.name === 'GetObjectCommand'), false);
    }
});

test('HTTP 503 after persisted PUT recovers through exact GET without another PUT', async () => {
    const s = sdkFixture({ putError: Object.assign(new Error(SECRET), { $metadata: { httpStatusCode: 503 } }) });
    const result = await storeAndRetrieve(s.store, makeObjectKey(SHA), Buffer.from('encrypted-only'));
    assert.equal(result.ambiguous, true);
    assert.deepEqual(s.calls.map(x => x.name), ['HeadObjectCommand', 'PutObjectCommand', 'GetObjectCommand']);
});

test('HTTP 403 with no persisted object fails exact GET and does not retry PUT', async () => {
    const s = sdkFixture({ persistPut: false, putError: Object.assign(new Error(SECRET), { $metadata: { httpStatusCode: 403 } }) });
    await assert.rejects(storeAndRetrieve(s.store, makeObjectKey(SHA), Buffer.from('encrypted-only')), /OBJECT_GET_FAILED/);
    assert.deepEqual(s.calls.map(x => x.name), ['HeadObjectCommand', 'PutObjectCommand', 'GetObjectCommand']);
});

test('schema ACL rejects all grant options and CREATE for every non-owner', () => {
    for (const grantee of ['PUBLIC', 'anon', 'authenticated', 'service_role', 'otp_staging_app', 'postgres']) {
        assert.throws(() => parseSnapshot(JSON.stringify({ ...FIXTURE, acl: [['pg_database_owner', grantee, 'CREATE', false]] })), /SNAPSHOT_INVALID/);
    }
    for (const privilege of ['USAGE', 'CREATE']) assert.throws(() => parseSnapshot(JSON.stringify({ ...FIXTURE, acl: [['pg_database_owner', 'pg_database_owner', privilege, true]] })), /SNAPSHOT_INVALID/);
    assert.throws(() => parseSnapshot(JSON.stringify({ ...FIXTURE, owner: 'otp_staging_app' })), /SNAPSHOT_INVALID/);
    assert.equal(parseSnapshot(JSON.stringify(FIXTURE)).objects, 0);
});

test('exact GET ciphertext mismatch and oversized metadata are rejected', async () => {
    for (const options of [{ tamper: true }, { length: MAX_BYTES + 1 }]) {
        const s = sdkFixture(options);
        await assert.rejects(storeAndRetrieve(s.store, makeObjectKey(SHA), Buffer.from('encrypted')), /OBJECT_(?:READBACK|SIZE)_INVALID/);
    }
});

test('subprocess errors never propagate hostile stderr, stdout or thrown objects', () => {
    for (const result of [{ status: 1, stdout: Buffer.from(SECRET), stderr: Buffer.from(SECRET) }, { status: 0, stdout: Buffer.from(SECRET), error: { message: SECRET } }, { status: 0, stdout: 'not-buffer' }]) {
        assert.throws(() => invoke(() => result, '/fake', [], { code: 'FIXED_FAILURE' }), /^Error: FIXED_FAILURE$/);
    }
    assert.throws(() => invoke(() => { throw new Error(SECRET); }, '/fake', []), /^Error: TOOL_FAILED$/);
    let captured;
    invoke((...args) => { captured = args; return success('ok'); }, '/fake', ['--version']);
    assert.deepEqual(captured[2].env, BASE_ENV); assert.equal(captured[2].encoding, null); assert.equal(captured[2].killSignal, 'SIGKILL');
});

test('private temporary workspace cleanup requires exact owned marker and realpath', t => {
    const root = fixture(t); const workspace = makeWorkspace({ base: root });
    assert.equal(existsSync(workspace.path), true);
    if (process.platform !== 'win32') assert.equal(lstatSync(workspace.path).mode & 0o777, 0o700);
    assert.throws(() => cleanupWorkspace({ ...workspace, marker: 'foreign' }), /CLEANUP_TARGET_INVALID/);
    assert.equal(existsSync(workspace.path), true);
    assert.throws(() => cleanupWorkspace({ ...workspace, path: root }), /CLEANUP_TARGET_INVALID/);
    cleanupWorkspace(workspace); assert.equal(existsSync(workspace.path), false);
});

test('public output is a constant-only idempotent stub; foreign content refuses', t => {
    const root = fixture(t); publishStatus({ root }); publishStatus({ root });
    const directory = join(root, 'staging-backup-public');
    assert.deepEqual(readdirSync(directory), ['index.html']); assert.equal(readFileSync(join(directory, 'index.html'), 'utf8'), PUBLIC_STATUS);
    assert.doesNotMatch(PUBLIC_STATUS, /PGDMP|mnfiixtg|sha256|credential|@/);
    writeFileSync(join(directory, 'foreign'), 'untouched'); assert.throws(() => publishStatus({ root }), /PUBLISH_PATH_INVALID/);
});

test('public directory symlink is rejected, no fixture target overwritten', t => {
    const root = fixture(t); const foreign = join(root, 'foreign'); mkdirSync(foreign);
    try { symlinkSync(foreign, join(root, 'staging-backup-public'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) return t.skip('OS does not permit this fixture symlink'); throw e; }
    assert.throws(() => publishStatus({ root }), /PUBLISH_PATH_INVALID/); assert.deepEqual(readdirSync(foreign), []);
});

test('pinned package verifier detects every byte/version-sized mismatch', () => {
    const bytes = Buffer.from('public-synthetic-package'); const entry = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    verifyPackage(bytes, entry); assert.throws(() => verifyPackage(Buffer.from('wrong'), entry), /PACKAGE_HASH_INVALID/);
    assert.throws(() => verifyPackage(bytes, { ...entry, sha256: '0'.repeat(64) }), /PACKAGE_HASH_INVALID/);
});

test('local cluster command is Unix-socket only, host auth reject, resource capped and credential-free', t => {
    const root = fixture(t); const calls = [];
    const cluster = startLocalCluster({ path: root }, { bin: '/fixed/bin' }, (...args) => { calls.push(args); return success(''); });
    const init = calls[0]; assert.ok(init[1].includes('--auth-host=reject')); assert.ok(init[1].includes('--auth-local=trust'));
    const start = calls[1]; const options = start[1][start[1].indexOf('-o') + 1];
    assert.match(options, /listen_addresses=''/); assert.match(options, /unix_socket_permissions=0700/); assert.match(options, /jit=off/); assert.match(options, /shared_buffers=16MB/); assert.match(options, /max_connections=5/);
    assert.ok(cluster.env.PGHOST.endsWith('socket')); assert.equal(cluster.env.PGSSLMODE, 'disable'); assert.equal(cluster.env.PGPASSWORD, undefined);
    cluster.stop();
    for (const call of calls) assert.deepEqual(call[2].env, BASE_ENV);
});

function pipelineFixture(t, change = {}) {
    const root = fixture(t); const calls = []; const logs = []; const storeCalls = []; let ciphertext; let stopped = 0; let cleaned = 0; let published = 0;
    const run = (exe, args, options) => {
        calls.push({ exe, args, options });
        if (exe.endsWith('git')) return success(SHA);
        if (exe.endsWith('pg_dump')) return success(ARCHIVE);
        if (exe.endsWith('pg_restore')) return success(args.includes('--list') ? TOC : '');
        if (exe.endsWith('psql')) {
            if (options.input.startsWith('CREATE ROLE')) return success('');
            const remote = options.env.PGHOST === 'aws-0-ap-southeast-1.pooler.supabase.com';
            assert.equal(options.input, SNAPSHOT_SQL);
            return success(JSON.stringify(remote ? (change.remote ?? FIXTURE) : localFixture()));
        }
        assert.fail('Unexpected executable');
    };
    return { calls, logs, storeCalls, counts: () => ({ stopped, cleaned, published }), options: {
        env: { ...ENV }, run, log: value => logs.push(value), getUid: () => 1000,
        workspaceFactory: () => ({ path: root }), prepare: () => ({ bin: '/fixed/bin', sdk: {} }),
        start: () => ({ env: { ...BASE_ENV, PGHOST: '/private/socket' }, stop() { stopped++; } }),
        cleanup: () => { cleaned++; }, publish: () => { published++; },
        storeFactory: () => ({ async exists(key) { storeCalls.push(['head', key]); return false; }, async put(key, body) { ciphertext = Buffer.from(body); storeCalls.push(['put', key]); }, async get(key) { storeCalls.push(['get', key]); return Buffer.from(ciphertext); }, close() {} }),
    } };
}

test('complete offline rehearsal proves ordered dump/readback/restore and Stage receives only read-only operations', async t => {
    const f = pipelineFixture(t); const result = await runRehearsal(f.options);
    assert.equal(result, 0); assert.deepEqual(f.counts(), { stopped: 1, cleaned: 1, published: 1 });
    assert.deepEqual(f.storeCalls.map(x => x[0]), ['head', 'put', 'get']); assert.equal(new Set(f.storeCalls.map(x => x[1])).size, 1);
    const remote = f.calls.filter(x => x.options.env.PGPASSWORD);
    assert.equal(remote.length, 3);
    for (const call of remote) { assert.ok(call.exe.endsWith('psql') || call.exe.endsWith('pg_dump')); assert.equal(call.options.env.PGSSLMODE, 'verify-full'); if (call.exe.endsWith('psql')) assert.equal(call.options.input, SNAPSHOT_SQL); }
    for (const call of f.calls.filter(x => x.exe.endsWith('pg_restore'))) {
        assert.equal(call.options.env.PGPASSWORD, undefined); assert.equal(call.options.env.STAGING_BACKUP_S3_SECRET_ACCESS_KEY, undefined);
        assert.equal(call.args.some(x => x.includes(SECRET)), false);
    }
    assert.match(f.logs[0], /^STAGING_BACKUP_OBJECT_ATTEMPT /);
    assert.match(f.logs[1], /^STAGING_BACKUP_REHEARSAL_OK /);
    for (const value of Object.values(ENV).filter(v => typeof v === 'string' && v.includes('TEST_ONLY'))) assert.equal(JSON.stringify(f.logs).includes(value), false);
    assert.equal(JSON.stringify(f.logs).includes(ENV.STAGING_BACKUP_ENCRYPTION_KEY), false);
});

test('private locator is logged before the only PUT and survives a post-persistence restore failure', async t => {
    const f = pipelineFixture(t); const originalRun = f.options.run;
    const originalStoreFactory = f.options.storeFactory;
    f.options.run = (exe, args, options) => {
        if (exe.endsWith('pg_restore') && !args.includes('--list')) return { status: 1, stdout: Buffer.from(SECRET), stderr: Buffer.from(SECRET) };
        return originalRun(exe, args, options);
    };
    f.options.storeFactory = () => {
        const store = originalStoreFactory(); const originalPut = store.put;
        store.put = async (key, body) => {
            assert.equal(f.logs.length, 1);
            const event = JSON.parse(f.logs[0].slice('STAGING_BACKUP_OBJECT_ATTEMPT '.length));
            assert.deepEqual(Object.keys(event).sort(), ['project_ref', 'retained_object', 'sha']);
            assert.equal(event.retained_object, key); assert.equal(event.sha, SHA); assert.equal(event.project_ref, PROJECT_REF);
            return originalPut(key, body);
        };
        return store;
    };
    assert.equal(await runRehearsal(f.options), 1);
    assert.deepEqual(f.storeCalls.map(x => x[0]), ['head', 'put', 'get']);
    assert.match(f.logs[0], /^STAGING_BACKUP_OBJECT_ATTEMPT /);
    assert.equal(f.logs[1], 'STAGING_BACKUP_REHEARSAL_FAILED RESTORE_FAILED');
    assert.equal(f.logs.some(x => x.startsWith('STAGING_BACKUP_REHEARSAL_OK')), false);
    assert.equal(f.counts().published, 0);
    for (const key of ['STAGING_DB_ADMIN_PASSWORD', 'STAGING_BACKUP_S3_ACCESS_KEY_ID', 'STAGING_BACKUP_S3_SECRET_ACCESS_KEY', 'STAGING_BACKUP_ENCRYPTION_KEY']) assert.equal(f.logs.join().includes(ENV[key]), false);
});

test('private locator callback is not emitted when HEAD finds an existing object', async () => {
    const s = sdkFixture({ exists: true }); let attempts = 0;
    await assert.rejects(storeAndRetrieve(s.store, makeObjectKey(SHA), Buffer.from('encrypted'), { beforePut: () => { attempts++; } }), /OBJECT_ALREADY_EXISTS/);
    assert.equal(attempts, 0); assert.deepEqual(s.calls.map(x => x.name), ['HeadObjectCommand']);
});

test('nonempty public objects abort before dump/S3, no success or publication', async t => {
    const f = pipelineFixture(t, { remote: { ...FIXTURE, objects: 1 } });
    assert.equal(await runRehearsal(f.options), 1); assert.equal(f.storeCalls.length, 0);
    assert.equal(f.calls.some(x => x.exe.endsWith('pg_dump')), false); assert.equal(f.counts().published, 0);
    assert.deepEqual(f.logs, ['STAGING_BACKUP_REHEARSAL_FAILED SNAPSHOT_INVALID']);
});

test('failed tools/cluster and invalid CA abort before any secret-bearing DB child', async t => {
    for (const phase of ['prepare', 'start', 'ca']) {
        const f = pipelineFixture(t);
        if (phase === 'ca') f.options.readCertificate = () => SECRET;
        else f.options[phase] = () => { throw new Error(SECRET); };
        assert.equal(await runRehearsal(f.options), 1);
        assert.equal(f.calls.some(x => x.options.env.PGPASSWORD), false); assert.equal(f.storeCalls.length, 0);
        assert.equal(f.logs.join().includes(SECRET), false);
    }
});

test('uncertain local stop never deletes potentially live cluster', async t => {
    const f = pipelineFixture(t);
    f.options.start = () => ({ env: { ...BASE_ENV, PGHOST: '/private/socket' }, stop() { throw new Error(SECRET); } });
    assert.equal(await runRehearsal(f.options), 1);
    assert.equal(f.counts().cleaned, 0); assert.equal(f.counts().published, 0); assert.equal(f.logs.join().includes(SECRET), false);
});

test('runner source keeps APT authenticated and download/extract-only; SDK isolated ignore-scripts', () => {
    const source = readFileSync(fileURLToPath(new URL('./staging-backup-rehearsal.mjs', import.meta.url)), 'utf8');
    assert.match(source, /APT_CONFIG: config/); assert.match(source, /Dir::Etc::parts/); assert.match(source, /--error-on=any/);
    assert.ok(source.includes('AllowUnauthenticated "false"')); assert.doesNotMatch(source, /trusted=yes|--allow-unauthenticated|\['install'|--force/);
    assert.match(source, /\['download',/); assert.match(source, /\['--extract',/); assert.match(source, /'ci', '--ignore-scripts'/);
    assert.match(source, /NPM_CONFIG_USERCONFIG: join\(path, 'npm-user.conf'\)/);
    assert.match(source, /NPM_CONFIG_GLOBALCONFIG: join\(path, 'npm-global.conf'\)/);
    assert.match(source, /'ci', '--ignore-scripts', '--omit=dev'/);
    assert.match(source, /maxAttempts: 1/); assert.doesNotMatch(source, /DeleteObjectCommand|ListObjects|UploadPartCommand/);
    const manifest = JSON.parse(readFileSync(new URL('../tools/staging-backup/toolchain-manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.postgresVersion, '17.11'); assert.equal(manifest.packages.length, 2);
    assert.ok(manifest.packages.every(x => x.version === '17.11-1.pgdg12+2' && /^[a-f0-9]{64}$/.test(x.sha256)));
});

test('self-check uses only local tools/synthetic archive with every provider secret forbidden', async t => {
    const f = pipelineFixture(t);
    f.options.env = { STAGING_RELEASE_SHA: SHA, RENDER_GIT_COMMIT: SHA, RENDER_GIT_BRANCH: BRANCH };
    assert.equal(await runSelfCheck(f.options), 0); assert.equal(f.storeCalls.length, 0);
    assert.ok(f.calls.every(x => !x.options.env.PGPASSWORD));
    assert.match(f.logs[0], /^STAGING_BACKUP_SELF_CHECK_OK /);
    for (const key of ['STAGING_DB_ADMIN_PASSWORD', 'STAGING_BACKUP_ENCRYPTION_KEY', 'STAGING_BACKUP_S3_ACCESS_KEY_ID', 'STAGING_BACKUP_S3_SECRET_ACCESS_KEY', 'RESEND_API_KEY']) {
        const logs = [];
        assert.equal(await runSelfCheck({ env: { ...f.options.env, [key]: SECRET }, log: x => logs.push(x), run: () => assert.fail('Must reject before subprocess'), getUid: () => 1000 }), 1);
        assert.deepEqual(logs, ['STAGING_BACKUP_SELF_CHECK_FAILED SELF_CHECK_SECRETS_FORBIDDEN']);
    }
});
