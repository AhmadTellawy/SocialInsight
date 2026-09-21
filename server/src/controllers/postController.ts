import { activePageActor, lockPage, pageAudit, pageIsBlocked, requirePageCapability } from '../pages/pageService';
import { pagePostReplay, pagePostRequestKey, recordPagePostCreation } from '../pages/pagePostReplay';
import { assertPagesEnabled, pageDiscoveryPostWhere } from '../pages/pageFeature';
import { notifyPagePostInteraction } from '../pages/pageNotificationService';
import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { MentionState, MentionSurface, PeopleTagStatus, Prisma } from '@prisma/client';
import prisma from '../prisma';
import { dispatchNotificationIds, notify } from '../services/notificationService';
import { processBase64Image } from '../utils/imageProcessor';
import { PrivacyService } from '../services/privacyService';
import { isProfileAndGroups, validateProfileAndGroupsInput, canInteractWithProfileAndGroups } from '../services/postAudienceService';
import { GroupPermissionService } from '../services/groupPermissionService';
import { POST_STATUS, MEMBERSHIP_STATUS, GROUP_ROLES } from '../utils/constants';
import {
    commitPreparedMedia,
    commitMediaScopeChange,
    finalizeMediaScopeChange,
    getStoredMediaPresentation,
    prepareMediaAttachments,
    prepareMediaScopeChange,
    resolvePostMediaScope,
    rollbackMediaScopeChange,
    rollbackPreparedMedia,
    scheduleMediaDeletion,
    serializeUserMediaRecord,
    PUBLIC_AVATAR_MEDIA_SELECT,
    POST_MEDIA_INCLUDE,
    serializePostMediaRecord,
    validatePostMediaSet,
    importPageInlineMedia
} from '../services/mediaService';
import { MediaValidationError } from '../services/mediaProcessor';
import { MediaAttachmentRequirement } from '../services/mediaService';
import { validatePublishedAnswerTypes } from '../utils/answerTypeValidation';
import { getMentionLimitViolation } from '../utils/mentionLimits';
import { parseTextEntities } from '../utils/textEntities';
import { parseNotificationPayload } from '../utils/notificationTarget';
import {
    ACTIVE_MENTION_REFERENCE_INCLUDE,
    MentionLimitError,
    reconcileCommentMentions,
    reconcilePostMentions,
    serializeMentionReferences
} from '../services/mentionLifecycleService';
import {
    HashtagLimitError,
    reconcileCommentHashtags,
    reconcilePostHashtags
} from '../services/hashtagService';
import {
    PeopleTagValidationError,
    getCurrentPeopleTagUserIds,
    getVisiblePeopleTagsInclude,
    reconcilePeopleTags,
    serializePeopleTags
} from '../services/peopleTagService';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { loadVisiblePostScalars } from '../services/postVisibilitySql';
import { attachPageCommentPublishers, attachPagePublishers, authorizePagePublisher, guardPagePostInteractions, guardPagePostPersistence, hasPostPageCapability, isPageFollower, respondPagePostError } from '../pages/pagePostService';
import { assertPageDestination, PagePolicyError } from '../pages/pagePolicy';
import {
    PostOptionValidationError,
    buildPostReportDedupeKey,
    normalizePostReportInput
} from '../services/postOptionService';
import { calculateAgeGroupFromDate } from '../utils/profileValidation';
import {
    attachFeedContentRelations,
    attachFeedViewerState,
    buildFeedCursorWhere,
    buildFeedPostScalarSelect,
    decodeFeedCursor,
    encodeFeedCursor,
    isOpaqueFeedCursor,
    loadFeedRelationBundle,
    parseFeedLimit
} from '../services/postFeedService';

const logPostRequestFailure = (req: Request, event: string, error: unknown): void => {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || 'UNKNOWN')
        : 'UNKNOWN';
    const requestId = (req as Request & { requestId?: string }).requestId;
    console.error(JSON.stringify({ event, requestId, errorCode }));
};

export const SAFE_USER_SELECT = {
    id: true,
    name: true,
    handle: true,
    avatar: true,
    ...PUBLIC_AVATAR_MEDIA_SELECT,
    verifiedBadge: true,
    isPrivate: true
};

const parseBoolean = (value: any): boolean => {
    if (value === true || value === 1 || value === '1' || (typeof value === 'string' && value.toLowerCase() === 'true')) return true;
    if (value === false || value === 0 || value === '0' || (typeof value === 'string' && value.toLowerCase() === 'false')) return false;
    return false;
};

const getTrendingDemographics = async () => {
    return [
        { filter: 'age', segments: ['18-24', '25-34', '35-44'] },
        { filter: 'device', segments: ['iOS', 'Android'] },
        { filter: 'location', segments: ['US', 'UK', 'Remote'] }
    ];
};

export const parseJsonArray = (jsonString: string | null | undefined): string[] => {
    if (!jsonString) return [];
    if (Array.isArray(jsonString)) return jsonString; // Added this line to handle already parsed arrays
    try {
        return JSON.parse(jsonString as string);
    } catch {
        return [];
    }
};

export const normalizePostType = (type?: string): string | undefined => {
    if (!type) return undefined;
    if (type.toLowerCase() === 'poll') return 'Poll';
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
};

const OPTION_POST_TYPES = ['Poll', 'Challenge', 'Prediction', 'Debate'];
const SECTION_POST_TYPES = ['Quiz', 'Survey'];
const EDIT_WINDOW_MS = 5 * 60 * 1000;

const getPostMentionSurfaces = (post: {
    title: string;
    description: string;
    sharedFromId?: string | null;
    sharedCaption?: string | null;
}) => post.sharedFromId
    ? [{ surface: MentionSurface.REPOST_CAPTION, text: post.sharedCaption || '' }]
    : [
        { surface: MentionSurface.POST_TITLE, text: post.title || '' },
        { surface: MentionSurface.POST_DESCRIPTION, text: post.description || '' }
    ];

const getPostHashtagTexts = (post: {
    title: string;
    description: string;
    sharedFromId?: string | null;
    sharedCaption?: string | null;
}) => post.sharedFromId
    ? [post.sharedCaption || '']
    : [post.title || '', post.description || ''];

const serializePostSocialRecord = (post: any, viewerId?: string | null): any => {
    const serialized = serializePostMediaRecord(post, viewerId);
    return {
        ...serialized,
        mentions: serializeMentionReferences(post?.mentions),
        taggedUsers: serializePeopleTags(post?.taggedUsers),
        sharedFrom: serialized?.sharedFrom && post?.sharedFrom
            ? {
                ...serialized.sharedFrom,
                mentions: serializeMentionReferences(post.sharedFrom.mentions),
                taggedUsers: serializePeopleTags(post.sharedFrom.taggedUsers)
            }
            : serialized?.sharedFrom
    };
};

const firstQueryString = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
};

const parseReadLimit = (value: unknown, fallback = 30, maximum = 100): number => {
    const parsed = Number.parseInt(firstQueryString(value) || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const applyNextCursorHeader = (res: Response, items: Array<{ id: string }>, hasMore: boolean) => {
    if (hasMore && items.length > 0) {
        res.setHeader('X-Next-Cursor', items[items.length - 1].id);
    }
};

const validateMentionRecipientLimit = (text: string, res: Response, surface: 'post' | 'comment'): boolean => {
    const violation = getMentionLimitViolation(text);
    if (!violation) return true;

    console.warn(JSON.stringify({
        event: 'mention_limit_exceeded',
        surface,
        recipientCount: violation.recipientCount,
        limit: violation.limit
    }));
    const { recipientCount: _recipientCount, ...response } = violation;
    res.status(400).json(response);
    return false;
};

const getPostMediaAssetIds = (data: any): string[] => {
    if (!Array.isArray(data?.mediaAssetIds)) return [];
    return data.mediaAssetIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
};

/** Page media always uses revocable assets, including the existing inline editor transport. */
const importPagePostImages = async (data: any, actorId: string, existing?: any) => {
    const inlineCover = data.coverImage || data.image;
    if (!inlineCover && !Array.isArray(data.mediaAssetIds) && (Object.prototype.hasOwnProperty.call(data, 'coverImage') || Object.prototype.hasOwnProperty.call(data, 'image'))) data.mediaAssetIds = [];
    if (inlineCover && getPostMediaAssetIds(data).length === 0) {
        if (inlineCover === existing?.image && existing?.media?.length) data.mediaAssetIds = existing.media.map((item: any) => item.mediaAssetId);
        else data.mediaAssetIds = [await importPageInlineMedia(actorId, 'POST', inlineCover)];
    }
    delete data.coverImage;
    delete data.image;
    const existingQuestions = [...(existing?.questions || []), ...(existing?.sections || []).flatMap((section: any) => section.questions || [])];
    const priorQuestions = new Map(existingQuestions.map((question: any) => [question.id, question]));
    const priorOptions = new Map(existingQuestions.flatMap((question: any) => question.options || []).map((option: any) => [option.id, option]));
    const convert = async (item: any, purpose: 'OPTION_IMAGE' | 'QUESTION_IMAGE', previous: any) => {
        if (item.image && !item.imageMediaId) {
            item.imageMediaId = item.image === previous?.image && previous?.imageMediaId
                ? previous.imageMediaId : await importPageInlineMedia(actorId, purpose, item.image);
        }
        delete item.image;
    };
    for (const option of Array.isArray(data.options) ? data.options : []) await convert(option, 'OPTION_IMAGE', priorOptions.get(option.id));
    for (const section of Array.isArray(data.sections) ? data.sections : []) {
        for (const question of Array.isArray(section.questions) ? section.questions : []) {
            await convert(question, 'QUESTION_IMAGE', priorQuestions.get(question.id));
            for (const option of Array.isArray(question.options) ? question.options : []) await convert(option, 'OPTION_IMAGE', priorOptions.get(option.id));
        }
    }
};

const normalizeOptionPresentation = (value: unknown): 'text' | 'image' | undefined =>
    value === 'text' || value === 'image' ? value : undefined;

const getMediaAttachmentRequirements = (data: any): MediaAttachmentRequirement[] => {
    const requirements: MediaAttachmentRequirement[] = getPostMediaAssetIds(data).map((id) => ({ id, purpose: 'POST' }));
    for (const option of Array.isArray(data?.options) ? data.options : []) {
        if (typeof option?.imageMediaId === 'string') requirements.push({ id: option.imageMediaId, purpose: 'OPTION_IMAGE' });
    }
    for (const section of Array.isArray(data?.sections) ? data.sections : []) {
        for (const question of Array.isArray(section?.questions) ? section.questions : []) {
            if (typeof question?.imageMediaId === 'string') requirements.push({ id: question.imageMediaId, purpose: 'QUESTION_IMAGE' });
            for (const option of Array.isArray(question?.options) ? question.options : []) {
                if (typeof option?.imageMediaId === 'string') requirements.push({ id: option.imageMediaId, purpose: 'OPTION_IMAGE' });
            }
        }
    }
    return requirements;
};

const mapTargetGroups = (post: any): string[] => {
    return Array.isArray(post?.targetedGroups) ? post.targetedGroups.map((g: any) => g.id) : [];
};

const mapVisibleFeedGroupId = (post: any, viewerId?: string): string | null => {
    const groupId = typeof post?.groupId === 'string' ? post.groupId : null;
    if (!groupId || post?.authorId === viewerId) return groupId;
    const visibleTargetGroupIds = mapTargetGroups(post);
    if (isProfileAndGroups(post?.targetAudience)) return visibleTargetGroupIds.includes(groupId) ? groupId : null;
    return visibleTargetGroupIds.length === 0 || visibleTargetGroupIds.includes(groupId)
        ? groupId
        : null;
};

const normalizeDemographicFilters = (value: any): string | undefined => {
    if (!value) return undefined;
    const aliases: Record<string, string> = {
        ageGroup: 'age_group',
        maritalStatus: 'marital_status',
        familyRole: 'family_role'
    };
    const filters = Array.isArray(value) ? value : parseJsonArray(value);
    const normalized = Array.from(new Set(filters.map((filter: any) => aliases[String(filter)] || String(filter)).filter(Boolean)));
    return normalized.length > 0 ? JSON.stringify(normalized) : undefined;
};

export const mapAnswerOptionIds = (answers: any[] = []): string[] => {
    return answers.map((answer: any) => answer.optionId).filter((optionId: any): optionId is string => typeof optionId === 'string' && optionId.length > 0);
};

export const buildUserProgress = (answers: any[] = []) => {
    const progressAnswers: Record<string, any> = {};
    const followUpAnswers: Record<string, string> = {};

    for (const answer of answers) {
        if (!answer?.questionId) continue;

        if (answer.optionId) {
            const existing = progressAnswers[answer.questionId];
            progressAnswers[answer.questionId] = Array.isArray(existing)
                ? [...existing, answer.optionId]
                : existing
                    ? [existing, answer.optionId]
                    : [answer.optionId];

            if (answer.textValue) {
                followUpAnswers[answer.optionId] = answer.textValue;
            }
        } else if (answer.textValue) {
            progressAnswers[answer.questionId] = answer.textValue;
        }
    }

    return {
        currentQuestionIndex: 0,
        answers: progressAnswers,
        followUpAnswers,
        historyStack: []
    };
};

export const mapPostForClient = (rawPost: any, userId?: string, guestId?: string) => {
    const post = serializePostSocialRecord(rawPost, userId);
    const actualResponse = post.sharedFrom ? post.sharedFrom.responses?.[0] : post.responses?.[0];
    const userAnswers = actualResponse?.answers || [];

    let mappedSharedFrom: any = undefined;
    if (post.sharedFrom) {
        mappedSharedFrom = {
            ...post.sharedFrom,
            options: OPTION_POST_TYPES.includes(normalizePostType(post.sharedFrom.type) || '') && post.sharedFrom.questions?.length > 0
                ? post.sharedFrom.questions[0].options
                : [],
            demographics: parseJsonArray(post.sharedFrom.demographics),
            author: post.sharedFrom.author ? {
                ...post.sharedFrom.author,
                isFollowing: userId ? Boolean(post.sharedFrom.author.following?.length) : false
            } : undefined,
            likes: post.sharedFrom.likesCount,
            repostCount: post.sharedFrom.sharesCount || 0,
            participants: post.sharedFrom.responseCount,
            groupId: mapVisibleFeedGroupId(post.sharedFrom, userId),
            targetGroups: mapTargetGroups(post.sharedFrom),
            hasParticipated: Boolean((userId || guestId) && post.sharedFrom.responses?.length),
            userSelectedOptions: post.sharedFrom.responses?.length
                ? mapAnswerOptionIds(post.sharedFrom.responses[0].answers || [])
                : [],
            isLiked: Boolean(userId && post.sharedFrom.likes?.length),
            hasReposted: Boolean(userId && post.sharedFrom.shares?.length),
            isSaved: Boolean(userId && post.sharedFrom.savedBy?.length)
        };
    }

    return {
        ...post,
        sharedFrom: mappedSharedFrom || post.sharedFrom,
        likes: post.likesCount,
        repostCount: post.sharesCount || 0,
        participants: post.responseCount,
        coverImage: post.coverImage,
        hasParticipated: Boolean((userId || guestId) && actualResponse),
        userSelectedOptions: mapAnswerOptionIds(userAnswers),
        userProgress: buildUserProgress(userAnswers),
        isLiked: Boolean(userId && post.likes?.length),
        hasReposted: Boolean(userId && post.shares?.length),
        isSaved: Boolean(userId && post.savedBy?.length),
        options: OPTION_POST_TYPES.includes(normalizePostType(post.type) || '') && post.questions?.length > 0
            ? post.questions[0].options
            : [],
        groupId: mapVisibleFeedGroupId(post, userId),
        targetGroups: mapTargetGroups(post),
        author: {
            ...post.author,
            isFollowing: post.author?.kind === 'PAGE' ? Boolean(post.author.isFollowing) : userId ? Boolean(post.author?.following?.length) : false
        },
        allowAnonymous: post.allowAnonymous,
        forceAnonymous: Boolean(post.forceAnonymous),
        demographics: parseJsonArray(post.demographics)
    };
};

const resolveInteractionTarget = async (postId: string, type: 'like' | 'comment' | 'vote' | 'share'): Promise<string> => {
    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true, sharedFromId: true, sharedCaption: true }
    });
    if (!post) return postId;

    if (type === 'vote') {
        return post.sharedFromId || post.id;
    }
    if (type === 'like' || type === 'comment' || type === 'share') {
        const isRepost = post.sharedFromId && (!post.sharedCaption || post.sharedCaption.trim() === '');
        if (isRepost) return post.sharedFromId!;
    }
    return post.id;
};


