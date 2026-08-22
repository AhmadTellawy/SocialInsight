import { Request, Response } from 'express';
import prisma from '../prisma';
import {
  POST_MEDIA_INCLUDE,
  PUBLIC_AVATAR_MEDIA_SELECT,
  serializePostMediaRecord
} from '../services/mediaService';
import {
  ACTIVE_MENTION_REFERENCE_INCLUDE,
  serializeMentionReferences
} from '../services/mentionLifecycleService';
import {
  getVisiblePeopleTagsInclude,
  serializePeopleTags
} from '../services/peopleTagService';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import {
  TOPIC_TOP_CANDIDATE_LIMIT,
  TRENDING_HASHTAG_CANDIDATE_LIMIT,
  TRENDING_MAX_POSTS_PER_CREATOR,
  TRENDING_HASHTAG_WINDOW_DAYS,
  calculateTopicPostScore,
  calculateTrendingHashtagScore,
  registerTrendingCreatorContribution
} from '../services/hashtagService';
import { normalizeHashtag } from '../utils/textEntities';

const OPTION_POST_TYPES = ['Poll', 'Challenge', 'Prediction', 'Debate'];

const parseJsonArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const mapAnswerOptionIds = (answers: any[] = []): string[] =>
  answers.map((answer) => answer.optionId).filter((id): id is string => typeof id === 'string' && id.length > 0);

const buildUserProgress = (answers: any[] = []) => {
  const progressAnswers: Record<string, any> = {};
  const followUpAnswers: Record<string, string> = {};
  for (const answer of answers) {
    if (!answer?.questionId) continue;
    if (answer.optionId) {
      const existing = progressAnswers[answer.questionId];
      progressAnswers[answer.questionId] = Array.isArray(existing)
        ? [...existing, answer.optionId]
        : existing ? [existing, answer.optionId] : [answer.optionId];
      if (answer.textValue) followUpAnswers[answer.optionId] = answer.textValue;
    } else if (answer.textValue) {
      progressAnswers[answer.questionId] = answer.textValue;
    }
  }
  return { currentQuestionIndex: 0, answers: progressAnswers, followUpAnswers, historyStack: [] };
};

const buildTopicPostInclude = (viewerId?: string | null) => ({
  author: {
    select: {
      id: true,
      name: true,
      handle: true,
      avatar: true,
      ...PUBLIC_AVATAR_MEDIA_SELECT,
      verifiedBadge: true,
      isPrivate: true,
      following: viewerId ? {
        where: { followerId: viewerId, status: 'ACTIVE' },
        select: { followerId: true }
      } : false
    }
  },
  questions: { include: { options: { orderBy: { order: 'asc' as const } } } },
  sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' as const } } } } } },
  mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
  taggedUsers: getVisiblePeopleTagsInclude(viewerId),
  media: POST_MEDIA_INCLUDE,
  targetedGroups: true,
  responses: viewerId ? {
    where: { userId: viewerId },
    take: 1,
    include: { answers: true }
  } : false,
  likes: viewerId ? { where: { userId: viewerId }, take: 1 } : false,
  shares: viewerId ? { where: { authorId: viewerId }, take: 1 } : false,
  savedBy: viewerId ? { where: { userId: viewerId }, take: 1 } : false,
  sharedFrom: {
    include: {
      author: {
        select: {
          id: true,
          name: true,
          handle: true,
          avatar: true,
          ...PUBLIC_AVATAR_MEDIA_SELECT,
          verifiedBadge: true,
          isPrivate: true,
          following: viewerId ? {
            where: { followerId: viewerId, status: 'ACTIVE' },
            select: { followerId: true }
          } : false
        }
      },
      questions: { include: { options: { orderBy: { order: 'asc' as const } } } },
      sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' as const } } } } } },
      mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
      taggedUsers: getVisiblePeopleTagsInclude(viewerId),
      media: POST_MEDIA_INCLUDE,
      targetedGroups: true,
      responses: viewerId ? {
        where: { userId: viewerId },
        take: 1,
        include: { answers: true }
      } : false,
      likes: viewerId ? { where: { userId: viewerId }, take: 1 } : false,
      shares: viewerId ? { where: { authorId: viewerId }, take: 1 } : false,
      savedBy: viewerId ? { where: { userId: viewerId }, take: 1 } : false
    }
  }
});

