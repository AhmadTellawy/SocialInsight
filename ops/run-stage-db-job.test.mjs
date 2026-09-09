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

test('credential failure emits only bounded sorted safe names without accessing their values', () => {
  const values = { ...basicEnv }; const lines = []; let calls = 0;
  for (const name of ['STAGING_DB_ADMIN_PASSWORD', 'DATABASE_URL', 'SECRET\nsynthetic-private-name', ...Array.from({ length: 18 }, (_, i) => `TOKEN_${String(i).padStart(2, '0')}`)]) {
    Object.defineProperty(values, name, { enumerable: true, get: () => assert.fail('credential value accessed') });
  }
  assert.throws(() => runStageJob({ here: process.cwd(), env: values, platform: 'linux', run: () => { calls++; }, emitFailure: line => lines.push(line) }), /VERIFY_CREDENTIAL_CONFIGURATION_PRESENT/);
  assert.equal(calls, 0); assert.equal(lines.length, 1); assert.equal(lines[0].includes('synthetic-private-name'), false);
  const event = JSON.parse(lines[0]); assert.equal(event.phase, 'CONFIGURATION'); assert.equal(event.code, 'VERIFY_CREDENTIAL_CONFIGURATION_PRESENT');
  assert.deepEqual(event.spawn, { attempted: false, status: null, errorCode: null, signal: null });
  assert.equal(event.variableNames.length, 16); assert.equal(event.variableNamesTruncated, true); assert.deepEqual(event.variableNames, [...event.variableNames].sort());
  assert.ok(event.variableNames.every(name => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)));
});

test('unsafe credential variable names use a fixed fallback and never leak the original name', () => {
  const lines = [];
  assert.throws(() => runStageJob({ here: process.cwd(), env: { ...basicEnv, ['SECRET\nsynthetic-private-name']: 'synthetic-private-value' }, platform: 'linux', emitFailure: line => lines.push(line), run: () => assert.fail('must not execute') }));
  assert.deepEqual(JSON.parse(lines[0]).variableNames, ['UNSAFE_VARIABLE_NAME']); assert.equal(lines[0].includes('synthetic-private'), false);
});