export const getPosts = async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const guestId = typeof req.query.guestId === 'string' ? req.query.guestId : undefined;
    const authorId = typeof req.query.authorId === 'string' ? req.query.authorId : undefined;
    const authorHandle = typeof req.query.authorHandle === 'string' ? req.query.authorHandle : undefined;
    const groupId = typeof req.query.groupId === 'string' ? req.query.groupId : undefined;
    const publisherPageId = typeof req.query.pageId === 'string' ? req.query.pageId : undefined;
    const pagePostType = publisherPageId && typeof req.query.type === 'string' ? normalizePostType(req.query.type) : undefined;
    const cursorValue = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = parseFeedLimit(req.query.limit);
    
    try {
        let cursor = decodeFeedCursor(cursorValue);
        if (cursorValue && !cursor) {
            if (isOpaqueFeedCursor(cursorValue)) {
                res.status(400).json({ error: 'Invalid feed cursor', code: 'INVALID_CURSOR' });
                return;
            }

            // Compatibility with the previous API, which exposed a bare post ID.
            const legacyCursor = await prisma.post.findUnique({
                where: { id: cursorValue },
                select: { id: true, createdAt: true }
            });
            if (!legacyCursor) {
                res.json({ data: [], nextCursor: null });
                return;
            }
            cursor = legacyCursor;
        }

        const feedPage = await prisma.$transaction(async (tx) => {
            // This relation-free scalar page also supplies the stable cursor
            // keys. Only one extra scalar row is read to determine hasMore.
            const pageRows = await loadVisiblePostScalars(tx, {
                viewerId: userId, authorId, authorHandle, groupId,
                pageId: publisherPageId, type: pagePostType,
                discovery: !publisherPageId, cursor, limit: limit + 1
            });
            const hasMore = pageRows.length > limit;
            const visiblePageRefs = hasMore ? pageRows.slice(0, limit) : pageRows;
            const pageIds = visiblePageRefs.map((post) => post.id);

            if (pageIds.length === 0) {
                return { hasMore, visiblePageRefs, posts: [] as any[], relationBundle: null };
            }

            let posts = visiblePageRefs as any[];
            const sharedPostIds = Array.from(new Set(
                posts.map((post) => post.sharedFromId).filter(Boolean)
            )) as string[];
            const sharedPosts = sharedPostIds.length > 0
                ? await loadVisiblePostScalars(tx, { viewerId: userId, ids: sharedPostIds, limit: sharedPostIds.length })
                : [];
            const sharedPostsById = new Map(sharedPosts.map((post: any) => [post.id, post]));
            posts = posts.filter((post) => !post.sharedFromId || sharedPostsById.has(post.sharedFromId));
            const safeSharedPostIds = sharedPostIds.filter((id) => sharedPostsById.has(id));
            const relationPostIds = Array.from(new Set([
                ...posts.map((post) => post.id),
                ...safeSharedPostIds
            ]));
            const relationBundle = await loadFeedRelationBundle(
                tx,
                relationPostIds,
                userId,
                guestId
            );
            for (const post of posts) {
                post.sharedFrom = post.sharedFromId
                    ? sharedPostsById.get(post.sharedFromId) || null
                    : null;
            }

            return { hasMore, visiblePageRefs, posts, relationBundle };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
            maxWait: 3_000,
            timeout: 10_000
        });

        const { hasMore, visiblePageRefs, posts, relationBundle } = feedPage;
        if (!relationBundle) {
            res.json({ data: [], nextCursor: null });
            return;
        }

        attachFeedContentRelations(posts, relationBundle);
        attachFeedViewerState(posts, {
            hasResponseIdentity: Boolean(userId || guestId),
            userId,
            responses: relationBundle.responses,
            answers: relationBundle.answers,
            likes: relationBundle.likes,
            shares: relationBundle.shares,
            savedPosts: relationBundle.savedPosts,
            follows: relationBundle.follows
        });

        await attachPagePublishers(posts, userId);
        const mappedPosts = posts.map((post) => mapPostForClient(post, userId, guestId));

        const lastPageRef = visiblePageRefs[visiblePageRefs.length - 1];
        const nextCursor = hasMore && lastPageRef
            ? encodeFeedCursor(lastPageRef)
            : null;

        res.json({ data: mappedPosts, nextCursor });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
            console.warn('Feed transaction timed out', { code: error.code });
            res.status(503).json({ error: 'Feed is temporarily unavailable', code: 'FEED_TIMEOUT' });
            return;
        }
        logPostRequestFailure(req, 'posts_feed_read_failed', error);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
};

export const getTrends = async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const period = (req.query.period as string || '24h').toLowerCase();
    const type = req.query.type as string | undefined; // "Poll", "Survey", "Quiz", "Challenge"
    const country = req.query.country as string | undefined; // country code like 'JO', 'SA'
    const category = req.query.category as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;

    try {
        // Date range filter
        let dateFilter = {};
        const now = new Date();
        if (period === '24h') {
            dateFilter = { createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } };
        } else if (period === '7d') {
            dateFilter = { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } };
        } else if (period === '30d') {
            dateFilter = { createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } };
        }

        // Fetch all candidates matching basic criteria
        const posts = await prisma.post.findMany({
            where: {
                AND: [buildVisiblePublishedPostWhere(userId), pageDiscoveryPostWhere()],
                ...dateFilter,
                ...(type && type !== 'all' ? { type: { equals: type, mode: 'insensitive' } } : {}),
                ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
                ...(country && country !== 'ALL' ? {
                    OR: [
                      { pageId: null, author: { OR: [
                            { country: { equals: country, mode: 'insensitive' } },
                            { location: { contains: country, mode: 'insensitive' } }
                        ] } },
                      { page: { is: { OR: [ { country: { equals: country, mode: 'insensitive' } }, { city: { contains: country, mode: 'insensitive' } } ] } } }
                    ]
                } : {})
            },
            include: {
                author: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                        ...PUBLIC_AVATAR_MEDIA_SELECT,
                        handle: true,
                        location: true,
                        country: true,
                        followersCount: true
                    }
                },
                media: POST_MEDIA_INCLUDE
            }
        });

        // Map and rank candidates in-memory
        const nowMs = Date.now();
        await attachPagePublishers(posts,userId);
        const scoredPosts = posts.map(rawPost => {
            const post = serializePostMediaRecord(rawPost, userId);
            const votes = post.responseCount || 0;
            const comments = post.commentsCount || 0;
            const likes = post.likesCount || 0;
            const shares = post.sharesCount || 0;
            const views = post.viewCount || 0;

            // gravity score: engagement / (ageHours + 2)^1.5
            const ageHours = (nowMs - post.createdAt.getTime()) / (3600 * 1000);
            const engagement = votes * 3 + comments * 2 + likes + shares * 4 + views * 0.1;
            const trendScore = engagement / Math.pow(ageHours + 2, 1.5);

            // Compute dynamic trending reason
            let trendingReason = 'تفاعل نشط'; // Active engagement
            if (comments > votes * 0.4 && comments > 5) {
                trendingReason = 'الأكثر تعليقاً';
            } else if (shares > 5) {
                trendingReason = 'ينمو بسرعة';
            } else if (ageHours < 12 && engagement > 15) {
                trendingReason = 'صاعد حديثاً';
            } else if (votes > 50) {
                trendingReason = 'مشاركة قياسية';
            }

            return {
                id: post.id,
                pageId: post.pageId,
                title: post.title,
                description: post.description,
                type: post.type,
                category: post.category,
                coverImage: post.coverImage,
                likesCount: post.likesCount,
                commentsCount: post.commentsCount,
                participants: post.responseCount,
                sharesCount: post.sharesCount,
                viewCount: post.viewCount,
                trendScore,
                trendingReason,
                createdAt: post.createdAt,
                author: {
                    id: post.author.id,
                    kind: post.author.kind,
                    name: post.author.name,
                    avatar: post.author.avatar || null,
                    avatarMediaId: post.author.avatarMediaId,
                    avatarMedia: post.author.avatarMedia,
                    handle: post.author.handle,
                    location: post.author.location
                }
            };
        });

        // Sort descending by trendScore
        scoredPosts.sort((a, b) => b.trendScore - a.trendScore);

        // Return top-N
        res.json(scoredPosts.slice(0, limit));
    } catch (error) {
        console.error('Failed to get trends:', error);
        res.status(500).json({ error: 'Failed to fetch trends' });
    }
};

export const getPostById = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    const guestId = typeof req.query.guestId === 'string' ? req.query.guestId : undefined;
    try {
        const detail = await prisma.$transaction(async (tx) => {
            const [post] = await loadVisiblePostScalars(tx, { viewerId: userId, ids: [id], limit: 1 });
            if (!post) return null;

            const sharedFrom = post.sharedFromId
                ? (await loadVisiblePostScalars(tx, { viewerId: userId, ids: [post.sharedFromId], limit: 1 }))[0]
                : null;
            if (post.sharedFromId && !sharedFrom) return null;

            post.sharedFrom = sharedFrom;
            const relationBundle = await loadFeedRelationBundle(
                tx,
                [post.id, ...(sharedFrom ? [sharedFrom.id] : [])],
                userId,
                guestId
            );
            return { post, relationBundle };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
            maxWait: 3_000,
            timeout: 10_000
        });

        if (!detail) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        attachFeedContentRelations([detail.post], detail.relationBundle);
        attachFeedViewerState([detail.post], {
            hasResponseIdentity: Boolean(userId || guestId),
            userId,
            responses: detail.relationBundle.responses,
            answers: detail.relationBundle.answers,
            likes: detail.relationBundle.likes,
            shares: detail.relationBundle.shares,
            savedPosts: detail.relationBundle.savedPosts,
            follows: detail.relationBundle.follows
        });
        await attachPagePublishers([detail.post], userId);
        res.json(mapPostForClient(detail.post, userId, guestId));
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
            res.status(503).json({ error: 'Post is temporarily unavailable', code: 'POST_READ_TIMEOUT' });
            return;
        }
        logPostRequestFailure(req, 'post_detail_read_failed', error);
        res.status(500).json({ error: 'Failed to fetch post' });
    }
};

export const createPost = async (req: Request, res: Response) => {
    const data = req.body;
    console.log('[CREATE POST] Request received:', JSON.stringify({
        type: data.type,
        status: data.status,
        optionCount: Array.isArray(data.options) ? data.options.length : 0,
        sectionCount: Array.isArray(data.sections) ? data.sections.length : 0,
        mediaCount: Array.isArray(data.mediaAssetIds) ? data.mediaAssetIds.length : 0
    }));
    try {
        const authorId = req.user!.userId;
        const publisherPageId = data.pageId == null ? null : typeof data.pageId === 'string' && /^[0-9a-f-]{36}$/i.test(data.pageId) ? data.pageId : undefined;
        if (publisherPageId === undefined) throw new PagePolicyError('PAGE_INVALID_PUBLISHER');
        if (publisherPageId) await authorizePagePublisher(prisma, publisherPageId, authorId, data);
        const pageRequestKey = publisherPageId ? pagePostRequestKey(data.pageCreateKey) : null;
        if (publisherPageId && pageRequestKey) {
            const replay=await pagePostReplay(prisma,publisherPageId,authorId,pageRequestKey);
            if(replay){await attachPagePublishers([replay],authorId);return res.json(mapPostForClient(replay,authorId));}
        }
        if (publisherPageId) await importPagePostImages(data, authorId);
        const postMediaAssetIds = getPostMediaAssetIds(data);
        const audienceError = validateProfileAndGroupsInput(data.targetAudience, data.targetGroups, data.status === 'DRAFT');
        if (audienceError) {
            res.status(400).json({ error: audienceError, code: 'INVALID_POST_AUDIENCE' });
            return;
        }

        if (data.status !== 'DRAFT' && !validateMentionRecipientLimit(`${data.title || ''} ${data.description || ''}`, res, 'post')) {
            return;
        }

        // --- PRE-PROCESS IMAGES ---
        if (postMediaAssetIds.length === 0 && data.coverImage) data.coverImage = await processBase64Image(data.coverImage);
        if (postMediaAssetIds.length === 0 && data.image) data.image = await processBase64Image(data.image);

        if (data.options && Array.isArray(data.options)) {
            for (let opt of data.options) {
                if (opt.image && !opt.imageMediaId) opt.image = await processBase64Image(opt.image);
            }
        }

        if (data.sections && Array.isArray(data.sections)) {
            for (let sec of data.sections) {
                if (sec.questions && Array.isArray(sec.questions)) {
                    for (let q of sec.questions) {
                        if (q.image && !q.imageMediaId) q.image = await processBase64Image(q.image);
                        if (q.options && Array.isArray(q.options)) {
                            for (let opt of q.options) {
                                if (opt.image && !opt.imageMediaId) opt.image = await processBase64Image(opt.image);
                            }
                        }
                    }
                }
            }
        }
        // --------------------------

        let needsApproval = false;
        if (data.targetGroups && Array.isArray(data.targetGroups) && data.targetGroups.length > 0) {
            for (const groupId of data.targetGroups) {
                const group = await prisma.group.findUnique({
                    where: { id: groupId },
                    select: { postingPermissions: true, isDeleted: true }
                });
                if (isProfileAndGroups(data.targetAudience) && (!group || group.isDeleted)) {
                    res.status(403).json({ error: 'A selected group is unavailable.' });
                    return;
                }
                if (group) {
                    const membership = await prisma.groupMember.findUnique({
                        where: { userId_groupId: { userId: authorId, groupId } }
                    });

                    if (!membership || membership.status !== MEMBERSHIP_STATUS.JOINED) {
                        res.status(403).json({ error: 'You must be a member of the group to post.' });
                        return;
                    }

                    if (group.postingPermissions === 'AdminsOnly' && membership.role === GROUP_ROLES.MEMBER) {
                        res.status(403).json({ error: 'Only admins can post in this group.' });
                        return;
                    }

                    if (group.postingPermissions === 'ApprovalNeeded' && membership.role === GROUP_ROLES.MEMBER) {
                        needsApproval = true;
                    }
                }
            }
        }

        if (needsApproval && data.targetGroups.length > 1) {
            res.status(400).json({ error: 'Posts requiring group approval can target one group only.' });
            return;
        }

        const targetGroupIds = Array.isArray(data.targetGroups) ? data.targetGroups : [];
        const postData: any = {
            title: normalizePostType(data.type) === 'Quiz'
                ? (typeof data.title === 'string' ? data.title.trim() : '')
                : (data.title || "Untitled"),
            description: data.description || "",
            type: normalizePostType(data.type) || "Post",
            authorId: authorId,
            pageId: publisherPageId,
            groupId: data.targetGroups && Array.isArray(data.targetGroups) && data.targetGroups.length > 0 
                ? data.targetGroups[0] 
                : null,
            category: data.category,
            image: postMediaAssetIds.length > 0 ? null : (data.coverImage || data.image),
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            pollChoiceType: data.pollChoiceType,
            imageLayout: data.imageLayout,
            optionPresentation: normalizeOptionPresentation(data.optionPresentation),
            showOptionNames: data.showOptionNames !== undefined ? parseBoolean(data.showOptionNames) : true,
            currentStep: data.currentStep || 1,
            targetAudience: data.targetAudience,
            targetedGroups: data.targetGroups && Array.isArray(data.targetGroups) && data.targetGroups.length > 0 
                ? { connect: data.targetGroups.map((id: string) => ({ id })) } 
                : undefined,
            resultsWho: data.resultsWho,
            resultsDetail: data.resultsDetail,
            resultsTiming: data.resultsTiming,
            allowComments: data.allowComments !== undefined ? parseBoolean(data.allowComments) : true,
            allowMultipleSelection: data.allowMultipleSelection !== undefined ? parseBoolean(data.allowMultipleSelection) : false,
            allowUserOptions: data.allowUserOptions !== undefined ? parseBoolean(data.allowUserOptions) : false,
            randomPairing: data.randomPairing !== undefined ? parseBoolean(data.randomPairing) : true,
            demographics: normalizeDemographicFilters(data.demographics),
            allowAnonymous: parseBoolean(data.allowAnonymous),
            forceAnonymous: data.forceAnonymous !== undefined ? parseBoolean(data.forceAnonymous) : false,
            status: isProfileAndGroups(data.targetAudience) && data.status === 'DRAFT'
                ? POST_STATUS.DRAFT
                : needsApproval ? POST_STATUS.PENDING_APPROVAL : (data.status === 'DRAFT' ? POST_STATUS.DRAFT : POST_STATUS.PUBLISHED)
        };

        if (postData.status !== POST_STATUS.DRAFT) {
            const answerTypeError = validatePublishedAnswerTypes(data);
            if (answerTypeError) {
                res.status(400).json({ error: answerTypeError, code: 'INVALID_ANSWER_OPTIONS' });
                return;
            }
        }

        const mediaAspectRatio = await validatePostMediaSet(authorId, postMediaAssetIds, data.mediaAspectRatio);
        if (mediaAspectRatio) postData.mediaAspectRatio = mediaAspectRatio;
        const requirements = getMediaAttachmentRequirements(data);
        const mediaScope = publisherPageId ? 'RESTRICTED' : await resolvePostMediaScope(authorId, postData.status, targetGroupIds, postData.targetAudience);
        const prepared = await prepareMediaAttachments(authorId, requirements, mediaScope);

        let transactionResult;
        try {
            if (postMediaAssetIds.length > 0 && mediaScope === 'PUBLIC') {
                postData.image = (await getStoredMediaPresentation(postMediaAssetIds[0]))?.src || null;
            }
            transactionResult = await prisma.$transaction(async (tx) => {
            if (publisherPageId) await authorizePagePublisher(tx, publisherPageId, authorId, data);
            if(publisherPageId && pageRequestKey){
                const replay=await pagePostReplay(tx,publisherPageId,authorId,pageRequestKey);
                if(replay)return {post:replay,createdOptions:replay.questions[0]?.options || [],createdSections:replay.sections,notificationIds:[] as string[]};
            }
            const newPost = await tx.post.create({
                data: postData,
                include: {
                    author: { select: SAFE_USER_SELECT },
                    targetedGroups: true
                }
            });

            if(publisherPageId && pageRequestKey)await recordPagePostCreation(tx,publisherPageId,authorId,pageRequestKey,newPost.id);
            let optionsList: any[] = [];
            let sectionsList: any[] = [];
            const typeStr = normalizePostType(data.type) || '';

            if (postMediaAssetIds.length > 0) {
                await tx.postMedia.createMany({
                    data: postMediaAssetIds.map((mediaAssetId, sortOrder) => ({
                        postId: newPost.id,
                        mediaAssetId,
                        sortOrder
                    }))
                });
            }

            if (OPTION_POST_TYPES.includes(typeStr) && data.options) {
                const question = await tx.question.create({
                    data: {
                        text: data.title || "Poll Question",
                        type: 'SingleChoice',
                        postId: newPost.id,
                        optionPresentation: normalizeOptionPresentation(data.optionPresentation),
                        showOptionNames: data.showOptionNames !== undefined ? parseBoolean(data.showOptionNames) : true
                    }
                });
                await tx.option.createMany({
                    data: data.options.map((opt: any, index: number) => ({
                        text: opt.text,
                        image: opt.image,
                        imageMediaId: opt.imageMediaId || null,
                        questionId: question.id,
                        isRating: opt.isRating || false,
                        ratingValue: opt.ratingValue || 0,
                        withFollowUp: parseBoolean(opt.withFollowUp),
                        followUpLabel: opt.followUpLabel || null,
                        order: index
                    }))
                });
                optionsList = await tx.option.findMany({ where: { questionId: question.id }, orderBy: { order: 'asc' } });
            } else if (SECTION_POST_TYPES.includes(typeStr) && data.sections) {
                for (const [sIdx, sec] of data.sections.entries()) {
                    const section = await tx.section.create({
                        data: {
                            title: sec.title || `Section ${sIdx + 1}`,
                            order: sec.order !== undefined ? sec.order : sIdx,
                            postId: newPost.id
                        }
                    });

                    for (const [qIdx, q] of (sec.questions || []).entries()) {
                        const question = await tx.question.create({
                            data: {
                                text: q.text,
                                type: typeStr === 'Quiz' ? 'multiple_choice' : (q.type || 'multiple_choice'),
                                image: q.image,
                                imageMediaId: q.imageMediaId || null,
                                order: q.order !== undefined ? q.order : qIdx,
                                isRequired: q.isRequired !== undefined ? q.isRequired : true,
                                optionPresentation: normalizeOptionPresentation(q.optionPresentation),
                                showOptionNames: q.showOptionNames !== undefined ? parseBoolean(q.showOptionNames) : true,
                                postId: newPost.id,
                                sectionId: section.id
                            }
                        });

                        if (q.options?.length) {
                            await tx.option.createMany({
                                data: q.options.map((opt: any, index: number) => ({
                                    text: opt.text,
                                    image: opt.image,
                                    imageMediaId: opt.imageMediaId || null,
                                    isCorrect: q.correctOptionId === opt.id,
                                    isRating: opt.isRating || false,
                                    ratingValue: opt.ratingValue || 0,
                                    withFollowUp: parseBoolean(opt.withFollowUp),
                                    followUpLabel: opt.followUpLabel || null,
                                    questionId: question.id,
                                    order: index
                                }))
                            });
                        }
                    }
                }

                const fullyPopulatedPost = await tx.post.findUnique({
                    where: { id: newPost.id },
                    include: { sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } } }
                });
                if (fullyPopulatedPost?.sections) {
                    sectionsList = fullyPopulatedPost.sections;
                }
            }

            const mentionResult = await reconcilePostMentions(tx, {
                postId: newPost.id,
                actorUserId: authorId,
                state: newPost.status === POST_STATUS.PUBLISHED ? MentionState.ACTIVE : MentionState.STAGED,
                surfaces: getPostMentionSurfaces(newPost)
            });
            await reconcilePostHashtags(tx, newPost.id, getPostHashtagTexts(newPost));
            const peopleTagResult = await reconcilePeopleTags(tx, {
                postId: newPost.id,
                actorUserId: authorId,
                targetUserIds: Array.isArray(data.taggedUserIds) ? data.taggedUserIds : [],
                strict: true
            });

            await commitPreparedMedia(tx, prepared);
            if (publisherPageId && prepared.assetIds.length) await tx.mediaAsset.updateMany({
                where: { id: { in: prepared.assetIds } }, data: { pageId: publisherPageId }
            });
            return {
                post: newPost,
                createdOptions: optionsList,
                createdSections: sectionsList,
                notificationIds: [...mentionResult.notificationIds, ...peopleTagResult.notificationIds]
            };
        });
        } catch (error) {
            await rollbackPreparedMedia(prepared);
            throw error;
        }
        const { post, createdOptions, createdSections, notificationIds } = transactionResult;

        console.log(`[CREATE POST] Saved to DB:`, JSON.stringify({ id: post.id, allowAnonymous: postData.allowAnonymous, forceAnonymous: postData.forceAnonymous }));

        await dispatchNotificationIds(notificationIds);

        try {
            if (postData.status === POST_STATUS.PENDING_APPROVAL) {
                const targetGroupId = data.targetGroups[0];
                const group = await prisma.group.findUnique({ where: { id: targetGroupId }, select: { name: true } });
                const managers = await prisma.groupMember.findMany({
                    where: { groupId: targetGroupId, role: { in: [GROUP_ROLES.OWNER, GROUP_ROLES.ADMIN] }, status: MEMBERSHIP_STATUS.JOINED }
                });
                for (const manager of managers) {
                    await notify(authorId, manager.userId, 'group_post_pending', `A new post in "${group?.name || 'group'}" is pending approval.`, 'group', targetGroupId);
                }
            }
        } catch (notificationError) {
            console.error('Post created, but notifications failed:', notificationError instanceof Error ? notificationError.message : 'unknown error');
        }

        const media = (await Promise.all(postMediaAssetIds.map((id) => getStoredMediaPresentation(id)))).filter(Boolean);
        const socialRelations = await prisma.post.findUnique({
            where: { id: post.id },
            select: {
                mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                taggedUsers: getVisiblePeopleTagsInclude(authorId)
            }
        });
        const mappedPost = {
            ...post,
            author: serializeUserMediaRecord((post as any).author),
            likes: post.likesCount,
                repostCount: post.sharesCount || 0,
            participants: post.responseCount,
            coverImage: media[0]?.src || post.image,
            media,
            options: createdOptions,
            sections: createdSections.length > 0 ? createdSections : undefined,
            allowAnonymous: post.allowAnonymous,
            forceAnonymous: (post as any).forceAnonymous,
            randomPairing: (post as any).randomPairing,
            mentions: serializeMentionReferences(socialRelations?.mentions),
            taggedUsers: serializePeopleTags(socialRelations?.taggedUsers),
            demographics: parseJsonArray(post.demographics),
            targetGroups: mapTargetGroups(post)
        };

        await attachPagePublishers([mappedPost], authorId);
        res.json(mappedPost);
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        logPostRequestFailure(req, 'post_create_failed', error);
        if (error instanceof MediaValidationError) {
            res.status(error.statusCode).json({ error: error.message, code: error.code });
            return;
        }
        if (error instanceof MentionLimitError || error instanceof HashtagLimitError) {
            res.status(400).json({ error: error.message, code: 'SOCIAL_TEXT_LIMIT_EXCEEDED', limit: error.limit });
            return;
        }
        if (error instanceof PeopleTagValidationError) {
            res.status(400).json({ error: error.message, code: error.code, invalidTargetIds: error.invalidTargetIds });
            return;
        }
        res.status(500).json({ error: 'Failed to create post' });
    }
};

