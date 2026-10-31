import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { REEL_MAX_SECONDS, ReelError } from './reelPolicy';
import { streamProvider } from './streamProvider';

export async function assertAttachableVideo(tx: Prisma.TransactionClient, id: string, ownerId: string, postId?: string) {
  await tx.$queryRaw`SELECT id FROM "VideoAsset" WHERE id = ${id} FOR UPDATE`;
  const asset = await tx.videoAsset.findUnique({ where: { id }, include: { post: { select: { id: true } } } });
  // The caller authorizes the post editor first. Existing Page videos belong to
  // that post, even if a different editor originally uploaded them.
  if (!asset || asset.status !== 'READY' || (asset.post ? asset.post.id !== postId : asset.ownerId !== ownerId || asset.attachedAt !== null)) throw new ReelError('REEL_VIDEO_NOT_READY', 'Your video must finish processing before it can be used.', 409);
  // Invalidate any cleanup claim that observed the unattached asset earlier.
  const now = new Date();
  await tx.videoAsset.update({ where: { id }, data: { updatedAt: now, attachedAt: asset.attachedAt || now } });
  return asset;
}

export async function cancelUnattachedVideo(tx: Prisma.TransactionClient, id: string, ownerId: string) {
  // A waiting UPDATE keeps its statement snapshot for relation predicates.
  // Take the lock first, then read the committed attachment in a new statement.
  await tx.$queryRaw`SELECT id FROM "VideoAsset" WHERE id = ${id} FOR UPDATE`;
  const asset = await tx.videoAsset.findUnique({ where: { id }, include: { post: { select: { id: true } } } });
  if (!asset || asset.ownerId !== ownerId || asset.post || ['DELETED', 'PENDING_DELETE'].includes(asset.status)) throw new ReelError('VIDEO_UNAVAILABLE', 'Video is unavailable or already attached.', 409);
  await tx.videoAsset.update({ where: { id }, data: { status: 'PENDING_DELETE', uploadUrl: null } });
}

export async function reconcileVideo(id: string) {
  const asset = await prisma.videoAsset.findUnique({ where: { id } });
  if (!asset?.providerId || !['UPLOADING', 'PROCESSING'].includes(asset.status)) return asset;
  const remote = await streamProvider.inspect(asset.providerId);
  if (remote?.uid !== asset.providerId) throw new ReelError('VIDEO_PROVIDER_RESPONSE', 'Unable to verify video.', 503);
  const ready = remote.status?.state === 'ready' && remote.readyToStream === true;
  const invalid = remote.requireSignedURLs !== true || remote.status?.state === 'error' || (ready && (!Number.isFinite(remote.duration) || remote.duration < 0.1 || remote.duration > REEL_MAX_SECONDS || !(remote.input?.width > 0) || !(remote.input?.height > 0)));
  await prisma.videoAsset.updateMany({ where: { id, status: { in: ['UPLOADING', 'PROCESSING'] } }, data: {
    status: invalid ? 'FAILED' : ready ? 'READY' : 'PROCESSING',
    errorCode: invalid ? 'VIDEO_PROCESSING_FAILED' : null,
    ...(ready && !invalid ? { duration: remote.duration, width: remote.input.width, height: remote.input.height } : {})
  } });
  return prisma.videoAsset.findUnique({ where: { id } });
}

/** Durable database state makes missed callbacks and interrupted cleanup retryable. */
export async function maintainReelVideos() {
  const now = new Date();
  const candidates = await prisma.videoAsset.findMany({ where: { OR: [
    { providerId: null, status: { in: ['CREATING', 'FAILED'] }, updatedAt: { lt: new Date(Date.now() - 60_000) } },
    { status: { in: ['UPLOADING', 'PROCESSING'] } },
    { status: 'PENDING_DELETE' },
    { post: null, expiresAt: { lt: now }, status: { not: 'DELETED' } },
    { post: null, attachedAt: { not: null }, status: { not: 'DELETED' } },
    { owner: { status: 'DELETED' }, status: { not: 'DELETED' }, OR: [{ post: null }, { post: { pageId: null } }] },
    { post: { isDeleted: true, deletedAt: { lt: new Date(Date.now() - 30 * 86400_000) } }, status: { not: 'DELETED' } }
  ] }, orderBy: { updatedAt: 'asc' }, take: 20, include: { post: { select: { isDeleted: true, deletedAt: true, pageId: true } }, owner: { select: { status: true } } } });
  for (const asset of candidates) {
    try {
      if (!asset.providerId && ['CREATING', 'FAILED'].includes(asset.status)) {
        const recovered = await streamProvider.findUpload(asset.id);
        for (const video of recovered) await streamProvider.remove(video.uid);
        await prisma.videoAsset.updateMany({ where: { id: asset.id, updatedAt: asset.updatedAt }, data: { status: 'DELETED', uploadUrl: null } });
        continue;
      }
      const expired = !asset.post && (asset.expiresAt < now || asset.attachedAt !== null);
      const erased = asset.owner.status === 'DELETED' && !asset.post?.pageId;
      const deleted = asset.post?.isDeleted && asset.post.deletedAt && asset.post.deletedAt.getTime() < Date.now() - 30 * 86400_000;
      if (expired || erased || deleted || asset.status === 'PENDING_DELETE') {
        const claimed = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "VideoAsset" WHERE id = ${asset.id} FOR UPDATE`;
          return tx.videoAsset.updateMany({ where: { id: asset.id, updatedAt: asset.updatedAt }, data: { status: 'PENDING_DELETE' } });
        });
        if (!claimed.count) continue;
        if (asset.providerId) await streamProvider.remove(asset.providerId);
        await prisma.videoAsset.update({ where: { id: asset.id }, data: { status: 'DELETED', uploadUrl: null, providerId: null, errorCode: null } });
      } else await reconcileVideo(asset.id);
    } catch { console.warn(JSON.stringify({ event: 'reel_video_maintenance_retry', assetId: asset.id })); }
  }
}
