import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCredentialFree, credentialDiagnosticNames, verifyLinuxTLS } from './stage-engine-tls/verify.mjs';
import { verifyCredentialedParity } from './stage-credentialed-parity/verify.mjs';

const OMITTED_PROVIDER_FUNCTIONS = new Set(['BASH_FUNC_copy_secret_files%%', 'BASH_FUNC_remove_secret_files%%']);

export function providerShellEnvironment(env) {
  const clean = Object.create(null);
  for (const key of Object.keys(env)) {
    if (OMITTED_PROVIDER_FUNCTIONS.has(key)) continue;
    // A names-only view: never access dropped bodies, and defer every other
    // value until after the existing credential-name guard permits execution.
    Object.defineProperty(clean, key, { enumerable: true, get: () => env[key] });
  }
  return clean;
}
export function dependencyEnvironment(env) {
  const clean = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (env[key]) clean[key] = env[key];
  }
  // No Render groups, database URLs/passwords, tokens, npm config or Node hooks.
  return { ...clean, CI: 'true', NO_COLOR: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' };
}

const FAILURE_CODES = new Set(['PLATFORM_INVALID', 'MODE_INVALID', 'VERIFY_CREDENTIAL_CONFIGURATION_PRESENT', 'DEPENDENCIES_FAILED', 'EXECUTOR_FAILED',
  'OPENSSL_SELECTION_INVALID', 'OPENSSL_SELECTION_AMBIGUOUS_OR_MISSING', 'PROVIDER_IDENTITY_INVALID', 'TLS_HARNESS_BINDING_INVALID', 'TLS_HARNESS_FAILED', 'TLS_RECEIPT_FILE_INVALID', 'TLS_ENGINE_FILE_INVALID', 'TLS_RECEIPT_INVALID', 'PARITY_MANIFEST_INVALID', 'PARITY_CONTEXT_INVALID', 'PARITY_INPUT_MISMATCH', 'PARITY_REPLAY_OR_OUTPUT_INVALID', 'PARITY_NATIVE_ENGINE_INVALID', 'PARITY_REPOSITORY_INVALID', 'PARITY_ENGINE_VERSION_FAILED']);
const SPAWN_ERROR_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOMEM', 'ETIMEDOUT', 'E2BIG', 'EAGAIN', 'ENOBUFS']);
const SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT']);
const spawnProjection = result => ({ attempted: true, status: Number.isInteger(result?.status) && result.status >= 0 && result.status <= 255 ? result.status : null,
  errorCode: result?.error ? (SPAWN_ERROR_CODES.has(result.error.code) ? result.error.code : 'UNCLASSIFIED_SPAWN_ERROR') : null,
  signal: result?.signal ? (SIGNALS.has(result.signal) ? result.signal : 'UNCLASSIFIED_SIGNAL') : null });

export function runStageJob({ here, env, platform = process.platform, run = spawnSync, verifyTLS = verifyLinuxTLS, verifyParity = verifyCredentialedParity, emit = console.log, emitFailure = console.error }) {
  let phase = 'CONFIGURATION';
  let spawn = { attempted: false, status: null, errorCode: null, signal: null };
  const invoke = (...args) => {
    spawn = { attempted: true, status: null, errorCode: null, signal: null };
    try { const result = run(...args); spawn = spawnProjection(result); return result; }
    catch (error) { spawn = spawnProjection({ error }); throw error; }
  };
  try {
    env = providerShellEnvironment(env);
    if (platform !== 'linux') throw new Error('PLATFORM_INVALID');
    const mode = env.STAGING_INITIAL_INSTALL_MODE || 'verify';
    if (!['verify', 'preflight', 'deploy'].includes(mode)) throw new Error('MODE_INVALID');
    if (mode === 'verify') assertCredentialFree(env);
    phase = 'DEPENDENCIES';
    const deps = invoke('npm', ['ci'], {
      cwd: resolve(here, 'stage-initial-install'), env: dependencyEnvironment(env), timeout: 300000, stdio: 'inherit',
    });
    if (deps.status !== 0 || deps.error || deps.signal) throw new Error('DEPENDENCIES_FAILED');
    if (mode === 'verify') {
      phase = 'TLS'; spawn = { attempted: false, status: null, errorCode: null, signal: null };
      const summary = verifyTLS({ here, env: { ...dependencyEnvironment(env), RENDER_SERVICE_ID: env.RENDER_SERVICE_ID, RENDER_GIT_COMMIT: env.RENDER_GIT_COMMIT }, run: invoke });
      emit(JSON.stringify(summary));
    } else {
      phase = 'PARITY'; spawn = { attempted: false, status: null, errorCode: null, signal: null };
      const summary = verifyParity({ here, env: dependencyEnvironment(env), run: invoke, context: {
        mode, project: env.STAGING_INITIAL_INSTALL_PROJECT, transport: env.STAGING_DB_TRANSPORT,
        serviceId: env.RENDER_SERVICE_ID, operationsCommit: env.RENDER_GIT_COMMIT,
      } });
      emit(JSON.stringify(summary));
    }
    phase = 'EXECUTOR'; spawn = { attempted: false, status: null, errorCode: null, signal: null };
    const job = invoke(process.execPath, [resolve(here, 'build-stage-db-job.mjs')], { cwd: here, env, timeout: 570000, stdio: 'inherit' });
    if (job.status !== 0 || job.error || job.signal) throw new Error('EXECUTOR_FAILED');
  } catch (error) {
    // Map known codes, never copy raw errors, messages, environment values or child output.
    const code = FAILURE_CODES.has(error?.message) ? error.message : 'UNCLASSIFIED_FAILURE';
    const event = { event: 'STAGE_DB_JOB_LAUNCH_FAILURE', phase, code, spawn };
    if (phase === 'CONFIGURATION' && code === 'VERIFY_CREDENTIAL_CONFIGURATION_PRESENT') Object.assign(event, credentialDiagnosticNames(env));
    try { emitFailure(JSON.stringify(event)); } catch { /* Keep the original failure and fail closed. */ }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // Dedicated Render Linux entry point. No shell interpolation.
    runStageJob({ here: dirname(fileURLToPath(import.meta.url)), env: process.env });
  } catch {
    console.error('STAGE_DB_JOB_LAUNCH_FAILED_REVIEW_REQUIRED');
    process.exitCode = 1;
  }
}
