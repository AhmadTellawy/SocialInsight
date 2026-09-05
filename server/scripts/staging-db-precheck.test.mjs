import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { BRANCH, PROJECT_REF, PRECHECK_SQL, PUBLIC_STATUS, STAGING_CA_FINGERPRINT, STAGING_CA_PATH,
    publishStatus, runPrecheck, validateStagingCa } from './staging-db-precheck.mjs';

const SHA = 'a'.repeat(40);
const SECRET = 'synthetic-test-password-ONLY';
const evidence = () => ({ server_version_num: 170006, database: 'postgres', role: 'postgres',
    superuser: false, bypass_rls: true, create_database: true, create_role: true,
    public_table_count: 0, tls: true, read_only: true });
function fixture({ extraEnv = {}, mutateResult, data = evidence(), head = SHA } = {}) {
    const calls = [], logs = [], files = [];
    const env = { STAGING_RELEASE_SHA: SHA, RENDER_GIT_COMMIT: SHA, RENDER_GIT_BRANCH: BRANCH,
        STAGING_DB_ADMIN_PASSWORD: SECRET, STAGING_DATABASE_PROJECT_REF: PROJECT_REF,
        OTHER_SECRET: 'must-not-inherit', PGHOST: 'production.invalid', PGPASSWORD: 'must-not-inherit',
        PATH: 'untrusted-path', ...extraEnv };
    const run = (command, args, options) => {
        calls.push({ command, args, options });
        const stdout = command.endsWith('/git') ? head : args[0] === '--version'
            ? `${command.endsWith('/psql') ? 'psql' : 'pg_dump'} (PostgreSQL) 17.6 (Debian 17.6-1)` : JSON.stringify(data);
        return mutateResult?.({ command, args, options, stdout }) ?? { status: 0, stdout, stderr: '' };
    };
    const execute = overrides => runPrecheck({ env, run, publish: content => files.push(content), log: line => logs.push(line),
        inspectRestoreTool: () => false, getUid: () => 0, ...overrides });
    return { calls, logs, files, env, execute };
}

test('successful precheck pins identity and publishes only a constant status stub', () => {
    const f = fixture();
    assert.equal(f.execute(), 0);
    assert.deepEqual(f.files, [PUBLIC_STATUS]);
    assert.equal(f.calls.length, 4);
    const output = JSON.parse(f.logs[0].slice('STAGING_DB_PRECHECK_OK '.length));
    assert.equal(output.sha, SHA);
    assert.equal(output.project_ref, PROJECT_REF);
    assert.equal(output.pg_dump_compatible, true);
    assert.equal(output.psql_version, '17.6');
    for (const value of [SECRET, PROJECT_REF, SHA, 'postgres', '170006']) assert.ok(!PUBLIC_STATUS.includes(value));
    assert.ok(!JSON.stringify(f.logs).includes(SECRET));
});

test('credentials only enter read-only psql child environment, never argv, git or version tools', () => {
    const f = fixture(); f.execute();
    const query = f.calls[3];
    assert.equal(query.options.env.PGHOST, 'aws-0-ap-southeast-1.pooler.supabase.com');
    assert.equal(query.options.env.PGPORT, '5432');
    assert.equal(query.options.env.PGUSER, `postgres.${PROJECT_REF}`);
    assert.equal(query.options.env.PGDATABASE, 'postgres');
    assert.equal(query.options.env.PGPASSWORD, SECRET);
    assert.equal(query.options.env.PGSSLMODE, 'verify-full');
    assert.equal(query.options.env.PGSSLROOTCERT, STAGING_CA_PATH);
    assert.equal(query.options.env.PSQL_HISTORY, '/dev/null');
    assert.match(query.options.env.PGOPTIONS, /default_transaction_read_only=on/);
    assert.match(query.options.env.PGOPTIONS, /statement_timeout=10000/);
    assert.equal(query.options.input, PRECHECK_SQL);
    assert.deepEqual(query.args, ['-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-At']);
    for (const call of f.calls) {
        assert.ok(call.command.startsWith('/usr/bin/'));
        assert.ok(!JSON.stringify(call.args).includes(SECRET));
        assert.equal(call.options.env.OTHER_SECRET, undefined);
        assert.equal(call.options.env.RESEND_API_KEY, undefined);
        assert.equal(call.options.timeout, 20000);
        assert.equal(call.options.maxBuffer, 65536);
        assert.notEqual(call.options.env.PATH, f.env.PATH);
    }
    for (const call of f.calls.slice(0, 3)) assert.equal(call.options.env.PGPASSWORD, undefined);
    assert.match(PRECHECK_SQL, /^BEGIN READ ONLY;/);
    assert.ok(!/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|CALL)\b/i.test(PRECHECK_SQL));
});

