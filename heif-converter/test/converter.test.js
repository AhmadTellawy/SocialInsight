import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HeifConverter } from '../src/converter.js';

test('uses an injectable native decoder and image pipeline, then removes its private job directory', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'si-heif-test-'));
  const encoded = Buffer.from('verified-webp');
  const calls = [];
  const imageFactory = (input, options) => {
    calls.push({ input, options });
    if (input === encoded) return { metadata: async () => ({ format: 'webp', width: 1600, height: 900 }) };
    const pipeline = {
      rotate() { return pipeline; },
      toColourspace(value) { calls.push({ colourspace: value }); return pipeline; },
      resize(value) { calls.push({ resize: value }); return pipeline; },
      webp(value) { calls.push({ webp: value }); return pipeline; },
      async toBuffer() { return { data: encoded, info: { format: 'webp' } }; },
    };
    return pipeline;
  };
  const converter = new HeifConverter({
    tempRoot,
    prlimitPath: '/usr/bin/prlimit',
    converterPath: '/usr/local/bin/heif-convert',
    conversionTimeoutMs: 15_000,
    maxAggregatePixels: 40_000_000,
  }, {
    imageFactory,
    runNative: async ({ outputPath }) => writeFile(outputPath, Buffer.from('decoded-png')),
  });

  try {
    const result = await converter.convert(Buffer.from('heic'));
    assert.deepEqual(result, { data: encoded, mime: 'image/webp', width: 1600, height: 900 });
    assert.deepEqual(calls.find((entry) => entry.webp)?.webp, {
      quality: 92, alphaQuality: 100, smartSubsample: true, effort: 4,
    });
    assert.deepEqual(calls.find((entry) => entry.resize)?.resize, {
      width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true,
    });
    assert.equal(calls.find((entry) => entry.colourspace)?.colourspace, 'srgb');
    assert.deepEqual(await readdir(tempRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('rejects a decoder that emits more than one top-level image', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'si-heif-collection-test-'));
  const converter = new HeifConverter({
    tempRoot,
    prlimitPath: '/usr/bin/prlimit',
    converterPath: '/usr/local/bin/heif-convert',
    conversionTimeoutMs: 15_000,
    maxAggregatePixels: 40_000_000,
  }, {
    runNative: async ({ outputPath }) => {
      await writeFile(outputPath, Buffer.from('decoded-png'));
      await writeFile(path.join(path.dirname(outputPath), 'decoded-1.png'), Buffer.from('second-image'));
    },
  });
  try {
    await assert.rejects(() => converter.convert(Buffer.from('heic')), { code: 'HEIF_COLLECTION_NOT_ALLOWED' });
    assert.deepEqual(await readdir(tempRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
