import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createReadinessEvidence, loadHealthEvidence } from '../src/health.js';

const binary = Buffer.from('pinned-heif-convert-binary');
const digest = createHash('sha256').update(binary).digest('hex');
const config = { versionManifestPath: '/manifest.json', converterPath: '/heif-convert' };
test('health evidence refuses missing confined versions without loading a native library',async()=>{
  await assert.rejects(loadHealthEvidence(config),/Confined Sharp version evidence/);
});

test('verifies native version, immutable binary digest, and Sharp version', async () => {
  const manifest = JSON.stringify({
    libheif: '1.23.4', libde265: '1.1.1', libheifRef: 'v1.23.4', libde265Ref: 'v1.1.1',
    libheifCommit: '4e14f5942c1732ace9611b9522cc991501445463',
    libde265Commit: '4dd701fffac01632ffd5cabc5ef10deb56accba1', heifConvertSha256: digest,
  });
  const evidence = await loadHealthEvidence(config, {
    readFile: async (file) => file === config.versionManifestPath ? manifest : binary,
    probeCommand: async () => 'libheif version: 1.23.4',
    sharpVersions: { sharp: '0.35.4', vips: '8.17.2' },
  });
  assert.equal(evidence.status, 'ready');
  assert.equal(evidence.nativeBuild.heifConvertSha256, digest);
});

test('fails readiness when the runtime binary digest does not match the build manifest', async () => {
  const manifest = JSON.stringify({
    libheif: '1.23.4', libde265: '1.1.1', libheifRef: 'v1.23.4', libde265Ref: 'v1.1.1',
    libheifCommit: '4e14f5942c1732ace9611b9522cc991501445463',
    libde265Commit: '4dd701fffac01632ffd5cabc5ef10deb56accba1', heifConvertSha256: '0'.repeat(64),
  });
  await assert.rejects(loadHealthEvidence(config, {
    readFile: async (file) => file === config.versionManifestPath ? manifest : binary,
    probeCommand: async () => 'libheif version: 1.23.4',
    sharpVersions: { sharp: '0.35.4', vips: '8.17.2' },
  }), /does not match/);
});

test('fails readiness when an approved source commit is replaced', async () => {
  const manifest = JSON.stringify({
    libheif: '1.23.4', libde265: '1.1.1', libheifRef: 'v1.23.4', libde265Ref: 'v1.1.1',
    libheifCommit: 'a'.repeat(40), libde265Commit: '4dd701fffac01632ffd5cabc5ef10deb56accba1',
    heifConvertSha256: digest,
  });
  await assert.rejects(loadHealthEvidence(config, {
    readFile: async (file) => file === config.versionManifestPath ? manifest : binary,
    probeCommand: async () => 'libheif version: 1.23.4',
    sharpVersions: { sharp: '0.35.4', vips: '8.17.2' },
  }), /does not match/);
});

test('publishes only the fixed schema 2 readiness allowlist', () => {
  const evidence = createReadinessEvidence({
    nativeEvidence: {
      status: 'ready',
      service: 'heif-converter',
      versions: { node: 'provider-node', sharp: '0.35.4', libvips: 'provider-vips', libheif: '1.23.4', libde265: '1.1.1' },
      nativeBuild: {
        libheifRef: 'v1.23.4', libde265Ref: 'v1.1.1',
        libheifCommit: '4e14f5942c1732ace9611b9522cc991501445463',
        libde265Commit: '4dd701fffac01632ffd5cabc5ef10deb56accba1',
        heifConvertSha256: 'provider-build-detail',
      },
    },
    nativeProbe: {
      schemaVersion: 1, status: 'passed', fixtureSet: 'native-still-v1', elapsedMs: 123,
      cases: [{ id: 'case', fixtureSha256: 'hash', inputMime: 'image/heic', outputMime: 'image/webp', width: 1, height: 1, hasAlpha: false, providerDetail: true }],
    },
    processControl: { supervisorLimit: 128 },
  });
  assert.deepEqual(Object.keys(evidence), ['status', 'service', 'versions', 'nativeBuild', 'nativeProbe', 'confinement']);
  assert.deepEqual(Object.keys(evidence.versions), ['sharp', 'libheif', 'libde265']);
  assert.deepEqual(Object.keys(evidence.nativeBuild), ['libheifRef', 'libde265Ref', 'libheifCommit', 'libde265Commit']);
  assert.deepEqual(Object.keys(evidence.nativeProbe), ['schemaVersion', 'status', 'fixtureSet', 'cases']);
  assert.deepEqual(Object.keys(evidence.nativeProbe.cases[0]), ['id', 'fixtureSha256', 'inputMime', 'outputMime', 'width', 'height', 'hasAlpha']);
  assert.deepEqual(Object.keys(evidence.confinement), ['schemaVersion', 'policy', 'status', 'processControl']);
  assert.equal(JSON.stringify(evidence).includes('provider'), false);
});
