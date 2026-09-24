import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { inspectHeif } from './bmff.js';

const FIXTURE_SET = 'native-still-v1';
const FIXTURES = Object.freeze([
  Object.freeze({
    id: 'rainbow-heic',
    file: 'rainbow-451x461.heic.base64',
    bytes: 7080,
    sha256: '4b2ce727f093944975f143ba2b39c4c64511b766d94552f8d51a755916e7f983',
    width: 451,
    height: 461,
    alpha: false,
    sourceMetadataMarker: 'application/rdf+xml',
  }),
  Object.freeze({
    id: 'alpha-heic',
    file: 'with-alpha-512x512.heic.base64',
    bytes: 8284,
    sha256: 'dac399d3bf1019baaf5f88eef8b277087d0643e735db947c42355237bb9d0221',
    width: 512,
    height: 512,
    alpha: true,
  }),
]);

const digest = (input) => createHash('sha256').update(input).digest('hex');

function decodeFixture(encoded, fixture) {
  const value = encoded.trim();
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Native probe fixture encoding is invalid');
  }
  const input = Buffer.from(value, 'base64');
  if (input.toString('base64') !== value || input.length !== fixture.bytes || digest(input) !== fixture.sha256) {
    throw new Error('Native probe fixture integrity check failed');
  }
  return input;
}

function asGenericHeif(input) {
  const output = Buffer.from(input);
  const ftypEnd = output.readUInt32BE(0);
  if (ftypEnd < 16 || ftypEnd > output.length) throw new Error('Native probe fixture has an invalid ftyp box');
  for (let index = 8; index + 4 <= ftypEnd; index += 4) {
    if (output.toString('ascii', index, index + 4) === 'heic') output.write('mif1', index, 4, 'ascii');
  }
  return output;
}

function verifyOutput(output, expected) {
  if (output.mime !== 'image/webp' || output.width !== expected.width || output.height !== expected.height || !output.data?.length) {
    throw new Error('Native probe conversion output is invalid');
  }
  const evidence = output.verification;
  if (!evidence || evidence.metadataStripped !== true || typeof evidence.hasAlpha !== 'boolean'
    || typeof evidence.alphaHasTransparent !== 'boolean' || typeof evidence.alphaHasNonzero !== 'boolean') {
    throw new Error('Confined output verification evidence is required');
  }
  if (expected.alpha && (!evidence.hasAlpha || !evidence.alphaHasTransparent || !evidence.alphaHasNonzero)) {
    throw new Error('Native probe alpha channel is invalid');
  }
  return evidence.hasAlpha;
}

export async function runStartupNativeProbe(config, converter, dependencies = {}) {
  const startedAt = performance.now();
  const read = dependencies.readFile ?? readFile;
  const inspect = dependencies.inspectHeif ?? inspectHeif;
  if ((await readdir(config.tempRoot)).length !== 0) throw new Error('Native probe temp root is not empty');

  const loaded = new Map();
  for (const fixture of FIXTURES) {
    const encoded = await read(path.join(config.nativeProbeFixtureRoot, fixture.file), 'ascii');
    loaded.set(fixture.id, decodeFixture(encoded, fixture));
    if (fixture.sourceMetadataMarker && !loaded.get(fixture.id).includes(Buffer.from(fixture.sourceMetadataMarker, 'ascii'))) {
      throw new Error('Native probe source metadata marker is missing');
    }
  }
  const cases = [
    { ...FIXTURES[0], input: loaded.get('rainbow-heic'), expectedMime: 'image/heic' },
    { ...FIXTURES[0], id: 'rainbow-generic-heif', input: asGenericHeif(loaded.get('rainbow-heic')), expectedMime: 'image/heif' },
    { ...FIXTURES[1], input: loaded.get('alpha-heic'), expectedMime: 'image/heic' },
  ];
  const reports = [];
  for (const item of cases) {
    const inspected = inspect(item.input);
    if (inspected.mime !== item.expectedMime || inspected.width < item.width || inspected.height < item.height) {
      throw new Error('Native probe input inspection failed');
    }
    const output = await converter.convert(item.input);
    const hasAlpha = verifyOutput(output, item);
    reports.push(Object.freeze({
      id: item.id,
      fixtureSha256: digest(item.input),
      inputMime: inspected.mime,
      outputMime: output.mime,
      width: output.width,
      height: output.height,
      hasAlpha,
    }));
    if ((await readdir(config.tempRoot)).length !== 0) throw new Error('Native probe temporary files were not cleaned');
  }

  return Object.freeze({
    schemaVersion: 1,
    status: 'passed',
    fixtureSet: FIXTURE_SET,
    cases: Object.freeze(reports),
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}