export const updatePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const data = req.body;
    console.log('[UPDATE POST] Request received:', JSON.stringify({
        id,
        status: data.status,
        hasOptions: data.options !== undefined,
        hasSections: data.sections !== undefined,
        mediaCount: Array.isArray(data.mediaAssetIds) ? data.mediaAssetIds.length : undefined
    }));
    try {
        const trustedUserId = req.user!.userId;
        const existingPost = await prisma.post.findUnique({
            where: { id },
            select: {
                authorId: true,
                pageId: true,
                title: true,
                description: true,
                status: true,
                createdAt: true,
                isDeleted: true,
                responseCount: true,
                groupId: true,
                sharedFromId: true,
                sharedCaption: true,
                image: true,
                targetAudience: true,
                mediaAspectRatio: true,
                targetedGroups: { select: { id: true } },
                media: { orderBy: { sortOrder: 'asc' }, select: { mediaAssetId: true } },
                questions: { where: { sectionId: null }, include: { options: true } },
                sections: { include: { questions: { include: { options: true } } } }
            }
        });

        if (!existingPost || existingPost.isDeleted) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        if (data.pageId !== undefined && (data.pageId || null) !== existingPost.pageId) throw new PagePolicyError('PAGE_PUBLISHER_IMMUTABLE',409);
        if (existingPost.pageId) {
            await authorizePagePublisher(prisma,existingPost.pageId,trustedUserId,{
                ...data,status:data.status ?? existingPost.status,groupId:data.groupId ?? existingPost.groupId,
                targetAudience:data.targetAudience ?? existingPost.targetAudience,
                targetGroups:data.targetGroups ?? existingPost.targetedGroups.map(group=>group.id)
            },existingPost.status==='DRAFT');
        }
        if (!existingPost.pageId && existingPost.authorId !== trustedUserId) {
            res.status(403).json({ error: 'Unauthorized to update this post' });
            return;
        }

        if (data.status !== undefined && data.status !== POST_STATUS.DRAFT && data.status !== POST_STATUS.PUBLISHED) {
            res.status(400).json({ error: 'Status must be DRAFT or PUBLISHED.', code: 'INVALID_POST_STATUS' });
            return;
        }

        if (data.targetGroups !== undefined && (!Array.isArray(data.targetGroups)
            || data.targetGroups.some((groupId: unknown) => typeof groupId !== 'string' || !groupId.trim())
            || new Set(data.targetGroups).size !== data.targetGroups.length)) {
            res.status(400).json({ error: 'Select valid, unique target groups.', code: 'INVALID_POST_AUDIENCE' });
            return;
        }

        if (existingPost.status === 'PUBLISHED' && Date.now() - existingPost.createdAt.getTime() > EDIT_WINDOW_MS) {
            res.status(403).json({ error: 'Published posts can only be edited within 5 minutes.' });
            return;
        }

        if (existingPost.responseCount > 0 && (data.options !== undefined || data.sections !== undefined)) {
            res.status(409).json({ error: 'Posts with responses cannot have their questions or options changed.' });
            return;
        }

        const publishesAnswerChanges = data.status === 'PUBLISHED'
            || (existingPost.status === POST_STATUS.PUBLISHED && (data.options !== undefined || data.sections !== undefined || data.optionPresentation !== undefined));
        if (publishesAnswerChanges) {
            const answerTypeError = validatePublishedAnswerTypes(data);
            if (answerTypeError) {
                res.status(400).json({ error: answerTypeError, code: 'INVALID_ANSWER_OPTIONS' });
                return;
            }
        }

        const validatesPublishedMentions = data.status === 'PUBLISHED'
            || (existingPost.status === POST_STATUS.PUBLISHED && data.status !== 'DRAFT');
        if (validatesPublishedMentions) {
            const nextMentionText = `${data.title ?? existingPost.title} ${data.description ?? existingPost.description}`;
            if (!validateMentionRecipientLimit(nextMentionText, res, 'post')) return;
        }

        // --- PRE-PROCESS IMAGES ---
        if (existingPost.pageId) await importPagePostImages(data, trustedUserId, existingPost);
        const submittedPostMediaIds = Array.isArray(data.mediaAssetIds) ? getPostMediaAssetIds(data) : undefined;
        if (submittedPostMediaIds === undefined && data.coverImage) data.coverImage = await processBase64Image(data.coverImage, existingPost.image);
        if (submittedPostMediaIds === undefined && data.image) data.image = await processBase64Image(data.image, existingPost.image);

        const existingQuestions = [
            ...existingPost.questions,
            ...existingPost.sections.flatMap((section) => section.questions)
        ];
        const existingQuestionById = new Map(existingQuestions.map((question) => [question.id, question]));
        const existingOptionById = new Map(existingQuestions.flatMap((question) => question.options).map((option) => [option.id, option]));

        if (data.options && Array.isArray(data.options)) {
            for (let opt of data.options) {
                if (opt.image && !opt.imageMediaId) opt.image = await processBase64Image(opt.image, existingOptionById.get(opt.id)?.image);
            }
        }

        if (data.sections && Array.isArray(data.sections)) {
            for (let sec of data.sections) {
                if (sec.questions && Array.isArray(sec.questions)) {
                    for (let q of sec.questions) {
                        if (q.image && !q.imageMediaId) q.image = await processBase64Image(q.image, existingQuestionById.get(q.id)?.image);
                        if (q.options && Array.isArray(q.options)) {
                            for (let opt of q.options) {
                                if (opt.image && !opt.imageMediaId) opt.image = await processBase64Image(opt.image, existingOptionById.get(opt.id)?.image);
                            }
                        }
                    }
                }
            }
        }
        // --------------------------

        const submittedTargetGroups = Array.isArray(data.targetGroups) ? data.targetGroups : undefined;
        const existingTargetGroups = Array.from(new Set([
            existingPost.groupId,
            ...existingPost.targetedGroups.map((group) => group.id)
        ].filter((groupId): groupId is string => typeof groupId === 'string' && groupId.length > 0)));
        const effectiveTargetGroups = submittedTargetGroups !== undefined ? submittedTargetGroups : existingTargetGroups;
        const effectiveAudience = data.targetAudience !== undefined ? data.targetAudience : existingPost.targetAudience;
        const audienceError = validateProfileAndGroupsInput(effectiveAudience, data.targetGroups !== undefined ? data.targetGroups : effectiveTargetGroups, (data.status ?? existingPost.status) === 'DRAFT');
        if (audienceError) {
            res.status(400).json({ error: audienceError, code: 'INVALID_POST_AUDIENCE' });
            return;
        }
        let needsApproval = false;
        // Content edits and target changes must respect the current group policy too.
        if (effectiveTargetGroups.length > 0) {
            for (const groupId of effectiveTargetGroups) {
                const group = await prisma.group.findUnique({
                    where: { id: groupId },
                    select: { postingPermissions: true, isDeleted: true }
                });
                if (!group || group.isDeleted) {
                    res.status(403).json({ error: 'A selected group is unavailable.' });
                    return;
                }
                const membership = await prisma.groupMember.findUnique({
                    where: { userId_groupId: { userId: trustedUserId, groupId } }
                });

                if (!membership || membership.status !== MEMBERSHIP_STATUS.JOINED) {
                    res.status(403).json({ error: 'You must be a member of the group to post.' });
                    return;
                }

                if (group.postingPermissions === 'AdminsOnly' && membership.role === GROUP_ROLES.MEMBER) {
                    res.status(403).json({ error: 'Only admins can post in this group.' });
                    return;
                }

                if (group.postingPermissions === 'ApprovalNeeded' && membership.role === GROUP_ROLES.MEMBER) {
                    needsApproval = true;
                }
            }
        }

        if (needsApproval && effectiveTargetGroups.length > 1) {
            res.status(400).json({ error: 'Posts requiring group approval can target one group only.' });
            return;
        }

        const updateData: any = {
            ...(data.title !== undefined && { title: data.title }),
            ...(data.description !== undefined && { description: data.description }),
            ...(data.category !== undefined && { category: data.category }),
            ...((data.coverImage !== undefined || data.image !== undefined) && { image: data.coverImage || data.image }),
            ...(data.currentStep !== undefined && { currentStep: data.currentStep }),
            ...(data.expiresAt !== undefined && { expiresAt: new Date(data.expiresAt) }),
            ...(data.allowAnonymous !== undefined && { allowAnonymous: parseBoolean(data.allowAnonymous) }),
            ...(data.forceAnonymous !== undefined && { forceAnonymous: parseBoolean(data.forceAnonymous) }),
            ...(data.allowComments !== undefined && { allowComments: parseBoolean(data.allowComments) }),
            ...(data.allowMultipleSelection !== undefined && { allowMultipleSelection: parseBoolean(data.allowMultipleSelection) }),
            ...(data.allowUserOptions !== undefined && { allowUserOptions: parseBoolean(data.allowUserOptions) }),
            ...(data.resultsWho !== undefined && { resultsWho: data.resultsWho }),
            ...(data.resultsDetail !== undefined && { resultsDetail: data.resultsDetail }),
            ...(data.resultsTiming !== undefined && { resultsTiming: data.resultsTiming }),
            ...(data.status !== undefined && { status: data.status === 'DRAFT' ? POST_STATUS.DRAFT : POST_STATUS.PUBLISHED }),
            ...(data.targetAudience !== undefined && { targetAudience: data.targetAudience }),
            ...(data.targetGroups !== undefined && { 
                groupId: Array.isArray(data.targetGroups) && data.targetGroups.length > 0 ? data.targetGroups[0] : null,
                targetedGroups: { 
                    set: Array.isArray(data.targetGroups) ? data.targetGroups.map((id: string) => ({ id })) : [] 
                } 
            }),
            ...(data.pollChoiceType !== undefined && { pollChoiceType: data.pollChoiceType }),
            ...(data.imageLayout !== undefined && { imageLayout: data.imageLayout }),
            ...(data.optionPresentation !== undefined && { optionPresentation: normalizeOptionPresentation(data.optionPresentation) }),
            ...(data.showOptionNames !== undefined && { showOptionNames: parseBoolean(data.showOptionNames) }),
            ...(data.randomPairing !== undefined && { randomPairing: parseBoolean(data.randomPairing) }),
            ...(data.demographics !== undefined && { demographics: normalizeDemographicFilters(data.demographics) })
        };

        // Resubmission flow for rejected/draft posts
        if (existingPost.status === POST_STATUS.REJECTED) {
            if (data.status === 'PUBLISHED') {
                updateData.status = POST_STATUS.PENDING_APPROVAL;
                // Clear rejection & approval metadata
                updateData.approvedById = null;
                updateData.approvedAt = null;
                updateData.rejectedById = null;
                updateData.rejectedAt = null;
                updateData.rejectionReason = null;
            }
        } else if (existingPost.status === POST_STATUS.DRAFT) {
            if (data.status === 'PUBLISHED') {
                updateData.status = needsApproval ? POST_STATUS.PENDING_APPROVAL : POST_STATUS.PUBLISHED;
                // Clear rejection & approval metadata
                updateData.approvedById = null;
                updateData.approvedAt = null;
                updateData.rejectedById = null;
                updateData.rejectedAt = null;
                updateData.rejectionReason = null;
            }
        }

        const requestedStatus = data.status ?? existingPost.status;
        if (needsApproval && (requestedStatus === POST_STATUS.PUBLISHED || requestedStatus === POST_STATUS.PENDING_APPROVAL)) {
            updateData.status = POST_STATUS.PENDING_APPROVAL;
            updateData.approvedById = null;
            updateData.approvedAt = null;
            updateData.rejectedById = null;
            updateData.rejectedAt = null;
            updateData.rejectionReason = null;
        }

        const oldRequirements: MediaAttachmentRequirement[] = [
            ...existingPost.media.map(({ mediaAssetId }) => ({ id: mediaAssetId, purpose: 'POST' as const })),
            ...existingPost.questions.flatMap((question) => [
                ...(question.imageMediaId ? [{ id: question.imageMediaId, purpose: 'QUESTION_IMAGE' as const }] : []),
                ...question.options.flatMap((option) => option.imageMediaId ? [{ id: option.imageMediaId, purpose: 'OPTION_IMAGE' as const }] : [])
            ]),
            ...existingPost.sections.flatMap((section) => section.questions.flatMap((question) => [
                ...(question.imageMediaId ? [{ id: question.imageMediaId, purpose: 'QUESTION_IMAGE' as const }] : []),
                ...question.options.flatMap((option) => option.imageMediaId ? [{ id: option.imageMediaId, purpose: 'OPTION_IMAGE' as const }] : [])
            ]))
        ];
        const oldPurposeById = new Map(oldRequirements.map((requirement) => [requirement.id, requirement.purpose]));
        const finalPostMediaIds = submittedPostMediaIds || existingPost.media.map(({ mediaAssetId }) => mediaAssetId);
        const incomingRequirements: MediaAttachmentRequirement[] = [
            ...finalPostMediaIds.map((mediaId) => ({ id: mediaId, purpose: 'POST' as const })),
            ...(data.options !== undefined
                ? getMediaAttachmentRequirements({ options: data.options })
                : oldRequirements.filter((requirement) => requirement.purpose === 'OPTION_IMAGE' && existingPost.questions.some((question) => question.options.some((option) => option.imageMediaId === requirement.id)))),
            ...(data.sections !== undefined
                ? getMediaAttachmentRequirements({ sections: data.sections })
                : oldRequirements.filter((requirement) => existingPost.sections.some((section) => section.questions.some((question) =>
                    question.imageMediaId === requirement.id || question.options.some((option) => option.imageMediaId === requirement.id)
                ))))
        ];
        if (new Set(incomingRequirements.map(({ id: mediaId }) => mediaId)).size !== incomingRequirements.length) {
            throw new MediaValidationError('DUPLICATE_MEDIA', 'The same image cannot be attached more than once.', 409);
        }
        if (incomingRequirements.some((requirement) => oldPurposeById.has(requirement.id) && oldPurposeById.get(requirement.id) !== requirement.purpose)) {
            throw new MediaValidationError('MEDIA_PURPOSE_MISMATCH', 'An existing image cannot move to a different media role.', 409);
        }

        const oldIds = new Set(oldRequirements.map(({ id: mediaId }) => mediaId));
        const incomingIds = new Set(incomingRequirements.map(({ id: mediaId }) => mediaId));
        const retainedIds = Array.from(incomingIds).filter((mediaId) => oldIds.has(mediaId));
        const removedIds = Array.from(oldIds).filter((mediaId) => !incomingIds.has(mediaId));
        const newRequirements = incomingRequirements.filter((requirement) => !oldIds.has(requirement.id));
        const finalStatus = updateData.status || existingPost.status;
        const mediaScope = existingPost.pageId ? 'RESTRICTED' : await resolvePostMediaScope(trustedUserId, finalStatus, effectiveTargetGroups, data.targetAudience !== undefined ? data.targetAudience : existingPost.targetAudience);
        const ratio = await validatePostMediaSet(trustedUserId, finalPostMediaIds, data.mediaAspectRatio || existingPost.mediaAspectRatio || undefined,existingPost.pageId || undefined);
        if (ratio) updateData.mediaAspectRatio = ratio;
        else if (submittedPostMediaIds) updateData.mediaAspectRatio = null;

        const preparedNew = await prepareMediaAttachments(trustedUserId, newRequirements, mediaScope);
        let preparedRetained;
        try {
            preparedRetained = await prepareMediaScopeChange(retainedIds, mediaScope);
        } catch (error) {
            await rollbackPreparedMedia(preparedNew);
            throw error;
        }

        const legacyUrlById = new Map<string, string>();
        try {
            if (mediaScope === 'PUBLIC') {
                for (const requirement of incomingRequirements) {
                    const presentation = await getStoredMediaPresentation(requirement.id);
                    if (presentation?.src) legacyUrlById.set(requirement.id, presentation.src);
                }
            }
        } catch (error) {
            await rollbackPreparedMedia(preparedNew);
            await rollbackMediaScopeChange(preparedRetained);
            throw error;
        }
        if (submittedPostMediaIds !== undefined || (finalPostMediaIds.length > 0 && mediaScope !== 'PUBLIC')) {
            updateData.image = finalPostMediaIds.length > 0 ? (legacyUrlById.get(finalPostMediaIds[0]) || null) : null;
        }

        let transactionResult;
        try {
            transactionResult = await prisma.$transaction(async (tx) => {
                if (existingPost.pageId) {
                    await lockPage(tx, existingPost.pageId);
                    const current = await tx.post.findUnique({where:{id},select:{pageId:true,status:true,isDeleted:true,createdAt:true,responseCount:true}});
                    if (!current || current.isDeleted || current.pageId!==existingPost.pageId) throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
                    await authorizePagePublisher(tx,existingPost.pageId,trustedUserId,{...data,status:finalStatus,targetGroups:effectiveTargetGroups},current.status==='DRAFT');
                    if (current.status==='PUBLISHED' && Date.now()-current.createdAt.getTime()>EDIT_WINDOW_MS) throw new PagePolicyError('POST_EDIT_WINDOW_CLOSED',403);
                    if (current.responseCount>0 && (data.options!==undefined || data.sections!==undefined)) throw new PagePolicyError('POST_ANSWERS_ALREADY_RECEIVED',409);
                }
                const post = await tx.post.update({
                    where: { id },
                    data: updateData,
                    include: { author: { select: SAFE_USER_SELECT }, targetedGroups: true }
                });

                if(existingPost.pageId)await pageAudit(tx,existingPost.pageId,trustedUserId,'CONTENT_UPDATED',id,{fields:Object.keys(updateData)});

                if (submittedPostMediaIds !== undefined) {
                    await tx.postMedia.deleteMany({ where: { postId: id } });
                    if (finalPostMediaIds.length > 0) {
                        await tx.postMedia.createMany({
                            data: finalPostMediaIds.map((mediaAssetId, sortOrder) => ({ postId: id, mediaAssetId, sortOrder }))
                        });
                    }
                }

                const typeStr = normalizePostType(post.type) || '';
                if (OPTION_POST_TYPES.includes(typeStr) && data.options !== undefined) {
                    let question = await tx.question.findFirst({ where: { postId: id, sectionId: null } });
                    if (!question) {
                        question = await tx.question.create({
                            data: {
                                text: data.title || 'Poll Question',
                                type: 'SingleChoice',
                                postId: id,
                                optionPresentation: normalizeOptionPresentation(data.optionPresentation),
                                showOptionNames: data.showOptionNames !== undefined ? parseBoolean(data.showOptionNames) : true
                            }
                        });
                    } else if (data.optionPresentation !== undefined || data.showOptionNames !== undefined) {
                        question = await tx.question.update({
                            where: { id: question.id },
                            data: {
                                ...(data.optionPresentation !== undefined && { optionPresentation: normalizeOptionPresentation(data.optionPresentation) }),
                                ...(data.showOptionNames !== undefined && { showOptionNames: parseBoolean(data.showOptionNames) })
                            }
                        });
                    }
                    await tx.option.deleteMany({ where: { questionId: question.id } });
                    if (data.options.length > 0) {
                        await tx.option.createMany({
                            data: data.options.map((option: any, index: number) => ({
                                text: option.text,
                                image: option.imageMediaId ? (legacyUrlById.get(option.imageMediaId) || null) : option.image,
                                imageMediaId: option.imageMediaId || null,
                                questionId: question!.id,
                                isRating: option.isRating || false,
                                ratingValue: option.ratingValue || 0,
                                withFollowUp: parseBoolean(option.withFollowUp),
                                followUpLabel: option.followUpLabel || null,
                                order: index
                            }))
                        });
                    }
                } else if (SECTION_POST_TYPES.includes(typeStr) && data.sections !== undefined) {
                    const oldSections = await tx.section.findMany({ where: { postId: id }, include: { questions: true } });
                    const oldSectionIds = oldSections.map((section) => section.id);
                    const oldQuestionIds = oldSections.flatMap((section) => section.questions.map((question) => question.id));
                    if (oldQuestionIds.length > 0) {
                        await tx.option.deleteMany({ where: { questionId: { in: oldQuestionIds } } });
                        await tx.question.deleteMany({ where: { id: { in: oldQuestionIds } } });
                    }
                    if (oldSectionIds.length > 0) await tx.section.deleteMany({ where: { id: { in: oldSectionIds } } });

                    for (const [sectionIndex, sectionInput] of data.sections.entries()) {
                        const section = await tx.section.create({
                            data: {
                                title: sectionInput.title || `Section ${sectionIndex + 1}`,
                                order: sectionInput.order !== undefined ? sectionInput.order : sectionIndex,
                                postId: id
                            }
                        });
                        for (const [questionIndex, questionInput] of (sectionInput.questions || []).entries()) {
                            const question = await tx.question.create({
                                data: {
                                    text: questionInput.text,
                                    type: typeStr === 'Quiz' ? 'multiple_choice' : (questionInput.type || 'multiple_choice'),
                                    image: questionInput.imageMediaId ? (legacyUrlById.get(questionInput.imageMediaId) || null) : questionInput.image,
                                    imageMediaId: questionInput.imageMediaId || null,
                                    order: questionInput.order !== undefined ? questionInput.order : questionIndex,
                                    isRequired: questionInput.isRequired !== undefined ? questionInput.isRequired : true,
                                    optionPresentation: normalizeOptionPresentation(questionInput.optionPresentation),
                                    showOptionNames: questionInput.showOptionNames !== undefined ? parseBoolean(questionInput.showOptionNames) : true,
                                    postId: id,
                                    sectionId: section.id
                                }
                            });
                            if (questionInput.options?.length) {
                                await tx.option.createMany({
                                    data: questionInput.options.map((option: any, index: number) => ({
                                        text: option.text,
                                        image: option.imageMediaId ? (legacyUrlById.get(option.imageMediaId) || null) : option.image,
                                        imageMediaId: option.imageMediaId || null,
                                        isCorrect: questionInput.correctOptionId === option.id,
                                        isRating: option.isRating || false,
                                        ratingValue: option.ratingValue || 0,
                                        withFollowUp: parseBoolean(option.withFollowUp),
                                        followUpLabel: option.followUpLabel || null,
                                        questionId: question.id,
                                        order: index
                                    }))
                                });
                            }
                        }
                    }
                }

                const mentionResult = await reconcilePostMentions(tx, {
                    postId: post.id,
                    actorUserId: trustedUserId,
                    state: post.status === POST_STATUS.PUBLISHED ? MentionState.ACTIVE : MentionState.STAGED,
                    surfaces: getPostMentionSurfaces(post)
                });
                await reconcilePostHashtags(tx, post.id, getPostHashtagTexts(post));
                const taggedUserIds = Array.isArray(data.taggedUserIds)
                    ? data.taggedUserIds
                    : await getCurrentPeopleTagUserIds(tx, post.id);
                const peopleTagResult = await reconcilePeopleTags(tx, {
                    postId: post.id,
                    actorUserId: trustedUserId,
                    targetUserIds: taggedUserIds,
                    strict: true
                });

                await commitPreparedMedia(tx, preparedNew);
                if (existingPost.pageId && preparedNew.assetIds.length) await tx.mediaAsset.updateMany({where:{id:{in:preparedNew.assetIds}},data:{pageId:existingPost.pageId}});
                await commitMediaScopeChange(tx, preparedRetained);

                const finalOptions = OPTION_POST_TYPES.includes(typeStr)
                    ? await tx.option.findMany({ where: { question: { postId: id, sectionId: null } }, orderBy: { order: 'asc' } })
                    : [];
                const finalSections = SECTION_POST_TYPES.includes(typeStr)
                    ? await tx.section.findMany({
                        where: { postId: id },
                        orderBy: { order: 'asc' },
                        include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } }
                    })
                    : [];
                return {
                    post,
                    finalOptions,
                    finalSections,
                    notificationIds: [...mentionResult.notificationIds, ...peopleTagResult.notificationIds]
                };
            });
        } catch (error) {
            await rollbackPreparedMedia(preparedNew);
            await rollbackMediaScopeChange(preparedRetained);
            throw error;
        }

        await finalizeMediaScopeChange(preparedRetained);
        await scheduleMediaDeletion(removedIds);
        const { post, finalOptions, finalSections, notificationIds } = transactionResult;
        console.log('[UPDATE POST] Saved to DB:', JSON.stringify({ id: post.id, mediaCount: finalPostMediaIds.length }));

        await dispatchNotificationIds(notificationIds);

        try {
            if (post.status === POST_STATUS.PENDING_APPROVAL && existingPost.status !== POST_STATUS.PENDING_APPROVAL) {
                const targetGroupId = post.groupId || post.targetedGroups[0]?.id;
                if (targetGroupId) {
                    const [group, managers] = await Promise.all([
                        prisma.group.findUnique({ where: { id: targetGroupId }, select: { name: true } }),
                        prisma.groupMember.findMany({
                            where: { groupId: targetGroupId, role: { in: [GROUP_ROLES.OWNER, GROUP_ROLES.ADMIN] }, status: MEMBERSHIP_STATUS.JOINED }
                        })
                    ]);
                    for (const manager of managers) {
                        await notify(trustedUserId, manager.userId, 'group_post_pending', `A rejected post in "${group?.name || 'group'}" was resubmitted and is pending approval.`, 'group', targetGroupId);
                    }
                }
            }
        } catch (notificationError) {
            console.error('Post updated, but notifications failed:', notificationError instanceof Error ? notificationError.message : 'unknown error');
        }

        const media = (await Promise.all(finalPostMediaIds.map((mediaId) => getStoredMediaPresentation(mediaId)))).filter(Boolean);
        const socialRelations = await prisma.post.findUnique({
            where: { id: post.id },
            select: {
                mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                taggedUsers: getVisiblePeopleTagsInclude(trustedUserId)
            }
        });

        const mappedPost = {
            ...post,
            author: serializeUserMediaRecord((post as any).author),
            likes: post.likesCount,
                repostCount: post.sharesCount || 0,
            participants: post.responseCount,
            coverImage: media[0]?.src || post.image,
            media,
            options: finalOptions,
            sections: finalSections.length > 0 ? finalSections : undefined,
            allowAnonymous: post.allowAnonymous,
            forceAnonymous: (post as any).forceAnonymous,
            randomPairing: (post as any).randomPairing,
            mentions: serializeMentionReferences(socialRelations?.mentions),
            taggedUsers: serializePeopleTags(socialRelations?.taggedUsers),
            demographics: parseJsonArray(post.demographics),
            targetGroups: mapTargetGroups(post)
        };

        await attachPagePublishers([mappedPost],trustedUserId);
        res.json(mappedPost);
    } catch (error) {
        if (respondPagePostError(error,res)) return;
        logPostRequestFailure(req, 'post_update_failed', error);
        if (error instanceof MediaValidationError) {
            res.status(error.statusCode).json({ error: error.message, code: error.code });
            return;
        }
        if (error instanceof MentionLimitError || error instanceof HashtagLimitError) {
            res.status(400).json({ error: error.message, code: 'SOCIAL_TEXT_LIMIT_EXCEEDED', limit: error.limit });
            return;
        }
        if (error instanceof PeopleTagValidationError) {
            res.status(400).json({ error: error.message, code: error.code, invalidTargetIds: error.invalidTargetIds });
            return;
        }
        res.status(500).json({ error: 'Failed to update post' });
    }
};

