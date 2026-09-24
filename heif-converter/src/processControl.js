import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { verifyTempRoot, verifyResourceCounters, TEMP_ROOT } from './confinementBootstrap.js';
import { ServiceError } from './errors.js';

const required = Object.freeze({ supervisorLimit: 128, workerLimit: 32, brokerFilterInstalled: true,
  forkBoundsPassed: true, threadBoundsPassed: true, raiseDenied: true, inheritancePassed: true,
  escapeDenied: true, countersUnchanged: true, cleanupPassed: true, attribution: 'UNCLAIMED' });
const unavailable = () => new ServiceError(503, 'CONFINEMENT_UNAVAILABLE', 'Image processing is unavailable');
export function validateProcessControl(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== Object.keys(required).length
    || Object.entries(required).some(([key, expected]) => !Object.hasOwn(value, key) || value[key] !== expected)) throw unavailable();
  return Object.freeze({ ...value });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function reapGroup(pid) {
  try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let i = 0; i < 100; i++) {
    try { process.kill(-pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await wait(20);
  }
  throw unavailable();
}
// Trusted startup caller only; neither argv nor request data chooses a mode.
export async function runProcessProbe(limit, kind, { signal, io = fs } = {}) {
  if (![128, 32].includes(limit) || !['forks', 'threads'].includes(kind)) throw unavailable();
  let job, child, cleanup = false;
  try {
    if (signal?.aborted) throw unavailable();
    if (limit === 32) {
      job = await io.mkdtemp(`${TEMP_ROOT}/job-`);
      await io.chmod(job, 0o700);
      await io.writeFile(`${job}/input.heic`, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
      await io.writeFile(`${job}/decoded.png`, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    }
    const args = limit === 128 ? ['--supervisor-process-proof', kind, String(process.pid)]
      : ['--worker-process-probe', job, kind, String(process.pid)];
    return await new Promise((resolve, reject) => {
      child = spawn('/usr/local/bin/si-heif-confine', args, { detached: true, shell: false, env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', diagnosticBytes = 0, failure;
      const stop = () => { failure = unavailable(); if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
      const timer = setTimeout(stop, 10000);
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 1024) stop(); });
      child.stderr.on('data', chunk => { diagnosticBytes += chunk.length; if (diagnosticBytes > 1024) stop(); });
      child.once('error', () => { failure = unavailable(); });
      child.once('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', stop);
        if (failure || code !== 0) { reject(failure ?? unavailable()); return; }
        try { resolve(JSON.parse(output)); } catch { reject(unavailable()); }
      });
    });
  } finally {
    if (child?.pid) await reapGroup(child.pid);
    cleanup = true;
    if (job && cleanup) await io.rm(job, { recursive: true, force: false });
  }
}

export async function runStartupProcessControl(resources, { signal, probe = runProcessProbe,
  checkRoot = verifyTempRoot, checkCounters = verifyResourceCounters } = {}) {
  await checkRoot();
  await checkCounters(resources);
  for (const limit of [128, 32]) for (const kind of ['forks', 'threads']) {
    if (signal?.aborted) throw unavailable();
    const report = await probe(limit, kind, { signal });
    if (!report || report.limit !== limit || report.soft !== limit || report.hard !== limit
      || report.kind !== kind || report.error !== 'EAGAIN' || !Number.isInteger(report.created)
      || report.created < 1 || report.created > limit
      || ['raiseDenied', 'inheritancePassed', 'escapeDenied', 'cleanupPassed', 'gatewayInstalled'].some(key => report[key] !== true)) throw unavailable();
    await checkCounters(resources);
    await checkRoot();
  }
  return validateProcessControl(required);
}
