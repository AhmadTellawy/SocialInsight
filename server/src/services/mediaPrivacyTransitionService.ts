import { AccountSecurityError, lockAccountSecurity } from './mfaService';
import prisma from '../prisma';
import {
  ATTACHED_MEDIA_SCOPE_SELECT,
  promoteMediaAsset,
  resolveAttachedMediaScopeFromState,
  restrictMediaAsset
} from './mediaService';
import { Prisma } from '@prisma/client';
import { acceptPendingPublicFollowers } from './publicFollowAcceptanceService';

const BATCH_SIZE = 20;
const WORKER_LEASE_MS = 15 * 60_000;
const FOLLOW_ACCEPTANCE_PHASE = 'FOLLOW_ACCEPTANCE_PENDING';
class SupersededTransition extends Error {}
class MediaSourceScopeChanged extends Error {}

export const processMediaPrivacyTransition = async (transitionId: string): Promise<boolean> => {
  const identity = await prisma.mediaPrivacyTransition.findUnique({ where: { id: transitionId }, select: { userId: true } });
  if (!identity) return true;
  const transition = await prisma.$transaction(async tx => {
    await lockAccountSecurity(tx, identity.userId);
    const job = await tx.mediaPrivacyTransition.findUnique({ where: { id: transitionId } });
    if (!job || job.status === 'COMPLETE') return null;
    const account = await tx.user.findUnique({ where: { id: job.userId }, select: { status: true, isPrivate: true, mediaPrivacyTarget: true } });
    const acceptFollowersOnly = job.failureReason === FOLLOW_ACCEPTANCE_PHASE;
    const currentIntent = acceptFollowersOnly
      ? account?.status === 'ACTIVE' && !account.isPrivate && account.mediaPrivacyTarget === null
      : !!account && account.mediaPrivacyTarget === job.targetIsPrivate && (account.status === 'ACTIVE' || job.targetIsPrivate);
    if (!currentIntent) {
      await tx.mediaPrivacyTransition.update({ where: { id: job.id }, data: { status: 'COMPLETE', completedAt: new Date(), failureReason: 'SUPERSEDED' } });
      return null;
    }
    // Cron and immediate continuation must not process the same batch together.
    if (job.status === 'RUNNING' && job.startedAt && job.startedAt.getTime() > Date.now() - WORKER_LEASE_MS) return null;
    const claimed = await tx.mediaPrivacyTransition.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date(), failureReason: acceptFollowersOnly ? FOLLOW_ACCEPTANCE_PHASE : null } });
    return { ...claimed, acceptFollowersOnly };
  });
  if (!transition) return true;
  if (transition.acceptFollowersOnly) {
    try {
      await acceptPendingPublicFollowers(transition.userId);
      await prisma.$transaction(async tx => {
        await lockAccountSecurity(tx, transition.userId);
        await tx.mediaPrivacyTransition.updateMany({
          where: { id: transition.id, status: 'RUNNING', startedAt: transition.startedAt, failureReason: FOLLOW_ACCEPTANCE_PHASE },
          data: { status: 'COMPLETE', completedAt: new Date(), failureReason: null }
        });
      });
      return true;
    } catch (error) {
      await prisma.$transaction(async tx => {
        await lockAccountSecurity(tx, transition.userId);
        await tx.mediaPrivacyTransition.updateMany({
          where: { id: transition.id, status: 'RUNNING', startedAt: transition.startedAt, failureReason: FOLLOW_ACCEPTANCE_PHASE },
          data: { status: 'FAILED' }
        });
      });
      throw error;
    }
  }
  const targetIsPrivate = transition.targetIsPrivate;
  const assertCurrent = async (tx: Prisma.TransactionClient) => {
    const [job, account] = await Promise.all([
      tx.mediaPrivacyTransition.findUnique({ where: { id: transition.id }, select: { status: true, startedAt: true } }),
      tx.user.findUnique({ where: { id: transition.userId }, select: { status: true, mediaPrivacyTarget: true } })
    ]);
    if (job?.status !== 'RUNNING' || job.startedAt?.getTime() !== transition.startedAt?.getTime()
      || account?.mediaPrivacyTarget !== targetIsPrivate || (account.status !== 'ACTIVE' && !targetIsPrivate)) throw new SupersededTransition();
  };
  const reconcileAttachedAsset = async (assetId: string): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, select: ATTACHED_MEDIA_SCOPE_SELECT });
      if (!asset) return;
      const desiredScope = resolveAttachedMediaScopeFromState(asset, targetIsPrivate);
      const assertSourceScope = async (tx: Prisma.TransactionClient) => {
        await assertCurrent(tx);
        const current = await tx.mediaAsset.findUnique({ where: { id: assetId }, select: ATTACHED_MEDIA_SCOPE_SELECT });
        if (resolveAttachedMediaScopeFromState(current, targetIsPrivate) !== desiredScope) throw new MediaSourceScopeChanged();
      };
      try {
        if (desiredScope === 'PUBLIC') {
          // A previous public state may have left exact public variants behind
          // after the source became restricted. Remove the stale disclosure
          // before minting a fresh public presentation for the current source.
          if (asset.accessScope !== 'PUBLIC' && asset.variants.some(variant => variant.isPublic)) {
            await restrictMediaAsset(assetId, 'RESTRICTED', assertSourceScope);
          }
          await promoteMediaAsset(assetId, assertSourceScope);
        } else await restrictMediaAsset(assetId, desiredScope, assertSourceScope);
        return;
      } catch (error) {
        if (error instanceof MediaSourceScopeChanged) continue;
        throw error;
      }
    }
    throw new Error('Media attachment scope kept changing during privacy transition.');
  };

  try {
    const assets = await prisma.mediaAsset.findMany({
      where: {
        ownerId: transition.userId,
        purpose: { in: ['POST', 'PROFILE_AVATAR', 'PROFILE_COVER', 'QUESTION_IMAGE', 'OPTION_IMAGE'] },
        status: 'ATTACHED',
        ...(targetIsPrivate
          ? { OR: [{ accessScope: 'PUBLIC' as const }, { variants: { some: { isPublic: true } } }] }
          : { OR: [{ accessScope: { not: 'PUBLIC' as const } }, { variants: { some: { isPublic: true } } }] }),
        ...(transition.cursorAssetId ? { id: { gt: transition.cursorAssetId } } : {})
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: ATTACHED_MEDIA_SCOPE_SELECT
    });

    for (const asset of assets) {
      await reconcileAttachedAsset(asset.id);
    }

    if (assets.length === BATCH_SIZE) {
      await prisma.$transaction(async tx => {
        await lockAccountSecurity(tx, transition.userId);
        await assertCurrent(tx);
        await tx.mediaPrivacyTransition.update({
        where: { id: transition.id },
        data: {
          cursorAssetId: assets[assets.length - 1].id,
          status: 'PENDING',
          processedCount: { increment: assets.length }
        }
        });
      });
      return false;
    }

    await prisma.$transaction(async tx => {
      await lockAccountSecurity(tx, transition.userId);
      await assertCurrent(tx);
      const currentAccount = await tx.user.findUnique({ where: { id: transition.userId }, select: { status: true } });
      await tx.mediaPrivacyTransition.update({ where: { id: transition.id }, data: {
        status: targetIsPrivate ? 'COMPLETE' : 'PENDING', processedCount: { increment: assets.length },
        completedAt: targetIsPrivate ? new Date() : null, failureReason: targetIsPrivate ? null : FOLLOW_ACCEPTANCE_PHASE
      } });
      await tx.user.update({ where: { id: transition.userId }, data: {
        ...(currentAccount?.status === 'ACTIVE' ? { isPrivate: transition.targetIsPrivate } : {}),
        mediaPrivacyTarget: null
      } });
    });
    // This durable phase survives a crash between publishing the profile and
    // accepting followers; retries use the same idempotent authorization path.
    if (!targetIsPrivate) return processMediaPrivacyTransition(transition.id);
    return true;
  } catch (error) {
    const stillCurrent = await prisma.$transaction(async tx => {
      await lockAccountSecurity(tx, transition.userId);
      try { await assertCurrent(tx); } catch (failure) { if (failure instanceof SupersededTransition) return false; throw failure; }
      await tx.mediaPrivacyTransition.update({ where: { id: transition.id }, data: { status: 'FAILED', failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown media transition error' } });
      return true;
    });
    if (!stillCurrent || error instanceof SupersededTransition) return true;
    throw error;
  }
};

const continueTransition = (transitionId: string): void => {
  setImmediate(async () => {
    try {
      const complete = await processMediaPrivacyTransition(transitionId);
      if (!complete) continueTransition(transitionId);
    } catch (error) {
      console.error('Media privacy transition failed:', error instanceof Error ? error.message : 'unknown error');
    }
  });
};

export const requestMediaPrivacyTransition = async (userId: string, targetIsPrivate: boolean, authorize?: (tx: any) => Promise<void>) => {
  const transition = await prisma.$transaction(async tx => {
    await lockAccountSecurity(tx, userId);
    if (authorize) await authorize(tx);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, isPrivate: true, mediaPrivacyTarget: true } });
    if (!user || user.status !== 'ACTIVE') throw new AccountSecurityError('AUTH_REQUIRED', 401);
    if (user.mediaPrivacyTarget !== null) {
      if (user.mediaPrivacyTarget === targetIsPrivate) return null;
      if (!targetIsPrivate) throw new Error('A privacy transition is already in progress.');
      // A requested expansion can always be cancelled safely. Mark every old
      // worker terminal before persisting the more restrictive replacement.
      await tx.mediaPrivacyTransition.updateMany({ where: { userId, status: { in: ['PENDING', 'RUNNING', 'FAILED'] } }, data: { status: 'COMPLETE', completedAt: new Date(), failureReason: 'SUPERSEDED' } });
      await tx.user.update({ where: { id: userId }, data: { isPrivate: true, mediaPrivacyTarget: true } });
      return tx.mediaPrivacyTransition.create({ data: { userId, targetIsPrivate: true } });
    }
    if (user.isPrivate === targetIsPrivate) return null;
    await tx.mediaPrivacyTransition.updateMany({ where: { userId, status: { in: ['PENDING', 'RUNNING', 'FAILED'] } }, data: { status: 'COMPLETE', completedAt: new Date(), failureReason: 'SUPERSEDED' } });
    await tx.user.update({ where: { id: userId }, data: { mediaPrivacyTarget: targetIsPrivate } });
    return tx.mediaPrivacyTransition.create({ data: { userId, targetIsPrivate } });
  });
  if (!transition) return null;
  const complete = await processMediaPrivacyTransition(transition.id);
  if (!complete) continueTransition(transition.id);
  return transition.id;
};

