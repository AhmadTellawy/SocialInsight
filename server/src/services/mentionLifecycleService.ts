import {
  MentionSourceType,
  MentionState,
  MentionSurface,
  Prisma
} from '@prisma/client';
import { MEMBERSHIP_STATUS, POST_STATUS } from '../utils/constants';
import { MENTION_RECIPIENT_LIMIT, parseTextEntities } from '../utils/textEntities';
import { createMentionNotificationTarget } from '../utils/notificationTarget';
import {
  PUBLIC_AVATAR_MEDIA_SELECT,
  serializeUserMediaRecord
} from './mediaService';

export interface MentionSurfaceInput {
  surface: MentionSurface;
  text: string;
}

export interface MentionLifecycleResult {
  targetUserIds: string[];
  notificationIds: string[];
  created: number;
  retained: number;
  removed: number;
  unresolved: number;
  ineligible: number;
}

export class MentionLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly count: number
  ) {
    super(`Content can mention up to ${limit} unique users.`);
    this.name = 'MentionLimitError';
  }
}

type SourceDescriptor = {
  sourceType: MentionSourceType;
  state: MentionState;
  actorUserId: string;
  postId?: string;
  commentId?: string;
  parentCommentId?: string;
  profileUserId?: string;
  groupId?: string;
  surfaces: MentionSurfaceInput[];
  notify: boolean;
};

type Occurrence = {
  surface: MentionSurface;
  startOffset: number;
  endOffset: number;
  rawText: string;
};

type ResolvedTarget = {
  id: string;
  handle: string;
  occurrences: Occurrence[];
};

const mentionReferenceSelect = {
  id: true,
  targetUserId: true,
  sourceType: true,
  state: true,
  targetUser: {
    select: {
      id: true,
      name: true,
      handle: true,
      avatar: true,
      ...PUBLIC_AVATAR_MEDIA_SELECT
    }
  },
  occurrences: {
    orderBy: [{ surface: 'asc' }, { startOffset: 'asc' }],
    select: {
      surface: true,
      startOffset: true,
      endOffset: true,
      rawText: true
    }
  }
} satisfies Prisma.MentionSelect;

export const ACTIVE_MENTION_REFERENCE_INCLUDE = {
  where: { state: MentionState.ACTIVE },
  select: mentionReferenceSelect
} satisfies Prisma.MentionFindManyArgs;

export const serializeMentionReferences = (mentions: any[] | null | undefined) =>
  (mentions || []).map((mention) => ({
    id: mention.id,
    targetUserId: mention.targetUserId,
    sourceType: mention.sourceType,
    targetUser: serializeUserMediaRecord(mention.targetUser),
    occurrences: mention.occurrences || []
  }));

const collectOccurrences = (surfaces: MentionSurfaceInput[]) => {
  const byHandle = new Map<string, Occurrence[]>();
  for (const surface of surfaces) {
    for (const entity of parseTextEntities(surface.text || '')) {
      if (entity.type !== 'mention') continue;
      const occurrences = byHandle.get(entity.normalizedValue) || [];
      occurrences.push({
        surface: surface.surface,
        startOffset: entity.start,
        endOffset: entity.end,
        rawText: entity.raw
      });
      byHandle.set(entity.normalizedValue, occurrences);
    }
  }
  if (byHandle.size > MENTION_RECIPIENT_LIMIT) {
    throw new MentionLimitError(MENTION_RECIPIENT_LIMIT, byHandle.size);
  }
  return byHandle;
};

const sourceWhere = (source: SourceDescriptor): Prisma.MentionWhereInput => {
  if (source.commentId) return { commentId: source.commentId };
  if (source.profileUserId) return { profileUserId: source.profileUserId };
  if (source.groupId) return { groupId: source.groupId };
  return { postId: source.postId, sourceType: MentionSourceType.POST };
};

const sourceData = (source: SourceDescriptor): Prisma.MentionUncheckedCreateInput => ({
  targetUserId: '',
  actorUserId: source.actorUserId,
  sourceType: source.sourceType,
  state: source.state,
  postId: source.postId,
  commentId: source.commentId,
  profileUserId: source.profileUserId,
  groupId: source.groupId
});

