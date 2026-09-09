import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dependencyEnvironment } from './run-stage-db-job.mjs';

test('dependency subprocess cannot inherit provider secrets or Node/npm hooks', () => {
  const sentinel = 'synthetic-private-provider-sentinel';
  const polluted = { ...process.env, STAGING_DB_ADMIN_PASSWORD: sentinel, DATABASE_URL: sentinel,
    DIRECT_URL: sentinel, SUPABASE_ACCESS_TOKEN: sentinel, JWT_SECRET: sentinel,
    NODE_OPTIONS: '--invalid-hook', npm_config_registry: sentinel, NPM_TOKEN: sentinel,
    STAGING_EXECUTION_RUN_ID: sentinel, RENDER_SERVICE_ID: sentinel };
  const clean = dependencyEnvironment(polluted);
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
    env: clean, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.includes(sentinel), false);
  const observed = JSON.parse(child.stdout);
  for (const key of ['STAGING_DB_ADMIN_PASSWORD','DATABASE_URL','DIRECT_URL','SUPABASE_ACCESS_TOKEN','JWT_SECRET','NODE_OPTIONS','npm_config_registry','NPM_TOKEN','STAGING_EXECUTION_RUN_ID','RENDER_SERVICE_ID']) assert.equal(observed[key], undefined, key);
  assert.equal(observed.CI, 'true');
});

import { runStageJob } from './run-stage-db-job.mjs';
const basicEnv = { PATH: process.env.PATH, HOME: process.env.HOME, RENDER_SERVICE_ID: 'srv-controlled', RENDER_GIT_COMMIT: 'a'.repeat(40), STAGING_INITIAL_INSTALL_MODE: 'verify' };

test('verify orders filtered dependency install, TLS gate, then publisher', () => {
  const calls = []; const lines = [];
  runStageJob({ here: process.cwd(), env: basicEnv, platform: 'linux', run: (command, args, options) => {
    calls.push(command === 'npm' ? 'dependencies' : 'publisher');
    assert.equal(options.env.STAGING_DB_ADMIN_PASSWORD, undefined);
    if (command === 'npm') assert.equal(options.env.RENDER_SERVICE_ID, undefined);
    return { status: 0 };
  }, verifyTLS: ({ env }) => { calls.push('tls'); assert.equal(env.RENDER_SERVICE_ID, basicEnv.RENDER_SERVICE_ID); return { event: 'controlled-pass' }; }, emit: line => lines.push(line) });
  assert.deepEqual(calls, ['dependencies', 'tls', 'publisher']); assert.deepEqual(lines, ['{"event":"controlled-pass"}']);
});

test('credential environment fails before dependency lifecycle or TLS execution', () => {
  for (const key of ['STAGING_DB_ADMIN_PASSWORD', 'DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET', 'SUPABASE_ACCESS_TOKEN', 'RESEND_API_KEY', 'AWS_ACCESS_KEY_ID', 'PGPASSFILE']) {
    let calls = 0;
    assert.throws(() => runStageJob({ here: process.cwd(), env: { ...basicEnv, [key]: 'synthetic' }, platform: 'linux', run: () => { calls++; }, verifyTLS: () => { calls++; } }), /VERIFY_CREDENTIAL_CONFIGURATION_PRESENT/);
    assert.equal(calls, 0);
  }
});

test('dependency and TLS failures cannot reach publisher', () => {
  let calls = 0;
  assert.throws(() => runStageJob({ here: process.cwd(), env: basicEnv, platform: 'linux', run: () => { calls++; return { status: 1 }; }, verifyTLS: () => assert.fail('must not run') }), /DEPENDENCIES_FAILED/);
  assert.equal(calls, 1); calls = 0;
  assert.throws(() => runStageJob({ here: process.cwd(), env: basicEnv, platform: 'linux', run: () => { calls++; return { status: 0 }; }, verifyTLS: () => { throw new Error('CONTROLLED_TLS_FAILURE'); } }), /CONTROLLED_TLS_FAILURE/);
  assert.equal(calls, 1);
});

test('credentialed modes do not invoke controlled TLS; dependency child remains filtered', () => {
  for (const mode of ['preflight', 'deploy']) {
    const observed = [];
    runStageJob({ here: process.cwd(), env: { ...basicEnv, STAGING_INITIAL_INSTALL_MODE: mode, STAGING_DB_ADMIN_PASSWORD: 'synthetic' }, platform: 'linux', run: (command, args, options) => { observed.push(options.env); return { status: 0 }; }, verifyTLS: () => assert.fail('TLS harness must not see credentials') });
    assert.equal(observed[0].STAGING_DB_ADMIN_PASSWORD, undefined); assert.equal(observed[1].STAGING_DB_ADMIN_PASSWORD, 'synthetic');
  }
});

test('wrong platform and invalid mode fail before children', () => {
  for (const [platform, mode] of [['win32', 'verify'], ['linux', 'unexpected']]) {
    assert.throws(() => runStageJob({ here: process.cwd(), env: { ...basicEnv, STAGING_INITIAL_INSTALL_MODE: mode }, platform, run: () => assert.fail('no child allowed') }));
  }
});