export const getDrafts = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const limit = parseReadLimit(req.query.limit, 20, 50);
    const cursor = firstQueryString(req.query.cursor)?.trim() || undefined;
    try {
        const drafts = await prisma.post.findMany({
            where: { authorId: userId, pageId: null, status: { in: [POST_STATUS.DRAFT, POST_STATUS.PENDING_APPROVAL, POST_STATUS.REJECTED] }, isDeleted: false },
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                taggedUsers: getVisiblePeopleTagsInclude(userId),
                media: POST_MEDIA_INCLUDE,
                targetedGroups: true,
                author: { select: SAFE_USER_SELECT }
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
        });
        const hasMore = drafts.length > limit;
        if (hasMore) drafts.pop();
        applyNextCursorHeader(res, drafts, hasMore);
        const mappedDrafts = drafts.map((rawDraft: any) => {
            const d = serializePostSocialRecord(rawDraft, userId);
            return {
                ...d,
                likes: d.likesCount,
                repostCount: d.sharesCount || 0,
                participants: d.responseCount,
                coverImage: d.coverImage,
                options: OPTION_POST_TYPES.includes(normalizePostType(d.type) || '') && d.questions.length > 0 ? d.questions[0].options : [],
                sections: d.sections,
                allowAnonymous: d.allowAnonymous,
                forceAnonymous: d.forceAnonymous,
                randomPairing: d.randomPairing,
                demographics: parseJsonArray(d.demographics),
                targetGroups: mapTargetGroups(d)
            };
        });
        res.json(mappedDrafts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch drafts' });
    }
};

