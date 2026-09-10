import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runHeifConvert } from '../src/processRunner.js';

function fakeChild(onKill) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => onKill?.(signal, child);
  return child;
}

const options = {
  prlimitPath: '/usr/bin/prlimit',
  converterPath: '/usr/local/bin/heif-convert',
  inputPath: '/tmp/job/input.heic',
  outputPath: '/tmp/job/decoded.png',
  tempDir: '/tmp/job',
  timeoutMs: 100,
};

test('spawns prlimit without a shell and without inheriting secrets', async () => {
  let invocation;
  const child = fakeChild();
  const run = runHeifConvert({
    ...options,
    spawnImpl(command, args, spawnOptions) {
      invocation = { command, args, spawnOptions };
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    },
  });
  await run;
  assert.equal(invocation.command, '/usr/bin/prlimit');
  assert.equal(invocation.spawnOptions.shell, false);
  assert.deepEqual(Object.keys(invocation.spawnOptions.env).sort(), ['LANG', 'LC_ALL', 'TMPDIR']);
  assert.deepEqual(invocation.args.slice(-4), [
    '--', '/usr/local/bin/heif-convert', '/tmp/job/input.heic', '/tmp/job/decoded.png',
  ]);
  assert.ok(invocation.args.includes('--as=805306368'));
  assert.ok(invocation.args.includes('--cpu=12'));
  assert.ok(invocation.args.includes('--nproc=1'));
});

test('kills a native conversion that exceeds the timeout', async () => {
  const child = fakeChild((signal, instance) => queueMicrotask(() => instance.emit('close', null, signal)));
  await assert.rejects(runHeifConvert({
    ...options,
    timeoutMs: 5,
    spawnImpl: () => child,
  }), { code: 'CONVERSION_TIMEOUT' });
});

test('bounds native diagnostic output', async () => {
  const child = fakeChild((signal, instance) => queueMicrotask(() => instance.emit('close', null, signal)));
  const run = runHeifConvert({ ...options, spawnImpl: () => child });
  child.stderr.write(Buffer.alloc(8 * 1024 + 1));
  await assert.rejects(run, { code: 'CONVERTER_OUTPUT_LIMIT' });
});
