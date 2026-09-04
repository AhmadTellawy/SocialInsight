import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { loadHealthEvidence } from '../src/health.js';

const binary = Buffer.from('pinned-heif-convert-binary');
const digest = createHash('sha256').update(binary).digest('hex');
const config = { versionManifestPath: '/manifest.json', converterPath: '/heif-convert' };

test('verifies native version, immutable binary digest, and Sharp version', async () => {
  const manifest = JSON.stringify({
    libheif: '1.23.3', libde265: '1.1.1', libheifRef: 'v1.23.3', libde265Ref: 'v1.1.1',
    libheifCommit: 'a'.repeat(40), libde265Commit: 'b'.repeat(40), heifConvertSha256: digest,
  });
  const evidence = await loadHealthEvidence(config, {
    readFile: async (file) => file === config.versionManifestPath ? manifest : binary,
    probeCommand: async () => 'libheif version: 1.23.3',
    sharpVersions: { sharp: '0.35.4', vips: '8.17.2' },
  });
  assert.equal(evidence.status, 'ready');
  assert.equal(evidence.nativeBuild.heifConvertSha256, digest);
});

test('fails readiness when the runtime binary digest does not match the build manifest', async () => {
  const manifest = JSON.stringify({
    libheif: '1.23.3', libde265: '1.1.1', heifConvertSha256: '0'.repeat(64),
  });
  await assert.rejects(loadHealthEvidence(config, {
    readFile: async (file) => file === config.versionManifestPath ? manifest : binary,
    probeCommand: async () => 'libheif version: 1.23.3',
    sharpVersions: { sharp: '0.35.4', vips: '8.17.2' },
  }), /does not match/);
});
