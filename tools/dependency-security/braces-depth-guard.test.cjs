'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const braces = require('braces');

const expectDepthGuard = callback => {
  assert.throws(callback, error => {
    assert.equal(error instanceof RangeError, false);
    assert.equal(error instanceof SyntaxError, true);
    assert.match(error.message, /nesting depth exceeds maximum/);
    return true;
  });
};

test('rejects the deeply nested brace pattern from CVE-2026-93687 before recursive walks', () => {
  const pattern = '{'.repeat(3_500) + 'a' + '}'.repeat(3_500);

  expectDepthGuard(() => braces(pattern));
  expectDepthGuard(() => braces.expand(pattern));
  expectDepthGuard(() => braces.parse(pattern));
});

test('also rejects deeply nested parenthesis ASTs consumed by the same recursive walkers', () => {
  const pattern = '('.repeat(3_500) + 'a' + ')'.repeat(3_500);

  expectDepthGuard(() => braces(pattern));
});

test('preserves ordinary compile and expansion behavior', () => {
  assert.deepEqual(braces('file-{1..3}.txt'), ['file-([1-3]).txt']);
  assert.deepEqual(braces.expand('file-{1..3}.txt'), [
    'file-1.txt',
    'file-2.txt',
    'file-3.txt'
  ]);
});

test('allows nesting through the documented local limit', () => {
  const pattern = '{'.repeat(100) + 'a' + '}'.repeat(100);

  assert.doesNotThrow(() => braces(pattern));
});
