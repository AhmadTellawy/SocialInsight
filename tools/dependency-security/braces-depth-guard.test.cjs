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

test('guards every string walker and mixed nesting at the exact boundary', () => {
  for (const method of ['compile', 'expand', 'stringify', 'parse', 'create']) {
    for (const [open, close] of [['{', '}'], ['(', ')'], ['{(', ')}']]) {
      const accepted = open.repeat(open.length === 2 ? 50 : 100) + 'a' + close.repeat(close.length === 2 ? 50 : 100);
      assert.doesNotThrow(() => braces[method](accepted));
      expectDepthGuard(() => braces[method](open + accepted + close));
    }
  }
  expectDepthGuard(() => braces(['ordinary-{a,b}', '{'.repeat(101) + 'a']));
  expectDepthGuard(() => braces('{'.repeat(101) + 'a', { maxLength: Infinity }));
  assert.throws(() => braces.parse('a'.repeat(10001)), SyntaxError);
});

test('guards caller-supplied ASTs, including fake root nodes and cycles', () => {
  for (const type of ['brace', 'paren', 'root']) {
    let ast = { type: 'text', value: 'a' };
    for (let depth = 0; depth < 3500; depth++) ast = { type, nodes: [ast] };
    for (const method of ['compile', 'expand', 'stringify']) {
      expectDepthGuard(() => braces[method](ast));
    }
  }
  const cycle = { type: 'root', nodes: [] };
  cycle.nodes.push(cycle);
  for (const method of ['compile', 'expand', 'stringify']) {
    assert.throws(() => braces[method](cycle), /Cyclic AST/);
    const ast = braces.parse('x-{a,b}');
    assert.doesNotThrow(() => braces[method](ast));
  }
});

test('preserves escaped, quoted, bracketed and unmatched literal syntax', () => {
  assert.equal(braces.stringify('"' + '{'.repeat(150) + '"'), '{'.repeat(150));
  assert.equal(braces.stringify('[' + '{'.repeat(150) + ']'), '[' + '{'.repeat(150) + ']');
  assert.equal(braces.stringify('\\{'.repeat(150)), '{'.repeat(150));
  assert.deepEqual(braces.expand('x-{a,b'), ['x-{a,b']);
  assert.deepEqual(braces(['a-{b,c}', 'd'], { expand: true }), ['a-b', 'a-c', 'd']);
});
