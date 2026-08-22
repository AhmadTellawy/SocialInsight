import 'dotenv/config';
import {
  MentionSourceType,
  MentionState,
  MentionSurface,
  Prisma
} from '@prisma/client';
import prisma from '../prisma';
import {
  HashtagLimitError,
  reconcileCommentHashtags,
  reconcilePostHashtags
} from '../services/hashtagService';
import {
  COMMENT_HASHTAG_LIMIT,
  MENTION_RECIPIENT_LIMIT,
  POST_HASHTAG_LIMIT,
  getUniqueHashtags,
  parseTextEntities
} from '../utils/textEntities';
import { parseNotificationPayload } from '../utils/notificationTarget';

type Mode = 'all' | 'mentions' | 'hashtags';
type SourceKind = 'post' | 'comment';
type SurfaceText = { surface: MentionSurface; text: string };
type ExistingMention = { targetUserId: string };
type ExistingHashtag = { hashtag: { normalizedName: string } };

type HistoricalSource = {
  kind: SourceKind;
  id: string;
  postId: string;
  actorUserId: string;
  createdAt: Date;
  sourceType: MentionSourceType;
  surfaces: SurfaceText[];
  existingMentions: ExistingMention[];
  existingHashtags: ExistingHashtag[];
};

type EvidenceUser = {
  id: string;
  handle: string;
  createdAt: Date;
  status: string;
};

type EvidenceNotification = {
  id: string;
  userId: string;
  actorId: string | null;
  targetId: string | null;
  payload: string | null;
  createdAt: Date;
  mention: { id: string } | null;
};

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const value = (name: string): string | undefined =>
  argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const boundedInteger = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const apply = flag('apply');
