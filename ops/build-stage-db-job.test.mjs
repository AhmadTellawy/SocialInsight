import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.join(here, 'stage-initial-install');
const secret = 'synthetic:a/@% private-password-sentinel';
const binding = JSON.parse(fs.readFileSync(path.join(packageDir, 'source-binding.json')));
const files = [...binding.files.map(item => item.path), 'source-binding.json', 'install.mjs', 'contract.mjs', 'execution-events.mjs', 'preflight.sql', 'supabase-root-2021.crt'];
function fixture(t, prismaBody = 'process.exit(0)') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opiniup-stage-job-test-'));
  const pkg = path.join(dir, 'stage-initial-install');
  for (const name of files) {
    const dest = path.join(pkg, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(packageDir, name), dest);
  }
  fs.copyFileSync(path.join(here, 'build-stage-db-job.mjs'), path.join(dir, 'build-stage-db-job.mjs'));
  fs.mkdirSync(path.join(pkg, 'node_modules/prisma/build'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'node_modules/prisma/package.json'), JSON.stringify({ version: '6.19.2' }));
  fs.writeFileSync(path.join(pkg, 'node_modules/prisma/build/index.js'), prismaBody);
  t.after(() => {
    const real = fs.realpathSync(dir);
    const tmp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(real), tmp);
    assert.match(path.basename(real), /^opiniup-stage-job-test-[A-Za-z0-9]+$/);
    fs.rmSync(real, { recursive: true });
  });
  const env = {};
  for (const key of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','HOME','USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { STAGING_INITIAL_INSTALL_MODE: 'preflight', STAGING_INITIAL_INSTALL_PROJECT: 'mnfiixtgnlzmduunfryt', STAGING_DB_TRANSPORT: 'session', STAGING_DB_ADMIN_PASSWORD: secret, RENDER_GIT_COMMIT: 'a'.repeat(40), RENDER_SERVICE_ID: 'srv-abcdefghijklmnopqrst' });
  const run = (timeout = 20000) => {
    const result = spawnSync(process.execPath, [path.join(dir, 'build-stage-db-job.mjs')], { cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout });
    const output = result.stdout + result.stderr;
    for (const value of [secret, encodeURIComponent(secret)]) assert.equal(output.includes(value), false, 'secret must never reach wrapper logs');
    const events = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    return { ...result, output, events };
  };
  return { dir, pkg, env, run };
}
test('fixed events retain successful preflight steps and one context; synthetic CLI only', t => {
  const f = fixture(t);
  const r = f.run(); assert.equal(r.status, 0, r.output);
  const states = r.events.filter(event => event.event === 'STAGE_INITIAL_INSTALL_STATE');
  assert(states.some(event => event.steps[0]?.status === 'RUNNING'));
  assert(states.some(event => event.steps[0]?.status === 'PASSED'));
  assert.equal(states.at(-1).status, 'PASSED');
  assert.equal(new Set(r.events.map(event => event.runId)).size, 1);
  assert(r.events.every(event => event.operationsCommit === f.env.RENDER_GIT_COMMIT));
  assert(fs.existsSync(path.join(f.dir, 'public-result/status.json')));
});
test('raw Prisma failure output containing an encoded secret is suppressed', t => {
  const f = fixture(t, 'process.stdout.write(process.env.DATABASE_URL); process.stderr.write(process.env.DIRECT_URL); process.exit(1);');
  const r = f.run(); assert.notEqual(r.status, 0);
  assert(r.events.some(event => event.failureCode === 'PREFLIGHT_FAILED'));
  assert.equal(r.events.at(-1).state, 'FAILED_OR_UNKNOWN');
  assert.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
});
test('interrupted Prisma child retains a failed step and stops publication', t => {
  const f = fixture(t, "process.kill(process.pid, 'SIGTERM');");
  const r = f.run(); assert.notEqual(r.status, 0);
  // Windows reports exit 1 for self-SIGTERM; Unix reports a signal with null status.
  assert(r.events.some(event => event.steps?.[0]?.status === 'FAILED' && event.steps[0].exitCode === (process.platform === 'win32' ? 1 : null)));
  assert.equal(r.events.at(-1).state, 'FAILED_OR_UNKNOWN');
  assert.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
});
test('interrupted installer yields wrapper unknown-outcome event', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.pkg, 'install.mjs'), "process.kill(process.pid, 'SIGTERM');");
  const r = f.run(); assert.notEqual(r.status, 0);
  assert.equal(r.events.at(-1).state, 'FAILED_OR_UNKNOWN');
  assert.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
});
for (const kind of ['missing', 'malformed']) test(`${kind} terminal receipt cannot publish success`, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.pkg, 'install.mjs'), kind === 'missing' ? 'process.exit(0);' : "import fs from 'node:fs'; fs.writeFileSync('execution-preflight.json', '{bad');");
  const r = f.run(); assert.notEqual(r.status, 0);
  assert.equal(r.events.at(-1).state, 'FAILED_OR_UNKNOWN');
  assert.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
});
for (const value of [null, false, 0, '', []]) test(`valid JSON ${JSON.stringify(value)} is rejected as a terminal receipt`, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.pkg, 'install.mjs'), `import fs from 'node:fs'; fs.writeFileSync('execution-preflight.json', ${JSON.stringify(JSON.stringify(value))});`);
  const r = f.run(); assert.notEqual(r.status, 0);
  assert.equal(r.events.at(-1).state, 'FAILED_OR_UNKNOWN');
  assert.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
});
test('an existing receipt is preserved and blocks another attempt', t => {
  const f = fixture(t, "require('node:fs').writeFileSync('engine-ran', 'yes');");
  const old = JSON.stringify({ untrusted: secret });
  fs.writeFileSync(path.join(f.pkg, 'execution-preflight.json'), old);
  const r = f.run(); assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(path.join(f.pkg, 'execution-preflight.json'), 'utf8'), old);
  assert.equal(fs.existsSync(path.join(f.pkg, 'engine-ran')), false);
  assert.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
});
test('invalid Render context blocks before installer or network', t => {
  const f = fixture(t, "require('node:fs').writeFileSync('engine-ran', 'yes');");
  f.env.RENDER_GIT_COMMIT = 'not-a-commit';
  const r = f.run(); assert.notEqual(r.status, 0);
  assert.equal(fs.existsSync(path.join(f.pkg, 'execution-preflight.json')), false);
  assert.equal(fs.existsSync(path.join(f.pkg, 'engine-ran')), false);
});
test('actual configured Prisma timeout retains failure and suppresses raw output', { timeout: 80000 }, t => {
  const f = fixture(t, 'process.stderr.write(process.env.DATABASE_URL); setInterval(() => {}, 1000);');
  const r = f.run(75000); assert.notEqual(r.status, 0);
  assert.equal(r.error, undefined, 'the installer deadline must finish before the test driver deadline');
  assert(r.events.some(event => event.failureCode === 'PREFLIGHT_FAILED'));
  assert.equal(r.events.at(-1).state, 'FAILED_OR_UNKNOWN');
  assert.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
});
