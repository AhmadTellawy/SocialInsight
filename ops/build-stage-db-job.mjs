import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { executionContext, emitWrapper, projectReceipt } from './stage-initial-install/execution-events.mjs';

// Dedicated Stage build job. Its only publish directory is public-result/.
// The application and this source directory must never be the publish target.
const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, 'stage-initial-install');
const publishDir = resolve(here, 'public-result');
const expectedProject = 'mnfiixtgnlzmduunfryt';
const expectedSource = '4d9daeacdd7c7f4cc7a67b3fc1331736597b0037';
let mode, context;
try {
  mode = process.env.STAGING_INITIAL_INSTALL_MODE || 'verify';
  if (!['verify', 'preflight', 'deploy'].includes(mode)) throw new Error('MODE_INVALID');
  const env = { ...process.env, STAGING_EXECUTION_RUN_ID: randomUUID() };
  context = executionContext(env, mode !== 'verify');
  emitWrapper(context, mode, 'STARTED');
  if (existsSync(publishDir)) throw new Error('PUBLISH_DIRECTORY_ALREADY_EXISTS');
  if (mode !== 'verify' && process.env.STAGING_INITIAL_INSTALL_PROJECT !== expectedProject) throw new Error('TARGET_NOT_ACKNOWLEDGED');
  const child = spawnSync(process.execPath, [resolve(packageDir, 'install.mjs'), `--${mode}`], {
    cwd: packageDir, env, windowsHide: true,
    timeout: 540000, stdio: ['ignore', 'inherit', 'inherit'],
  });
  // Only the reviewed installer's projected events/fixed codes are inherited.
  // That installer always captures and suppresses raw Prisma output.
  if (child.status !== 0 || child.error || child.signal) throw new Error('INSTALLER_FAILED');
  const receipt = mode === 'verify' ? null : JSON.parse(readFileSync(resolve(packageDir, `execution-${mode}.json`), 'utf8'));
  if (mode !== 'verify') {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('RECEIPT_INVALID');
    projectReceipt(receipt, context);
  }
  const expectedSteps = mode === 'preflight' ? ['PREFLIGHT'] : ['PREFLIGHT', 'MIGRATE_DEPLOY', 'POSTFLIGHT'];
  if (mode !== 'verify' && (receipt.status !== 'PASSED' || receipt.project !== expectedProject || receipt.sourceRevision !== expectedSource || receipt.mode !== `--${mode}` ||
      JSON.stringify(receipt.steps?.map(step => step.name)) !== JSON.stringify(expectedSteps) || receipt.steps.some(step => step.status !== 'PASSED' || step.exitCode !== 0))) throw new Error('RECEIPT_INVALID');
  const summary = { job: 'stage-initial-database-install', project: expectedProject, sourceRevision: expectedSource, mode, status: 'PASSED', completedAt: new Date().toISOString(), applicationDeployment: false };
  mkdirSync(publishDir);
  writeFileSync(resolve(publishDir, 'status.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(resolve(publishDir, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Stage database job</title><p>Stage database job completed. This is an operations receipt, not the application.</p></html>\n', { flag: 'wx' });
  emitWrapper(context, mode, 'PASSED');
  console.log(`STAGE_DB_BUILD_JOB_PASSED mode=${mode} source=${expectedSource}`);
} catch {
  if (context && ['verify', 'preflight', 'deploy'].includes(mode)) {
    try { emitWrapper(context, mode, 'FAILED_OR_UNKNOWN'); } catch { /* No raw error output. */ }
  }
  console.error('STAGE_DB_BUILD_JOB_FAILED_REVIEW_REQUIRED');
  process.exitCode = 1;
}
