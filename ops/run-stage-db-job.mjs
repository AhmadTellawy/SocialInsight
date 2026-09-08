import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function dependencyEnvironment(env) {
  const clean = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (env[key]) clean[key] = env[key];
  }
  // No Render groups, database URLs/passwords, tokens, npm config or Node hooks.
  return { ...clean, CI: 'true', NO_COLOR: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    // This entry point targets Render's Linux builder only; no shell interpolation.
    if (process.platform !== 'linux') throw new Error('PLATFORM_INVALID');
    const deps = spawnSync('npm', ['ci'], {
      cwd: resolve(here, 'stage-initial-install'), env: dependencyEnvironment(process.env),
      timeout: 300000, stdio: 'inherit',
    });
    if (deps.status !== 0 || deps.error || deps.signal) throw new Error('DEPENDENCIES_FAILED');
    const job = spawnSync(process.execPath, [resolve(here, 'build-stage-db-job.mjs')], {
      cwd: here, env: process.env, timeout: 570000, stdio: 'inherit',
    });
    if (job.status !== 0 || job.error || job.signal) throw new Error('EXECUTOR_FAILED');
  } catch {
    console.error('STAGE_DB_JOB_LAUNCH_FAILED_REVIEW_REQUIRED');
    process.exitCode = 1;
  }
}
