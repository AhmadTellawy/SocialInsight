import { PeopleTagPermission, PeopleTagStatus, Prisma } from '@prisma/client';
import { MEMBERSHIP_STATUS, POST_STATUS } from '../utils/constants';
import { buildPostDeepLink } from '../utils/notificationTarget';
import {
  PUBLIC_AVATAR_MEDIA_SELECT,
  serializeUserMediaRecord
} from './mediaService';

export const PEOPLE_TAG_LIMIT = 10;

export class PeopleTagValidationError extends Error {
  constructor(
    public readonly code: 'PEOPLE_TAG_LIMIT_EXCEEDED' | 'PEOPLE_TAG_INELIGIBLE',
    public readonly invalidTargetIds: string[] = []
  ) {
    super(code === 'PEOPLE_TAG_LIMIT_EXCEEDED'
      ? `You can tag up to ${PEOPLE_TAG_LIMIT} people.`
      : 'One or more selected people cannot be tagged in this post.');
    this.name = 'PeopleTagValidationError';
  }
}

export interface PeopleTagLifecycleResult {
  notificationIds: string[];
  taggedUserIds: string[];
  created: number;
  retained: number;
  removed: number;
}

export const getVisiblePeopleTagsInclude = (viewerId?: string | null) => ({
  where: viewerId
    ? {
        OR: [
          { status: PeopleTagStatus.ACCEPTED },
          {
            status: PeopleTagStatus.PENDING,
            OR: [
              { taggedUserId: viewerId },
              { taggedByUserId: viewerId }
            ]
          }
        ]
      }
    : { status: PeopleTagStatus.ACCEPTED },
  include: {
    taggedUser: {
      select: {
        id: true,
        name: true,
        handle: true,
        avatar: true,
        ...PUBLIC_AVATAR_MEDIA_SELECT
      }
    }
  },
  orderBy: { createdAt: 'asc' as const }
});

export const serializePeopleTags = (tags: any[] | null | undefined) =>
  (tags || []).map((tag) => ({
    id: tag.id,
    status: tag.status,
    taggedUserId: tag.taggedUserId,
    taggedByUserId: tag.taggedByUserId,
    taggedUser: serializeUserMediaRecord(tag.taggedUser),
    createdAt: tag.createdAt
  }));

const normalizeTargetIds = (targetUserIds: string[]): string[] =>
  Array.from(new Set(targetUserIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));

const validateTargets = async (
  tx: Prisma.TransactionClient,
  input: { postId: string; actorUserId: string; targetUserIds: string[] }
): Promise<{ validIds: string[]; invalidIds: string[]; isPublished: boolean }> => {
  const targetUserIds = normalizeTargetIds(input.targetUserIds);
  if (targetUserIds.length > PEOPLE_TAG_LIMIT) {
    throw new PeopleTagValidationError('PEOPLE_TAG_LIMIT_EXCEEDED');
  }

  const post = await tx.post.findUnique({
    where: { id: input.postId },
    select: {
      authorId: true,
      status: true,
      isDeleted: true,
      targetAudience: true,
      author: { select: { isPrivate: true, mediaPrivacyTarget: true } },
      groupId: true,
      targetedGroups: { select: { id: true } }
    }
  });
  if (!post || post.isDeleted) return { validIds: [], invalidIds: targetUserIds, isPublished: false };

  const users = targetUserIds.length > 0
    ? await tx.user.findMany({
        where: { id: { in: targetUserIds }, status: 'ACTIVE' },
        select: { id: true, peopleTagPermission: true }
      })
    : [];
  const existingUserIds = new Set(users.map((user) => user.id));
  const candidateIds = targetUserIds.filter((id) => id !== input.actorUserId && existingUserIds.has(id));
  const groupIds = Array.from(new Set([
    post.groupId,
    ...post.targetedGroups.map((group) => group.id)
  ].filter((groupId): groupId is string => Boolean(groupId))));

  const [blocks, targetFollowsActor, targetFollowsAuthor, memberships] = await Promise.all([
    candidateIds.length > 0
      ? tx.userBlock.findMany({
          where: {
            OR: [
              { blockerId: input.actorUserId, blockedId: { in: candidateIds } },
              { blockerId: { in: candidateIds }, blockedId: input.actorUserId }
            ]
          },
          select: { blockerId: true, blockedId: true }
        })
      : Promise.resolve([]),
    candidateIds.length > 0
      ? tx.follow.findMany({
          where: { followerId: { in: candidateIds }, followingId: input.actorUserId, status: 'ACTIVE' },
          select: { followerId: true }
        })
      : Promise.resolve([]),
    candidateIds.length > 0
      ? tx.follow.findMany({
          where: { followerId: { in: candidateIds }, followingId: post.authorId, status: 'ACTIVE' },
          select: { followerId: true }
        })
      : Promise.resolve([]),
    candidateIds.length > 0 && groupIds.length > 0
      ? tx.groupMember.findMany({
          where: {
            userId: { in: candidateIds },
            groupId: { in: groupIds },
            status: MEMBERSHIP_STATUS.JOINED
          },
          select: { userId: true }
        })
      : Promise.resolve([])
  ]);

  const blockedIds = new Set(blocks.map((block) =>
    block.blockerId === input.actorUserId ? block.blockedId : block.blockerId
  ));
  const followsActorIds = new Set(targetFollowsActor.map((follow) => follow.followerId));
  const followsAuthorIds = new Set(targetFollowsAuthor.map((follow) => follow.followerId));
  const memberIds = new Set(memberships.map((membership) => membership.userId));
  const permissionById = new Map(users.map((user) => [user.id, user.peopleTagPermission]));
  const audience = (post.targetAudience || 'Public').trim().toLowerCase();

  const validIds = candidateIds.filter((targetId) => {
    if (blockedIds.has(targetId)) return false;
    const permission = permissionById.get(targetId);
    if (permission === PeopleTagPermission.NO_ONE) return false;
    if (permission === PeopleTagPermission.FOLLOWING && !followsActorIds.has(targetId)) return false;
    if (targetId === post.authorId) return true;
    if (groupIds.length > 0) return memberIds.has(targetId);
    if (audience === 'followers' && !followsAuthorIds.has(targetId)) return false;
    if (!['public', 'followers', ''].includes(audience)) return false;
    if (post.author.isPrivate || post.author.mediaPrivacyTarget === true) {
      return followsAuthorIds.has(targetId);
    }
    return true;
  });
  const validSet = new Set(validIds);
  return {
    validIds,
    invalidIds: targetUserIds.filter((targetId) => !validSet.has(targetId)),
    isPublished: post.status === POST_STATUS.PUBLISHED
  };
};