test('refuses incorrect SHA, branch and project before any child process', () => {
    for (const extraEnv of [{ STAGING_RELEASE_SHA: 'bad' }, { RENDER_GIT_COMMIT: 'b'.repeat(40) },
        { RENDER_GIT_BRANCH: 'main' }, { STAGING_DATABASE_PROJECT_REF: 'jlanmsxfggpnbwoowejy' }]) {
        const f = fixture({ extraEnv });
        assert.equal(f.execute(), 1); assert.equal(f.calls.length, 0);
        assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED TARGET_INVALID']);
        assert.equal(f.files.length, 0);
    }
});

test('refuses runtime environment group markers even if empty', () => {
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'RESEND_API_KEY', 'JWT_SECRET', 'OTP_HASH_SECRET',
        'STAGING_OTP_ALLOWED_EMAILS', 'CLIENT_URL', 'STAGING_TRUST_PROXY_HOPS']) {
        const f = fixture({ extraEnv: { [key]: '' } });
        assert.equal(f.execute(), 1); assert.equal(f.calls.length, 0);
        assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED RUNTIME_ENV_FORBIDDEN']);
    }
});

test('refuses absent, oversized or invalid admin credentials without exposing them', () => {
    for (const password of [undefined, '', 'x'.repeat(1025), `${SECRET}\n`, `${SECRET}\0`]) {
        const f = fixture({ extraEnv: { STAGING_DB_ADMIN_PASSWORD: password } });
        assert.equal(f.execute(), 1); assert.equal(f.calls.length, 0);
        assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED ADMIN_CREDENTIAL_MISSING_OR_INVALID']);
    }
});