const resolveTargets = async (
  tx: Prisma.TransactionClient,
  source: SourceDescriptor,
  occurrencesByHandle: Map<string, Occurrence[]>,
  existingMentions: Array<{
    targetUserId: string;
    occurrences: Array<{ rawText: string }>;
  }>
): Promise<{ targets: ResolvedTarget[]; unresolved: number; ineligible: number }> => {
  const handles = Array.from(occurrencesByHandle.keys());
  if (handles.length === 0) return { targets: [], unresolved: 0, ineligible: 0 };

  const persistedTargetsByHistoricalHandle = new Map<string, Set<string>>();
  for (const mention of existingMentions) {
    for (const occurrence of mention.occurrences) {
      const entity = parseTextEntities(occurrence.rawText || '')
        .find((candidate) => candidate.type === 'mention');
      if (!entity) continue;
      const targetIds = persistedTargetsByHistoricalHandle.get(entity.normalizedValue) || new Set<string>();
      targetIds.add(mention.targetUserId);
      persistedTargetsByHistoricalHandle.set(entity.normalizedValue, targetIds);
    }
  }
  const persistedTargetIds = Array.from(new Set(
    Array.from(persistedTargetsByHistoricalHandle.values()).flatMap((ids) => Array.from(ids))
  ));

  const candidates = await tx.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        ...handles.map((handle) => ({ handle: { equals: handle, mode: 'insensitive' as const } })),
        ...(persistedTargetIds.length > 0 ? [{ id: { in: persistedTargetIds } }] : [])
      ]
    },
    select: { id: true, handle: true, status: true }
  });

  const usersByHandle = new Map<string, typeof candidates>();
  for (const user of candidates) {
    const normalized = user.handle.toLowerCase();
    usersByHandle.set(normalized, [...(usersByHandle.get(normalized) || []), user]);
  }
  const usersById = new Map(candidates.map((user) => [user.id, user]));

  const unambiguous = handles.flatMap((handle) => {
    const persistedTargetIdsForHandle = persistedTargetsByHistoricalHandle.get(handle);
    const matches = persistedTargetIdsForHandle
      ? Array.from(persistedTargetIdsForHandle).map((id) => usersById.get(id)).filter((user): user is typeof candidates[number] => Boolean(user))
      : usersByHandle.get(handle) || [];
    return matches.length === 1
      ? [{ ...matches[0], occurrences: occurrencesByHandle.get(handle) || [] }]
      : [];
  });
  const unresolved = handles.length - unambiguous.length;
  const targetsById = new Map<string, ResolvedTarget>();
  for (const target of unambiguous) {
    const existing = targetsById.get(target.id);
    if (existing) existing.occurrences.push(...target.occurrences);
    else targetsById.set(target.id, { ...target, occurrences: [...target.occurrences] });
  }
  const resolvedTargets = Array.from(targetsById.values());
  const targetIds = resolvedTargets
    .map((target) => target.id)
    .filter((targetId) => targetId !== source.actorUserId);

  const blocks = targetIds.length > 0
    ? await tx.userBlock.findMany({
        where: {
          OR: [
            { blockerId: source.actorUserId, blockedId: { in: targetIds } },
            { blockerId: { in: targetIds }, blockedId: source.actorUserId }
          ]
        },
        select: { blockerId: true, blockedId: true }
      })
    : [];
  const blockedIds = new Set(blocks.map((block) =>
    block.blockerId === source.actorUserId ? block.blockedId : block.blockerId
  ));

  let postContext: {
    authorId: string;
    status: string;
    isDeleted: boolean;
    targetAudience: string | null;
    author: { isPrivate: boolean; mediaPrivacyTarget: boolean | null };
    groupIds: string[];
  } | null = null;
  let followerIds = new Set<string>();
  let groupMemberIds = new Set<string>();

  if (source.postId && source.state === MentionState.ACTIVE) {
    const post = await tx.post.findUnique({
      where: { id: source.postId },
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
    if (post) {
      const groupIds = Array.from(new Set([
        post.groupId,
        ...post.targetedGroups.map((group) => group.id)
      ].filter((groupId): groupId is string => Boolean(groupId))));
      postContext = { ...post, groupIds };

      const [follows, memberships] = await Promise.all([
        targetIds.length > 0
          ? tx.follow.findMany({
              where: {
                followerId: { in: targetIds },
                followingId: post.authorId,
                status: 'ACTIVE'
              },
              select: { followerId: true }
            })
          : Promise.resolve([]),
        targetIds.length > 0 && groupIds.length > 0
          ? tx.groupMember.findMany({
              where: {
                userId: { in: targetIds },
                groupId: { in: groupIds },
                status: MEMBERSHIP_STATUS.JOINED
              },
              select: { userId: true }
            })
          : Promise.resolve([])
      ]);
      followerIds = new Set(follows.map((follow) => follow.followerId));
      groupMemberIds = new Set(memberships.map((membership) => membership.userId));
    }
  }

  const isEligible = (targetId: string): boolean => {
    if (targetId === source.actorUserId || blockedIds.has(targetId)) return false;
    if (!source.postId || source.state === MentionState.STAGED) return true;
    if (!postContext || postContext.isDeleted || postContext.status !== POST_STATUS.PUBLISHED) return false;
    if (targetId === postContext.authorId) return true;
    if (postContext.groupIds.length > 0) return groupMemberIds.has(targetId);

    const audience = (postContext.targetAudience || 'Public').trim().toLowerCase();
    if (audience === 'followers' && !followerIds.has(targetId)) return false;
    if (!['public', 'followers', ''].includes(audience)) return false;
    if (postContext.author.isPrivate || postContext.author.mediaPrivacyTarget === true) {
      return followerIds.has(targetId);
    }
    return true;
  };

  const targets = resolvedTargets.filter((target) => isEligible(target.id));
  return {
    targets,
    unresolved,
    ineligible: resolvedTargets.length - targets.length
  };
};

const createMentionNotification = async (
  tx: Prisma.TransactionClient,
  mentionId: string,
  source: SourceDescriptor,
  targetUserId: string
): Promise<string | null> => {
  if (!source.notify || !source.postId) return null;
  const target = createMentionNotificationTarget({
    postId: source.postId,
    ...(source.commentId && source.sourceType === MentionSourceType.COMMENT
      ? { commentId: source.commentId }
      : {}),
    ...(source.commentId && source.sourceType === MentionSourceType.REPLY
      ? { commentId: source.parentCommentId || source.commentId, replyId: source.commentId }
      : {})
  });
  const notification = await tx.notification.create({
    data: {
      userId: targetUserId,
      actorId: source.actorUserId,
      type: 'mention',
      message: `mentioned you in a ${target.sourceType === 'post' ? 'post' : target.sourceType}`,
      targetType: 'post',
      targetId: source.postId,
      payload: JSON.stringify(target),
      dedupeKey: `mention:${mentionId}`
    },
    select: { id: true }
  });
  await tx.mention.update({
    where: { id: mentionId },
    data: { notificationId: notification.id }
  });
  return notification.id;
};

const reconcileMentions = async (
  tx: Prisma.TransactionClient,
  source: SourceDescriptor
): Promise<MentionLifecycleResult> => {
  const occurrencesByHandle = collectOccurrences(source.surfaces);
  const existing = await tx.mention.findMany({
    where: sourceWhere(source),
    include: { occurrences: true }
  });
  const resolution = await resolveTargets(tx, source, occurrencesByHandle, existing);
  const desiredByTargetId = new Map(resolution.targets.map((target) => [target.id, target]));
  const existingByTargetId = new Map(existing.map((mention) => [mention.targetUserId, mention]));
  const notificationIds: string[] = [];
  let created = 0;
  let retained = 0;
  let removed = 0;

  for (const mention of existing) {
    const desired = desiredByTargetId.get(mention.targetUserId);
    if (!desired) {
      if (mention.notificationId) {
        await tx.notification.deleteMany({ where: { id: mention.notificationId } });
      }
      await tx.mention.delete({ where: { id: mention.id } });
      removed += 1;
      continue;
    }

    const wasActive = mention.state === MentionState.ACTIVE;
    if (wasActive && source.state === MentionState.STAGED && mention.notificationId) {
      await tx.notification.deleteMany({ where: { id: mention.notificationId } });
    }
    await tx.mention.update({
      where: { id: mention.id },
      data: {
        actorUserId: source.actorUserId,
        sourceType: source.sourceType,
        state: source.state,
        notificationId: wasActive && source.state === MentionState.STAGED ? null : undefined
      }
    });
    await tx.mentionOccurrence.deleteMany({ where: { mentionId: mention.id } });
    if (desired.occurrences.length > 0) {
      await tx.mentionOccurrence.createMany({
        data: desired.occurrences.map((occurrence) => ({
          mentionId: mention.id,
          ...occurrence
        }))
      });
    }
    if (!wasActive && source.state === MentionState.ACTIVE && !mention.notificationId) {
      const notificationId = await createMentionNotification(tx, mention.id, source, mention.targetUserId);
      if (notificationId) notificationIds.push(notificationId);
    }
    retained += 1;
  }

  for (const target of resolution.targets) {
    if (existingByTargetId.has(target.id)) continue;
    const base = sourceData(source);
    const mention = await tx.mention.create({
      data: {
        ...base,
        targetUserId: target.id,
        occurrences: {
          create: target.occurrences.map((occurrence) => occurrence)
        }
      },
      select: { id: true }
    });
    if (source.state === MentionState.ACTIVE) {
      const notificationId = await createMentionNotification(tx, mention.id, source, target.id);
      if (notificationId) notificationIds.push(notificationId);
    }
    created += 1;
  }

  return {
    targetUserIds: resolution.targets.map((target) => target.id),
    notificationIds,
    created,
    retained,
    removed,
    unresolved: resolution.unresolved,
    ineligible: resolution.ineligible
  };
};

export const reconcilePostMentions = (
  tx: Prisma.TransactionClient,
  input: {
    postId: string;
    actorUserId: string;
    state: MentionState;
    surfaces: MentionSurfaceInput[];
  }
) => reconcileMentions(tx, {
  sourceType: MentionSourceType.POST,
  state: input.state,
  actorUserId: input.actorUserId,
  postId: input.postId,
  surfaces: input.surfaces,
  notify: true
});

export const reconcileCommentMentions = (
  tx: Prisma.TransactionClient,
  input: {
    postId: string;
    commentId: string;
    actorUserId: string;
    isReply: boolean;
    parentCommentId?: string;
    text: string;
  }
) => reconcileMentions(tx, {
  sourceType: input.isReply ? MentionSourceType.REPLY : MentionSourceType.COMMENT,
  state: MentionState.ACTIVE,
  actorUserId: input.actorUserId,
  postId: input.postId,
  commentId: input.commentId,
  parentCommentId: input.parentCommentId,
  surfaces: [{ surface: MentionSurface.COMMENT_TEXT, text: input.text }],
  notify: true
});

export const reconcileProfileMentions = (
  tx: Prisma.TransactionClient,
  input: { profileUserId: string; actorUserId: string; bio: string }
) => reconcileMentions(tx, {
  sourceType: MentionSourceType.PROFILE,
  state: MentionState.ACTIVE,
  actorUserId: input.actorUserId,
  profileUserId: input.profileUserId,
  surfaces: [{ surface: MentionSurface.PROFILE_BIO, text: input.bio }],
  notify: false
});

export const reconcileGroupMentions = (
  tx: Prisma.TransactionClient,
  input: { groupId: string; actorUserId: string; description: string; rules: string }
) => reconcileMentions(tx, {
  sourceType: MentionSourceType.GROUP,
  state: MentionState.ACTIVE,
  actorUserId: input.actorUserId,
  groupId: input.groupId,
  surfaces: [
    { surface: MentionSurface.GROUP_DESCRIPTION, text: input.description },
    { surface: MentionSurface.GROUP_RULES, text: input.rules }
  ],
  notify: false
});