const createPeopleTagNotification = async (
  tx: Prisma.TransactionClient,
  tagId: string,
  postId: string,
  actorUserId: string,
  targetUserId: string
): Promise<string> => {
  const payload = {
    postId,
    peopleTagId: tagId,
    peopleTagStatus: PeopleTagStatus.PENDING,
    deepLink: buildPostDeepLink(postId)
  };
  const notification = await tx.notification.create({
    data: {
      userId: targetUserId,
      actorId: actorUserId,
      type: 'people_tag',
      message: 'tagged you in a post',
      targetType: 'post',
      targetId: postId,
      payload: JSON.stringify(payload),
      dedupeKey: `people-tag:${tagId}`
    },
    select: { id: true }
  });
  await tx.postTaggedUser.update({
    where: { id: tagId },
    data: { notificationId: notification.id }
  });
  return notification.id;
};

export const reconcilePeopleTags = async (
  tx: Prisma.TransactionClient,
  input: {
    postId: string;
    actorUserId: string;
    targetUserIds: string[];
    strict?: boolean;
  }
): Promise<PeopleTagLifecycleResult> => {
  const validation = await validateTargets(tx, input);
  if (input.strict !== false && validation.invalidIds.length > 0) {
    throw new PeopleTagValidationError('PEOPLE_TAG_INELIGIBLE', validation.invalidIds);
  }

  const desiredIds = validation.validIds;
  const desiredSet = new Set(desiredIds);
  const existing = await tx.postTaggedUser.findMany({ where: { postId: input.postId } });
  const existingByUserId = new Map(existing.map((tag) => [tag.taggedUserId, tag]));
  const notificationIds: string[] = [];
  let created = 0;
  let retained = 0;
  let removed = 0;

  for (const tag of existing) {
    if (!desiredSet.has(tag.taggedUserId)) {
      if (tag.notificationId) await tx.notification.deleteMany({ where: { id: tag.notificationId } });
      if (tag.status !== PeopleTagStatus.REMOVED) {
        await tx.postTaggedUser.update({
          where: { id: tag.id },
          data: {
            status: PeopleTagStatus.REMOVED,
            removedAt: new Date(),
            notificationId: null
          }
        });
      }
      removed += 1;
      continue;
    }

    const shouldReactivate = tag.status === PeopleTagStatus.REJECTED || tag.status === PeopleTagStatus.REMOVED;
    if (shouldReactivate) {
      await tx.postTaggedUser.update({
        where: { id: tag.id },
        data: {
          status: PeopleTagStatus.PENDING,
          taggedByUserId: input.actorUserId,
          rejectedAt: null,
          removedAt: null,
          notificationId: null
        }
      });
    }
    if (validation.isPublished && (shouldReactivate || !tag.notificationId) && tag.status !== PeopleTagStatus.ACCEPTED) {
      const notificationId = await createPeopleTagNotification(
        tx,
        tag.id,
        input.postId,
        input.actorUserId,
        tag.taggedUserId
      );
      notificationIds.push(notificationId);
    }
    retained += 1;
  }

  for (const targetUserId of desiredIds) {
    if (existingByUserId.has(targetUserId)) continue;
    const tag = await tx.postTaggedUser.create({
      data: {
        postId: input.postId,
        taggedUserId: targetUserId,
        taggedByUserId: input.actorUserId,
        status: PeopleTagStatus.PENDING
      },
      select: { id: true }
    });
    if (validation.isPublished) {
      const notificationId = await createPeopleTagNotification(
        tx,
        tag.id,
        input.postId,
        input.actorUserId,
        targetUserId
      );
      notificationIds.push(notificationId);
    }
    created += 1;
  }

  return {
    notificationIds,
    taggedUserIds: desiredIds,
    created,
    retained,
    removed
  };
};

export const getCurrentPeopleTagUserIds = async (
  tx: Prisma.TransactionClient,
  postId: string
): Promise<string[]> => {
  const tags = await tx.postTaggedUser.findMany({
    where: {
      postId,
      status: { in: [PeopleTagStatus.PENDING, PeopleTagStatus.ACCEPTED] }
    },
    select: { taggedUserId: true }
  });
  return tags.map((tag) => tag.taggedUserId);
};