export const getSavedPosts = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const limit = parseReadLimit(req.query.limit, 20, 50);
    const cursor = firstQueryString(req.query.cursor)?.trim() || undefined;
    try {
        const saved = await prisma.savedPost.findMany({
            where: { 
                userId, 
                post: buildVisiblePublishedPostWhere(userId)
            },
            take: limit + 1,
            ...(cursor ? { cursor: { userId_postId: { userId, postId: cursor } }, skip: 1 } : {}),
            include: {
                post: {
                    include: {
                        author: { select: SAFE_USER_SELECT },
                        questions: { include: { options: { orderBy: { order: 'asc' } } } },
                        sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                        mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                        taggedUsers: getVisiblePeopleTagsInclude(userId),
                        media: POST_MEDIA_INCLUDE,
                        targetedGroups: true,
                        responses: userId ? { where: { userId }, take: 1, include: { answers: true } } : false,
                        likes: userId ? { where: { userId }, take: 1 } : false,
                        shares: { where: { authorId: userId, pageId: null }, take: 1 },
                        savedBy: { where: { userId }, take: 1 },
                        sharedFrom: {
                            include: {
                                author: {
                                    select: {
                                        ...SAFE_USER_SELECT,
                                        following: {
                                            where: { followerId: userId, status: 'ACTIVE' },
                                            select: { followerId: true }
                                        }
                                    }
                                },
                                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                                mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                                taggedUsers: getVisiblePeopleTagsInclude(userId),
                                media: POST_MEDIA_INCLUDE,
                                targetedGroups: true,
                                responses: { where: { userId }, take: 1, include: { answers: true } },
                                likes: { where: { userId }, take: 1 },
                                shares: { where: { authorId: userId, pageId: null }, take: 1 },
                                savedBy: { where: { userId }, take: 1 }
                            }
                        }
                    }
                }
            },
            orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }]
        });
        const hasMore = saved.length > limit;
        if (hasMore) saved.pop();
        if (hasMore && saved.length > 0) {
            res.setHeader('X-Next-Cursor', saved[saved.length - 1].postId);
        }
        await attachPagePublishers(saved.map(item => item.post), userId);
        const posts = saved.map((s: any) => {
            const p: any = serializePostSocialRecord(s.post, userId);
            const userResponse = p.sharedFrom ? p.sharedFrom.responses?.[0] : p.responses?.[0];
            const userAnswers = userResponse?.answers || [];
            const mappedSharedFrom = p.sharedFrom ? {
                ...p.sharedFrom,
                options: OPTION_POST_TYPES.includes(normalizePostType(p.sharedFrom.type) || '') && p.sharedFrom.questions?.length > 0
                    ? p.sharedFrom.questions[0].options
                    : [],
                demographics: parseJsonArray(p.sharedFrom.demographics),
                author: p.sharedFrom.author ? {
                    ...p.sharedFrom.author,
                    isFollowing: p.sharedFrom.author.following?.length > 0
                } : undefined,
                likes: p.sharedFrom.likesCount,
                repostCount: p.sharedFrom.sharesCount || 0,
                participants: p.sharedFrom.responseCount,
                targetGroups: mapTargetGroups(p.sharedFrom),
                hasParticipated: !!p.sharedFrom.responses?.length,
                userSelectedOptions: mapAnswerOptionIds(p.sharedFrom.responses?.[0]?.answers || []),
                isLiked: !!p.sharedFrom.likes?.length,
                hasReposted: !!p.sharedFrom.shares?.length,
                isSaved: !!p.sharedFrom.savedBy?.length
            } : undefined;
            return {
                ...p,
                sharedFrom: mappedSharedFrom,
                likes: p.likesCount,
                repostCount: p.sharesCount || 0,
                participants: p.responseCount,
                coverImage: p.coverImage,
                hasParticipated: userId ? !!userResponse : false,
                userSelectedOptions: mapAnswerOptionIds(userAnswers),
                userProgress: buildUserProgress(userAnswers),
                isLiked: userId ? (p.likes && p.likes.length > 0) : false,
                hasReposted: userId ? (p.shares && p.shares.length > 0) : false,
                isSaved: true,
                options: OPTION_POST_TYPES.includes(normalizePostType(p.type) || '') && p.questions.length > 0 ? p.questions[0].options : [],
                allowAnonymous: p.allowAnonymous,
                forceAnonymous: !!p.forceAnonymous,
                randomPairing: p.randomPairing,
                demographics: parseJsonArray(p.demographics),
                targetGroups: mapTargetGroups(p)
            };
        });
        res.json(posts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch saved posts' });
    }
};

export const votePost = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const { guestId, optionId, optionIds, isAnonymous, newOption, followUpAnswers = {}, answers = [] } = req.body;
    try {
        const id = await resolveInteractionTarget(rawId, 'vote');
        const guestIp = req.ip || req.socket?.remoteAddress;
        const actorUserId = req.user?.userId || null;
        if (!actorUserId && !guestId) {
            res.status(400).json({ error: 'Authentication or Guest ID is required' });
            return;
        }

        const votePostSelect = {
                allowAnonymous: true,
                forceAnonymous: true,
                authorId: true, pageId: true,
                allowMultipleSelection: true,
                allowUserOptions: true,
                type: true,
                targetAudience: true,
                targetedGroups: { select: { id: true } },
                status: true,
                isDeleted: true,
                expiresAt: true
        } satisfies Prisma.PostSelect;
        const post = await prisma.post.findUnique({ where: { id }, select: votePostSelect });

        if (!post || post.isDeleted || post.status !== 'PUBLISHED') {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        if (post.expiresAt && post.expiresAt.getTime() <= Date.now()) {
            res.status(400).json({ error: 'This post has ended' });
            return;
        }

        const targetGroupIds = mapTargetGroups(post);
        // A public, non-group vote has no author-only preflight branch. The locked
        // interaction guard below still checks current visibility and actor eligibility.
        const needsPageRole = post.targetAudience !== 'Public' || targetGroupIds.length > 0;
        const isAuthor = post.pageId
            ? needsPageRole && await hasPostPageCapability(post.pageId, actorUserId, 'manageContent')
            : !!actorUserId && post.authorId === actorUserId;
        if (isProfileAndGroups(post.targetAudience) && !(await canInteractWithProfileAndGroups(id, post.authorId, actorUserId, targetGroupIds))) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        if (!isProfileAndGroups(post.targetAudience) && !isAuthor && (post.targetAudience === 'Groups' || targetGroupIds.length > 0)) {
            if (!actorUserId) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const membership = await prisma.groupMember.findFirst({
                where: { userId: actorUserId, groupId: { in: targetGroupIds }, status: 'JOINED' }
            });
            if (!membership) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        if (!isAuthor && post.targetAudience === 'Followers') {
            if (!actorUserId) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const follow = post.pageId ? await isPageFollower(post.pageId,actorUserId) : await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: actorUserId, followingId: post.authorId } }
            });
            if (!follow) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        let optionsToProcess: string[] = [];
        if (Array.isArray(optionIds) && optionIds.length > 0) {
            optionsToProcess.push(...optionIds);
        } else if (optionId) {
            optionsToProcess.push(optionId);
        }
        optionsToProcess = Array.from(new Set(optionsToProcess.filter(Boolean)));
        const structuredAnswers = Array.isArray(answers)
            ? answers
                .map((answer: any) => ({
                    questionId: typeof answer?.questionId === 'string' ? answer.questionId : '',
                    optionId: typeof answer?.optionId === 'string' && answer.optionId.trim() ? answer.optionId : null,
                    textValue: typeof answer?.textValue === 'string' ? answer.textValue.trim() : null
                }))
                .filter((answer: any) => answer.questionId && (answer.optionId || answer.textValue))
            : [];

        let finalIsAnonymous = false;
        if ((post as any).forceAnonymous === true) {
            finalIsAnonymous = true;
        } else {
            finalIsAnonymous = parseBoolean(isAnonymous);
        }

        let createdCustomOption: any = null;
        let shouldNotify = false;
        let pageVoteNotificationHandled = false;
        let notificationOptionId = optionsToProcess[0];

        await prisma.$transaction(async (tx) => {
            const pageInteraction = await guardPagePostInteractions(tx,[rawId,id],actorUserId,id);
            // The publisher may have changed vote settings while this request
            // waited. Read the canonical post again under its row lock, including
            // when it is a personal source reached through a Page wrapper.
            const effectivePost = pageInteraction
                ? await tx.post.findUnique({ where: { id }, select: votePostSelect })
                : post;
            if (!effectivePost || effectivePost.isDeleted || effectivePost.status !== 'PUBLISHED') throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
            if (pageInteraction && effectivePost.expiresAt && effectivePost.expiresAt.getTime() <= Date.now()) throw new PagePolicyError('PAGE_POST_ENDED',400);
            finalIsAnonymous = effectivePost.forceAnonymous === true || parseBoolean(isAnonymous);
            const customClientId = typeof newOption?.id === 'string' ? newOption.id : undefined;
            const customText = typeof newOption?.text === 'string' ? newOption.text.trim() : '';
            let resolvedOptionIds = [...optionsToProcess];

            if (customClientId && customText && resolvedOptionIds.includes(customClientId)) {
                if (!effectivePost.allowUserOptions) {
                    throw Object.assign(new Error('This poll does not allow voter-added options'), { statusCode: 400 });
                }

                const question = await tx.question.findFirst({
                    where: { postId: id },
                    orderBy: { order: 'asc' }
                });

                if (!question) {
                    throw Object.assign(new Error('Poll question not found'), { statusCode: 400 });
                }

                const lastOption = await tx.option.findFirst({
                    where: { questionId: question.id },
                    orderBy: { order: 'desc' },
                    select: { order: true }
                });

                createdCustomOption = await tx.option.create({
                    data: {
                        text: customText,
                        questionId: question.id,
                        order: (lastOption?.order ?? -1) + 1,
                        isUserAdded: true,
                        addedByUserId: actorUserId || null,
                        addedByGuestId: guestId || null
                    }
                });

                resolvedOptionIds = resolvedOptionIds.map(optId => optId === customClientId ? createdCustomOption.id : optId);
                notificationOptionId = createdCustomOption.id;
            }

            if (structuredAnswers.length === 0 && resolvedOptionIds.length === 0) {
                throw Object.assign(new Error('No answers provided'), { statusCode: 400 });
            }

            const whereClause: any = { postId: id };
            if (actorUserId) whereClause.userId = actorUserId;
            else if (guestId) whereClause.guestId = guestId;

            const existingResponse = await tx.response.findFirst({ where: whereClause });

            // Additional answers must not make a previously anonymous response
            // identifiable, and current forced anonymity applies to this write.
            if (pageInteraction && existingResponse) {
                finalIsAnonymous = finalIsAnonymous || existingResponse.isAnonymous;
                if (finalIsAnonymous && !existingResponse.isAnonymous) await tx.response.update({where:{id:existingResponse.id},data:{isAnonymous:true}});
            }

            const response = existingResponse || await tx.response.create({
                data: {
                    postId: id,
                    userId: actorUserId || null,
                    guestId: guestId || null,
                    ipAddress: guestIp || null,
                    isAnonymous: finalIsAnonymous
                }
            });

            shouldNotify = !existingResponse;

            if (structuredAnswers.length > 0) {
                const questionIds = Array.from(new Set(structuredAnswers.map((answer: any) => answer.questionId)));
                const questions = await tx.question.findMany({
                    where: { id: { in: questionIds }, postId: id },
                    select: { id: true }
                });
                const validQuestionIds = new Set(questions.map(q => q.id));

                if (validQuestionIds.size !== questionIds.length) {
                    throw Object.assign(new Error('Invalid questions for this post'), { statusCode: 400 });
                }

                const selectedOptionIds = Array.from(new Set(structuredAnswers.map((answer: any) => answer.optionId).filter(Boolean))) as string[];
                const options = selectedOptionIds.length > 0
                    ? await tx.option.findMany({ where: { id: { in: selectedOptionIds } }, include: { question: true } })
                    : [];
                const optionsById = new Map(options.map((option: any) => [option.id, option]));

                if (options.length !== selectedOptionIds.length || options.some((option: any) => option.question.postId !== id)) {
                    throw Object.assign(new Error('Invalid options for this post'), { statusCode: 400 });
                }

                const uniqueAnswers = new Map<string, any>();
                for (const answer of structuredAnswers) {
                    if (answer.optionId) {
                        const option = optionsById.get(answer.optionId);
                        if (!option || option.questionId !== answer.questionId) {
                            throw Object.assign(new Error('Option does not belong to the submitted question'), { statusCode: 400 });
                        }
                    }
                    uniqueAnswers.set(`${answer.questionId}:${answer.optionId || 'text'}`, answer);
                }

                for (const answer of uniqueAnswers.values()) {
                    const existingAnswer = await tx.answer.findFirst({
                        where: {
                            responseId: response.id,
                            questionId: answer.questionId,
                            optionId: answer.optionId || null
                        }
                    });

                    if (existingAnswer) continue;

                    await tx.answer.create({
                        data: {
                            responseId: response.id,
                            questionId: answer.questionId,
                            optionId: answer.optionId || null,
                            textValue: answer.textValue || null
                        }
                    });

                    if (answer.optionId) {
                        notificationOptionId = notificationOptionId || answer.optionId;
                        await tx.option.update({
                            where: { id: answer.optionId },
                            data: { votes: { increment: 1 } }
                        });
                    }
                }
            } else {
                if (!effectivePost.allowMultipleSelection && resolvedOptionIds.length > 1) {
                    throw Object.assign(new Error('This poll accepts one option only'), { statusCode: 400 });
                }

                const dbOptions = await tx.option.findMany({
                    where: { id: { in: resolvedOptionIds } },
                    include: { question: true }
                });

                if (dbOptions.length !== resolvedOptionIds.length || dbOptions.some((o: any) => o.question.postId !== id)) {
                    throw Object.assign(new Error('Invalid options for this post'), { statusCode: 400 });
                }

                for (const opt of dbOptions) {
                    if (!effectivePost.allowMultipleSelection) {
                        const existingQuestionAnswer = await tx.answer.findFirst({
                            where: { responseId: response.id, questionId: opt.question.id, optionId: { not: null } }
                        });
                        if (existingQuestionAnswer) continue;
                    }

                    const existingAnswer = await tx.answer.findFirst({
                        where: { responseId: response.id, questionId: opt.question.id, optionId: opt.id }
                    });
                    if (!existingAnswer) {
                        const followUpText = opt.withFollowUp && typeof followUpAnswers?.[opt.id] === 'string'
                            ? followUpAnswers[opt.id].trim()
                            : null;

                        await tx.answer.create({
                            data: { responseId: response.id, questionId: opt.question.id, optionId: opt.id, textValue: followUpText || null }
                        });
                        await tx.option.update({
                            where: { id: opt.id },
                            data: { votes: { increment: 1 } }
                        });
                    }
                }
            }

            if (!existingResponse) {
                await tx.post.update({
                    where: { id },
                    data: { responseCount: { increment: 1 } }
                });
            }
            if (actorUserId && shouldNotify && !finalIsAnonymous) {
                pageVoteNotificationHandled = await notifyPagePostInteraction({ postId: id, actorId: actorUserId, kind: 'vote', optionId: notificationOptionId }, tx);
            }
        });

        if (actorUserId && shouldNotify && !finalIsAnonymous && post.authorId && !pageVoteNotificationHandled) {
            await notify(actorUserId, post.authorId as string, 'vote', 'voted on your post', 'survey', id, { optionId: notificationOptionId });
        }

        res.json({ success: true, newOption: createdCustomOption });
    } catch (error: any) {
        if (respondPagePostError(error,res)) return;
        console.error(error);
        res.status(error?.statusCode || 500).json({ error: error?.statusCode ? error.message : 'Failed to vote' });
    }
};

export const getParticipants = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const limit = parseReadLimit(req.query.limit, 30, 50);
    const cursor = firstQueryString(req.query.cursor)?.trim() || undefined;
    try {
        const id = await resolveInteractionTarget(rawId, 'vote');
        const currentUserId = req.user?.userId;
        const post = await prisma.post.findFirst({
            where: { id, ...buildVisiblePublishedPostWhere(currentUserId) },
            select: {
                forceAnonymous: true,
            } as any
        });
        if (!post) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        if (post && (post as any).forceAnonymous === true) {
            return res.json([]);
        }

        const responses = await prisma.response.findMany({
            where: { postId: id },
            include: { user: { select: SAFE_USER_SELECT } },
            orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
        });
        const hasMore = responses.length > limit;
        if (hasMore) responses.pop();
        applyNextCursorHeader(res, responses, hasMore);
        
        let anonIdx = 1;
        let guestIdx = 1;

        const mapped = responses.map((r: any) => {
            if (r.isAnonymous) {
                 return {
                     id: 'anon-' + r.id,
                     name: `Anonymous ${anonIdx++}`,
                     avatar: null,
                     handle: null,
                     isAnonymous: true,
                     timestamp: r.timestamp
                 };
            }
            if (!r.user) {
                 return {
                     id: 'guest-' + r.id,
                     name: `Guest ${guestIdx++}`,
                     avatar: null,
                     handle: null,
                     isAnonymous: true, // Render as anonymous (hides profile link)
                     timestamp: r.timestamp
                 };
            }
            return {
                 ...serializeUserMediaRecord(r.user),
                 isAnonymous: false,
                 timestamp: r.timestamp
            };
        });
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch participants' });
    }
};

// Reuse the existing results DTO for public and explicitly authorized management reads.
// This contains response answers and demographic bands; it never adds account identities.
const loadPostResultRows = async (client: Prisma.TransactionClient, postId: string) => {
    const responses = await client.response.findMany({
        where: { postId },
        include: { answers: true, user: { select: { birthday: true, country: true, demographics: true } } }
    });
    return responses.map(r => ({
        id: r.id,
        isAnonymous: r.isAnonymous,
        answers: r.answers.map(a => ({ questionId: a.questionId, optionId: a.optionId, textValue: a.textValue })),
        demographics: {
            age: calculateAgeGroupFromDate(r.user?.birthday) || 'Unknown',
            gender: r.user?.demographics?.gender || 'Unknown',
            country: r.user?.country || 'Unknown',
            education: r.user?.demographics?.educationLevel || 'Unknown',
            employment: r.user?.demographics?.employmentType || 'Unknown',
            industry: r.user?.demographics?.industry || 'Unknown',
            sector: r.user?.demographics?.employmentSector || 'Unknown'
        }
    }));
};