test('spawn diagnostics retain fixed status codes and omit errors output and arbitrary properties', () => {
  for (const result of [
    { status: null, error: Object.assign(new Error('synthetic-private-error'), { code: 'ENOENT' }), signal: null },
    { status: 127, error: undefined, signal: null },
    { status: null, error: Object.assign(new Error('synthetic-private-error'), { code: 'synthetic-private-code' }), signal: 'synthetic-private-signal' },
    { status: null, error: Object.assign(new Error('synthetic-private-error'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM' }
  ]) {
    const lines = []; let calls = 0;
    assert.throws(() => runStageJob({ here: process.cwd(), env: basicEnv, platform: 'linux', run: () => { calls++; return { ...result, stdout: 'synthetic-private-stdout', stderr: 'synthetic-private-stderr' }; }, emitFailure: line => lines.push(line) }), /DEPENDENCIES_FAILED/);
    assert.equal(calls, 1); assert.equal(lines.length, 1); assert.equal(lines[0].includes('synthetic-private'), false);
    const event = JSON.parse(lines[0]); assert.equal(event.phase, 'DEPENDENCIES'); assert.equal(event.code, 'DEPENDENCIES_FAILED');
    assert.equal(event.spawn.status, result.status); assert.equal(event.spawn.attempted, true);
    assert.equal(event.spawn.errorCode, result.error ? (['ENOENT', 'ETIMEDOUT'].includes(result.error.code) ? result.error.code : 'UNCLASSIFIED_SPAWN_ERROR') : null);
    assert.equal(event.spawn.signal, result.signal ? (result.signal === 'SIGTERM' ? 'SIGTERM' : 'UNCLASSIFIED_SIGNAL') : null);
  }
});

test('TLS and executor failures record their own phase without stale dependency spawn state', () => {
  const tlsLines = [];
  assert.throws(() => runStageJob({ here: process.cwd(), env: basicEnv, platform: 'linux', run: () => ({ status: 0 }), verifyTLS: () => { throw new Error('OPENSSL_SELECTION_AMBIGUOUS_OR_MISSING'); }, emitFailure: line => tlsLines.push(line) }));
  assert.equal(JSON.parse(tlsLines[0]).phase, 'TLS'); assert.equal(JSON.parse(tlsLines[0]).spawn.attempted, false);
  const executorLines = []; let calls = 0;
  assert.throws(() => runStageJob({ here: process.cwd(), env: basicEnv, platform: 'linux', run: () => ({ status: ++calls === 1 ? 0 : 3 }), verifyTLS: () => ({ status: 'PASSED' }), emit: () => {}, emitFailure: line => executorLines.push(line) }), /EXECUTOR_FAILED/);
  assert.equal(calls, 2); assert.equal(JSON.parse(executorLines[0]).phase, 'EXECUTOR'); assert.equal(JSON.parse(executorLines[0]).spawn.status, 3);
});

test('thrown spawn errors and unknown TLS errors emit fixed fallback codes only', () => {
  const thrown = [];
  assert.throws(() => runStageJob({ here: process.cwd(), env: basicEnv, platform: 'linux', run: () => { throw Object.assign(new Error('synthetic-private-error'), { code: 'EACCES', stdout: 'synthetic-private-output' }); }, emitFailure: line => thrown.push(line) }));
  assert.equal(JSON.parse(thrown[0]).code, 'UNCLASSIFIED_FAILURE'); assert.equal(JSON.parse(thrown[0]).spawn.errorCode, 'EACCES'); assert.equal(thrown[0].includes('synthetic-private'), false);
  const tlsLines = [];
  assert.throws(() => runStageJob({ here: process.cwd(), env: basicEnv, platform: 'linux', run: () => ({ status: 0 }), verifyTLS: ({ run }) => { run('controlled', [], {}); throw new Error('synthetic-private-tls-error'); }, emitFailure: line => tlsLines.push(line) }));
  assert.equal(JSON.parse(tlsLines[0]).phase, 'TLS'); assert.equal(JSON.parse(tlsLines[0]).spawn.status, 0); assert.equal(JSON.parse(tlsLines[0]).code, 'UNCLASSIFIED_FAILURE'); assert.equal(tlsLines[0].includes('synthetic-private'), false);
});

import { providerShellEnvironment } from './run-stage-db-job.mjs';
const providerFunctionNames = ['BASH_FUNC_copy_secret_files%%', 'BASH_FUNC_remove_secret_files%%'];
const withUnreadProviderBodies = (source = {}) => {
  const env = { ...source };
  for (const key of providerFunctionNames) Object.defineProperty(env, key, { enumerable: true, get: () => assert.fail('provider function body accessed') });
  return env;
};

test('provider boundary drops only exact observed names before accessing any value', () => {
  const env = withUnreadProviderBodies();
  Object.defineProperty(env, 'DATABASE_URL', { enumerable: true, get: () => assert.fail('credential value accessed') });
  const clean = providerShellEnvironment(env);
  assert.equal(Object.getPrototypeOf(clean), null); assert.deepEqual(Object.keys(clean), ['DATABASE_URL']);
  for (const key of providerFunctionNames) { assert.equal(Object.hasOwn(clean, key), false); assert.equal(clean[key], undefined); assert.equal(Object.hasOwn(env, key), true); }
});

test('provider boundary preserves pre-dependency rejection of every other credential name', () => {
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'STAGING_DB_ADMIN_PASSWORD', 'JWT_SECRET', 'SUPABASE_ACCESS_TOKEN', 'RESEND_API_KEY',
    'BASH_FUNC_unknown_secret_files%%', 'BASH_FUNC_copy_secret_files%%%', 'BASH_FUNC_remove_secret_files%%tail', 'bash_func_copy_secret_files%%', 'copy_secret_files']) {
    const env = withUnreadProviderBodies(basicEnv); const lines = []; let calls = 0;
    Object.defineProperty(env, key, { enumerable: true, get: () => assert.fail('rejected credential value accessed') });
    assert.throws(() => runStageJob({ here: process.cwd(), env, platform: 'linux', run: () => { calls++; }, emitFailure: line => lines.push(line) }), /VERIFY_CREDENTIAL_CONFIGURATION_PRESENT/);
    assert.equal(calls, 0); assert.equal(JSON.parse(lines[0]).spawn.attempted, false);
  }
});

test('verify children receive no observed provider function names or bodies and preserve success ordering', () => {
  const env = withUnreadProviderBodies(basicEnv); const order = []; const diagnostics = [];
  runStageJob({ here: process.cwd(), env, platform: 'linux', run: (command, args, options) => {
    order.push(command === 'npm' ? 'dependencies' : 'executor');
    for (const key of providerFunctionNames) assert.equal(Object.hasOwn(options.env, key), false);
    // Force the same remaining-value enumeration performed by a subprocess launcher.
    const materialized = Object.fromEntries(Object.keys(options.env).map(key => [key, options.env[key]]));
    assert.equal(JSON.stringify(materialized).includes('BASH_FUNC_'), false);
    return { status: 0 };
  }, verifyTLS: ({ env: clean }) => {
    order.push('tls'); for (const key of providerFunctionNames) assert.equal(Object.hasOwn(clean, key), false);
    assert.equal(clean.RENDER_SERVICE_ID, basicEnv.RENDER_SERVICE_ID); return { status: 'PASSED' };
  }, emit: () => {}, emitFailure: line => diagnostics.push(line) });
  assert.deepEqual(order, ['dependencies', 'tls', 'executor']); assert.deepEqual(diagnostics, []);
});

test('real controlled child cannot inherit omitted provider body markers', () => {
  const body = 'synthetic-provider-function-body-marker';
  const env = providerShellEnvironment({ ...dependencyEnvironment(process.env), [providerFunctionNames[0]]: body, [providerFunctionNames[1]]: body });
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { env, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(child.status, 0); assert.equal(child.stdout.includes(body), false);
  const observed = JSON.parse(child.stdout); for (const name of providerFunctionNames) assert.equal(Object.hasOwn(observed, name), false);
});

test('credentialed modes retain intended executor credentials but omit provider functions in all children', () => {
  for (const mode of ['preflight', 'deploy']) {
    const observed = [];
    const env = withUnreadProviderBodies({ ...basicEnv, STAGING_INITIAL_INSTALL_MODE: mode, STAGING_DB_ADMIN_PASSWORD: 'synthetic-approved-stage-password' });
    runStageJob({ here: process.cwd(), env, platform: 'linux', run: (command, args, options) => {
      observed.push(Object.fromEntries(Object.keys(options.env).map(key => [key, options.env[key]])));
      return { status: 0 };
    }, verifyTLS: () => assert.fail('controlled TLS must not run in credentialed mode') });
    assert.equal(observed.length, 2); assert.equal(observed[0].STAGING_DB_ADMIN_PASSWORD, undefined);
    assert.equal(observed[1].STAGING_DB_ADMIN_PASSWORD, 'synthetic-approved-stage-password');
    for (const childEnv of observed) for (const key of providerFunctionNames) assert.equal(Object.hasOwn(childEnv, key), false);
  }
});
