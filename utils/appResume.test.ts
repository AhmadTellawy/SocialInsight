import assert from 'node:assert/strict';
import test from 'node:test';
import { readResume, saveResume, resumeLocation } from './appResume.ts';

test('cold resume preserves the analytics tab without persisting arbitrary query data', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    saveResume('owner', '/post/abc', 0, 10, undefined, '?tab=analysis&private=do-not-store');
    const saved = readResume('owner');
    assert.ok(saved); assert.equal(resumeLocation(saved), '/post/abc?tab=analysis');
    assert.equal(values.get('opiniup_resume_v1')!.includes('do-not-store'), false);
    assert.equal(readResume('another-account'), null);
    saveResume('owner', '/', 120, 30, undefined, '?tab=analysis');
    assert.equal(resumeLocation(readResume('owner')!), '/');
    values.set('opiniup_resume_v1', JSON.stringify({ ...saved, path: '//external.example', analysis: true }));
    assert.equal(readResume('owner'), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
