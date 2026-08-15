import prisma from '../prisma';
import { promoteMediaAsset, restrictMediaAsset } from './mediaService';

const BATCH_SIZE = 20;

export const processMediaPrivacyTransition = async (transitionId: string): Promise<boolean> => {
  const transition = await prisma.mediaPrivacyTransition.findUnique({ where: { id: transitionId } });
  if (!transition || transition.status === 'COMPLETE') return true;

  await prisma.mediaPrivacyTransition.update({
    where: { id: transition.id },
    data: { status: 'RUNNING', startedAt: transition.startedAt || new Date(), failureReason: null }
  });

  try {
    const assets = await prisma.mediaAsset.findMany({
      where: {
        ownerId: transition.userId,
        purpose: { in: ['POST', 'QUESTION_IMAGE', 'OPTION_IMAGE'] },
        status: 'ATTACHED',
        accessScope: transition.targetIsPrivate ? 'PUBLIC' : 'RESTRICTED',
        ...(transition.cursorAssetId ? { id: { gt: transition.cursorAssetId } } : {})
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true }
    });

    for (const asset of assets) {
      if (transition.targetIsPrivate) await restrictMediaAsset(asset.id, 'RESTRICTED');
      else await promoteMediaAsset(asset.id);
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

    await prisma.$transaction([
      prisma.user.update({
        where: { id: transition.userId },
        data: { isPrivate: transition.targetIsPrivate, mediaPrivacyTarget: null }
      }),
      prisma.mediaPrivacyTransition.update({
        where: { id: transition.id },
        data: {
          status: 'COMPLETE',
          processedCount: { increment: assets.length },
          completedAt: new Date(),
          failureReason: null
        }
      })
    ]);
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

export const requestMediaPrivacyTransition = async (userId: string, targetIsPrivate: boolean) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPrivate: true, mediaPrivacyTarget: true }
  });
  if (!user) throw new Error('User not found');
  if (user.mediaPrivacyTarget !== null) {
    if (user.mediaPrivacyTarget === targetIsPrivate) return null;
    throw new Error('A privacy transition is already in progress.');
  }
  if (user.isPrivate === targetIsPrivate) return null;

  const transition = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { mediaPrivacyTarget: targetIsPrivate } });
    return tx.mediaPrivacyTransition.create({ data: { userId, targetIsPrivate } });
  });

  const complete = await processMediaPrivacyTransition(transition.id);
  if (!complete) continueTransition(transition.id);
  return transition.id;
};

export const resumeMediaPrivacyTransitions = async (): Promise<number> => {
  const transitions = await prisma.mediaPrivacyTransition.findMany({
    where: { status: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
    orderBy: { createdAt: 'asc' },
    take: 5,
    select: { id: true }
  });
  for (const transition of transitions) continueTransition(transition.id);
  return transitions.length;
};
