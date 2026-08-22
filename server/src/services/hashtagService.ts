import { Prisma } from '@prisma/client';
import {
  COMMENT_HASHTAG_LIMIT,
  POST_HASHTAG_LIMIT,
  UniqueHashtag,
  getUniqueHashtags
} from '../utils/textEntities';

export const TRENDING_HASHTAG_WINDOW_DAYS = 7;
export const TRENDING_HASHTAG_CANDIDATE_LIMIT = 2000;
export const TRENDING_MAX_POSTS_PER_CREATOR = 3;
export const TOPIC_TOP_CANDIDATE_LIMIT = 500;

export const registerTrendingCreatorContribution = (
  creatorCounts: Map<string, number>,
  creatorId: string
): boolean => {
  const currentCount = creatorCounts.get(creatorId) || 0;
  if (currentCount >= TRENDING_MAX_POSTS_PER_CREATOR) return false;
  creatorCounts.set(creatorId, currentCount + 1);
  return true;
};

export class HashtagLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly count: number
  ) {
    super(`Content can contain up to ${limit} unique hashtags.`);
    this.name = 'HashtagLimitError';
  }
}

const collectHashtags = (texts: string[], limit: number): UniqueHashtag[] => {
  const unique = new Map<string, UniqueHashtag>();
  for (const text of texts) {
    for (const hashtag of getUniqueHashtags(text || '')) {
      if (!unique.has(hashtag.normalizedName)) unique.set(hashtag.normalizedName, hashtag);
    }
  }
  if (unique.size > limit) throw new HashtagLimitError(limit, unique.size);
  return Array.from(unique.values());
};

const ensureHashtags = async (
  tx: Prisma.TransactionClient,
  hashtags: UniqueHashtag[]
) => {
  if (hashtags.length === 0) return [];
  await tx.hashtag.createMany({
    data: hashtags.map((hashtag) => ({
      normalizedName: hashtag.normalizedName,
      displayName: hashtag.displayName
    })),
    skipDuplicates: true
  });
  return tx.hashtag.findMany({
    where: { normalizedName: { in: hashtags.map((hashtag) => hashtag.normalizedName) } },
    select: { id: true, normalizedName: true }
  });
};

export const reconcilePostHashtags = async (
  tx: Prisma.TransactionClient,
  postId: string,
  texts: string[]
): Promise<number> => {
  const desired = collectHashtags(texts, POST_HASHTAG_LIMIT);
  const records = await ensureHashtags(tx, desired);
  const hashtagIds = records.map((record) => record.id);

  await tx.postHashtag.deleteMany({
    where: {
      postId,
      ...(hashtagIds.length > 0 ? { hashtagId: { notIn: hashtagIds } } : {})
    }
  });
  if (hashtagIds.length > 0) {
    await tx.postHashtag.createMany({
      data: hashtagIds.map((hashtagId) => ({ postId, hashtagId })),
      skipDuplicates: true
    });
  }
  return hashtagIds.length;
};

export const reconcileCommentHashtags = async (
  tx: Prisma.TransactionClient,
  commentId: string,
  text: string
): Promise<number> => {
  const desired = collectHashtags([text], COMMENT_HASHTAG_LIMIT);
  const records = await ensureHashtags(tx, desired);
  const hashtagIds = records.map((record) => record.id);

  await tx.commentHashtag.deleteMany({
    where: {
      commentId,
      ...(hashtagIds.length > 0 ? { hashtagId: { notIn: hashtagIds } } : {})
    }
  });
  if (hashtagIds.length > 0) {
    await tx.commentHashtag.createMany({
      data: hashtagIds.map((hashtagId) => ({ commentId, hashtagId })),
      skipDuplicates: true
    });
  }
  return hashtagIds.length;
};

export const calculateTopicPostScore = (post: {
  createdAt: Date;
  responseCount: number;
  commentsCount: number;
  likesCount: number;
  sharesCount: number;
}, now = Date.now()): number => {
  const ageHours = Math.max(0, (now - post.createdAt.getTime()) / 3_600_000);
  const recency = 1 / Math.pow(ageHours + 2, 0.8);
  const engagement = post.responseCount * 3
    + post.commentsCount * 2
    + post.likesCount
    + post.sharesCount * 4;
  return recency * (1 + Math.log1p(engagement));
};

export const calculateTrendingHashtagScore = (input: {
  recencyWeightTotal: number;
  uniqueCreatorCount: number;
  engagementTotal: number;
}): number => {
  const diversityFactor = 1 + Math.min(Math.max(input.uniqueCreatorCount - 1, 0), 5) * 0.12;
  const engagementFactor = 1 + Math.min(Math.log1p(Math.max(input.engagementTotal, 0)) * 0.03, 0.3);
  return input.recencyWeightTotal * diversityFactor * engagementFactor;
};
