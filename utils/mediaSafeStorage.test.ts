import assert from 'node:assert/strict';
import test from 'node:test';
import { readMediaSafeJson, sanitizePersistedMedia } from './mediaSafeStorage.ts';

test('removes embedded and signed media payloads while retaining media references', () => {
  const sanitized = sanitizePersistedMedia({
    id: 'post-1',
    description: 'Keep https://example.com/page?token=part-of-user-content',
    image: 'data:image/png;base64,AAAA',
    media: {
      id: 'media-1',
      access: 'RESTRICTED',
      src: 'https://storage.example/object/sign/media?token=secret',
      srcSet: 'https://storage.example/object/sign/media?token=secret 640w',
      width: 640,
      height: 640
    }
  });

  assert.equal(sanitized.image, undefined);
  assert.equal(sanitized.description, 'Keep https://example.com/page?token=part-of-user-content');
  assert.deepEqual(sanitized.media, {
    id: 'media-1',
    access: 'RESTRICTED',
    width: 640,
    height: 640
  });
});

test('invalid cached JSON is discarded without breaking app bootstrap', () => {
  const values = new Map<string, string>([['broken', '{not-json']]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
  });

  assert.equal(readMediaSafeJson('broken'), null);
  assert.equal(values.has('broken'), false);
});
