import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../prisma';
import { MediaValidationError } from './mediaProcessor';
import { getMediaReadPresentation } from './mediaService';
import { setMediaStorageForTests } from './mediaStorage';

test('restricted profile covers are readable only by the owner or an active unblocked follower', async () => {
  const originals = {
    mediaFindUnique: prisma.mediaAsset.findUnique,
    userFindUnique: prisma.user.findUnique,
    blockFindFirst: prisma.userBlock.findFirst,
    followFindUnique: prisma.follow.findUnique
  };
  let blocked = false;
  let activeFollower = false;
  try {
    (prisma.mediaAsset as any).findUnique = async () => ({
      id: 'cover-1',
      ownerId: 'owner-1',
      owner: { status: 'ACTIVE' },
      purpose: 'PROFILE_COVER',
      status: 'ATTACHED',
      accessScope: 'RESTRICTED',
      aspectRatio: 3,
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      focalX: 0.5,
      focalY: 0.5,
      altText: null,
      variants: [{
        id: 'variant-1', mediaAssetId: 'cover-1', kind: 'XLARGE', storageBucket: 'media-private',
        storageKey: 'owner-1/cover-1/private/1500.webp', width: 1500, height: 500,
        mime: 'image/webp', byteSize: 1000, isPublic: false, createdAt: new Date()
      }],
      coverFor: { id: 'owner-1' },
      postAttachment: null,
      questionFor: null,
      optionFor: null
    });
    (prisma.user as any).findUnique = async () => ({ status: 'ACTIVE', isPrivate: true, mediaPrivacyTarget: null });
    (prisma.userBlock as any).findFirst = async () => blocked ? ({ blockerId: 'owner-1' }) : null;
    (prisma.follow as any).findUnique = async () => activeFollower ? ({ status: 'ACTIVE' }) : null;
    setMediaStorageForTests({
      createSignedUpload: async () => { throw new Error('unused'); },
      download: async () => { throw new Error('unused'); },
      upload: async () => undefined,
      copy: async () => undefined,
      remove: async () => undefined,
      createSignedReadUrl: async () => 'https://signed.example/cover.webp',
      getPublicUrl: () => 'https://public.example/cover.webp',
      provisionBuckets: async () => undefined
    });

    await assert.rejects(
      () => getMediaReadPresentation('cover-1', 'stranger-1'),
      (error: unknown) => error instanceof MediaValidationError && error.statusCode === 404
    );

    activeFollower = true;
    const followerCover = await getMediaReadPresentation('cover-1', 'follower-1');
    assert.equal(followerCover.access, 'RESTRICTED');
    assert.equal(followerCover.src, 'https://signed.example/cover.webp');

    blocked = true;
    await assert.rejects(
      () => getMediaReadPresentation('cover-1', 'follower-1'),
      (error: unknown) => error instanceof MediaValidationError && error.statusCode === 404
    );

    const ownerCover = await getMediaReadPresentation('cover-1', 'owner-1');
    assert.equal(ownerCover.src, 'https://signed.example/cover.webp');
  } finally {
    (prisma.mediaAsset as any).findUnique = originals.mediaFindUnique;
    (prisma.user as any).findUnique = originals.userFindUnique;
    (prisma.userBlock as any).findFirst = originals.blockFindFirst;
    (prisma.follow as any).findUnique = originals.followFindUnique;
    setMediaStorageForTests(undefined);
  }
});

test('an attached PUBLIC post asset cannot mint a fresh public URL during account restriction', async () => {
  const originals = { media: prisma.mediaAsset.findUnique, post: prisma.post.findUnique, user: prisma.user.findUnique, follow: prisma.follow.findUnique };
  try {
    (prisma.mediaAsset as any).findUnique = async () => ({ id: 'asset', ownerId: 'owner', owner: { status: 'ACTIVE' }, status: 'ATTACHED', accessScope: 'PUBLIC', aspectRatio: 1, coverFor: null, avatarFor: null, postAttachment: { post: { id: 'post', authorId: 'owner', groupId: null, targetedGroups: [] } }, variants: [] });
    (prisma.post as any).findUnique = async () => ({ id: 'post', status: 'PUBLISHED', isDeleted: false, authorId: 'owner', author: { status: 'ACTIVE' }, targetAudience: 'Public', group: null, groupId: null, targetedGroups: [] });
    (prisma.user as any).findUnique = async () => ({ status: 'ACTIVE', isPrivate: false, mediaPrivacyTarget: true });
    (prisma.follow as any).findUnique = async () => null;
    await assert.rejects(() => getMediaReadPresentation('asset'), (error: unknown) => error instanceof MediaValidationError && error.statusCode === 404);
  } finally {
    (prisma.mediaAsset as any).findUnique = originals.media; (prisma.post as any).findUnique = originals.post;
    (prisma.user as any).findUnique = originals.user; (prisma.follow as any).findUnique = originals.follow;
  }
});