const serializeTopicPost = (rawPost: any, viewerId?: string | null): any => {
  const post = serializePostMediaRecord(rawPost, viewerId);
  const serializeBase = (value: any) => {
    const response = value.responses?.[0];
    const answers = response?.answers || [];
    return {
      ...value,
      mentions: serializeMentionReferences(value.mentions),
      taggedUsers: serializePeopleTags(value.taggedUsers),
      options: OPTION_POST_TYPES.includes(value.type) && value.questions?.length > 0
        ? value.questions[0].options
        : [],
      demographics: parseJsonArray(value.demographics),
      targetGroups: Array.isArray(value.targetedGroups) ? value.targetedGroups.map((group: any) => group.id) : [],
      likes: value.likesCount || 0,
      repostCount: value.sharesCount || 0,
      participants: value.responseCount || 0,
      hasParticipated: Boolean(response),
      userSelectedOptions: mapAnswerOptionIds(answers),
      userProgress: buildUserProgress(answers),
      isLiked: viewerId ? Boolean(value.likes?.length) : false,
      hasReposted: viewerId ? Boolean(value.shares?.length) : false,
      isSaved: viewerId ? Boolean(value.savedBy?.length) : false,
      author: value.author ? {
        ...value.author,
        isFollowing: viewerId ? Boolean(value.author.following?.length) : false
      } : value.author
    };
  };
  const mapped = serializeBase(post);
  return {
    ...mapped,
    sharedFrom: post.sharedFrom ? serializeBase(post.sharedFrom) : undefined
  };
};

const cleanHashtagName = (value: string): string => normalizeHashtag(value.replace(/^#/, '').trim());

export const getHashtagPosts = async (req: Request, res: Response) => {
  const viewerId = req.user?.userId;
  const normalizedName = cleanHashtagName(String(req.params.name || ''));
  const sort = String(req.query.sort || 'top').toLowerCase() === 'recent' ? 'recent' : 'top';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '10'), 10) || 10, 1), 30);
  if (!normalizedName) return res.status(400).json({ error: 'Hashtag is required' });

  try {
    const hashtag = await prisma.hashtag.findUnique({
      where: { normalizedName },
      select: { id: true, normalizedName: true, displayName: true }
    });
    if (!hashtag) {
      return res.json({
        topic: { normalizedName, displayName: normalizedName, postCount: 0 },
        data: [],
        nextCursor: null,
        sort
      });
    }

    const visibleWhere = buildVisiblePublishedPostWhere(viewerId);
    const where = { ...visibleWhere, hashtags: { some: { hashtagId: hashtag.id } } };
    const postCount = await prisma.post.count({ where });
    let posts: any[];
    let nextCursor: string | null = null;

    if (sort === 'recent') {
      posts = await prisma.post.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: buildTopicPostInclude(viewerId)
      });
      if (posts.length > limit) {
        posts.pop();
        nextCursor = posts[posts.length - 1]?.id || null;
      }
    } else {
      const candidates = await prisma.post.findMany({
        where,
        take: TOPIC_TOP_CANDIDATE_LIMIT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: buildTopicPostInclude(viewerId)
      });
      const rankingNow = Date.now();
      candidates.sort((left, right) => {
        const scoreDifference = calculateTopicPostScore(right, rankingNow) - calculateTopicPostScore(left, rankingNow);
        return scoreDifference || right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id);
      });
      const cursorIndex = cursor ? candidates.findIndex((post) => post.id === cursor) : -1;
      const startIndex = cursor ? (cursorIndex >= 0 ? cursorIndex + 1 : candidates.length) : 0;
      posts = candidates.slice(startIndex, startIndex + limit + 1);
      if (posts.length > limit) {
        posts.pop();
        nextCursor = posts[posts.length - 1]?.id || null;
      }
    }

    res.json({
      topic: { ...hashtag, postCount },
      data: posts.map((post) => serializeTopicPost(post, viewerId)),
      nextCursor,
      sort
    });
  } catch (error) {
    console.error('Get Hashtag Posts Error:', error);
    res.status(500).json({ error: 'Failed to fetch hashtag topic' });
  }
};