export const resumeMediaPrivacyTransitions = async (): Promise<number> => {
  // Backfill the newly protected avatar scope without resetting or exposing data.
  // A pending transition is durable and retried by the same normal worker.
  const legacyPrivateAvatars = await prisma.user.findMany({ where: { isPrivate: true, status: 'ACTIVE', mediaPrivacyTarget: null,
    avatarMedia: { is: { status: 'ATTACHED', accessScope: 'PUBLIC' } },
    mediaPrivacyTransitions: { none: { status: { in: ['PENDING', 'RUNNING', 'FAILED'] } } }
  }, take: 5, select: { id: true } });
  for (const user of legacyPrivateAvatars) {
    await prisma.$transaction(async tx => {
      await lockAccountSecurity(tx, user.id);
      const claimed = await tx.user.updateMany({ where: { id: user.id, isPrivate: true, status: 'ACTIVE', mediaPrivacyTarget: null }, data: { mediaPrivacyTarget: true } });
      if (claimed.count === 1) await tx.mediaPrivacyTransition.create({ data: { userId: user.id, targetIsPrivate: true } });
    });
  }
  const transitions = await prisma.mediaPrivacyTransition.findMany({
    where: { status: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
    orderBy: { createdAt: 'asc' },
    take: 5,
    select: { id: true }
  });
  for (const transition of transitions) continueTransition(transition.id);
  return transitions.length;
};
