import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readParityManifest, assertParityContext, assertParityInputs, assertCheckedOutCommit, selectNativeEngine, writeParityReceipt, verifyCredentialedParity } from './verify.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const binding = readParityManifest(resolve(here, 'run-04-binding.json'));
const context = { mode: 'preflight', project: binding.target.project, transport: 'session', serviceId: binding.proof.serviceId, operationsCommit: 'b'.repeat(40) };
const observed = { ...binding.runtime, sourceRevision: binding.target.sourceRevision };
function fixture(t) { const path = mkdtempSync(resolve(here, 'fixture-')); const real = realpathSync(path); t.after(() => { assert.equal(realpathSync(path), real); assert.equal(dirname(real), realpathSync(here)); assert.match(basename(real), /^fixture-/); rmSync(real, { recursive: true }); assert.equal(existsSync(real), false); }); return path; }

test('pinned manifest permits exact new-commit input parity without relabeling proof revision', () => {
  assertParityContext(binding, context); assertParityInputs(binding, observed); assertCheckedOutCommit(context, context.operationsCommit);
  assert.notEqual(context.operationsCommit, binding.proof.operationsCommit); assert.equal(binding.runtime.platform, 'linux'); assert.equal(binding.runtime.node, 'v24.21.0');
});

test('missing modified or replay-substitute manifest cannot become accepted evidence', t => {
  const root = fixture(t); assert.throws(() => readParityManifest(resolve(root, 'missing.json')), /PARITY_MANIFEST_INVALID/);
  const path = resolve(root, 'forged.json');
  for (const value of ['{}', JSON.stringify({ ...binding, runtime: { ...binding.runtime, engineSha256: 'a'.repeat(64) } }), readFileSync(resolve(here, 'run-04-binding.json'), 'utf8') + '\n']) {
    writeFileSync(path, value); assert.throws(() => readParityManifest(path), /PARITY_MANIFEST_INVALID/);
  }
});

test('every runtime proof input and exact target identity is mandatory', () => {
  for (const key of Object.keys(observed)) {
    assert.throws(() => assertParityInputs(binding, { ...observed, [key]: 'mismatch' }), /PARITY_INPUT_MISMATCH/, key);
    const missing = { ...observed }; delete missing[key]; assert.throws(() => assertParityInputs(binding, missing), /PARITY_INPUT_MISMATCH/, key);
  }
  for (const [key, value] of [['mode', 'verify'], ['project', 'different'], ['transport', 'direct'], ['serviceId', 'srv-other'], ['operationsCommit', 'not-a-sha']]) assert.throws(() => assertParityContext(binding, { ...context, [key]: value }), /PARITY_CONTEXT_INVALID/);
  assert.throws(() => assertCheckedOutCommit(context, 'c'.repeat(40)), /PARITY_REPOSITORY_INVALID/);
  assert.throws(() => assertCheckedOutCommit(context, ''), /PARITY_REPOSITORY_INVALID/);
});

test('native engine selection rejects missing ambiguous or non-Linux engine names', t => {
  const root = fixture(t); assert.throws(() => selectNativeEngine(root), /PARITY_NATIVE_ENGINE_INVALID/);
  const engine = resolve(root, 'schema-engine-debian-openssl-3.0.x'); writeFileSync(engine, 'controlled-file'); assert.equal(selectNativeEngine(root), engine);
  writeFileSync(resolve(root, 'schema-engine-linux-musl-openssl-3.0.x'), 'controlled-file'); assert.throws(() => selectNativeEngine(root), /PARITY_NATIVE_ENGINE_INVALID/);
  const windows = resolve(root, 'windows'); mkdirSync(windows); writeFileSync(resolve(windows, 'schema-engine-windows.exe'), 'controlled-file'); assert.throws(() => selectNativeEngine(windows), /PARITY_NATIVE_ENGINE_INVALID/);
});

test('private parity receipt is exclusive-create and cannot overwrite or reuse a prior result', t => {
  const root = fixture(t); const path = resolve(root, 'execution-preflight.json'); const summary = { status: 'CONTROLLED', runId: 'one' };
  writeParityReceipt(path, summary); const original = readFileSync(path); assert.throws(() => writeParityReceipt(path, { ...summary, runId: 'two' }), /PARITY_REPLAY_OR_OUTPUT_INVALID/);
  assert.deepEqual(readFileSync(path), original);
});

test('live parity path rejects replay before child execution and never accesses credential getters', t => {
  const root = fixture(t); const parityDir = resolve(root, 'stage-credentialed-parity'); mkdirSync(parityDir); copyFileSync(resolve(here, 'run-04-binding.json'), resolve(parityDir, 'run-04-binding.json'));
  writeFileSync(resolve(parityDir, 'execution-preflight.json'), '{}');
  const clean = {}; Object.defineProperty(clean, 'STAGING_DB_ADMIN_PASSWORD', { enumerable: true, get: () => assert.fail('credential getter accessed') });
  assert.throws(() => verifyCredentialedParity({ here: root, context, env: clean, run: () => assert.fail('no child allowed after replay') }), /PARITY_REPLAY_OR_OUTPUT_INVALID/);
});
