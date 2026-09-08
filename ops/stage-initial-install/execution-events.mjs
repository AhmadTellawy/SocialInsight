import { writeSync } from 'node:fs';
import { COMMIT, PROJECT, PRISMA_VERSION, TARGETS } from './contract.mjs';

const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const failures = new Set(['PREFLIGHT_FAILED','MIGRATE_DEPLOY_FAILED','POSTFLIGHT_FAILED','EXECUTION_FAILED']);
const fail = () => { throw new Error('EXECUTION_EVENT_INVALID'); };
export function executionContext(env, required = true) {
  const runId = env.STAGING_EXECUTION_RUN_ID;
  if (!uuid.test(runId ?? '')) fail();
  const operationsCommit = /^[a-f0-9]{40}$/.test(env.RENDER_GIT_COMMIT ?? '') ? env.RENDER_GIT_COMMIT : null;
  const serviceId = /^srv-[a-z0-9]{20,32}$/.test(env.RENDER_SERVICE_ID ?? '') ? env.RENDER_SERVICE_ID : null;
  if (required && (!operationsCommit || !serviceId)) fail();
  return { runId, operationsCommit, serviceId };
}
export function projectReceipt(receipt, context) {
  const checkedContext = executionContext({ STAGING_EXECUTION_RUN_ID: context.runId, RENDER_GIT_COMMIT: context.operationsCommit, RENDER_SERVICE_ID: context.serviceId });
  if (receipt.sourceRevision !== COMMIT || receipt.project !== PROJECT || receipt.prismaVersion !== PRISMA_VERSION ||
      !Object.hasOwn(TARGETS, receipt.transport ?? '') || receipt.host !== TARGETS[receipt.transport].host ||
      !/^[a-f0-9]{64}$/.test(receipt.sourceBindingSha256 ?? '') || !['--preflight','--deploy'].includes(receipt.mode) ||
      !['RUNNING','PASSED','FAILED_REVIEW_REQUIRED'].includes(receipt.status) || !validTime(receipt.startedAt) ||
      (receipt.finishedAt !== undefined && !validTime(receipt.finishedAt)) ||
      !Array.isArray(receipt.steps) || receipt.steps.length > (receipt.mode === '--preflight' ? 1 : 3)) fail();
  const names = ['PREFLIGHT','MIGRATE_DEPLOY','POSTFLIGHT'];
  const steps = receipt.steps.map((step, index) => {
    if (step.name !== names[index] || !validTime(step.startedAt) || !['RUNNING','PASSED','FAILED'].includes(step.status) ||
        (step.finishedAt !== undefined && !validTime(step.finishedAt)) ||
        (step.exitCode !== undefined && step.exitCode !== null && (!Number.isInteger(step.exitCode) || step.exitCode < 0 || step.exitCode > 255))) fail();
    return { name: step.name, status: step.status, startedAt: step.startedAt, finishedAt: step.finishedAt ?? null, exitCode: step.exitCode ?? null };
  });
  if (receipt.failureCode !== undefined && !failures.has(receipt.failureCode)) fail();
  return { event: 'STAGE_INITIAL_INSTALL_STATE', ...checkedContext, project: PROJECT, sourceRevision: COMMIT,
    sourceBindingSha256: receipt.sourceBindingSha256, prismaVersion: PRISMA_VERSION, transport: receipt.transport,
    host: TARGETS[receipt.transport].host, mode: receipt.mode, status: receipt.status, startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt ?? null, failureCode: receipt.failureCode ?? null, steps };
}
export function emitReceipt(receipt, context) {
  writeSync(1, JSON.stringify(projectReceipt(receipt, context)) + '\n');
}
export function emitWrapper(context, mode, state) {
  if (!['verify','preflight','deploy'].includes(mode) || !['STARTED','PASSED','FAILED_OR_UNKNOWN'].includes(state)) fail();
  const checkedContext = executionContext({ STAGING_EXECUTION_RUN_ID: context.runId, RENDER_GIT_COMMIT: context.operationsCommit, RENDER_SERVICE_ID: context.serviceId }, mode !== 'verify');
  writeSync(1, JSON.stringify({ event: 'STAGE_INITIAL_INSTALL_WRAPPER', ...checkedContext, project: PROJECT, sourceRevision: COMMIT, mode, state, observedAt: new Date().toISOString() }) + '\n');
}