/** Called only by the private Page route; query/body flags cannot activate this authority. */
export const getPageManagedPostResults = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) throw new PagePolicyError('AUTH_TOKEN_REQUIRED', 401);
        assertPagesEnabled(userId);
        const pageId = req.params.id as string;
        const postId = req.params.postId as string;
        if (![pageId, postId].every(value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) throw new PagePolicyError('PAGE_POST_NOT_FOUND', 404);
        const rows = await prisma.$transaction(async (tx) => {
            const page = await lockPage(tx, pageId);
            await activePageActor(tx, userId);
            await requirePageCapability(tx, page, userId, 'analytics');
            if (await pageIsBlocked(tx, pageId, userId)) throw new PagePolicyError('PAGE_POST_NOT_FOUND', 404);
            const post = await tx.post.findFirst({ where: { id: postId, pageId, isDeleted: false, status: 'PUBLISHED' }, select: { id: true, sharedFromId: true } });
            if (!post) throw new PagePolicyError('PAGE_POST_NOT_FOUND', 404);
            let resultPostId = post.id;
            if (post.sharedFromId) {
                const source = await tx.post.findFirst({ where: { id: post.sharedFromId, pageId, isDeleted: false, status: 'PUBLISHED' }, select: { id: true } });
                if (!source) throw new PagePolicyError('PAGE_SOURCE_RESULTS_REQUIRE_OWN_ACCESS', 403);
                resultPostId = source.id;
            }
            return loadPostResultRows(tx, resultPostId);
        });
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Vary', 'Authorization');
        res.json(rows);
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        logPostRequestFailure(req, 'page_managed_post_results_failed', error);
        res.status(500).json({ error: 'Failed to fetch post results' });
    }
};

export const getPostResults = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    try {
        const id = await resolveInteractionTarget(rawId, 'vote');
        const currentUserId = req.user?.userId;
        const guestId = req.query.guestId as string | undefined;
        const post = await prisma.post.findFirst({
            where: { id, ...buildVisiblePublishedPostWhere(currentUserId) },
            select: {
                authorId: true, pageId: true,
                resultsWho: true,
                resultsTiming: true,
                expiresAt: true,
            }
        });

        if (!post) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const isAuthor = post.pageId ? await hasPostPageCapability(post.pageId,currentUserId,'analytics') : !!currentUserId && post.authorId === currentUserId;
        const responseIdentity = currentUserId ? { userId: currentUserId } : guestId ? { guestId } : null;
        const [follow, viewerResponse] = await Promise.all([
            !isAuthor && post.resultsWho === 'Followers' && currentUserId
                ? post.pageId ? isPageFollower(post.pageId,currentUserId).then(follows => follows ? {status:'ACTIVE'} : null) : prisma.follow.findUnique({
                    where: { followerId_followingId: { followerId: currentUserId, followingId: post.authorId } },
                    select: { status: true }
                })
                : Promise.resolve(null),
            responseIdentity
                ? prisma.response.findFirst({
                    where: { postId: id, ...responseIdentity },
                    select: { id: true }
                })
                : Promise.resolve(null)
        ]);

        let whoPasses = isAuthor || !post.resultsWho || post.resultsWho === 'Public';

        if (!whoPasses && post.resultsWho === 'Followers') {
            whoPasses = follow?.status === 'ACTIVE';
        }

        if (!whoPasses && post.resultsWho === 'Participants') {
            whoPasses = Boolean(viewerResponse);
        }

        if (!whoPasses) {
            res.status(403).json({ error: 'You do not have access to these results' });
            return;
        }

        const timing = post.resultsTiming || 'AnyTime';
        const timingPasses = isAuthor
            || timing === 'AnyTime'
            || (timing === 'AfterEnd' && post.expiresAt.getTime() <= Date.now())
            || (timing === 'Immediately' && !!viewerResponse);

        if (!timingPasses) {
            res.status(403).json({ error: 'Results are not available yet' });
            return;
        }

        res.json(await loadPostResultRows(prisma, id));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch post results' });
    }
};

const mapComment = (c: any, currentUserId?: string) => {
    const user = serializeUserMediaRecord(c.user);
    return {
        id: c.id,
        text: c.text,
        pageId:c.pageId, pageCapabilities:c.pageCapabilities,
        author: {
            id: user?.id || 'unknown',
            kind: user?.kind,
            name: user?.name || 'Unknown',
            avatar: user?.avatar || '',
            avatarMediaId: user?.avatarMediaId,
            avatarMedia: user?.avatarMedia,
            handle: user?.handle || '',
            verifiedBadge: user?.verifiedBadge || false
        },
        timestamp: c.createdAt.toISOString(),
        likes: c.likes || 0,
        mentions: serializeMentionReferences(c.mentions),
        isLiked: currentUserId && c.likesList ? c.likesList.some((l: any) => l.userId === currentUserId) : false,
        replies: c.replies ? c.replies.map((r: any) => mapComment(r, currentUserId)) : []
    };
};

export const getComments = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const userId = req.user?.userId;
    const limit = parseReadLimit(req.query.limit, 30, 50);
    const cursor = firstQueryString(req.query.cursor)?.trim() || undefined;
    const focusId = firstQueryString(req.query.focusId)?.trim() || undefined;
    try {
        const id = await resolveInteractionTarget(rawId, 'comment');
        const commentTarget = await prisma.post.findFirst({
            where: { id, ...buildVisiblePublishedPostWhere(userId) },
            select: {
                id: true
            }
        });

        if (!commentTarget) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const commentInclude = {
            user: { select: SAFE_USER_SELECT },
            mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
            likesList: userId ? { where: { userId }, take: 1, select: { userId: true } } : false,
            replies: {
                orderBy: { createdAt: 'asc' as const },
                include: {
                    user: { select: SAFE_USER_SELECT },
                    mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                    likesList: userId ? { where: { userId }, take: 1, select: { userId: true } } : false
                }
            }
        } satisfies Prisma.CommentInclude;

        const [commentPage, focusedComment] = await Promise.all([
            prisma.comment.findMany({
                where: { postId: id, parentId: null },
                take: limit + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                include: commentInclude,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
            }),
            focusId && !cursor
                ? prisma.comment.findFirst({
                    where: {
                        postId: id,
                        parentId: null,
                        OR: [{ id: focusId }, { replies: { some: { id: focusId } } }]
                    },
                    include: commentInclude
                })
                : Promise.resolve(null)
        ]);
        const hasMore = commentPage.length > limit;
        if (hasMore) commentPage.pop();
        applyNextCursorHeader(res, commentPage, hasMore);

        if (focusedComment && !commentPage.some(comment => comment.id === focusedComment.id)) {
            commentPage.push(focusedComment);
        }
        await attachPageCommentPublishers(commentPage,userId);
        res.json(commentPage.map(c => mapComment(c, userId)));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
};

export const createComment = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const { text, content, parentId } = req.body;
    try {
        const id = await resolveInteractionTarget(rawId, 'comment');
        const userId = req.user!.userId;

        const commentTarget = await prisma.post.findUnique({
            where: { id },
            select: {
                allowComments: true,
                authorId: true, pageId:true,
                targetAudience: true,
                targetedGroups: { select: { id: true } },
                status: true,
                isDeleted: true
            }
        });

        if (!commentTarget || commentTarget.isDeleted || commentTarget.status !== 'PUBLISHED') {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        if (commentTarget.allowComments === false) {
            res.status(403).json({ error: 'Comments are disabled for this post' });
            return;
        }

        const officialPageId = req.body.pageId || null;
        const targetGroupIds = mapTargetGroups(commentTarget);
        const needsPageRole = !!officialPageId || commentTarget.targetAudience !== 'Public' || targetGroupIds.length > 0;
        const isAuthor = commentTarget.pageId
            ? needsPageRole && await hasPostPageCapability(commentTarget.pageId, userId, 'reply')
            : commentTarget.authorId === userId;
        if (officialPageId && (officialPageId !== commentTarget.pageId || !isAuthor)) throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
        if (isProfileAndGroups(commentTarget.targetAudience) && !(await canInteractWithProfileAndGroups(id, commentTarget.authorId, userId, targetGroupIds))) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        if (!isProfileAndGroups(commentTarget.targetAudience) && !isAuthor && (commentTarget.targetAudience === 'Groups' || targetGroupIds.length > 0)) {
            const membership = await prisma.groupMember.findFirst({
                where: { userId, groupId: { in: targetGroupIds }, status: 'JOINED' }
            });
            if (!membership) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        if (!isAuthor && commentTarget.targetAudience === 'Followers') {
            const follow = commentTarget.pageId ? await isPageFollower(commentTarget.pageId,userId) : await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: userId, followingId: commentTarget.authorId } }
            });
            if (!follow) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        const bodyText = text !== undefined ? text : content;
        const cleanText = typeof bodyText === 'string' ? bodyText.trim() : '';
        if (!cleanText) {
            res.status(400).json({ error: 'Comment text is required' });
            return;
        }

        if (!validateMentionRecipientLimit(cleanText, res, 'comment')) return;

        // Only newly inserted Page comments can have no previous text relations.
        // Editing a comment always reconciles removals, even when its new text is plain.
        const pageCommentEntities = commentTarget.pageId ? parseTextEntities(cleanText) : null;

        let parentComment: { postId: string; userId: string } | null = null;
        if (parentId) {
            parentComment = await prisma.comment.findUnique({
                where: { id: parentId },
                select: { postId: true, userId: true }
            });
            if (!parentComment) {
                res.status(400).json({ error: 'Parent comment not found' });
                return;
            }
            if (parentComment.postId !== id) {
                res.status(400).json({ error: 'Parent comment does not belong to the same post' });
                return;
            }
        }

        const transactionResult = await prisma.$transaction(async (tx) => {
            if (officialPageId) {
                // Role-authorized replies retain exclusive Page locks throughout.
                if (rawId !== id) await guardPagePostPersistence(tx,rawId,userId);
                await guardPagePostPersistence(tx,id,userId);
                const page=await lockPage(tx,officialPageId);await requirePageCapability(tx,page,userId,'reply');
            } else await guardPagePostInteractions(tx,[rawId,id],userId);
            if(commentTarget.pageId && !(await tx.post.findUnique({where:{id},select:{allowComments:true}}))?.allowComments) throw new PagePolicyError('PAGE_COMMENTS_DISABLED',403);
            if (commentTarget.pageId && parentId && !await tx.comment.count({ where: { id: parentId, postId: id } })) throw new PagePolicyError('COMMENT_NOT_FOUND',404);
            const createdComment = await tx.comment.create({
                data: { text: cleanText, userId, postId: id, parentId, pageId:officialPageId }
            });
            const targetPost = await tx.post.update({
                where: { id },
                data: { commentsCount: { increment: 1 } }
            });
            const mentionResult = pageCommentEntities && !pageCommentEntities.some(entity => entity.type === 'mention')
                ? { targetUserIds: [] as string[], notificationIds: [] as string[], created: 0, retained: 0, removed: 0, unresolved: 0, ineligible: 0 }
                : await reconcileCommentMentions(tx, {
                postId: id,
                commentId: createdComment.id,
                actorUserId: userId,
                isReply: Boolean(parentId),
                parentCommentId: parentId || undefined,
                text: cleanText
            });
            if (!pageCommentEntities || pageCommentEntities.some(entity => entity.type === 'hashtag')) {
                await reconcileCommentHashtags(tx, createdComment.id, cleanText);
            }
            const comment = await tx.comment.findUniqueOrThrow({
                where: { id: createdComment.id },
                include: {
                    user: { select: SAFE_USER_SELECT },
                    mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                    likesList: { select: { userId: true } },
                    replies: true
                }
            });
            const pageNotificationHandled = await notifyPagePostInteraction({ postId: id, actorId: userId, kind: parentId ? 'reply' : 'comment', commentId: createdComment.id, parentCommentId: parentId || undefined, excludedRecipientIds: mentionResult.targetUserIds }, tx);
            return { comment, targetPost, mentionResult, pageNotificationHandled };
        });
        const { comment, targetPost, mentionResult } = transactionResult;

        await dispatchNotificationIds(mentionResult.notificationIds);

        const commentNavigation = parentId
            ? { postId: id, commentId: parentId, replyId: comment.id, sourceType: 'reply' }
            : { postId: id, commentId: comment.id, sourceType: 'comment' };

        const conversationalRecipientId = parentComment?.userId || targetPost.authorId;
        if (!transactionResult.pageNotificationHandled && conversationalRecipientId && !mentionResult.targetUserIds.includes(conversationalRecipientId)) {
            await notify(
                userId,
                conversationalRecipientId,
                'response',
                parentId ? 'replied to your comment' : 'commented on your post',
                'post',
                id,
                commentNavigation,
                { dedupe: true }
            );
        }

        await attachPageCommentPublishers([comment],userId);
        res.json(mapComment(comment, userId));
    } catch (error) {
        if(respondPagePostError(error,res))return;
        if (error instanceof MentionLimitError || error instanceof HashtagLimitError) {
            res.status(400).json({ error: error.message, code: 'SOCIAL_TEXT_LIMIT_EXCEEDED', limit: error.limit });
            return;
        }
        console.error('Create comment failed:', error);
        res.status(500).json({ error: 'Failed to create comment' });
    }
};

export const likePost = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const id = await resolveInteractionTarget(rawId, 'like');
        const targetPostCheck = await prisma.post.findUnique({ where: { id }, select: { authorId: true, targetAudience: true, pageId: true } });
        if (targetPostCheck && !targetPostCheck.pageId && targetPostCheck.authorId) {
            const canView = isProfileAndGroups(targetPostCheck.targetAudience)
                ? await GroupPermissionService.canViewPost(id, userId)
                : await PrivacyService.canViewUserContent(userId, targetPostCheck.authorId);
            if (!canView) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }
        const result = await prisma.$transaction(async (tx) => {
            await guardPagePostInteractions(tx, [rawId,id], userId);
            const existing = await tx.userLike.findUnique({ where: { userId_postId: { userId, postId: id } } });
            if (existing) {
                await tx.userLike.delete({ where: { userId_postId: { userId, postId: id } } });
            } else {
                await tx.userLike.create({ data: { userId, postId: id } });
            }
            const targetPost = await tx.post.update({ where: { id }, data: { likesCount: existing ? { decrement: 1 } : { increment: 1 } } });
            const pageNotificationHandled = !existing && await notifyPagePostInteraction({ postId: id, actorId: userId, kind: 'like' }, tx);
            return { isLiked: !existing, targetPost, pageNotificationHandled };
        });
        if (result.isLiked && result.targetPost.authorId && !result.pageNotificationHandled) {
            await notify(userId, result.targetPost.authorId, 'like', 'liked your post', 'survey', id);
        }
        res.json({ isLiked: result.isLiked });
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        res.status(500).json({ error: 'Failed to like post' });
    }
};

export const likeComment = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const result = await prisma.$transaction(async (tx) => {
            const comment = await tx.comment.findUnique({ where: { id }, select: { postId: true } });
            if (!comment) throw new PagePolicyError('COMMENT_NOT_FOUND', 404);
            await guardPagePostInteractions(tx, [comment.postId], userId);
            if (!await tx.comment.count({ where: { id, postId: comment.postId } })) throw new PagePolicyError('COMMENT_NOT_FOUND', 404);
            const existing = await tx.commentLike.findUnique({ where: { userId_commentId: { userId, commentId: id } } });
            if (existing) await tx.commentLike.delete({ where: { userId_commentId: { userId, commentId: id } } });
            else await tx.commentLike.create({ data: { userId, commentId: id } });
            const targetComment = await tx.comment.update({ where: { id }, data: { likes: existing ? { decrement: 1 } : { increment: 1 } } });
            const pageNotificationHandled = !existing && await notifyPagePostInteraction({ postId: comment.postId, actorId: userId, kind: 'comment_like', commentId: id }, tx);
            return { isLiked: !existing, targetComment, pageNotificationHandled };
        });
        if (result.isLiked && !result.pageNotificationHandled) {
            const targetComment = result.targetComment;
            if (targetComment.userId) {
                const commentNavigation = targetComment.parentId
                    ? { postId: targetComment.postId, commentId: targetComment.parentId, replyId: id, sourceType: 'reply' }
                    : { postId: targetComment.postId, commentId: id, sourceType: 'comment' };
                await notify(userId, targetComment.userId, 'like', 'liked your comment', 'post', targetComment.postId, commentNavigation);
            }
        }
        res.json({ isLiked: result.isLiked });
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        res.status(500).json({ error: 'Failed to like comment' });
    }
};

export const getPostLikers = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const limit = parseReadLimit(req.query.limit, 30, 50);
    const cursor = firstQueryString(req.query.cursor)?.trim() || undefined;
    try {
        const id = await resolveInteractionTarget(rawId, 'like');
        const currentUserId = req.user?.userId;
        const targetPost = await prisma.post.findFirst({
            where: { id, ...buildVisiblePublishedPostWhere(currentUserId) },
            select: { id: true }
        });
        if (!targetPost) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }
        const likes = await prisma.userLike.findMany({
            where: { postId: id },
            include: { user: { select: SAFE_USER_SELECT } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
        });
        const hasMore = likes.length > limit;
        if (hasMore) likes.pop();
        applyNextCursorHeader(res, likes, hasMore);
        res.json(likes.map(l => serializeUserMediaRecord(l.user)));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch likers' });
    }
};

