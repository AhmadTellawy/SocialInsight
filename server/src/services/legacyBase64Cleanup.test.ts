import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'crypto';
import {
  LegacyBase64AssetSnapshot,
  LegacyBase64VariantSnapshot,
  buildExactLegacyBase64AssetWhere,
  downloadedVariantMatchesSnapshot,
  evaluateLegacyBase64CleanupCandidate,
  inspectLegacyBase64DataImage,
  parseLegacyBase64CleanupDomains,
  parseLegacyBase64BoundedInteger,
  parseLegacyBase64ExpectedCounts,
  selectLegacyBase64DisplayVariant
} from './legacyBase64Cleanup';

const legacyBytes = Buffer.from('legacy image source');
const legacySource = `data:image/png;base64,${legacyBytes.toString('base64')}`;
const checksum = createHash('sha256').update(legacyBytes).digest('hex');

const variant = (
  overrides: Partial<LegacyBase64VariantSnapshot> = {}
): LegacyBase64VariantSnapshot => ({
  id: 'variant-1',
  mediaAssetId: 'asset-1',
  kind: 'LARGE',
  storageBucket: 'media-public',
  storageKey: 'owner/asset/public/1080.webp',
  width: 1080,
  height: 1080,
  mime: 'image/webp',
  byteSize: 128,
  isPublic: true,
  ...overrides
});

const asset = (
  overrides: Partial<LegacyBase64AssetSnapshot> = {}
): LegacyBase64AssetSnapshot => ({
  id: 'asset-1',
  ownerId: 'owner-1',
  purpose: 'POST',
  status: 'ATTACHED',
  accessScope: 'PUBLIC',
  sourceMime: 'image/png',
  sourceByteSize: legacyBytes.length,
  checksum,
  aspectRatio: 1,
  deletedAt: null,
  variants: [variant()],
  ...overrides
});

test('legacy cleanup accepts only supported Base64 data images and derives the source checksum', () => {
  assert.deepEqual(inspectLegacyBase64DataImage(legacySource), {
    mime: 'image/png',
    byteSize: legacyBytes.length,
    checksum
  });
  assert.equal(inspectLegacyBase64DataImage('https://cdn.example/image.png'), null);
  assert.equal(inspectLegacyBase64DataImage('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(inspectLegacyBase64DataImage('data:image/png,not-base64'), null);
  assert.equal(inspectLegacyBase64DataImage('data:image/png;base64,'), null);
});

test('display-variant selection enforces visibility and valid storage metadata', () => {
  const publicAsset = asset({
    variants: [
      variant({ id: 'private', isPublic: false, storageBucket: 'media-private', width: 2000 }),
      variant({ id: 'small-public', width: 480 }),
      variant({ id: 'large-public', width: 1080 }),
      variant({ id: 'wrong-bucket', width: 2000, storageBucket: 'media-private' })
    ]
  });
  assert.equal(selectLegacyBase64DisplayVariant(publicAsset)?.id, 'large-public');

  const restrictedAsset = asset({
    accessScope: 'RESTRICTED',
    variants: [
      variant({ id: 'public', isPublic: true }),
      variant({ id: 'master', isPublic: false, kind: 'MASTER', storageBucket: 'media-private' }),
      variant({ id: 'private', isPublic: false, storageBucket: 'media-private', width: 768 })
    ]
  });
  assert.equal(selectLegacyBase64DisplayVariant(restrictedAsset)?.id, 'private');
});

test('cleanup eligibility requires authoritative ownership, purpose, attachment, checksum, and live asset', () => {
  const eligible = evaluateLegacyBase64CleanupCandidate('post', legacySource, 'owner-1', asset());
  assert.equal(eligible.eligible, true);

  assert.deepEqual(
    evaluateLegacyBase64CleanupCandidate('post', legacySource, 'other-owner', asset()),
    { eligible: false, reason: 'ownerMismatch' }
  );
  assert.deepEqual(
    evaluateLegacyBase64CleanupCandidate('question', legacySource, 'owner-1', asset()),
    { eligible: false, reason: 'purposeMismatch' }
  );
  assert.deepEqual(
    evaluateLegacyBase64CleanupCandidate('post', legacySource, 'owner-1', asset({ status: 'READY' })),
    { eligible: false, reason: 'assetNotAttached' }
  );
  assert.deepEqual(
    evaluateLegacyBase64CleanupCandidate('post', legacySource, 'owner-1', asset({ deletedAt: new Date() })),
    { eligible: false, reason: 'assetDeleted' }
  );
  assert.deepEqual(
    evaluateLegacyBase64CleanupCandidate('post', legacySource, 'owner-1', asset({ checksum: '0'.repeat(64) })),
    { eligible: false, reason: 'checksumMismatch' }
  );
  assert.deepEqual(
    evaluateLegacyBase64CleanupCandidate('post', legacySource, 'owner-1', asset({ sourceMime: 'image/jpeg' })),
    { eligible: false, reason: 'sourceMimeMismatch' }
  );
  assert.deepEqual(
    evaluateLegacyBase64CleanupCandidate('post', legacySource, 'owner-1', asset({ sourceByteSize: 1 })),
    { eligible: false, reason: 'sourceByteSizeMismatch' }
  );
});

test('race-safe asset predicate captures the exact verified asset and variant snapshot', () => {
  const selectedAsset = asset();
  const selectedVariant = selectedAsset.variants[0];
  const where = buildExactLegacyBase64AssetWhere(selectedAsset, selectedVariant);

  assert.equal(where.id, 'asset-1');
  assert.equal(where.ownerId, 'owner-1');
  assert.equal(where.status, 'ATTACHED');
  assert.equal(where.deletedAt, null);
  assert.deepEqual(where.variants, {
    some: {
      id: 'variant-1',
      mediaAssetId: 'asset-1',
      kind: 'LARGE',
      storageBucket: 'media-public',
      storageKey: 'owner/asset/public/1080.webp',
      width: 1080,
      height: 1080,
      mime: 'image/webp',
      byteSize: 128,
      isPublic: true
    }
  });
});

test('cleanup expectation parsing is strict and downloaded bytes must match metadata', () => {
  assert.deepEqual(parseLegacyBase64CleanupDomains('post,user,post'), ['post', 'user']);
  assert.deepEqual(parseLegacyBase64ExpectedCounts('user:5,group:0,post:8'), {
    user: 5,
    group: 0,
    post: 8
  });
  assert.throws(() => parseLegacyBase64CleanupDomains('post,unknown'), /INVALID_CLEANUP_DOMAINS/);
  assert.throws(() => parseLegacyBase64ExpectedCounts('post:-1'), /INVALID_CLEANUP_EXPECTATION/);
  assert.equal(parseLegacyBase64BoundedInteger(undefined, 25, 1, 100), 25);
  assert.equal(parseLegacyBase64BoundedInteger('10', 25, 1, 100), 10);
  assert.throws(() => parseLegacyBase64BoundedInteger('0', 25, 1, 100), /INVALID_CLEANUP_INTEGER/);
  assert.equal(downloadedVariantMatchesSnapshot(Buffer.alloc(128), variant()), true);
  assert.equal(downloadedVariantMatchesSnapshot(Buffer.alloc(127), variant()), false);
});
