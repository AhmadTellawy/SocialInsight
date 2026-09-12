import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { runStartupNativeProbe } from '../src/startupNativeProbe.js';

const fixtureRoot = path.resolve('self-test');

async function withTempRoot(run) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'si-native-probe-'));
  try {
    return await run(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('proves HEIC, generic HEIF, alpha presence, source metadata stripping, and cleanup', async () => {
  await withTempRoot(async (tempRoot) => {
    let conversions = 0;
    const converter = {
      async convert(input) {
        conversions += 1;
        const alpha = input.length === 8284;
        const width = alpha ? 512 : 451;
        const height = alpha ? 512 : 461;
        const data = await sharp({
          create: {
            width,
            height,
            channels: alpha ? 4 : 3,
            background: alpha ? { r: 12, g: 34, b: 56, alpha: 0.5 } : { r: 12, g: 34, b: 56 },
          },
        }).webp().toBuffer();
        return { data, mime: 'image/webp', width, height };
      },
    };
    const evidence = await runStartupNativeProbe({ tempRoot, nativeProbeFixtureRoot: fixtureRoot }, converter);
    assert.equal(conversions, 3);
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.fixtureSet, 'native-still-v1');
    assert.equal(evidence.cases.length, 3);
    assert.equal(evidence.cases[0].inputMime, 'image/heic');
    assert.equal(evidence.cases[1].inputMime, 'image/heif');
    assert.equal(evidence.cases[2].hasAlpha, true);
  });
});

test('fails closed when a pinned native fixture is changed', async () => {
  await withTempRoot(async (tempRoot) => {
    const originalRead = async (file, encoding) => {
      const value = await readFile(file, encoding);
      if (!String(file).endsWith('rainbow-451x461.heic.base64')) return value;
      return `${value.trim().slice(0, -4)}AAAA`;
    };
    await assert.rejects(
      runStartupNativeProbe(
        { tempRoot, nativeProbeFixtureRoot: fixtureRoot },
        { convert: async () => assert.fail('tampered fixture must not reach the decoder') },
        { readFile: originalRead },
      ),
      /integrity check failed/,
    );
  });
});