export const getCommentLikers = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;
    const limit = parseReadLimit(req.query.limit, 30, 50);
    const cursor = firstQueryString(req.query.cursor)?.trim() || undefined;
    try {
        const likes = await prisma.commentLike.findMany({
            where: {
                commentId: id,
                comment: { post: buildVisiblePublishedPostWhere(currentUserId) }
            },
            include: { user: { select: SAFE_USER_SELECT } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
        });
        const hasMore = likes.length > limit;
        if (hasMore) likes.pop();
        applyNextCursorHeader(res, likes, hasMore);
        res.json(likes.map(l => serializeUserMediaRecord(l.user)));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch comment likers' });
    }
};

export const savePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const targetPost = await prisma.post.findFirst({
            where: { id, ...buildVisiblePublishedPostWhere(userId) },
            select: { id: true }
        });
        if (!targetPost) {
            res.status(404).json({ error: 'Post not found or unavailable' });
            return;
        }

        await prisma.$transaction(async (tx) => {
        await guardPagePostPersistence(tx, id, userId);
        await tx.savedPost.upsert({
            where: { userId_postId: { userId, postId: id } },
            update: {},
            create: { userId, postId: id }
        });
        });
        res.json({ isSaved: true });
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        res.status(500).json({ error: 'Failed to save post' });
    }
};

export const unsavePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    try {
        await prisma.savedPost.deleteMany({ where: { userId, postId: id } });
        res.json({ isSaved: false });
    } catch {
        res.status(500).json({ error: 'Failed to remove saved post' });
    }
};

export const hidePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const existingHiddenPost = await prisma.hiddenPost.findUnique({
            where: { userId_postId: { userId, postId: id } },
            select: { postId: true }
        });
        if (existingHiddenPost) {
            res.json({ success: true, isHidden: true });
            return;
        }

        const targetPost = await prisma.post.findFirst({
            where: { id, ...buildVisiblePublishedPostWhere(userId) },
            select: { id: true, authorId: true, pageId: true }
        });
        if (!targetPost) {
            res.status(404).json({ error: 'Post not found or unavailable' });
            return;
        }
        if (!targetPost.pageId && targetPost.authorId === userId) {
            res.status(400).json({ error: 'You cannot hide your own post', code: 'CANNOT_HIDE_OWN_POST' });
            return;
        }

        await prisma.$transaction(async (tx) => {
        await guardPagePostPersistence(tx, id, userId);
        await tx.hiddenPost.upsert({
            where: { userId_postId: { userId, postId: id } },
            update: {},
            create: { userId, postId: id }
        });
        });
        res.json({ success: true, isHidden: true });
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        res.status(500).json({ error: 'Failed to hide post' });
    }
};

export const unhidePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    try {
        await prisma.hiddenPost.deleteMany({ where: { userId, postId: id } });
        res.json({ success: true, isHidden: false });
    } catch {
        res.status(500).json({ error: 'Failed to restore post' });
    }
};

export const reportPost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const reporterId = req.user!.userId;
    try {
        const { reason, description } = normalizePostReportInput(req.body.reason, req.body.description);
        const targetPost = await prisma.post.findFirst({
            where: { id, ...buildVisiblePublishedPostWhere(reporterId) },
            select: {
                id: true,
                authorId: true,
                title: true,
                pageId: true,
                description: true,
                type: true,
                createdAt: true
            }
        });
        if (!targetPost) {
            res.status(404).json({ error: 'Post not found or unavailable' });
            return;
        }
        if (!targetPost.pageId && targetPost.authorId === reporterId) {
            res.status(400).json({ error: 'You cannot report your own post', code: 'CANNOT_REPORT_OWN_POST' });
            return;
        }

        const existingReport = await prisma.report.findFirst({
            where: { reporterId, targetType: 'POST', targetId: id },
            orderBy: { createdAt: 'asc' },
            select: { id: true, status: true, createdAt: true }
        });
        if (existingReport) {
            res.json({ report: existingReport, alreadyReported: true });
            return;
        }

        const report = await prisma.$transaction(async (tx) => {
        await guardPagePostPersistence(tx, id, reporterId);
        return tx.report.upsert({
            where: { dedupeKey: buildPostReportDedupeKey(reporterId, id) },
            update: {},
            create: {
                targetId: id,
                targetType: 'POST',
                reporterId,
                dedupeKey: buildPostReportDedupeKey(reporterId, id),
                reason,
                description,
                targetSnapshot: {
                    title: targetPost.title,
                    description: targetPost.description,
                    type: targetPost.type,
                    authorId: targetPost.pageId || targetPost.authorId,
                    createdAt: targetPost.createdAt.toISOString()
                }
            },
            select: { id: true, status: true, createdAt: true }
        });
        });
        res.json({ report, alreadyReported: false });
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        console.error(error);
        if (error instanceof PostOptionValidationError) {
            res.status(error.statusCode).json({ error: error.message, code: error.code });
            return;
        }
        res.status(500).json({ error: 'Failed to report post' });
    }
};

