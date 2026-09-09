import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCredentialFree, verifyLinuxTLS } from './stage-engine-tls/verify.mjs';

export function dependencyEnvironment(env) {
  const clean = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (env[key]) clean[key] = env[key];
  }
  // No Render groups, database URLs/passwords, tokens, npm config or Node hooks.
  return { ...clean, CI: 'true', NO_COLOR: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' };
}

export function runStageJob({ here, env, platform = process.platform, run = spawnSync, verifyTLS = verifyLinuxTLS, emit = console.log }) {
  if (platform !== 'linux') throw new Error('PLATFORM_INVALID');
  const mode = env.STAGING_INITIAL_INSTALL_MODE || 'verify';
  if (!['verify', 'preflight', 'deploy'].includes(mode)) throw new Error('MODE_INVALID');
  if (mode === 'verify') assertCredentialFree(env);
  const deps = run('npm', ['ci'], {
    cwd: resolve(here, 'stage-initial-install'), env: dependencyEnvironment(env), timeout: 300000, stdio: 'inherit',
  });
  if (deps.status !== 0 || deps.error || deps.signal) throw new Error('DEPENDENCIES_FAILED');
  if (mode === 'verify') {
    const summary = verifyTLS({ here, env: { ...dependencyEnvironment(env), RENDER_SERVICE_ID: env.RENDER_SERVICE_ID, RENDER_GIT_COMMIT: env.RENDER_GIT_COMMIT }, run });
    emit(JSON.stringify(summary));
  }
  const job = run(process.execPath, [resolve(here, 'build-stage-db-job.mjs')], { cwd: here, env, timeout: 570000, stdio: 'inherit' });
  if (job.status !== 0 || job.error || job.signal) throw new Error('EXECUTOR_FAILED');
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
