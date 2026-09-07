import { AccountSecurityError, lockAccountSecurity } from './mfaService';
import prisma from '../prisma';
import { promoteMediaAsset, restrictMediaAsset } from './mediaService';

const BATCH_SIZE = 20;
const POST_SCOPE_SELECT = { status: true, isDeleted: true, targetAudience: true, groupId: true, targetedGroups: { select: { id: true } } } as const;

export const processMediaPrivacyTransition = async (transitionId: string): Promise<boolean> => {
  const transition = await prisma.mediaPrivacyTransition.findUnique({ where: { id: transitionId } });
  if (!transition || transition.status === 'COMPLETE') return true;
  const account = await prisma.user.findUnique({ where: { id: transition.userId }, select: { status: true, isPrivate: true } });
  if (!account) return true;
  // An account can deactivate while an older public transition is pending.
  // Never promote its objects after that revocation.
  const targetIsPrivate = transition.targetIsPrivate || account.status !== 'ACTIVE';

  await prisma.mediaPrivacyTransition.update({
    where: { id: transition.id },
    data: { status: 'RUNNING', startedAt: transition.startedAt || new Date(), failureReason: null }
  });

  try {
    const assets = await prisma.mediaAsset.findMany({
      where: {
        ownerId: transition.userId,
        purpose: { in: ['POST', 'PROFILE_AVATAR', 'PROFILE_COVER', 'QUESTION_IMAGE', 'OPTION_IMAGE'] },
        status: 'ATTACHED',
        accessScope: targetIsPrivate ? 'PUBLIC' : 'RESTRICTED',
        ...(transition.cursorAssetId ? { id: { gt: transition.cursorAssetId } } : {})
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, purpose: true,
        postAttachment: { select: { post: { select: POST_SCOPE_SELECT } } },
        questionFor: { select: { post: { select: POST_SCOPE_SELECT }, section: { select: { post: { select: POST_SCOPE_SELECT } } } } },
        optionFor: { select: { question: { select: { post: { select: POST_SCOPE_SELECT }, section: { select: { post: { select: POST_SCOPE_SELECT } } } } } } }
      }
    });

    for (const asset of assets) {
      if (targetIsPrivate) await restrictMediaAsset(asset.id, 'RESTRICTED');
      else {
        const current = await prisma.user.findUnique({ where: { id: transition.userId }, select: { status: true } });
        if (current?.status !== 'ACTIVE') continue;
        const post = asset.postAttachment?.post || asset.questionFor?.post || asset.questionFor?.section?.post || asset.optionFor?.question.post || asset.optionFor?.question.section?.post;
        const isPublicProfileImage = asset.purpose === 'PROFILE_AVATAR' || asset.purpose === 'PROFILE_COVER';
        const isPublicPost = post && post.status === 'PUBLISHED' && !post.isDeleted && !post.groupId && post.targetedGroups.length === 0 && (!post.targetAudience || post.targetAudience.toLowerCase() === 'public');
        if (isPublicProfileImage || isPublicPost) await promoteMediaAsset(asset.id);
      }
    }

    if (assets.length === BATCH_SIZE) {
      await prisma.mediaPrivacyTransition.update({
        where: { id: transition.id },
        data: {
          cursorAssetId: assets[assets.length - 1].id,
          processedCount: { increment: assets.length }
        }
      });
      return false;
    }

    await prisma.$transaction(async tx => {
      await lockAccountSecurity(tx, transition.userId);
      const currentAccount = await tx.user.findUnique({ where: { id: transition.userId }, select: { status: true } });
      await tx.mediaPrivacyTransition.update({ where: { id: transition.id }, data: { status: 'COMPLETE', processedCount: { increment: assets.length }, completedAt: new Date(), failureReason: null } });
      const anotherTransition = await tx.mediaPrivacyTransition.findFirst({ where: { userId: transition.userId, id: { not: transition.id }, status: { in: ['PENDING', 'RUNNING', 'FAILED'] } }, select: { id: true } });
      await tx.user.update({ where: { id: transition.userId }, data: {
        ...(currentAccount?.status === 'ACTIVE' ? { isPrivate: transition.targetIsPrivate } : {}),
        ...(!anotherTransition ? { mediaPrivacyTarget: null } : {})
      } });
    });
    return true;
  } catch (error) {
    await prisma.mediaPrivacyTransition.update({
      where: { id: transition.id },
      data: {
        status: 'FAILED',
        failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown media transition error'
      }
    });
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
      throw new Error('A privacy transition is already in progress.');
    }
    if (user.isPrivate === targetIsPrivate) return null;
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
