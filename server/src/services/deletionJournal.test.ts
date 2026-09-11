import assert from 'node:assert/strict';
import test from 'node:test';
import { appendDeletionDecision, captureDeletionMediaPointer, DeletionDecisionInput, mediaPurgeDecision, normalizeDeletionDecision } from './deletionJournalService';

const input = (): DeletionDecisionInput => ({ id: 'account-erase:fixture', subjectKind: 'ACCOUNT', subjectId: 'owner', action: 'ACCOUNT_ERASE',
  resourcePointers: { media: [{ assetId: 'asset', objects: [{ bucket: 'media-originals', key: 'owner/asset/upload.heic' }], deleteNotBefore: null }] } });

test('journal scope accepts only minimized exact asset pointers', () => {
  const base = input();
  for (const mutation of [
    { ...base, email: 'private@example.invalid' },
    { ...base, actionVersion: 2 }, { ...base, action: 'MEDIA_PURGE' },
    { ...base, resourcePointers: { ...base.resourcePointers, comment: 'private content' } },
    ...['https://storage.invalid/object', 'owner/asset/../other', 'owner/asset/file?token=secret', 'other/asset/upload.heic', 'owner/another/upload.heic'].map(key =>
      ({ ...base, resourcePointers: { media: [{ ...base.resourcePointers.media[0], objects: [{ bucket: 'media-originals', key }] }] } })),
    { ...base, resourcePointers: { media: [{ ...base.resourcePointers.media[0], deleteNotBefore: 'tomorrow' }] } },
    { ...base, resourcePointers: { media: [{ ...base.resourcePointers.media[0], objects: [{ bucket: 'arbitrary-bucket', key: 'owner/asset/file' }] }] } }
  ]) assert.throws(() => normalizeDeletionDecision(mutation), /INVALID_DELETION_DECISION/);
  assert.deepEqual(normalizeDeletionDecision(base), { ...base, actionVersion: 1 });
});

test('canonical object order and duplicates yield one deterministic purge batch', () => {
  const pointer = input().resourcePointers.media[0];
  const second = { bucket: 'media-private', key: 'owner/asset/private/480.webp' };
  const a = mediaPurgeDecision({ ...pointer, objects: [...pointer.objects, second, second] });
  const b = mediaPurgeDecision({ ...pointer, objects: [second, ...pointer.objects] });
  assert.equal(a.id, b.id); assert.deepEqual(a.resourcePointers, b.resourcePointers);
  assert.notEqual(a.id, mediaPurgeDecision(pointer).id, 'New exact-key batch never overwrites the original decision');
});

test('HEIF pointer capture retains private prepared source and upload deadline without content metadata', () => {
  const pointer = captureDeletionMediaPointer({ id: 'asset', ownerId: 'owner', sourceMime: 'image/heif', uploadBucket: 'media-originals',
    uploadKey: 'owner/asset/upload.heif', storageCleanupNotBefore: new Date('2030-01-01T00:00:00.000Z'),
    variants: [{ storageBucket: 'media-private', storageKey: 'owner/asset/private/480.webp' }] });
  assert.equal(pointer.deleteNotBefore, '2030-01-01T00:00:00.000Z');
  assert.deepEqual(pointer.objects.map(object => object.key), ['owner/asset/prepared.webp', 'owner/asset/upload.heif', 'owner/asset/private/480.webp']);
  assert.deepEqual(Object.keys(pointer), ['assetId', 'objects', 'deleteNotBefore']);
});

test('same decision ID replays the original row and timestamp while changed scope fails', async () => {
  let stored: any, inserts = 0, locks = 0;
  const tx: any = { $executeRaw: async () => { locks++; }, deletionDecision: {
    findUnique: async () => stored,
    create: async ({ data }: any) => { inserts++; return stored = { ...data, recordedAt: new Date('2026-01-01T00:00:00.000Z') }; }
  } };
  const original = await appendDeletionDecision(tx, input());
  const replay = await appendDeletionDecision(tx, input());
  assert.equal(replay, original); assert.equal(inserts, 1); assert.equal(locks, 2);
  await assert.rejects(appendDeletionDecision(tx, { ...input(), resourcePointers: { media: [] } }), /DELETION_DECISION_CONFLICT/);
  assert.equal(inserts, 1);
});