const requestedMode = (value('mode') || 'all').toLowerCase();
if (!['all', 'mentions', 'hashtags'].includes(requestedMode)) {
  throw new Error('--mode must be all, mentions, or hashtags.');
}
const mode = requestedMode as Mode;
const batchSize = boundedInteger(value('batch-size'), 100, 1, 500);
const sourceLimit = boundedInteger(value('limit'), Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
const postAfter = value('post-after');
const commentAfter = value('comment-after');

const mentionSummary = {
  scannedSources: 0,
  migrated: 0,
  safeCandidates: 0,
  ambiguous: 0,
  unresolved: 0,
  skipped: 0,
  failed: 0,
  postResumeCursor: postAfter || null as string | null,
  commentResumeCursor: commentAfter || null as string | null
};

const hashtagSummary = {
  scannedSources: 0,
  created: 0,
  wouldCreate: 0,
  retained: 0,
  removed: 0,
  failed: 0,
  postResumeCursor: postAfter || null as string | null,
  commentResumeCursor: commentAfter || null as string | null
};

const postSurfaces = (post: {
  title: string;
  description: string;
  sharedFromId: string | null;
  sharedCaption: string | null;
}): SurfaceText[] => post.sharedFromId
  ? [{ surface: MentionSurface.REPOST_CAPTION, text: post.sharedCaption || '' }]
  : [
      { surface: MentionSurface.POST_TITLE, text: post.title || '' },
      { surface: MentionSurface.POST_DESCRIPTION, text: post.description || '' }
    ];

const sourceHashtagTexts = (source: HistoricalSource): string[] =>
  source.surfaces.map(({ text }) => text);

const sourceMentionOccurrences = (source: HistoricalSource) => {
  const byHandle = new Map<string, Array<{
    surface: MentionSurface;
    startOffset: number;
    endOffset: number;
    rawText: string;
  }>>();

  for (const { surface, text } of source.surfaces) {
    for (const entity of parseTextEntities(text || '')) {
      if (entity.type !== 'mention') continue;
      const occurrences = byHandle.get(entity.normalizedValue) || [];
      occurrences.push({
        surface,
        startOffset: entity.start,
        endOffset: entity.end,
        rawText: entity.raw
      });
      byHandle.set(entity.normalizedValue, occurrences);
    }
  }
  return byHandle;
};

const notificationMatchesSource = (
  notification: EvidenceNotification,
  source: HistoricalSource
): boolean => {
  if (notification.actorId !== source.actorUserId || notification.targetId !== source.postId) return false;
  if (notification.createdAt.getTime() + 60_000 < source.createdAt.getTime()) return false;

  const payload = parseNotificationPayload(notification.payload);
  if (payload.postId !== source.postId) return false;
  if (source.kind === 'post') {
    return payload.sourceType === 'post' && !payload.commentId && !payload.replyId;
  }
  if (source.sourceType === MentionSourceType.REPLY) {
    return payload.sourceType === 'reply' && payload.replyId === source.id;
  }
  return payload.sourceType === 'comment' && payload.commentId === source.id && !payload.replyId;
};

const loadEvidence = async (sources: HistoricalSource[]) => {
  const handles = Array.from(new Set(sources.flatMap((source) =>
    Array.from(sourceMentionOccurrences(source).keys())
  )));
  const postIds = Array.from(new Set(sources.map(({ postId }) => postId)));
  const actorIds = Array.from(new Set(sources.map(({ actorUserId }) => actorUserId)));

  const [users, notifications] = await Promise.all([
    handles.length > 0
      ? prisma.user.findMany({
          where: { OR: handles.map((handle) => ({ handle: { equals: handle, mode: 'insensitive' } })) },
          select: { id: true, handle: true, createdAt: true, status: true }
        })
      : Promise.resolve([] as EvidenceUser[]),
    postIds.length > 0
      ? prisma.notification.findMany({
          where: {
            type: 'mention',
            targetType: 'post',
            targetId: { in: postIds },
            actorId: { in: actorIds }
          },
          select: {
            id: true,
            userId: true,
            actorId: true,
            targetId: true,
            payload: true,
            createdAt: true,
            mention: { select: { id: true } }
          }
        })
      : Promise.resolve([] as EvidenceNotification[])
  ]);

  const usersByHandle = new Map<string, EvidenceUser[]>();
  for (const user of users) {
    const normalized = user.handle.toLowerCase();
    usersByHandle.set(normalized, [...(usersByHandle.get(normalized) || []), user]);
  }
  return { usersByHandle, notifications };
};

const migrateMentions = async (
  source: HistoricalSource,
  usersByHandle: Map<string, EvidenceUser[]>,
  notifications: EvidenceNotification[]
): Promise<void> => {
  mentionSummary.scannedSources += 1;
  const occurrencesByHandle = sourceMentionOccurrences(source);
  if (occurrencesByHandle.size === 0) return;
  if (occurrencesByHandle.size > MENTION_RECIPIENT_LIMIT) {
    mentionSummary.skipped += occurrencesByHandle.size;
    return;
  }

  const existingTargetIds = new Set(source.existingMentions.map(({ targetUserId }) => targetUserId));
  for (const [handle, occurrences] of occurrencesByHandle) {
    const matchingUsers = usersByHandle.get(handle) || [];
    if (matchingUsers.length === 0) {
      mentionSummary.unresolved += 1;
      continue;
    }
    if (matchingUsers.length !== 1) {
      mentionSummary.ambiguous += 1;
      continue;
    }

    const target = matchingUsers[0];
    if (target.status !== 'ACTIVE' || target.id === source.actorUserId) {
      mentionSummary.skipped += 1;
      continue;
    }
    if (target.createdAt.getTime() > source.createdAt.getTime() + 60_000) {
      mentionSummary.ambiguous += 1;
      continue;
    }
    if (existingTargetIds.has(target.id)) {
      mentionSummary.skipped += 1;
      continue;
    }

    const evidence = notifications
      .filter((notification) =>
        notification.userId === target.id
        && !notification.mention
        && notificationMatchesSource(notification, source)
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!evidence) {
      mentionSummary.ambiguous += 1;
      continue;
    }

    if (!apply) {
      mentionSummary.safeCandidates += 1;
      continue;
    }

    try {
      await prisma.mention.create({
        data: {
          targetUserId: target.id,
          actorUserId: source.actorUserId,
          postId: source.postId,
          ...(source.kind === 'comment' ? { commentId: source.id } : {}),
          sourceType: source.sourceType,
          state: MentionState.ACTIVE,
          notificationId: evidence.id,
          occurrences: { create: occurrences }
        }
      });
      existingTargetIds.add(target.id);
      evidence.mention = { id: 'backfilled' };
      mentionSummary.migrated += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        mentionSummary.skipped += 1;
      } else {
        mentionSummary.failed += 1;
        console.error(JSON.stringify({
          event: 'social_tag_backfill_mention_failed',
          sourceKind: source.kind,
          sourceId: source.id,
          code: error instanceof Error ? error.name : 'UNKNOWN'
        }));
      }
    }
  }
};

const migrateHashtags = async (source: HistoricalSource): Promise<void> => {
  hashtagSummary.scannedSources += 1;
  const texts = sourceHashtagTexts(source);
  const hashtags = new Map<string, { normalizedName: string; displayName: string }>();
  for (const text of texts) {
    for (const hashtag of getUniqueHashtags(text || '')) {
      if (!hashtags.has(hashtag.normalizedName)) hashtags.set(hashtag.normalizedName, hashtag);
    }
  }

  const limit = source.kind === 'post' ? POST_HASHTAG_LIMIT : COMMENT_HASHTAG_LIMIT;
  if (hashtags.size > limit) {
    hashtagSummary.failed += 1;
    return;
  }

  const desiredNames = new Set(hashtags.keys());
  const existingNames = new Set(source.existingHashtags.map(({ hashtag }) => hashtag.normalizedName));
  const wouldCreate = Array.from(desiredNames).filter((name) => !existingNames.has(name)).length;
  const wouldRemove = Array.from(existingNames).filter((name) => !desiredNames.has(name)).length;
  hashtagSummary.retained += Array.from(desiredNames).filter((name) => existingNames.has(name)).length;

  if (!apply) {
    hashtagSummary.wouldCreate += wouldCreate;
    hashtagSummary.removed += wouldRemove;
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (source.kind === 'post') {
        await reconcilePostHashtags(tx, source.id, texts);
      } else {
        await reconcileCommentHashtags(tx, source.id, texts[0] || '');
      }
    });
    hashtagSummary.created += wouldCreate;
    hashtagSummary.removed += wouldRemove;
  } catch (error) {
    hashtagSummary.failed += 1;
    console.error(JSON.stringify({
      event: 'social_tag_backfill_hashtag_failed',
      sourceKind: source.kind,
      sourceId: source.id,
      code: error instanceof HashtagLimitError ? 'HASHTAG_LIMIT_EXCEEDED' : error instanceof Error ? error.name : 'UNKNOWN'
    }));
  }
};