export const sharePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    const cleanCaption = typeof req.body.caption === 'string' ? req.body.caption.trim() : '';
    try {
        const publisherPageId = req.body.pageId == null ? null : req.body.pageId;
        if (publisherPageId !== null && (typeof publisherPageId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publisherPageId))) {
            throw new PagePolicyError('PAGE_ID_INVALID', 400);
        }
        if (publisherPageId) {
            assertPageDestination(req.body);
            await authorizePagePublisher(prisma, publisherPageId, userId, { ...req.body, status: 'PUBLISHED' });
        }
        const shareRequestKey = publisherPageId ? pagePostRequestKey(req.body.pageCreateKey) : null;
        const captionHash = createHash('sha256').update(cleanCaption).digest('hex');
        if (cleanCaption && !validateMentionRecipientLimit(cleanCaption, res, 'post')) return;

        const originalPost = await prisma.post.findUnique({
            where: { id },
            include: {
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                targetedGroups: true,
                author: { select: { isPrivate: true, mediaPrivacyTarget: true } }
            }
        });
        if (!originalPost || (originalPost as any).isDeleted) {
            res.status(404).json({ error: 'Original post not found or has been deleted' });
            return;
        }

        const originalAudience = (originalPost.targetAudience || 'Public').trim().toLowerCase();
        if (!['public', ''].includes(originalAudience)
            || originalPost.groupId
            || originalPost.targetedGroups.length > 0
            || (!originalPost.pageId && originalPost.author.isPrivate)
            || (!originalPost.pageId && originalPost.author.mediaPrivacyTarget === true)) {
            res.status(403).json({ error: 'Cannot share private or group content' });
            return;
        }

        if (!originalPost.pageId && originalPost.authorId) {
            const canView = await PrivacyService.canViewUserContent(userId, originalPost.authorId);
            if (!canView) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        const actualSharedFromId = originalPost.sharedFromId ? originalPost.sharedFromId : originalPost.id;
        const visibleSourceCount = await prisma.post.count({
            where: {
                id: actualSharedFromId,
                ...buildVisiblePublishedPostWhere(userId)
            }
        });
        if (visibleSourceCount === 0) {
            res.status(403).json({ error: 'Cannot share content you cannot access' });
            return;
        }

        const sourceRefs = await prisma.post.findMany({ where: { id: { in: [...new Set([id, actualSharedFromId])] } }, select: { id: true, authorId: true, pageId: true } });
        const involvesPage = !!publisherPageId || sourceRefs.some(source => !!source.pageId);
        const shareAction = async (tx: Prisma.TransactionClient) => {
            // Lock both publisher and source in the same order as lifecycle mutations.
            const pageIds = [...new Set([publisherPageId, ...sourceRefs.map(source => source.pageId)].filter((value): value is string => Boolean(value)))].sort();
            for (const pageId of pageIds) await lockPage(tx, pageId);
            let sharedTemplate = originalPost;
            if (involvesPage) {
                // FOR UPDATE (not FOR SHARE) also conflicts with foreign-key KEY SHARE
                // taken by a new personal block or group-destination relation.
                const userIds = [...new Set([userId, ...sourceRefs.filter(source => !source.pageId).map(source => source.authorId)])].sort();
                await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`);
                const sourceIds = [...new Set([id, actualSharedFromId])].sort();
                await tx.$queryRaw(Prisma.sql`SELECT id FROM "Post" WHERE id IN (${Prisma.join(sourceIds)}) ORDER BY id FOR UPDATE`);
                const currentSources = await tx.post.findMany({ where: { id: { in: sourceIds } }, include: { questions: { include: { options: { orderBy: { order: 'asc' } } } }, targetedGroups: true, author: { select: { isPrivate: true, mediaPrivacyTarget: true } } } });
                if (currentSources.length !== sourceIds.length) throw new PagePolicyError('PAGE_SHARE_SOURCE_UNAVAILABLE', 404);
                for (const current of currentSources) {
                    const prior = sourceRefs.find(source => source.id === current.id);
                    if (!prior || prior.authorId !== current.authorId || prior.pageId !== current.pageId) throw new PagePolicyError('PAGE_SHARE_SOURCE_CHANGED', 409);
                    if (current.isDeleted || current.status !== 'PUBLISHED' || !['public', ''].includes((current.targetAudience || '').trim().toLowerCase()) || current.groupId || current.targetedGroups.length || (!current.pageId && (current.author.isPrivate || current.author.mediaPrivacyTarget))) throw new PagePolicyError('PAGE_SHARE_SOURCE_UNAVAILABLE', 403);
                }
                if (await tx.post.count({ where: { id: { in: sourceIds }, ...buildVisiblePublishedPostWhere(userId) } }) !== sourceIds.length) throw new PagePolicyError('PAGE_SHARE_SOURCE_UNAVAILABLE', 403);
                sharedTemplate = currentSources.find(source => source.id === id)!;
                if ((sharedTemplate.sharedFromId || sharedTemplate.id) !== actualSharedFromId) throw new PagePolicyError('PAGE_SHARE_SOURCE_CHANGED',409);
            }
            if (publisherPageId) await authorizePagePublisher(tx, publisherPageId, userId, { ...req.body, status: 'PUBLISHED' });
            await guardPagePostPersistence(tx,id,userId);
            await guardPagePostPersistence(tx,actualSharedFromId,userId);
            if (publisherPageId && shareRequestKey) {
                const receipt = await tx.pageAuditEvent.findUnique({ where: { id: shareRequestKey } });
                if (receipt) {
                    const outcome = receipt.data as { captionHash?: string; postId?: string; unshared?: boolean };
                    if (receipt.pageId !== publisherPageId || receipt.actorId !== userId || receipt.action !== 'SHARE_COMPLETED' || receipt.targetId !== actualSharedFromId || outcome.captionHash !== captionHash) throw new PagePolicyError('PAGE_REQUEST_KEY_CONFLICT', 409);
                    if (outcome.unshared) return { newPost: null, notificationIds: [] as string[] };
                    const replay = outcome.postId ? await tx.post.findUnique({ where: { id: outcome.postId }, select: { id: true, isDeleted: true, pageId: true } }) : null;
                    if (!replay || replay.isDeleted || replay.pageId !== publisherPageId) throw new PagePolicyError('PAGE_REQUEST_ALREADY_COMPLETED', 409);
                    return { newPost: { id: replay.id }, notificationIds: [] as string[] };
                }
            }
            if (!cleanCaption) {
                const existingRepost = await tx.post.findFirst({ where: {
                    ...(publisherPageId ? { pageId: publisherPageId } : { authorId: userId, pageId: null }),
                    sharedFromId: actualSharedFromId, sharedCaption: null, isDeleted: false
                } });
                if (existingRepost) {
                    await tx.post.delete({ where: { id: existingRepost.id } });
                    await tx.post.update({ where: { id: actualSharedFromId }, data: { sharesCount: { decrement: 1 } } });
                    if (publisherPageId) await pageAudit(tx, publisherPageId, userId, 'CONTENT_UNSHARED', existingRepost.id);
                    if (publisherPageId && shareRequestKey) await tx.pageAuditEvent.create({ data: { id: shareRequestKey, pageId: publisherPageId, actorId: userId, action: 'SHARE_COMPLETED', targetId: actualSharedFromId, data: { captionHash, unshared: true } } });
                    return { newPost: null, notificationIds: [] as string[] };
                }
            }
            const newPost = await tx.post.create({
                data: {
                    title: sharedTemplate.title,
                    description: sharedTemplate.description,
                    type: sharedTemplate.type,
                    authorId: userId,
                    pageId: publisherPageId,
                    expiresAt: sharedTemplate.expiresAt,
                    image: null,
                    category: sharedTemplate.category,
                    targetAudience: sharedTemplate.targetAudience,
                    pollChoiceType: sharedTemplate.pollChoiceType,
                    imageLayout: sharedTemplate.imageLayout,
                    sharedFromId: actualSharedFromId,
                    sharedCaption: cleanCaption || null,
                    visibility: 'PUBLIC',
                    status: 'PUBLISHED',
                    allowAnonymous: sharedTemplate.allowAnonymous,
                    forceAnonymous: sharedTemplate.forceAnonymous,
                    allowComments: sharedTemplate.allowComments,
                    allowMultipleSelection: sharedTemplate.allowMultipleSelection,
                    allowUserOptions: sharedTemplate.allowUserOptions,
                    randomPairing: (sharedTemplate as any).randomPairing,
                    resultsWho: sharedTemplate.resultsWho,
                    resultsTiming: sharedTemplate.resultsTiming,
                    targetedGroups: sharedTemplate.targetedGroups.length > 0 ? {
                        connect: sharedTemplate.targetedGroups.map((g: any) => ({ id: g.id }))
                    } : undefined
                }
            });
            if (publisherPageId) await pageAudit(tx, publisherPageId, userId, 'CONTENT_CREATED', newPost.id);
            if (publisherPageId && shareRequestKey) await tx.pageAuditEvent.create({ data: { id: shareRequestKey, pageId: publisherPageId, actorId: userId, action: 'SHARE_COMPLETED', targetId: actualSharedFromId, data: { captionHash, postId: newPost.id, unshared: false } } });
            await tx.post.update({
                where: { id: actualSharedFromId },
                data: { sharesCount: { increment: 1 } }
            });
            const mentionResult = await reconcilePostMentions(tx, {
                postId: newPost.id,
                actorUserId: userId,
                state: MentionState.ACTIVE,
                surfaces: getPostMentionSurfaces(newPost)
            });
            await reconcilePostHashtags(tx, newPost.id, getPostHashtagTexts(newPost));
            return {
                newPost,
                notificationIds: mentionResult.notificationIds
            };
        };
        let transactionResult;
        for (let attempt = 0; ; attempt++) {
            try {
                transactionResult = await prisma.$transaction(shareAction, involvesPage ? { isolationLevel: 'ReadCommitted', timeout: 15000, maxWait: 5000 } : undefined);
                break;
            } catch (error) {
                const conflict = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2010' && ['40P01','40001'].includes(String(error.meta?.code)));
                if (!involvesPage || !conflict || attempt >= 2) throw error;
            }
        }
        await dispatchNotificationIds(transactionResult.notificationIds);
        const newPost = transactionResult.newPost;
        if (!newPost) {
            res.json({ success: true, action: 'unshared' });
            return;
        }

        const createdPost = await prisma.post.findFirst({
            where: { id: newPost.id, ...(involvesPage ? buildVisiblePublishedPostWhere(userId) : {}) },
            include: {
                author: { select: SAFE_USER_SELECT },
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                media: POST_MEDIA_INCLUDE,
                targetedGroups: true,
                mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                taggedUsers: getVisiblePeopleTagsInclude(userId),
                sharedFrom: {
                    include: {
                        author: {
                            select: {
                                ...SAFE_USER_SELECT,
                                following: userId ? {
                                    where: { followerId: userId, status: 'ACTIVE' },
                                    select: { followerId: true }
                                } : false
                            }
                        },
                        questions: { include: { options: { orderBy: { order: 'asc' } } } },
                        sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                        media: POST_MEDIA_INCLUDE,
                        targetedGroups: true,
                        mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                        taggedUsers: getVisiblePeopleTagsInclude(userId)
                    }
                }
            }
        });

        if (!createdPost) {
            res.status(involvesPage ? 404 : 500).json({ error: involvesPage ? 'Shared post is no longer available' : 'Failed to retrieve shared post' });
            return;
        }

        await attachPagePublishers([createdPost],userId);
        const p = serializePostSocialRecord(createdPost as any, userId);
        
        let mappedSharedFrom: any = undefined;
        if (p.sharedFrom) {
            mappedSharedFrom = {
                ...p.sharedFrom,
                options: ['Poll', 'Challenge', 'Prediction', 'Debate'].includes(normalizePostType(p.sharedFrom.type) || '') && p.sharedFrom.questions?.length > 0 ? p.sharedFrom.questions[0].options : [],
                demographics: parseJsonArray(p.sharedFrom.demographics),
                author: p.sharedFrom.author ? {
                    ...p.sharedFrom.author,
                    isFollowing: userId ? (p.sharedFrom.author.following && p.sharedFrom.author.following.length > 0) : false
                } : undefined,
                likes: p.sharedFrom.likesCount,
                repostCount: p.sharedFrom.sharesCount || 0,
                participants: p.sharedFrom.responseCount,
                randomPairing: p.sharedFrom.randomPairing,
                targetGroups: mapTargetGroups(p.sharedFrom),
                hasParticipated: userId ? !!(p.sharedFrom.responses && p.sharedFrom.responses.length > 0) : false,
                userSelectedOptions: (p.sharedFrom.responses && p.sharedFrom.responses.length > 0) ? mapAnswerOptionIds(p.sharedFrom.responses[0].answers || []) : [],
                isLiked: userId ? (p.sharedFrom.likes && p.sharedFrom.likes.length > 0) : false,
                hasReposted: userId ? (p.sharedFrom.shares && p.sharedFrom.shares.length > 0) : false,
                isSaved: userId ? (p.sharedFrom.savedBy && p.sharedFrom.savedBy.length > 0) : false
            };
        }

        const mappedPost = {
            ...p,
            sharedFrom: mappedSharedFrom || p.sharedFrom,
            likes: p.likesCount || 0,
            repostCount: p.sharesCount || 0,
            participants: p.responseCount || 0,
            coverImage: p.coverImage,
            options: ['Poll', 'Challenge', 'Prediction', 'Debate'].includes(normalizePostType(p.type) || '') && p.questions && p.questions.length > 0 ? p.questions[0].options : [],
            author: {
                ...p.author,
                isFollowing: false
            },
            allowAnonymous: p.allowAnonymous,
            forceAnonymous: p.forceAnonymous,
            randomPairing: p.randomPairing,
            demographics: parseJsonArray(p.demographics),
            targetGroups: mapTargetGroups(p)
        };

        if (involvesPage && !await prisma.post.count({ where: { id: newPost.id, ...buildVisiblePublishedPostWhere(userId) } })) throw new PagePolicyError('PAGE_SHARE_SOURCE_UNAVAILABLE', 404);
        res.json(mappedPost);
    } catch (error) {
        if (respondPagePostError(error,res)) return;
        if (error instanceof MentionLimitError || error instanceof HashtagLimitError || error instanceof PeopleTagValidationError) {
            res.status(400).json({
                error: error.message,
                code: error instanceof PeopleTagValidationError ? error.code : 'SOCIAL_TEXT_LIMIT_EXCEEDED',
                limit: 'limit' in error ? error.limit : undefined
            });
            return;
        }
        console.error("Shared Post Error:", error);
        res.status(500).json({ error: 'Failed to share post' });
    }
};

export const acceptPeopleTag = async (req: Request, res: Response) => {
    const tagId = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const tag = await prisma.postTaggedUser.findUnique({ where: { id: tagId } });
        if (!tag) return res.status(404).json({ error: 'People tag not found' });
        if (tag.taggedUserId !== userId) {
            return res.status(403).json({ error: 'Only the tagged user can accept this tag' });
        }
        if (tag.status === PeopleTagStatus.REMOVED || tag.status === PeopleTagStatus.REJECTED) {
            return res.status(409).json({ error: 'This people tag is no longer pending' });
        }

        const updated = await prisma.$transaction(async (tx) => {
            await guardPagePostPersistence(tx, tag.postId, userId);
            const current = await tx.postTaggedUser.findUnique({ where: { id: tagId }, include: { post: { select: { pageId: true } } } });
            if (!current) throw new PagePolicyError('PEOPLE_TAG_NOT_FOUND', 404);
            if (current.taggedUserId !== userId) throw new PagePolicyError('PEOPLE_TAG_PERMISSION_DENIED', 403);
            if (current.status === PeopleTagStatus.REMOVED || current.status === PeopleTagStatus.REJECTED) throw new PagePolicyError('PEOPLE_TAG_NOT_PENDING', 409);
            const accepted = await tx.postTaggedUser.update({
                where: { id: tagId },
                data: {
                    status: PeopleTagStatus.ACCEPTED,
                    acceptedAt: current.acceptedAt || new Date(),
                    rejectedAt: null,
                    removedAt: null
                },
                include: {
                    taggedUser: { select: SAFE_USER_SELECT }
                }
            });
            if (current.notificationId) {
                const notification = await tx.notification.findUnique({
                    where: { id: current.notificationId },
                    select: { payload: true }
                });
                if (notification) {
                    await tx.notification.update({
                        where: { id: current.notificationId },
                        data: {
                            payload: JSON.stringify({
                                ...parseNotificationPayload(notification.payload),
                                peopleTagStatus: PeopleTagStatus.ACCEPTED
                            })
                        }
                    });
                }
            }
            return current.post.pageId ? { ...accepted, taggedByUserId: undefined } : accepted;
        });

        res.json(serializePeopleTags([updated])[0]);
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        console.error('Accept People Tag Error:', error);
        res.status(500).json({ error: 'Failed to accept people tag' });
    }
};

export const rejectPeopleTag = async (req: Request, res: Response) => {
    const tagId = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const tag = await prisma.postTaggedUser.findUnique({ where: { id: tagId } });
        if (!tag) return res.status(404).json({ error: 'People tag not found' });
        if (tag.taggedUserId !== userId) {
            return res.status(403).json({ error: 'Only the tagged user can reject this tag' });
        }
        if (tag.status === PeopleTagStatus.REMOVED) {
            return res.status(409).json({ error: 'This people tag has already been removed' });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const post = await tx.post.findUnique({ where: { id: tag.postId }, select: { pageId: true } });
            if (post?.pageId) { await lockPage(tx, post.pageId); await activePageActor(tx, userId); }
            // Removing one's own tag remains possible after the Page is hidden.
            const current = await tx.postTaggedUser.findUnique({ where: { id: tagId } });
            if (!current) throw new PagePolicyError('PEOPLE_TAG_NOT_FOUND', 404);
            if (current.taggedUserId !== userId) throw new PagePolicyError('PEOPLE_TAG_PERMISSION_DENIED', 403);
            if (current.status === PeopleTagStatus.REMOVED) throw new PagePolicyError('PEOPLE_TAG_ALREADY_REMOVED', 409);
            if (current.notificationId) {
                await tx.notification.deleteMany({ where: { id: current.notificationId } });
            }
            const rejected = await tx.postTaggedUser.update({
                where: { id: tagId },
                data: {
                    status: PeopleTagStatus.REJECTED,
                    acceptedAt: null,
                    rejectedAt: current.rejectedAt || new Date(),
                    removedAt: null,
                    notificationId: null
                },
                include: {
                    taggedUser: { select: SAFE_USER_SELECT }
                }
            });
            return post?.pageId ? { ...rejected, taggedByUserId: undefined } : rejected;
        });

        res.json(serializePeopleTags([updated])[0]);
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        console.error('Reject People Tag Error:', error);
        res.status(500).json({ error: 'Failed to reject people tag' });
    }
};

export const removePeopleTag = async (req: Request, res: Response) => {
    const tagId = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const tag = await prisma.postTaggedUser.findUnique({
            where: { id: tagId },
            include: { post: { select: { authorId: true, pageId: true } } }
        });
        if (!tag) return res.status(404).json({ error: 'People tag not found' });
        const canRemove = tag.taggedUserId === userId
            || (tag.post.pageId ? await hasPostPageCapability(tag.post.pageId, userId, 'manageContent')
                : tag.taggedByUserId === userId || tag.post.authorId === userId);
        if (!canRemove) {
            return res.status(403).json({ error: 'You cannot remove this people tag' });
        }

        await prisma.$transaction(async (tx) => {
            if (tag.post.pageId) {
                const page = await lockPage(tx, tag.post.pageId);
                await activePageActor(tx, userId);
                if (tag.taggedUserId !== userId) await requirePageCapability(tx, page, userId, 'manageContent');
            }
            const current = await tx.postTaggedUser.findUnique({ where: { id: tagId }, include: { post: { select: { authorId: true, pageId: true } } } });
            if (!current) throw new PagePolicyError('PEOPLE_TAG_NOT_FOUND', 404);
            if (current.taggedUserId !== userId && !(current.post.pageId
                ? await hasPostPageCapability(current.post.pageId, userId, 'manageContent', tx)
                : current.taggedByUserId === userId || current.post.authorId === userId)) throw new PagePolicyError('PEOPLE_TAG_PERMISSION_DENIED', 403);
            if (current.notificationId) {
                await tx.notification.deleteMany({ where: { id: current.notificationId } });
            }
            await tx.postTaggedUser.update({
                where: { id: tagId },
                data: {
                    status: PeopleTagStatus.REMOVED,
                    acceptedAt: null,
                    removedAt: current.removedAt || new Date(),
                    notificationId: null
                }
            });
            if (current.post.pageId && current.taggedUserId !== userId) await pageAudit(tx, current.post.pageId, userId, 'PEOPLE_TAG_REMOVED', tagId);
        });

        res.json({ success: true, id: tagId, status: PeopleTagStatus.REMOVED });
    } catch (error) {
        if (respondPagePostError(error, res)) return;
        console.error('Remove People Tag Error:', error);
        res.status(500).json({ error: 'Failed to remove people tag' });
    }
};

export const updateComment = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    const cleanText = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    try {
        const comment = await prisma.comment.findUnique({ where: { id } });
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        if (comment.pageId ? !await hasPostPageCapability(comment.pageId,userId,'reply') : comment.userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized to edit this comment' });
        }
        if (!cleanText) return res.status(400).json({ error: 'Comment text is required' });
        if (!validateMentionRecipientLimit(cleanText, res, 'comment')) return;

        const result = await prisma.$transaction(async (tx) => {
            await guardPagePostPersistence(tx,comment.postId,userId);
            const current = await tx.comment.findUnique({ where: { id } });
            if (!current) throw new PagePolicyError('COMMENT_NOT_FOUND', 404);
            if(current.pageId){const page=await lockPage(tx,current.pageId);await requirePageCapability(tx,page,userId,'reply');}
            else if (current.userId !== userId) throw new PagePolicyError('COMMENT_PERMISSION_DENIED', 403);
            await tx.comment.update({ where: { id }, data: { text: cleanText } });
            const mentionResult = await reconcileCommentMentions(tx, {
                postId: comment.postId,
                commentId: comment.id,
                actorUserId: userId,
                isReply: Boolean(comment.parentId),
                parentCommentId: comment.parentId || undefined,
                text: cleanText
            });
            await reconcileCommentHashtags(tx, comment.id, cleanText);
            const updated = await tx.comment.findUniqueOrThrow({
                where: { id },
                include: {
                    user: { select: SAFE_USER_SELECT },
                    mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                    likesList: { select: { userId: true } },
                    replies: {
                        include: {
                            user: { select: SAFE_USER_SELECT },
                            mentions: ACTIVE_MENTION_REFERENCE_INCLUDE,
                            likesList: { select: { userId: true } }
                        }
                    }
                }
            });
            return { updated, mentionResult };
        });

        await dispatchNotificationIds(result.mentionResult.notificationIds);
        await attachPageCommentPublishers([result.updated],userId);
        res.json(mapComment(result.updated, userId));
    } catch (error) {
        if(respondPagePostError(error,res))return;
        if (error instanceof MentionLimitError || error instanceof HashtagLimitError) {
            res.status(400).json({ error: error.message, code: 'SOCIAL_TEXT_LIMIT_EXCEEDED', limit: error.limit });
            return;
        }
        console.error("Update Comment Error:", error);
        res.status(500).json({ error: 'Failed to update comment' });
    }
};

export const deleteComment = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const comment = await prisma.comment.findUnique({ where: { id } });
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        const parentPost=await prisma.post.findUnique({where:{id:comment.postId},select:{pageId:true}});
        const mayModerate=await hasPostPageCapability(parentPost?.pageId,userId,'moderateComments');
        if (comment.pageId ? !mayModerate : comment.userId !== userId && !mayModerate) {
            return res.status(403).json({ error: 'Unauthorized to delete this comment' });
        }

        await prisma.$transaction(async (tx) => {
            await guardPagePostPersistence(tx,comment.postId,userId);
            const current = await tx.comment.findUnique({ where: { id }, include: { post: { select: { pageId: true } } } });
            if (!current) throw new PagePolicyError('COMMENT_NOT_FOUND', 404);
            if(current.post.pageId && (current.pageId || current.userId !== userId)){const page=await lockPage(tx,current.post.pageId);await requirePageCapability(tx,page,userId,'moderateComments');await pageAudit(tx,page.id,userId,'COMMENT_DELETED',id);}
            else if (current.userId !== userId) throw new PagePolicyError('COMMENT_PERMISSION_DENIED', 403);
            const replies = await tx.comment.findMany({ where: { parentId: id } });
            const replyIds = replies.map(r => r.id);
            const deletedCommentIds = [id, ...replyIds];
            const linkedMentionNotifications = await tx.mention.findMany({
                where: { commentId: { in: deletedCommentIds }, notificationId: { not: null } },
                select: { notificationId: true }
            });
            const navigationCandidates = await tx.notification.findMany({
                where: { targetId: comment.postId, targetType: 'post', type: { in: ['response', 'mention'] } },
                select: { id: true, payload: true }
            });
            const staleNavigationIds = navigationCandidates
                .filter((notification) => {
                    const payload = parseNotificationPayload(notification.payload);
                    return deletedCommentIds.includes(String(payload.commentId || ''))
                        || deletedCommentIds.includes(String(payload.replyId || ''));
                })
                .map((notification) => notification.id);
            const notificationIds = Array.from(new Set([
                ...linkedMentionNotifications.map((mention) => mention.notificationId).filter((value): value is string => Boolean(value)),
                ...staleNavigationIds
            ]));
            if (notificationIds.length > 0) {
                await tx.notification.deleteMany({ where: { id: { in: notificationIds } } });
            }

            if (replyIds.length > 0) {
                await tx.commentLike.deleteMany({ where: { commentId: { in: replyIds } } });
                await tx.comment.deleteMany({ where: { parentId: id } });
            }
            await tx.commentLike.deleteMany({ where: { commentId: id } });

            await tx.comment.delete({ where: { id } });

            await tx.post.update({
                where: { id: comment.postId },
                data: { commentsCount: { decrement: 1 + replyIds.length } }
            });
        });

        res.json({ success: true, message: 'Comment deleted successfully' });
    } catch (error) {
        if(respondPagePostError(error,res))return;
        console.error("Delete Comment Error:", error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
};

export const deletePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    try {
        const post = await prisma.post.findUnique({
            where: { id },
            include: {
                media: { select: { mediaAssetId: true } },
                questions: { include: { options: { select: { imageMediaId: true } } } }
            }
        });
        if (!post) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }
        if (post.pageId ? !await hasPostPageCapability(post.pageId,userId,'manageContent') : post.authorId !== userId) {
            res.status(403).json({ error: 'Unauthorized to delete this post' });
            return;
        }

        const dependentShares = post.sharedFromId
            ? []
            : await prisma.post.findMany({
                where: { sharedFromId: id },
                include: {
                    media: { select: { mediaAssetId: true } },
                    questions: { include: { options: { select: { imageMediaId: true } } } }
                }
            });
        const postsToDelete = [post, ...dependentShares];
        const postIds = postsToDelete.map(({ id: postId }) => postId);
        const dependentShareIds = dependentShares.map(({ id: postId }) => postId);
        const mediaAssetIds = Array.from(new Set(postsToDelete.flatMap((postToDelete) => [
            ...postToDelete.media.map(({ mediaAssetId }) => mediaAssetId),
            ...postToDelete.questions.flatMap((question) => [
                question.imageMediaId,
                ...question.options.map((option) => option.imageMediaId)
            ])
        ]).filter((mediaAssetId): mediaAssetId is string => Boolean(mediaAssetId))));

        await prisma.$transaction(async (tx) => {
            if (post.pageId) await authorizePagePublisher(tx,post.pageId,userId,{status:post.status},false);
            await tx.notification.deleteMany({
                where: { targetId: { in: postIds }, targetType: { in: ['survey', 'post'] } }
            });
            await tx.savedPost.deleteMany({ where: { postId: { in: postIds } } });
            await tx.hiddenPost.deleteMany({ where: { postId: { in: postIds } } });
            await tx.userLike.deleteMany({ where: { postId: { in: postIds } } });

            const comments = await tx.comment.findMany({ where: { postId: { in: postIds } } });
            const commentIds = comments.map(c => c.id);
            if (commentIds.length > 0) {
                await tx.commentLike.deleteMany({ where: { commentId: { in: commentIds } } });
                await tx.comment.deleteMany({ where: { postId: { in: postIds } } });
            }

            const responses = await tx.response.findMany({ where: { postId: { in: postIds } } });
            const responseIds = responses.map(r => r.id);
            if (responseIds.length > 0) {
                await tx.answer.deleteMany({ where: { responseId: { in: responseIds } } });
                await tx.response.deleteMany({ where: { postId: { in: postIds } } });
            }

            const questions = await tx.question.findMany({ where: { postId: { in: postIds } } });
            const questionIds = questions.map(q => q.id);
            if (questionIds.length > 0) {
                await tx.option.deleteMany({ where: { questionId: { in: questionIds } } });
                await tx.question.deleteMany({ where: { postId: { in: postIds } } });
            }
            await tx.section.deleteMany({ where: { postId: { in: postIds } } });

            if (dependentShareIds.length > 0) {
                await tx.post.deleteMany({ where: { id: { in: dependentShareIds } } });
            }
            await tx.post.delete({ where: { id } });

            if (post.sharedFromId) {
                await tx.post.updateMany({
                    where: { id: post.sharedFromId, sharesCount: { gt: 0 } },
                    data: { sharesCount: { decrement: 1 } }
                });
            }
        });

        await scheduleMediaDeletion(mediaAssetIds);

        res.json({ success: true, message: 'Post permanently deleted', deletedPostIds: postIds });
    } catch (error) {
        if (respondPagePostError(error,res)) return;
        console.error("Hard delete failed:", error);
        res.status(500).json({ error: 'Failed to delete post permanently' });
    }
};

export const getPostAnalytics = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    try {
        const id = await resolveInteractionTarget(rawId, 'vote');
        const currentUserId = req.user?.userId;
        const originalPost = await prisma.post.findFirst({
            where: { id, ...buildVisiblePublishedPostWhere(currentUserId) },
            select: {
                authorId: true,
                sharesCount: true,
            }
        });

        if (!originalPost) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const aggregateMetrics = await prisma.post.aggregate({
            where: {
                OR: [
                    { id: id },
                    { sharedFromId: id }
                ],
                isDeleted: false
            },
            _sum: {
                likesCount: true,
                commentsCount: true,
                responseCount: true
            }
        });

        res.json({
            totalGlobalLikes: aggregateMetrics._sum?.likesCount || 0,
            totalGlobalComments: aggregateMetrics._sum?.commentsCount || 0,
            totalSharesCount: originalPost.sharesCount || 0,
            totalParticipants: aggregateMetrics._sum?.responseCount || 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch global analytics' });
    }
};