test('git SHA mismatch prevents database connection', () => {
    const f = fixture({ head: 'b'.repeat(40) });
    assert.equal(f.execute(), 1); assert.equal(f.calls.length, 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED GIT_IDENTITY_MISMATCH']);
});

test('child errors, exit failures, signals and invalid output never leak raw diagnostic text', () => {
    for (const result of [{ status: 1, stderr: SECRET, stdout: SECRET },
        { status: 0, error: new Error(SECRET), stdout: SECRET },
        { status: 0, signal: 'SIGTERM', stdout: SECRET }, { status: 0, stdout: SECRET }]) {
        const f = fixture({ mutateResult: ({ args }) => args.includes('-At') ? result : undefined });
        assert.equal(f.execute(), 1); assert.equal(f.files.length, 0);
        assert.ok(!JSON.stringify(f.logs).includes(SECRET));
        assert.match(f.logs[0], /^STAGING_DB_PRECHECK_FAILED DATABASE_/);
    }
    const f = fixture();
    assert.equal(f.execute({ run: () => { throw new Error(SECRET); } }), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED GIT_IDENTITY_FAILED']);
});

test('strict evidence whitelist rejects unsafe identity, extra properties and non-read-only or non-TLS sessions', () => {
    for (const delta of [{ role: SECRET }, { database: SECRET }, { tls: false }, { read_only: false },
        { public_table_count: -1 }, { public_table_count: '0' }, { server_version_num: SECRET },
        { bypass_rls: 'yes' }, { injected_secret: SECRET }]) {
        const f = fixture({ data: { ...evidence(), ...delta } });
        assert.equal(f.execute(), 1); assert.equal(f.files.length, 0);
        assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED DATABASE_EVIDENCE_INVALID']);
    }
});

test('reports dump-client incompatibility as diagnostic evidence without performing a dump', () => {
    const f = fixture({ data: { ...evidence(), server_version_num: 180001 } });
    assert.equal(f.execute(), 0);
    assert.ok(f.logs[0].includes('"pg_dump_compatible":false'));
    assert.deepEqual(f.calls.find(call => call.command.endsWith('/pg_dump')).args, ['--version']);
});

test('version output is reduced to numeric version and malformed output fails closed', () => {
    const f = fixture({ mutateResult: ({ args, stdout }) => args[0] === '--version'
        ? { status: 0, stdout: `${stdout} ${SECRET}` } : undefined });
    assert.equal(f.execute(), 0); assert.ok(!JSON.stringify(f.logs).includes(SECRET));
    const bad = fixture({ mutateResult: ({ args }) => args[0] === '--version'
        ? { status: 0, stdout: SECRET } : undefined });
    assert.equal(bad.execute(), 1); assert.equal(bad.files.length, 0);
    assert.deepEqual(bad.logs, ['STAGING_DB_PRECHECK_FAILED CLIENT_VERSION_INVALID']);
});

test('publish failure is generic and does not emit successful evidence', () => {
    const f = fixture();
    assert.equal(f.execute({ publish: () => { throw new Error(SECRET); } }), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED INTERNAL_FAILURE']);
});

function temporaryPublicationFixture(t) {
    const temporaryParent = realpathSync(tmpdir());
    const root = mkdtempSync(join(temporaryParent, 'otp-precheck-publish-test-'));
    t.after(() => {
        // Only remove this exact newly-created fixture, never an existing
        // workspace directory. rmSync removes child symlinks without following.
        const stat = lstatSync(root);
        const actual = realpathSync(root);
        const inside = relative(temporaryParent, actual);
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
        assert.equal(actual, root);
        assert.equal(dirname(actual), temporaryParent);
        assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
        assert.ok(basename(actual).startsWith('otp-precheck-publish-test-'));
        rmSync(actual, { recursive: true, force: false });
    });
    return { root, directory: join(root, 'staging-precheck-public') };
}

function createFixtureSymlinkOrSkip(t, target, link, type) {
    try { symlinkSync(target, link, type); return true; }
    catch (error) {
        if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(error.code)) throw error;
        t.skip(`OS does not permit this symlink fixture (${error.code})`);
        return false;
    }
}

test('real filesystem publication creates only the fixed stub and is idempotent', t => {
    const { root, directory } = temporaryPublicationFixture(t);
    const f = fixture();
    const publish = content => publishStatus(content, { root });
    assert.equal(f.execute({ publish }), 0);
    assert.deepEqual(readdirSync(directory), ['index.html']);
    assert.equal(readFileSync(join(directory, 'index.html'), 'utf8'), PUBLIC_STATUS);
    assert.equal(f.execute({ publish }), 0);
    assert.deepEqual(readdirSync(directory), ['index.html']);
    assert.equal(readFileSync(join(directory, 'index.html'), 'utf8'), PUBLIC_STATUS);
});

test('real publisher refuses non-constant content before creating a directory', t => {
    const { root, directory } = temporaryPublicationFixture(t);
    assert.throws(() => publishStatus(SECRET, { root }), { message: 'PUBLISH_CONTENT_INVALID' });
    assert.equal(existsSync(directory), false);
});

test('real publisher refuses foreign artifacts and preserves them unchanged', t => {
    const { root, directory } = temporaryPublicationFixture(t);
    mkdirSync(directory);
    writeFileSync(join(directory, 'foreign.txt'), SECRET);
    const f = fixture();
    assert.equal(f.execute({ publish: content => publishStatus(content, { root }) }), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED PUBLISH_PATH_INVALID']);
    assert.deepEqual(readdirSync(directory), ['foreign.txt']);
    assert.equal(readFileSync(join(directory, 'foreign.txt'), 'utf8'), SECRET);
});

test('real publisher refuses existing different index content without overwriting', t => {
    const { root, directory } = temporaryPublicationFixture(t);
    mkdirSync(directory);
    writeFileSync(join(directory, 'index.html'), SECRET);
    const f = fixture();
    assert.equal(f.execute({ publish: content => publishStatus(content, { root }) }), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED PUBLISH_PATH_INVALID']);
    assert.equal(readFileSync(join(directory, 'index.html'), 'utf8'), SECRET);
});

test('real publisher refuses a symlinked publish directory', t => {
    const { root, directory } = temporaryPublicationFixture(t);
    const privateDirectory = join(root, 'not-public');
    mkdirSync(privateDirectory);
    if (!createFixtureSymlinkOrSkip(t, privateDirectory, directory, process.platform === 'win32' ? 'junction' : 'dir')) return;
    const f = fixture();
    assert.equal(f.execute({ publish: content => publishStatus(content, { root }) }), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED PUBLISH_PATH_INVALID']);
    assert.deepEqual(readdirSync(privateDirectory), []);
});

test('real publisher refuses a symlinked index and preserves its target', t => {
    const { root, directory } = temporaryPublicationFixture(t);
    mkdirSync(directory);
    const privateFile = join(root, 'not-public.txt');
    writeFileSync(privateFile, SECRET);
    if (!createFixtureSymlinkOrSkip(t, privateFile, join(directory, 'index.html'), 'file')) return;
    const f = fixture();
    assert.equal(f.execute({ publish: content => publishStatus(content, { root }) }), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED PUBLISH_PATH_INVALID']);
    assert.equal(readFileSync(privateFile, 'utf8'), SECRET);
});

test('actual filesystem errors are sanitized rather than leaking paths or content', t => {
    const { root } = temporaryPublicationFixture(t);
    const blockedRoot = join(root, SECRET);
    writeFileSync(blockedRoot, SECRET);
    const f = fixture();
    assert.equal(f.execute({ publish: content => publishStatus(content, { root: blockedRoot }) }), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED INTERNAL_FAILURE']);
    assert.equal(readFileSync(blockedRoot, 'utf8'), SECRET);
});

test('database failures expose only allowlisted classifications and validated client versions', () => {
    const cases = [
        ['FATAL: password authentication failed for user', 'AUTH_REJECTED'],
        ['FATAL: Tenant or user not found', 'TENANT_NOT_FOUND'],
        ['SSL error: certificate verify failed', 'TLS_CERTIFICATE'],
        ['could not translate host name', 'NETWORK_DNS'],
        ['connection to server failed: timeout expired', 'NETWORK_TIMEOUT'],
        ['connection to server failed: Connection refused', 'CONNECTION_REFUSED'],
        ['FATAL: unsupported startup parameter: options', 'STARTUP_OPTION_REJECTED'],
        ['ERROR: permission denied for view', 'PERMISSION_DENIED'],
        ['unrecognized provider failure', 'UNKNOWN'],
    ];
    for (const [diagnostic, reason] of cases) {
        const sensitive = `postgresql://private-user:${SECRET}@private-host.invalid/private-db`;
        const f = fixture({ mutateResult: ({ args }) => args.includes('-At')
            ? { status: 2, stdout: sensitive, stderr: `${diagnostic}\n${sensitive}\n${SECRET}` } : undefined });
        assert.equal(f.execute(), 1);
        assert.equal(f.files.length, 0);
        assert.deepEqual(f.logs, [`STAGING_DB_PRECHECK_FAILED DATABASE_PRECHECK_FAILED ${JSON.stringify({
            reason, psql_version: '17.6', pg_dump_version: '17.6', restore_tools: { initdb: false, pg_ctl: false, postgres: false, pg_restore: false, non_root: false },
        })}`]);
        for (const hidden of [SECRET, sensitive, 'private-user', 'private-host', diagnostic]) {
            assert.ok(!f.logs[0].includes(hidden));
        }
    }
});

test('database subprocess timeout is classified without forwarding error properties', () => {
    const f = fixture({ mutateResult: ({ args }) => args.includes('-At')
        ? { status: null, error: Object.assign(new Error(SECRET), { code: 'ETIMEDOUT', path: SECRET }),
            signal: 'SIGKILL', stdout: SECRET, stderr: SECRET } : undefined });
    assert.equal(f.execute(), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED DATABASE_PRECHECK_FAILED {"reason":"NETWORK_TIMEOUT","psql_version":"17.6","pg_dump_version":"17.6","restore_tools":{"initdb":false,"pg_ctl":false,"postgres":false,"pg_restore":false,"non_root":false}}']);
    assert.equal(f.files.length, 0);
});

test('arbitrary database error properties cannot become a failure reason or log field', () => {
    const f = fixture({ mutateResult: ({ args }) => args.includes('-At')
        ? { status: null, error: Object.assign(new Error(SECRET), { code: SECRET, reason: SECRET }),
            signal: SECRET, stdout: SECRET, stderr: { secret: SECRET } } : undefined });
    assert.equal(f.execute(), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED DATABASE_PRECHECK_FAILED {"reason":"UNKNOWN","psql_version":"17.6","pg_dump_version":"17.6","restore_tools":{"initdb":false,"pg_ctl":false,"postgres":false,"pg_restore":false,"non_root":false}}']);
    assert.equal(f.files.length, 0);
});

test('checked-in public Supabase CA has the pinned DER fingerprint, CA capability and validity', () => {
    const pem = readFileSync(STAGING_CA_PATH);
    const ca = new X509Certificate(pem);
    assert.equal(ca.fingerprint256, STAGING_CA_FINGERPRINT);
    assert.equal(ca.ca, true);
    assert.equal(ca.verify(ca.publicKey), true);
    assert.equal(ca.subject, ca.issuer);
    assert.equal(new Date(ca.validFrom).toISOString(), '2021-04-28T10:56:53.000Z');
    assert.equal(new Date(ca.validTo).toISOString(), '2031-04-26T10:56:53.000Z');
    assert.equal(validateStagingCa(pem), true);
    assert.equal(validateStagingCa(pem.toString().replace(/\r?\n/g, '\r\n')), true);
    assert.equal(validateStagingCa(pem, Date.parse('2031-04-26T10:56:54Z')), false);
    assert.equal(validateStagingCa(pem, Date.parse('2021-04-28T10:56:52Z')), false);
    assert.equal(validateStagingCa(pem, NaN), false);
});

test('invalid, expanded or tampered CA bundles fail before any credential-bearing child', () => {
    const pem = readFileSync(STAGING_CA_PATH, 'utf8');
    for (const invalid of [SECRET, pem + pem, pem.replace('MIIDx', 'MIIDy'), `${pem}${SECRET}`, 'x'.repeat(16385)]) {
        const f = fixture();
        assert.equal(f.execute({ readCertificate: () => invalid }), 1);
        assert.equal(f.calls.length, 0);
        assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED STAGING_CA_INVALID']);
    }
    const f = fixture();
    assert.equal(f.execute({ readCertificate: path => { assert.equal(path, STAGING_CA_PATH); throw new Error(SECRET); } }), 1);
    assert.deepEqual(f.logs, ['STAGING_DB_PRECHECK_FAILED STAGING_CA_INVALID']);
    assert.equal(f.calls.length, 0);
});

test('restore tool checks inspect only version-bound fixed paths and emit booleans without execution', () => {
    const paths = [];
    const f = fixture();
    assert.equal(f.execute({ inspectRestoreTool: path => { paths.push(path); return path.endsWith('/initdb'); }, getUid: () => 1234 }), 0);
    assert.deepEqual(paths, ['/usr/lib/postgresql/17/bin/initdb', '/usr/lib/postgresql/17/bin/pg_ctl', '/usr/lib/postgresql/17/bin/postgres', '/usr/lib/postgresql/17/bin/pg_restore']);
    const output = JSON.parse(f.logs[0].slice('STAGING_DB_PRECHECK_OK '.length));
    assert.deepEqual(output.restore_tools, { initdb: true, pg_ctl: false, postgres: false, pg_restore: false, non_root: true });
    assert.equal(f.calls.length, 4);
    assert.ok(!f.calls.some(call => /initdb|pg_ctl|pg_restore|\/postgres$/.test(call.command)));
    const hostile = fixture();
    assert.equal(hostile.execute({ inspectRestoreTool: () => SECRET, getUid: () => SECRET }), 0);
    assert.ok(hostile.logs[0].includes('"restore_tools":{"initdb":false,"pg_ctl":false,"postgres":false,"pg_restore":false,"non_root":false}'));
    assert.ok(!hostile.logs[0].includes(SECRET));
});