const processBatch = async (sources: HistoricalSource[]): Promise<void> => {
  const evidence = mode !== 'hashtags'
    ? await loadEvidence(sources)
    : { usersByHandle: new Map<string, EvidenceUser[]>(), notifications: [] as EvidenceNotification[] };

  for (const source of sources) {
    if (mode !== 'hashtags') {
      await migrateMentions(source, evidence.usersByHandle, evidence.notifications);
    }
    if (mode !== 'mentions') await migrateHashtags(source);
  }
};

const runPosts = async (): Promise<void> => {
  let cursor = postAfter;
  let remaining = sourceLimit;
  while (remaining > 0) {
    const take = Math.min(batchSize, remaining);
    const rows = await prisma.post.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        isDeleted: false,
        status: 'PUBLISHED'
      },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        title: true,
        description: true,
        sharedFromId: true,
        sharedCaption: true,
        authorId: true,
        createdAt: true,
        mentions: { select: { targetUserId: true } },
        hashtags: { select: { hashtag: { select: { normalizedName: true } } } }
      }
    });
    if (rows.length === 0) break;
    const sources: HistoricalSource[] = rows.map((post) => ({
      kind: 'post',
      id: post.id,
      postId: post.id,
      actorUserId: post.authorId,
      createdAt: post.createdAt,
      sourceType: MentionSourceType.POST,
      surfaces: postSurfaces(post),
      existingMentions: post.mentions,
      existingHashtags: post.hashtags
    }));
    await processBatch(sources);
    cursor = rows[rows.length - 1].id;
    mentionSummary.postResumeCursor = cursor;
    hashtagSummary.postResumeCursor = cursor;
    remaining -= rows.length;
    if (rows.length < take) break;
  }
};

const runComments = async (): Promise<void> => {
  let cursor = commentAfter;
  let remaining = sourceLimit;
  while (remaining > 0) {
    const take = Math.min(batchSize, remaining);
    const rows = await prisma.comment.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        isDeleted: false,
        post: { isDeleted: false, status: 'PUBLISHED' }
      },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        text: true,
        userId: true,
        postId: true,
        parentId: true,
        createdAt: true,
        mentions: { select: { targetUserId: true } },
        hashtags: { select: { hashtag: { select: { normalizedName: true } } } }
      }
    });
    if (rows.length === 0) break;
    const sources: HistoricalSource[] = rows.map((comment) => ({
      kind: 'comment',
      id: comment.id,
      postId: comment.postId,
      actorUserId: comment.userId,
      createdAt: comment.createdAt,
      sourceType: comment.parentId ? MentionSourceType.REPLY : MentionSourceType.COMMENT,
      surfaces: [{ surface: MentionSurface.COMMENT_TEXT, text: comment.text || '' }],
      existingMentions: comment.mentions,
      existingHashtags: comment.hashtags
    }));
    await processBatch(sources);
    cursor = rows[rows.length - 1].id;
    mentionSummary.commentResumeCursor = cursor;
    hashtagSummary.commentResumeCursor = cursor;
    remaining -= rows.length;
    if (rows.length < take) break;
  }
};

const main = async (): Promise<void> => {
  console.log(JSON.stringify({
    event: 'social_tag_backfill_started',
    mode,
    writeMode: apply ? 'APPLY' : 'DRY_RUN',
    batchSize,
    sourceLimit,
    mentionIdentityPolicy: 'legacy_notification_evidence_required',
    metadataMentionPolicy: 'profile_and_group_metadata_left_unlinked_without_historical_identity_evidence'
  }));
  await runPosts();
  await runComments();
  console.log(JSON.stringify({
    event: 'social_tag_backfill_summary',
    mode,
    writeMode: apply ? 'APPLY' : 'DRY_RUN',
    mentions: mentionSummary,
    hashtags: hashtagSummary
  }));
};

main()
  .catch((error) => {
    console.error(JSON.stringify({
      event: 'social_tag_backfill_fatal',
      code: error instanceof Error ? error.name : 'UNKNOWN'
    }));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
