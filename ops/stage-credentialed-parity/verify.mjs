import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const RUN_04_MANIFEST_SHA256 = '04cc923b8d7bf3ce92a2301438ceb6ad3510c4c9eeb5bb70cfe90f730b545379';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, code) => { if (!condition) throw new Error(code); };
const INPUT_KEYS = ['platform', 'node', 'prismaVersion', 'engineVersion', 'engineSha256', 'prismaCliSha256', 'contractSha256', 'stageCaSha256', 'sourceBindingSha256'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fileHash = path => { const stat = lstatSync(path); check(stat.isFile() && !stat.isSymbolicLink(), 'PARITY_INPUT_MISMATCH'); return sha(readFileSync(path)); };

export function readParityManifest(path) {
  try {
    const stat = lstatSync(path);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8192, 'PARITY_MANIFEST_INVALID');
    const bytes = readFileSync(path);
    check(sha(bytes) === RUN_04_MANIFEST_SHA256, 'PARITY_MANIFEST_INVALID');
    return JSON.parse(bytes);
  } catch { throw new Error('PARITY_MANIFEST_INVALID'); }
}

export function assertParityContext(binding, context) {
  check(plain(context) && ['preflight', 'deploy'].includes(context.mode) && context.project === binding.target.project && context.transport === binding.target.transport &&
    context.serviceId === binding.proof.serviceId && /^[a-f0-9]{40}$/.test(context.operationsCommit ?? ''), 'PARITY_CONTEXT_INVALID');
}

export function assertParityInputs(binding, observed) {
  check(plain(observed) && INPUT_KEYS.every(key => observed[key] === binding.runtime[key]) && observed.sourceRevision === binding.target.sourceRevision, 'PARITY_INPUT_MISMATCH');
}

export function assertCheckedOutCommit(context, checkedOutCommit) {
  check(/^[a-f0-9]{40}$/.test(checkedOutCommit ?? '') && checkedOutCommit === context.operationsCommit, 'PARITY_REPOSITORY_INVALID');
}

export function selectNativeEngine(directory) {
  const names = readdirSync(directory).filter(name => /^schema-engine-(?:windows\.exe|[a-z0-9.-]+)$/.test(name) && !name.endsWith('.sha256'));
  check(names.length === 1 && !names[0].includes('windows') && !names[0].includes('darwin'), 'PARITY_NATIVE_ENGINE_INVALID');
  const path = resolve(directory, names[0]);
  check(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'PARITY_NATIVE_ENGINE_INVALID');
  return path;
}

export function writeParityReceipt(path, summary) {
  try { writeFileSync(path, JSON.stringify(summary) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch { throw new Error('PARITY_REPLAY_OR_OUTPUT_INVALID'); }
}

export function verifyCredentialedParity({ here, context, env, run = spawnSync }) {
  // env is the launcher's filtered OS/CI environment; context contains only
  // named nonsecret identity fields. This function never receives credentials.
  const parityDir = resolve(here, 'stage-credentialed-parity');
  const binding = readParityManifest(resolve(parityDir, 'run-04-binding.json'));
  assertParityContext(binding, context);
  const output = resolve(parityDir, `execution-${context.mode}.json`);
  check(!existsSync(output), 'PARITY_REPLAY_OR_OUTPUT_INVALID');
  const packageDir = resolve(here, 'stage-initial-install');
  const prismaDir = resolve(packageDir, 'node_modules/prisma');
  const engine = selectNativeEngine(resolve(prismaDir, '../@prisma/engines'));
  const sourceBinding = JSON.parse(readFileSync(resolve(packageDir, 'source-binding.json')));
  const observed = {
    platform: process.platform, node: process.version,
    prismaVersion: JSON.parse(readFileSync(resolve(prismaDir, 'package.json'))).version,
    engineVersion: binding.runtime.engineVersion, // Hashes are checked before executing the binary below.
    engineSha256: fileHash(engine), prismaCliSha256: fileHash(resolve(prismaDir, 'build/index.js')),
    contractSha256: fileHash(resolve(packageDir, 'contract.mjs')), stageCaSha256: fileHash(resolve(packageDir, 'supabase-root-2021.crt')),
    sourceBindingSha256: fileHash(resolve(packageDir, 'source-binding.json')), sourceRevision: sourceBinding.sourceRevision,
  };
  assertParityInputs(binding, observed);
  // Neither subprocess receives context or credential-bearing service variables.
  const options = { cwd: here, env, timeout: 5000, encoding: 'utf8', maxBuffer: 8192, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  const git = run('git', ['-C', resolve(here, '..'), 'rev-parse', '--verify', 'HEAD'], options);
  check(git.status === 0 && !git.error && !git.signal, 'PARITY_REPOSITORY_INVALID');
  const checkedOutCommit = git.stdout.trim();
  assertCheckedOutCommit(context, checkedOutCommit);
  const version = run(engine, ['--version'], options);
  check(version.status === 0 && !version.error && !version.signal && version.stdout.trim() === binding.runtime.engineVersion, 'PARITY_ENGINE_VERSION_FAILED');
  observed.engineVersion = version.stdout.trim();
  assertParityInputs(binding, observed);
  const summary = { event: 'STAGE_CREDENTIALED_INPUT_PARITY', status: 'PASSED', runId: randomUUID(), checkedAt: new Date().toISOString(),
    mode: context.mode, serviceId: context.serviceId, operationsCommit: checkedOutCommit, project: binding.target.project, transport: binding.target.transport,
    sourceRevision: binding.target.sourceRevision, manifestSha256: RUN_04_MANIFEST_SHA256, proofRunId: binding.proof.runId, proofOperationsCommit: binding.proof.operationsCommit,
    ...Object.fromEntries(INPUT_KEYS.map(key => [key, observed[key]])), databaseExecution: false };
  writeParityReceipt(output, summary);
  return summary;
}