type TrendingTopic = {
  id: string;
  normalizedName: string;
  displayName: string;
  postCount: number;
  creators: Set<string>;
  creatorPostCounts: Map<string, number>;
  recencyWeightTotal: number;
  engagementTotal: number;
};

export const getTrendingHashtags = async (req: Request, res: Response) => {
  const viewerId = req.user?.userId;
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '10'), 10) || 10, 1), 30);
  const now = Date.now();
  const since = new Date(now - TRENDING_HASHTAG_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const relationships = await prisma.postHashtag.findMany({
      where: {
        post: {
          ...buildVisiblePublishedPostWhere(viewerId),
          createdAt: { gte: since }
        }
      },
      take: TRENDING_HASHTAG_CANDIDATE_LIMIT,
      orderBy: { post: { createdAt: 'desc' } },
      select: {
        hashtag: { select: { id: true, normalizedName: true, displayName: true } },
        post: {
          select: {
            authorId: true,
            createdAt: true,
            responseCount: true,
            commentsCount: true,
            likesCount: true,
            sharesCount: true
          }
        }
      }
    });

    const topics = new Map<string, TrendingTopic>();
    for (const relationship of relationships) {
      const { hashtag, post } = relationship;
      const topic = topics.get(hashtag.id) || {
        ...hashtag,
        postCount: 0,
        creators: new Set<string>(),
        creatorPostCounts: new Map<string, number>(),
        recencyWeightTotal: 0,
        engagementTotal: 0
      };
      const ageHours = Math.max(0, (now - post.createdAt.getTime()) / 3_600_000);
      topic.postCount += 1;
      topic.creators.add(post.authorId);
      if (!registerTrendingCreatorContribution(topic.creatorPostCounts, post.authorId)) {
        topics.set(hashtag.id, topic);
        continue;
      }
      topic.recencyWeightTotal += 1 / (1 + ageHours / 24);
      topic.engagementTotal += post.responseCount * 3
        + post.commentsCount * 2
        + post.likesCount
        + post.sharesCount * 4;
      topics.set(hashtag.id, topic);
    }

    const ranked = Array.from(topics.values())
      .map((topic) => ({
        id: topic.id,
        normalizedName: topic.normalizedName,
        displayName: topic.displayName,
        postCount: topic.postCount,
        uniqueCreatorCount: topic.creators.size,
        score: calculateTrendingHashtagScore({
          recencyWeightTotal: topic.recencyWeightTotal,
          uniqueCreatorCount: topic.creators.size,
          engagementTotal: topic.engagementTotal
        })
      }))
      .sort((left, right) => right.score - left.score || right.uniqueCreatorCount - left.uniqueCreatorCount || right.postCount - left.postCount || left.normalizedName.localeCompare(right.normalizedName))
      .slice(0, limit);

    res.json({
      windowDays: TRENDING_HASHTAG_WINDOW_DAYS,
      maxScoredPostsPerCreator: TRENDING_MAX_POSTS_PER_CREATOR,
      topics: ranked
    });
  } catch (error) {
    console.error('Get Trending Hashtags Error:', error);
    res.status(500).json({ error: 'Failed to fetch trending hashtags' });
  }
};
