// Credential-free codec evidence. This does not approve the production image:
// Windows lacks the Linux prlimit/container boundary and may use another codec.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { inspectHeif } from '../../heif-converter/src/bmff.js';
import { HeifConverter } from '../../heif-converter/src/converter.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const sharp = require('sharp');
const executable = process.argv[2];
if (!executable || !path.isAbsolute(executable)) throw new Error('Pass the absolute path to a trusted heif-convert executable.');
const nativeEnvironment = process.platform === 'win32'
  ? { SystemRoot: process.env.SystemRoot || 'C:\\Windows' }
  : { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true, env: nativeEnvironment, maxBuffer: 8192 });
assert.equal(probe.status, 0, 'Native version probe');
const tempRoot = await mkdtemp(path.join(root, '.native-probe-'));
assert.ok(tempRoot.startsWith(root + path.sep));
const reports = [];
const cases = [
  { name: 'camera-sample.base64', width: 1440, height: 960 },
  { name: 'camera-sample.base64', width: 1440, height: 960, genericBrand: true },
  // The encoded spatial extents include padding; native clap must remove it.
  { name: 'rainbow-451x461.heic', width: 451, height: 461 },
  { name: 'with-alpha-512x512.heic', width: 512, height: 512, alpha: true },
  { name: 'hevc32.heif' },
  { name: 'example.heic', rejection: 'HEIF_SEQUENCE_NOT_ALLOWED' },
  { name: 'moov_size_zero.heif', rejection: 'HEIF_SEQUENCE_NOT_ALLOWED' },
  { name: 'uncompressed_pix_RGB.heif', rejection: 'UNSUPPORTED_HEIF_CODEC' }
];
try {
  const converter = new HeifConverter({ tempRoot, maxAggregatePixels: 40_000_000, conversionTimeoutMs: 15_000 }, {
    imageFactory: sharp,
    runNative: async ({ inputPath, outputPath, tempDir }) => {
      const result = spawnSync(executable, [inputPath, outputPath], {
        cwd: tempDir, env: nativeEnvironment, timeout: 15_000, maxBuffer: 8192, windowsHide: true, encoding: 'utf8'
      });
      assert.equal(result.status, 0, `Native decode failed: ${result.error?.code || result.signal || result.status}`);
    }
  });
  for (const item of cases) {
    let input = await readFile(path.join(root, 'fixtures', item.name));
    if (item.name.endsWith('.base64')) input = Buffer.from(input.toString('utf8'), 'base64');
    if (item.genericBrand) {
      // Generated valid generic HEIF container: retain all encoded image data
      // and box lengths, replacing the HEIC ftyp brand with generic mif1.
      input = Buffer.from(input);
      const end = input.readUInt32BE(0);
      for (let index = 8; index < end; index += 4) {
        if (input.toString('ascii', index, index + 4) === 'heic') input.write('mif1', index, 4, 'ascii');
      }
    }
    const start = performance.now();
    const report = { fixture: item.genericBrand ? `${item.name}:generated-mif1` : item.name, bytes: input.length, sha256: createHash('sha256').update(input).digest('hex') };
    if (item.rejection) {
      assert.throws(() => inspectHeif(input), error => error.code === item.rejection);
      reports.push({ ...report, result: 'PASSED', rejectedBeforeDecoder: item.rejection });
      continue;
    }
    const inspected = inspectHeif(input);
    if (item.genericBrand) assert.equal(inspected.mime, 'image/heif');
    const output = await converter.convert(input);
    const metadata = await sharp(output.data).metadata();
    if (item.width) assert.equal(output.width, item.width);
    if (item.height) assert.equal(output.height, item.height);
    assert.ok(output.width > 0 && output.width <= inspected.width);
    assert.ok(output.height > 0 && output.height <= inspected.height);
    assert.equal(metadata.format, 'webp');
    for (const field of ['exif', 'xmp', 'iptc', 'icc', 'orientation']) assert.equal(metadata[field], undefined, field);
    if (item.alpha) {
      assert.equal(metadata.hasAlpha, true);
      const alpha = await sharp(output.data).extractChannel('alpha').raw().toBuffer();
      assert.ok(alpha.some(value => value < 255), 'Transparency must survive HEIF to WebP');
      assert.ok(alpha.some(value => value > 0), 'Visible pixels must survive HEIF to WebP');
    }
    reports.push({ ...report, result: 'PASSED', encodedWidth: inspected.width, encodedHeight: inspected.height,
      width: output.width, height: output.height, outputBytes: output.data.length, alpha: metadata.hasAlpha,
      elapsedMs: Math.round(performance.now() - start) });
    assert.deepEqual(await readdir(tempRoot), [], 'Every native job must clean up its files');
  }
  const sample = Buffer.from(await readFile(path.join(root, 'fixtures/camera-sample.base64'), 'utf8'), 'base64');
  for (const [name, input] of [['empty', Buffer.alloc(0)], ['truncated', sample.subarray(0, 48)]]) {
    assert.throws(() => inspectHeif(input));
    reports.push({ fixture: name, result: 'PASSED', rejectedBeforeDecoder: true });
  }
} finally {
  assert.ok(tempRoot.startsWith(root + path.sep));
  await rm(tempRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), environment: process.platform,
  nativeVersion: probe.stdout.trim(), sharpVersion: sharp.versions.sharp,
  productionRuntimeVerified: false, linuxResourceLimitsVerified: false, cleanupVerified: true, cases: reports }, null, 2));
