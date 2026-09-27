import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import en from '../locales/en/translation.json' with { type: 'json' };
import ar from '../locales/ar/translation.json' with { type: 'json' };

const resources = { en, ar } as const;

function lookup(resource: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)[part]
      : undefined, resource);
}

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

test('Home auth labels resolve to strings in English and Arabic', () => {
  for (const [locale, resource] of Object.entries(resources)) {
    assert.equal(typeof lookup(resource, 'auth.login.signIn'), 'string', `${locale} sign-in label`);
    assert.equal(typeof lookup(resource, 'auth.signup.action'), 'string', `${locale} sign-up label`);
    assert.equal(typeof lookup(resource, 'auth.login'), 'object', `${locale} login namespace`);
    assert.equal(typeof lookup(resource, 'auth.signup'), 'object', `${locale} signup namespace`);
  }
});

test('literal translation calls in components never target an object resource', () => {
  const files = [join(process.cwd(), 'App.tsx'), ...componentFiles(join(process.cwd(), 'components'))];
  const objectCalls: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*(['"`])([^'"`$]+)\1/g)) {
      for (const [locale, resource] of Object.entries(resources)) {
        const value = lookup(resource, match[2]);
        if (value !== undefined && typeof value !== 'string') {
          objectCalls.push(`${file}:${locale}:${match[2]}`);
        }
      }
    }
  }
  assert.deepEqual(objectCalls, []);
});

test('English and Arabic auth resources agree on leaf types', () => {
  function walk(left: unknown, right: unknown, key: string): void {
    assert.equal(typeof right, typeof left, `type mismatch at ${key}`);
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      for (const [part, value] of Object.entries(left)) {
        if (Object.prototype.hasOwnProperty.call(right, part)) {
          walk(value, (right as Record<string, unknown>)[part], `${key}.${part}`);
        }
      }
    }
  }
  walk(en.auth, ar.auth, 'auth');
});
