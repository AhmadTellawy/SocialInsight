import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { IMMUTABLE_ROOT_CANARY_PATH, isAccessDenied, isImmutableRootWriteDenied } from '../src/confinementProbePolicy.js';

const error = code => Object.assign(new Error(code), { code });

test('recognizes only permission errors for denied reads', () => {
  assert.equal(isAccessDenied(error('EACCES')), true);
  assert.equal(isAccessDenied(error('EPERM')), true);
  assert.equal(isAccessDenied(error('EROFS')), false);
  assert.equal(isAccessDenied(error('ENOENT')), false);
  assert.equal(isAccessDenied(undefined), false);
});

test('accepts EROFS only through the immutable-root write policy', () => {
  assert.equal(IMMUTABLE_ROOT_CANARY_PATH, '/opt/heif-converter/landlock-write-canary');
  assert.equal(isImmutableRootWriteDenied(error('EACCES')), true);
  assert.equal(isImmutableRootWriteDenied(error('EPERM')), true);
  assert.equal(isImmutableRootWriteDenied(error('EROFS')), true);
  assert.equal(isImmutableRootWriteDenied(error('ENOENT')), false);
  assert.equal(isImmutableRootWriteDenied(undefined), false);
});

test('recognizes an actual immutable-root write denial without weakening read checks', { skip: process.platform !== 'linux' }, () => {
  let readonlyError;
  try {
    writeFileSync('/sys/si-heif-confinement-code-write-regression', 'blocked', { flag: 'wx' });
    assert.fail('the kernel sysfs root unexpectedly accepted a write');
  } catch (error) {
    readonlyError = error;
  }
  assert.equal(readonlyError?.code, 'EROFS');
  assert.equal(isImmutableRootWriteDenied(readonlyError), true);
  assert.equal(isAccessDenied(readonlyError), false);
});
