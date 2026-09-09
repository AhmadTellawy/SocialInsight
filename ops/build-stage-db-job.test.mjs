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
function fixture(t, prismaBody = 'process.exit(0)', observation) {
  const check = observation?.assert ?? assert;
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
    check.equal(path.dirname(real), tmp);
    check.match(path.basename(real), /^opiniup-stage-job-test-[A-Za-z0-9]+$/);
    fs.rmSync(real, { recursive: true });
    if (observation) {
      check.equal(fs.existsSync(real), false, 'only the owned fixture was removed');
      observation.cleaned(path.basename(real));
    }
  });
  const env = {};
  for (const key of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','HOME','USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { STAGING_INITIAL_INSTALL_MODE: 'preflight', STAGING_INITIAL_INSTALL_PROJECT: 'mnfiixtgnlzmduunfryt', STAGING_DB_TRANSPORT: 'session', STAGING_DB_ADMIN_PASSWORD: secret, RENDER_GIT_COMMIT: 'a'.repeat(40), RENDER_SERVICE_ID: 'srv-abcdefghijklmnopqrst' });
  const run = (timeout = 20000) => {
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, [path.join(dir, 'build-stage-db-job.mjs')], { cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout });
    const output = result.stdout + result.stderr;
    for (const value of [secret, encodeURIComponent(secret)]) check.equal(output.includes(value), false, 'secret must never reach wrapper logs');
    const events = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    observation?.ran({ startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, errorCode: result.error?.code ?? null, events });
    return { ...result, output, events };
  };
  return { dir, pkg, env, run };
}
test('fixed events retain successful preflight steps and one context; synthetic CLI only', t => {
  const f = observedCase(t, 'preflight-success'); const check = f.check;
  const r = f.run(); check.equal(r.status, 0, r.output);
  const states = r.events.filter(event => event.event === 'STAGE_INITIAL_INSTALL_STATE');
  check(states.some(event => event.steps[0]?.status === 'RUNNING'));
  check(states.some(event => event.steps[0]?.status === 'PASSED'));
  check.equal(states.at(-1).status, 'PASSED');
  check.equal(new Set(r.events.map(event => event.runId)).size, 1);
  check(r.events.every(event => event.operationsCommit === f.env.RENDER_GIT_COMMIT));
  check(fs.existsSync(path.join(f.dir, 'public-result/status.json')));
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

// Deploy cases use the same real wrapper/installer and an inert synthetic CLI.
// Optional evidence records contain projected events and counts, never child URLs.
function observedCase(t, id, prismaBody) {
  const record = { id, startedAt: new Date().toISOString(), assertionsAttempted: 0, assertionsPassed: 0, runs: [], cleanup: null };
  const invoke = (fn, args) => { record.assertionsAttempted++; const value = fn(...args); record.assertionsPassed++; return value; };
  const check = new Proxy(assert, {
    apply(target, thisArg, args) { return invoke(target, args); },
    get(target, key) { return typeof target[key] === 'function' ? (...args) => invoke(target[key], args) : target[key]; },
  });
  const f = fixture(t, prismaBody, {
    assert: check,
    ran(run) { record.runs.push(run); },
    cleaned(basename) {
      record.cleanup = { ownedFixtureBasename: basename, resolvedParentMatchedTemporaryDirectory: true, absentAfterRemoval: true, observedAt: new Date().toISOString() };
      record.finishedAt = new Date().toISOString();
      const evidenceDir = process.env.STAGE_DEPLOY_TEST_EVIDENCE_DIR;
      if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, `${id}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
      t.diagnostic(JSON.stringify({ id, assertionsAttempted: record.assertionsAttempted, assertionsPassed: record.assertionsPassed, cleanup: 'PASSED' }));
    },
  });
  return { ...f, check };
}
function deployCase(t, id, prismaBody) {
  const f = observedCase(t, id, prismaBody);
  f.env.STAGING_INITIAL_INSTALL_MODE = 'deploy';
  return f;
}
function tracedPrisma(failureStep = null) {
  return `const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
const file = args.includes('--file') ? path.basename(args[args.indexOf('--file') + 1]) : null;
const name = args[0] === 'migrate' && args[1] === 'deploy' ? 'MIGRATE_DEPLOY' : file === 'preflight.sql' ? 'PREFLIGHT' : file === 'executed-postflight.sql' ? 'POSTFLIGHT' : 'UNEXPECTED';
fs.appendFileSync('synthetic-cli-trace.jsonl', JSON.stringify({ name, schemaArgumentPresent: args.includes('--schema') }) + '\\n');
process.stdout.write(process.env.DATABASE_URL); process.stderr.write(process.env.DIRECT_URL);
process.exit(name === ${JSON.stringify(failureStep)} || name === 'UNEXPECTED' ? 1 : 0);`;
}
const engineTrace = f => fs.readFileSync(path.join(f.pkg, 'synthetic-cli-trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const statesOf = r => r.events.filter(event => event.event === 'STAGE_INITIAL_INSTALL_STATE');
test('deploy: full preflight migration postflight succeeds in order; synthetic CLI only', t => {
  const f = deployCase(t, 'deploy-success', tracedPrisma()); const check = f.check;
  const r = f.run(); check.equal(r.status, 0, r.output); check.equal(r.error, undefined);
  const expected = ['PREFLIGHT', 'MIGRATE_DEPLOY', 'POSTFLIGHT'];
  const trace = engineTrace(f); check.deepEqual(trace.map(step => step.name), expected); check(trace.every(step => step.schemaArgumentPresent));
  const states = statesOf(r); const terminal = states.at(-1);
  check.equal(terminal.status, 'PASSED'); check.equal(terminal.mode, '--deploy');
  check.deepEqual(terminal.steps.map(step => [step.name, step.status, step.exitCode]), expected.map(name => [name, 'PASSED', 0]));
  for (const name of expected) {
    check(states.some(event => event.steps.at(-1)?.name === name && event.steps.at(-1).status === 'RUNNING'));
    check(states.some(event => event.steps.at(-1)?.name === name && event.steps.at(-1).status === 'PASSED'));
  }
  check.equal(new Set(r.events.map(event => event.runId)).size, 1);
  check(r.events.every(event => event.operationsCommit === f.env.RENDER_GIT_COMMIT && event.serviceId === f.env.RENDER_SERVICE_ID));
  check.equal(r.events.at(-1).state, 'PASSED');
  const receipt = JSON.parse(fs.readFileSync(path.join(f.pkg, 'execution-deploy.json')));
  check.deepEqual(receipt.steps.map(step => step.name), expected); check.equal(receipt.status, 'PASSED');
  const summary = JSON.parse(fs.readFileSync(path.join(f.dir, 'public-result/status.json')));
  check.equal(summary.mode, 'deploy'); check.equal(summary.status, 'PASSED'); check.equal(summary.applicationDeployment, false);
  check.deepEqual(fs.readdirSync(path.join(f.dir, 'public-result')).sort(), ['index.html', 'status.json']);
});
for (const failedStep of ['MIGRATE_DEPLOY', 'POSTFLIGHT']) test(`deploy: ${failedStep} failure prevents publication and later steps`, t => {
  const f = deployCase(t, `deploy-failure-${failedStep.toLowerCase()}`, tracedPrisma(failedStep)); const check = f.check;
  const r = f.run(); check.equal(r.status, 1); check.equal(r.error, undefined);
  const expected = failedStep === 'MIGRATE_DEPLOY' ? ['PREFLIGHT', 'MIGRATE_DEPLOY'] : ['PREFLIGHT', 'MIGRATE_DEPLOY', 'POSTFLIGHT'];
  check.deepEqual(engineTrace(f).map(step => step.name), expected);
  const terminal = statesOf(r).at(-1); check.equal(terminal.status, 'FAILED_REVIEW_REQUIRED'); check.equal(terminal.failureCode, `${failedStep}_FAILED`);
  check.deepEqual(terminal.steps.map(step => step.name), expected);
  check.deepEqual(terminal.steps.map(step => [step.status, step.exitCode]), expected.map(name => name === failedStep ? ['FAILED', 1] : ['PASSED', 0]));
  check.equal(r.events.at(-1).state, 'FAILED_OR_UNKNOWN'); check.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
  check.equal(r.events.some(event => event.status === 'PASSED' || event.state === 'PASSED'), false);
  check.equal(fs.existsSync(path.join(f.pkg, 'executed-postflight.sql')), failedStep === 'POSTFLIGHT');
  const receipt = JSON.parse(fs.readFileSync(path.join(f.pkg, 'execution-deploy.json')));
  check.equal(receipt.status, 'FAILED_REVIEW_REQUIRED'); check.equal(receipt.failureCode, `${failedStep}_FAILED`);
});
const invalidDeployReceipts = [
  ['wrong-mode', "receipt.mode = '--preflight';"],
  ['wrong-project', "receipt.project = 'wrong-project';"],
  ['wrong-source', "receipt.sourceRevision = 'b'.repeat(40);"],
  ['missing-postflight', 'receipt.steps.pop();'],
  ['wrong-step-order', 'receipt.steps.reverse();'],
  ['failed-step', "receipt.steps[2].status = 'FAILED';"],
  ['nonzero-step-exit', 'receipt.steps[1].exitCode = 1;'],
  ['missing-steps', 'delete receipt.steps;'],
  ['missing-completion-time', 'delete receipt.finishedAt;'],
  ['unfinished-step-time', 'delete receipt.steps[2].finishedAt;'],
];
for (const [kind, mutation] of invalidDeployReceipts) test(`deploy: ${kind} terminal receipt is rejected after zero installer exit`, t => {
  const f = deployCase(t, `deploy-receipt-${kind}`, tracedPrisma()); const check = f.check;
  fs.writeFileSync(path.join(f.pkg, 'install.mjs'), `import fs from 'node:fs'; import { createHash } from 'node:crypto';
const now = new Date().toISOString();
const receipt = { sourceRevision: '4d9daeacdd7c7f4cc7a67b3fc1331736597b0037', project: 'mnfiixtgnlzmduunfryt', transport: 'session', host: 'aws-0-ap-southeast-1.pooler.supabase.com', prismaVersion: '6.19.2', sourceBindingSha256: createHash('sha256').update(fs.readFileSync('source-binding.json')).digest('hex'), mode: '--deploy', startedAt: now, finishedAt: now, status: 'PASSED', steps: ['PREFLIGHT', 'MIGRATE_DEPLOY', 'POSTFLIGHT'].map(name => ({ name, status: 'PASSED', exitCode: 0, startedAt: now, finishedAt: now })) };
${mutation}
fs.writeFileSync('execution-deploy.json', JSON.stringify(receipt)); process.exit(0);`);
  const r = f.run(); check.equal(r.status, 1); check.equal(r.error, undefined);
  check.equal(r.events.at(-1).state, 'FAILED_OR_UNKNOWN'); check.equal(fs.existsSync(path.join(f.dir, 'public-result')), false);
  check.equal(fs.existsSync(path.join(f.pkg, 'synthetic-cli-trace.jsonl')), false);
  check.equal(r.events.some(event => event.state === 'PASSED'), false);
});
