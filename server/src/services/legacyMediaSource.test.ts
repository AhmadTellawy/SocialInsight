import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDisallowedLegacyAddress,
  isGeneratedAvatarFallback,
  loadLegacyMediaSource,
  parseLegacyMediaAllowedHosts
} from './legacyMediaSource';

test('parses a supported legacy data URL without remote access', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const loaded = await loadLegacyMediaSource(`data:image/png;base64,${png}`, new Set());
  assert.equal(loaded.mime, 'image/png');
  assert.equal(loaded.sourceKind, 'DATA_URL');
  assert.ok(loaded.buffer.length > 0);
});

test('rejects unsupported legacy data URL formats', async () => {
  await assert.rejects(
    () => loadLegacyMediaSource('data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==', new Set()),
    (error: any) => error?.code === 'LEGACY_DATA_URL_INVALID'
  );
});

test('normalizes the explicit remote-host allowlist', () => {
  assert.deepEqual(
    Array.from(parseLegacyMediaAllowedHosts(' CDN.EXAMPLE.COM,images.example.com, ')),
    ['cdn.example.com', 'images.example.com']
  );
});

test('recognizes deprecated generated-avatar services', () => {
  assert.equal(isGeneratedAvatarFallback('https://ui-avatars.com/api/?name=Test'), true);
  assert.equal(isGeneratedAvatarFallback('https://cdn.example.com/avatar.webp'), false);
});

test('blocks private, link-local, mapped, and reserved migration destinations', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.0.2.4',
    '198.51.100.7',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1'
  ]) {
    assert.equal(isDisallowedLegacyAddress(address), true, address);
  }
  assert.equal(isDisallowedLegacyAddress('8.8.8.8'), false);
  assert.equal(isDisallowedLegacyAddress('2606:4700:4700::1111'), false);
});
