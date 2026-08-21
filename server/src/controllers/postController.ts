import { Request, Response } from 'express';
import prisma from '../prisma';
import { notify, extractAndNotifyMentions } from '../services/notificationService';
import { processBase64Image } from '../utils/imageProcessor';
import { PrivacyService } from '../services/privacyService';
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
    validatePostMediaSet
} from '../services/mediaService';
import { MediaValidationError } from '../services/mediaProcessor';
import { MediaAttachmentRequirement } from '../services/mediaService';
import { validatePublishedAnswerTypes } from '../utils/answerTypeValidation';

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

const getPostMediaAssetIds = (data: any): string[] => {
    if (!Array.isArray(data?.mediaAssetIds)) return [];
    return data.mediaAssetIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
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
    const guestId = req.query.guestId as any;
    const authorId = req.query.authorId as string | undefined;
    const authorHandle = req.query.authorHandle as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    
    try {
        const posts = await prisma.post.findMany({
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            where: {
                isDeleted: false,
                status: 'PUBLISHED',
                ...(authorId ? { authorId } : {}),
                ...(authorHandle ? { author: { handle: authorHandle } } : {}),
                ...(userId && !authorId && !authorHandle ? {
                    NOT: { hiddenBy: { some: { userId } } }
                } : {}),
                ...PrivacyService.getPostPrivacyWhereClause(userId),
                OR: [
                    { targetAudience: 'Public' },
                    { targetAudience: 'PUBLIC' },
                    { targetAudience: null },
                    ...(userId ? [
                        { authorId: userId },
                        { author: { following: { some: { followerId: userId, status: 'ACTIVE' } } } }
                    ] : [])
                ]
            },
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
                responses: (userId || guestId) ? { 
                    where: userId ? { userId } : { guestId }, 
                    take: 1, 
                    include: { answers: true } 
                } : false,
                likes: userId ? { where: { userId }, take: 1 } : false,
                shares: userId ? { where: { authorId: userId }, take: 1 } : false,
                savedBy: userId ? { where: { userId }, take: 1 } : false,
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
                        responses: (userId || guestId) ? { 
                            where: userId ? { userId } : { guestId }, 
                            take: 1, 
                            include: { answers: true } 
                        } : false,
                        likes: userId ? { where: { userId }, take: 1 } : false,
                        shares: userId ? { where: { authorId: userId }, take: 1 } : false,
                        savedBy: userId ? { where: { userId }, take: 1 } : false,
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const mappedPosts = posts.map((rawPost: any) => {
            const s = serializePostMediaRecord(rawPost, userId);
            const actualResponse = s.sharedFrom ? s.sharedFrom.responses?.[0] : s.responses?.[0];
            const userAnswers = actualResponse?.answers || [];
            
            let mappedSharedFrom: any = undefined;
            if (s.sharedFrom) {
                mappedSharedFrom = {
                    ...s.sharedFrom,
                    options: ['Poll', 'Challenge', 'Prediction', 'Debate'].includes(normalizePostType(s.sharedFrom.type) || '') && s.sharedFrom.questions?.length > 0 ? s.sharedFrom.questions[0].options : [],
                    demographics: parseJsonArray(s.sharedFrom.demographics),
                    author: s.sharedFrom.author ? {
                        ...s.sharedFrom.author,
                        isFollowing: userId ? (s.sharedFrom.author.following && s.sharedFrom.author.following.length > 0) : false
                    } : undefined,
                    likes: s.sharedFrom.likesCount,
                    repostCount: s.sharedFrom.sharesCount || 0,
                    participants: s.sharedFrom.responseCount,
                    targetGroups: mapTargetGroups(s.sharedFrom),
                    hasParticipated: (userId || guestId) ? !!(s.sharedFrom.responses && s.sharedFrom.responses.length > 0) : false,
                    userSelectedOptions: (s.sharedFrom.responses && s.sharedFrom.responses.length > 0) ? mapAnswerOptionIds(s.sharedFrom.responses[0].answers || []) : [],
                    isLiked: userId ? (s.sharedFrom.likes && s.sharedFrom.likes.length > 0) : false,
                    hasReposted: userId ? (s.sharedFrom.shares && s.sharedFrom.shares.length > 0) : false,
                    isSaved: userId ? (s.sharedFrom.savedBy && s.sharedFrom.savedBy.length > 0) : false
                };
            }

            return {
                ...s,
                sharedFrom: mappedSharedFrom || s.sharedFrom,
                likes: s.likesCount,
                repostCount: s.sharesCount || 0,
                participants: s.responseCount,
                coverImage: s.coverImage,
                hasParticipated: (userId || guestId) ? !!actualResponse : false,
                userSelectedOptions: mapAnswerOptionIds(userAnswers),
                userProgress: buildUserProgress(userAnswers),
                isLiked: userId ? (s.likes && s.likes.length > 0) : false,
                hasReposted: userId ? (s.shares && s.shares.length > 0) : false,
                isSaved: userId ? (s.savedBy && s.savedBy.length > 0) : false,
                options: OPTION_POST_TYPES.includes(normalizePostType(s.type) || '') && s.questions.length > 0 ? s.questions[0].options : [],
                targetGroups: mapTargetGroups(s),
                author: {
                    ...s.author,
                    isFollowing: userId ? (s.author.following && s.author.following.length > 0) : false
                },
                allowAnonymous: s.allowAnonymous,
                forceAnonymous: !!(s as any).forceAnonymous,
                demographics: parseJsonArray(s.demographics),
            };
        });

        let nextCursor: string | null = null;
        if (mappedPosts.length > limit) {
            mappedPosts.pop(); // Remove the extra item
            nextCursor = mappedPosts[mappedPosts.length - 1].id;
        }

        res.json({ data: mappedPosts, nextCursor });
    } catch (error) {
        console.error(error);
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
                isDeleted: false,
                status: 'PUBLISHED',
                ...dateFilter,
                ...(type && type !== 'all' ? { type: { equals: type, mode: 'insensitive' } } : {}),
                ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
                ...(country && country !== 'ALL' ? {
                    author: {
                        OR: [
                            { country: { equals: country, mode: 'insensitive' } },
                            { location: { contains: country, mode: 'insensitive' } }
                        ]
                    }
                } : {}),
                ...PrivacyService.getPostPrivacyWhereClause(userId)
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
    const guestId = req.query.guestId as any;
    try {
        const post = await prisma.post.findFirst({
            where: { id, isDeleted: false },
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
                responses: (userId || guestId) ? { 
                    where: userId ? { userId } : { guestId }, 
                    take: 1, 
                    include: { answers: true } 
                } : false,
                likes: userId ? { where: { userId }, take: 1 } : false,
                shares: userId ? { where: { authorId: userId }, take: 1 } : false,
                savedBy: userId ? { where: { userId }, take: 1 } : false,
                comments: {
                    include: {
                        user: { select: SAFE_USER_SELECT },
                        replies: { include: { user: { select: SAFE_USER_SELECT } } }
                    }
                },
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
                        responses: (userId || guestId) ? { 
                            where: userId ? { userId } : { guestId }, 
                            take: 1, 
                            include: { answers: true } 
                        } : false,
                        likes: userId ? { where: { userId }, take: 1 } : false,
                        shares: userId ? { where: { authorId: userId }, take: 1 } : false,
                        savedBy: userId ? { where: { userId }, take: 1 } : false,
                    }
                }
            }
        });

        if (!post) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const p = serializePostMediaRecord(post as any, userId);
        const canViewPost = await GroupPermissionService.canViewPost(id, userId);
        if (!canViewPost) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const targetGroupIds = mapTargetGroups(p);
        const canViewAuthorContent = targetGroupIds.length > 0 || await PrivacyService.canViewUserContent(userId, p.authorId);
        if (!canViewAuthorContent) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const isAuthor = !!userId && p.authorId === userId;
        if (!isAuthor && (p.targetAudience === 'Groups' || targetGroupIds.length > 0)) {
            if (!userId) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const membership = await prisma.groupMember.findFirst({
                where: { userId, groupId: { in: targetGroupIds }, status: 'JOINED' }
            });
            if (!membership) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        const actualResponse = p.sharedFrom ? p.sharedFrom.responses?.[0] : p.responses?.[0];
        const userAnswers = actualResponse?.answers || [];
        
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
                targetGroups: mapTargetGroups(p.sharedFrom),
                hasParticipated: (userId || guestId) ? !!(p.sharedFrom.responses && p.sharedFrom.responses.length > 0) : false,
                userSelectedOptions: (p.sharedFrom.responses && p.sharedFrom.responses.length > 0) ? mapAnswerOptionIds(p.sharedFrom.responses[0].answers || []) : [],
                isLiked: userId ? (p.sharedFrom.likes && p.sharedFrom.likes.length > 0) : false,
                hasReposted: userId ? (p.sharedFrom.shares && p.sharedFrom.shares.length > 0) : false,
                isSaved: userId ? (p.sharedFrom.savedBy && p.sharedFrom.savedBy.length > 0) : false
            };
        }

        const mappedPost = {
            ...p,
            sharedFrom: mappedSharedFrom || p.sharedFrom,
            likes: p.likesCount,
                repostCount: p.sharesCount || 0,
            participants: p.responseCount,
            coverImage: p.coverImage,
            hasParticipated: (userId || guestId) ? !!actualResponse : false,
            userSelectedOptions: mapAnswerOptionIds(userAnswers),
            userProgress: buildUserProgress(userAnswers),
            isLiked: userId ? (p.likes && p.likes.length > 0) : false,
                hasReposted: userId ? (p.shares && p.shares.length > 0) : false,
            isSaved: userId ? (p.savedBy && p.savedBy.length > 0) : false,
            options: OPTION_POST_TYPES.includes(normalizePostType(p.type) || '') && p.questions.length > 0 ? p.questions[0].options : [],
            targetGroups: mapTargetGroups(p),
            author: {
                ...p.author,
                isFollowing: userId ? (p.author.following && p.author.following.length > 0) : false
            },
            allowAnonymous: p.allowAnonymous,
            forceAnonymous: !!(p as any).forceAnonymous,
            demographics: parseJsonArray(p.demographics)
        };
        res.json(mappedPost);
    } catch (error) {
        console.error(error);
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
        const postMediaAssetIds = getPostMediaAssetIds(data);

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
                    select: { postingPermissions: true }
                });
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
            title: data.title || "Untitled",
            description: data.description || "",
            type: normalizePostType(data.type) || "Post",
            authorId: authorId,
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
            status: needsApproval ? POST_STATUS.PENDING_APPROVAL : (data.status === 'DRAFT' ? POST_STATUS.DRAFT : POST_STATUS.PUBLISHED)
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
        const mediaScope = await resolvePostMediaScope(authorId, postData.status, targetGroupIds, postData.targetAudience);
        const prepared = await prepareMediaAttachments(authorId, requirements, mediaScope);

        let transactionResult;
        try {
            if (postMediaAssetIds.length > 0 && mediaScope === 'PUBLIC') {
                postData.image = (await getStoredMediaPresentation(postMediaAssetIds[0]))?.src || null;
            }
            transactionResult = await prisma.$transaction(async (tx) => {
            const newPost = await tx.post.create({
                data: postData,
                include: {
                    author: { select: SAFE_USER_SELECT },
                    targetedGroups: true
                }
            });

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

            await commitPreparedMedia(tx, prepared);
            return { post: newPost, createdOptions: optionsList, createdSections: sectionsList };
            });
        } catch (error) {
            await rollbackPreparedMedia(prepared);
            throw error;
        }
        const { post, createdOptions, createdSections } = transactionResult;

        console.log(`[CREATE POST] Saved to DB:`, JSON.stringify({ id: post.id, allowAnonymous: postData.allowAnonymous, forceAnonymous: postData.forceAnonymous }));

        try {
            if (postData.status === POST_STATUS.PUBLISHED) {
                const fullText = `${post.title} ${post.description}`;
                await extractAndNotifyMentions(fullText, authorId, 'survey', post.id);
            } else if (postData.status === POST_STATUS.PENDING_APPROVAL) {
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
            demographics: parseJsonArray(post.demographics),
            targetGroups: mapTargetGroups(post)
        };

        res.json(mappedPost);
    } catch (error) {
        console.error(error);
        if (error instanceof MediaValidationError) {
            res.status(error.statusCode).json({ error: error.message, code: error.code });
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
                status: true,
                createdAt: true,
                isDeleted: true,
                responseCount: true,
                groupId: true,
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

        if (existingPost.authorId !== trustedUserId) {
            res.status(403).json({ error: 'Unauthorized to update this post' });
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

        // --- PRE-PROCESS IMAGES ---
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
        const shouldValidateGroupPosting = submittedTargetGroups !== undefined || data.status === 'PUBLISHED' || existingPost.status === POST_STATUS.DRAFT || existingPost.status === POST_STATUS.REJECTED;

        let needsApproval = false;
        if (shouldValidateGroupPosting && effectiveTargetGroups.length > 0) {
            for (const groupId of effectiveTargetGroups) {
                const group = await prisma.group.findUnique({
                    where: { id: groupId },
                    select: { postingPermissions: true }
                });
                if (!group) continue;

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
        const mediaScope = await resolvePostMediaScope(trustedUserId, finalStatus, effectiveTargetGroups, data.targetAudience !== undefined ? data.targetAudience : existingPost.targetAudience);
        const ratio = await validatePostMediaSet(trustedUserId, finalPostMediaIds, data.mediaAspectRatio || existingPost.mediaAspectRatio || undefined);
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
                const post = await tx.post.update({
                    where: { id },
                    data: updateData,
                    include: { author: { select: SAFE_USER_SELECT }, targetedGroups: true }
                });

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

                await commitPreparedMedia(tx, preparedNew);
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
                return { post, finalOptions, finalSections };
            });
        } catch (error) {
            await rollbackPreparedMedia(preparedNew);
            await rollbackMediaScopeChange(preparedRetained);
            throw error;
        }

        await finalizeMediaScopeChange(preparedRetained);
        await scheduleMediaDeletion(removedIds);
        const { post, finalOptions, finalSections } = transactionResult;
        console.log('[UPDATE POST] Saved to DB:', JSON.stringify({ id: post.id, mediaCount: finalPostMediaIds.length }));

        try {
            if (existingPost.status !== POST_STATUS.PUBLISHED && post.status === POST_STATUS.PUBLISHED) {
                await extractAndNotifyMentions(`${post.title} ${post.description}`, trustedUserId, 'survey', post.id);
            } else if (post.status === POST_STATUS.PENDING_APPROVAL && existingPost.status !== POST_STATUS.PENDING_APPROVAL) {
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
            demographics: parseJsonArray(post.demographics),
            targetGroups: mapTargetGroups(post)
        };

        res.json(mappedPost);
    } catch (error) {
        console.error('Failed to update post:', error);
        if (error instanceof MediaValidationError) {
            res.status(error.statusCode).json({ error: error.message, code: error.code });
            return;
        }
        res.status(500).json({ error: 'Failed to update post' });
    }
};

export const getDrafts = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    try {
        const drafts = await prisma.post.findMany({
            where: { authorId: userId, status: { in: [POST_STATUS.DRAFT, POST_STATUS.PENDING_APPROVAL, POST_STATUS.REJECTED] }, isDeleted: false },
            include: {
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                media: POST_MEDIA_INCLUDE,
                targetedGroups: true,
                author: { select: SAFE_USER_SELECT }
            },
            orderBy: { updatedAt: 'desc' }
        });
        const mappedDrafts = drafts.map((rawDraft: any) => {
            const d = serializePostMediaRecord(rawDraft, userId);
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
    try {
        const saved = await prisma.savedPost.findMany({
            where: { 
                userId, 
                post: { 
                    isDeleted: false,
                    status: POST_STATUS.PUBLISHED,
                    ...PrivacyService.getPostPrivacyWhereClause(userId)
                } 
            },
            include: {
                post: {
                    include: {
                        author: { select: SAFE_USER_SELECT },
                        questions: { include: { options: { orderBy: { order: 'asc' } } } },
                        sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                        media: POST_MEDIA_INCLUDE,
                        targetedGroups: true,
                        responses: userId ? { where: { userId }, take: 1, include: { answers: true } } : false,
                        likes: userId ? { where: { userId }, take: 1 } : false
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        const posts = saved.map((s: any) => {
            const p: any = serializePostMediaRecord(s.post, userId);
            const userResponse = p.responses?.[0];
            const userAnswers = userResponse?.answers || [];
            return {
                ...p,
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

        const post = await prisma.post.findUnique({
            where: { id },
            select: {
                allowAnonymous: true,
                forceAnonymous: true,
                authorId: true,
                allowMultipleSelection: true,
                allowUserOptions: true,
                type: true,
                targetAudience: true,
                targetedGroups: { select: { id: true } },
                status: true,
                isDeleted: true,
                expiresAt: true
            }
        });

        if (!post || post.isDeleted || post.status !== 'PUBLISHED') {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        if (post.expiresAt && post.expiresAt.getTime() <= Date.now()) {
            res.status(400).json({ error: 'This post has ended' });
            return;
        }

        const isAuthor = !!actorUserId && post.authorId === actorUserId;
        const targetGroupIds = mapTargetGroups(post);
        if (!isAuthor && (post.targetAudience === 'Groups' || targetGroupIds.length > 0)) {
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
            const follow = await prisma.follow.findUnique({
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
        let notificationOptionId = optionsToProcess[0];

        await prisma.$transaction(async (tx) => {
            const customClientId = typeof newOption?.id === 'string' ? newOption.id : undefined;
            const customText = typeof newOption?.text === 'string' ? newOption.text.trim() : '';
            let resolvedOptionIds = [...optionsToProcess];

            if (customClientId && customText && resolvedOptionIds.includes(customClientId)) {
                if (!post.allowUserOptions) {
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
                if (!post.allowMultipleSelection && resolvedOptionIds.length > 1) {
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
                    if (!post.allowMultipleSelection) {
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
        });

        if (actorUserId && shouldNotify && !finalIsAnonymous && post.authorId) {
            await notify(actorUserId, post.authorId as string, 'vote', 'voted on your post', 'survey', id, { optionId: notificationOptionId });
        }

        res.json({ success: true, newOption: createdCustomOption });
    } catch (error: any) {
        console.error(error);
        res.status(error?.statusCode || 500).json({ error: error?.statusCode ? error.message : 'Failed to vote' });
    }
};

export const getParticipants = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    try {
        const id = await resolveInteractionTarget(rawId, 'vote');
        const currentUserId = req.user?.userId;
        const post = await prisma.post.findUnique({
            where: { id },
            select: {
                authorId: true,
                forceAnonymous: true,
                targetAudience: true,
                targetedGroups: { select: { id: true } },
                status: true,
                isDeleted: true
            } as any
        });
        if (!post || (post as any).isDeleted || (post as any).status !== 'PUBLISHED') {
            res.status(404).json({ error: 'Post not found' });
            return;
        }
        const isAuthor = !!currentUserId && (post as any).authorId === currentUserId;
        const canViewAuthorContent = await PrivacyService.canViewUserContent(currentUserId, (post as any).authorId);
        if (!canViewAuthorContent) {
            res.status(403).json({ error: 'You do not have access to this post' });
            return;
        }

        if (post && (post as any).forceAnonymous === true) {
            return res.json([]);
        }

        const targetGroupIds = mapTargetGroups(post);
        if (!isAuthor && ((post as any).targetAudience === 'Groups' || targetGroupIds.length > 0)) {
            if (!currentUserId) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const membership = await prisma.groupMember.findFirst({
                where: { userId: currentUserId, groupId: { in: targetGroupIds }, status: 'JOINED' }
            });
            if (!membership) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        if (!isAuthor && (post as any).targetAudience === 'Followers') {
            if (!currentUserId) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: currentUserId, followingId: (post as any).authorId } }
            });
            if (!follow || follow.status !== 'ACTIVE') {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        const responses = await prisma.response.findMany({
            where: { postId: id },
            include: { user: { select: SAFE_USER_SELECT } },
            orderBy: { timestamp: 'asc' }
        });
        
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
        }).reverse();
        res.json(mapped);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch participants' });
    }
};

export const getPostResults = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    try {
        const id = await resolveInteractionTarget(rawId, 'vote');
        const currentUserId = req.user?.userId;
        const guestId = req.query.guestId as string | undefined;
        const post = await prisma.post.findUnique({
            where: { id },
            select: {
                authorId: true,
                resultsWho: true,
                resultsTiming: true,
                targetAudience: true,
                targetedGroups: { select: { id: true } },
                expiresAt: true,
                status: true,
                isDeleted: true
            }
        });

        if (!post || post.isDeleted || post.status !== 'PUBLISHED') {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const isAuthor = !!currentUserId && post.authorId === currentUserId;
        const canViewAuthorContent = await PrivacyService.canViewUserContent(currentUserId, post.authorId);
        if (!canViewAuthorContent) {
            res.status(403).json({ error: 'You do not have access to these results' });
            return;
        }

        const targetGroupIds = mapTargetGroups(post);
        if (!isAuthor && (post.targetAudience === 'Groups' || targetGroupIds.length > 0)) {
            if (!currentUserId) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const membership = await prisma.groupMember.findFirst({
                where: { userId: currentUserId, groupId: { in: targetGroupIds }, status: 'JOINED' }
            });
            if (!membership) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        if (!isAuthor && post.targetAudience === 'Followers' && currentUserId) {
            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: currentUserId, followingId: post.authorId } }
            });
            if (!follow || follow.status !== 'ACTIVE') {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        } else if (!isAuthor && post.targetAudience === 'Followers') {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        let whoPasses = isAuthor || !post.resultsWho || post.resultsWho === 'Public';

        if (!whoPasses && post.resultsWho === 'Followers' && currentUserId) {
            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: currentUserId, followingId: post.authorId } }
            });
            whoPasses = follow?.status === 'ACTIVE';
        }

        if (!whoPasses && post.resultsWho === 'Participants' && (currentUserId || guestId)) {
            const response = await prisma.response.findFirst({
                where: {
                    postId: id,
                    ...(currentUserId ? { userId: currentUserId } : guestId ? { guestId } : {})
                }
            });
            whoPasses = !!response;
        }

        if (!whoPasses) {
            res.status(403).json({ error: 'You do not have access to these results' });
            return;
        }

        const timing = post.resultsTiming || 'AnyTime';
        const viewerResponse = (currentUserId || guestId) ? await prisma.response.findFirst({
            where: {
                postId: id,
                ...(currentUserId ? { userId: currentUserId } : { guestId })
            }
        }) : null;
        const timingPasses = isAuthor
            || timing === 'AnyTime'
            || (timing === 'AfterEnd' && post.expiresAt.getTime() <= Date.now())
            || (timing === 'Immediately' && !!viewerResponse);

        if (!timingPasses) {
            res.status(403).json({ error: 'Results are not available yet' });
            return;
        }

        const responses = await prisma.response.findMany({
            where: { postId: id },
            include: {
                answers: true,
                user: {
                    include: {
                        demographics: true
                    }
                }
            }
        });

        const results = responses.map(r => ({
            id: r.id,
            isAnonymous: r.isAnonymous,
            answers: r.answers.map(a => ({
                questionId: a.questionId,
                optionId: a.optionId,
                textValue: a.textValue
            })),
            demographics: {
                age: r.user?.demographics?.ageGroup || 'Unknown',
                gender: r.user?.demographics?.gender || 'Unknown',
                country: r.user?.country || 'Unknown',
                education: r.user?.demographics?.educationLevel || 'Unknown',
                employment: r.user?.demographics?.employmentType || 'Unknown',
                industry: r.user?.demographics?.industry || 'Unknown',
                sector: r.user?.demographics?.employmentSector || 'Unknown'
            }
        }));

        res.json(results);
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
        author: {
            id: user?.id || 'unknown',
            name: user?.name || 'Unknown',
            avatar: user?.avatar || '',
            avatarMediaId: user?.avatarMediaId,
            avatarMedia: user?.avatarMedia,
            handle: user?.handle || '',
            verifiedBadge: user?.verifiedBadge || false
        },
        timestamp: c.createdAt.toISOString(),
        likes: c.likes || 0,
        isLiked: currentUserId && c.likesList ? c.likesList.some((l: any) => l.userId === currentUserId) : false,
        replies: c.replies ? c.replies.map((r: any) => mapComment(r, currentUserId)) : []
    };
};

export const getComments = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const userId = req.user?.userId;
    try {
        const id = await resolveInteractionTarget(rawId, 'comment');
        const commentTarget = await prisma.post.findUnique({
            where: { id },
            select: {
                authorId: true,
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

        const isAuthor = !!userId && commentTarget.authorId === userId;
        const targetGroupIds = mapTargetGroups(commentTarget);
        if (!isAuthor && (commentTarget.targetAudience === 'Groups' || targetGroupIds.length > 0)) {
            if (!userId) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const membership = await prisma.groupMember.findFirst({
                where: { userId, groupId: { in: targetGroupIds }, status: 'JOINED' }
            });
            if (!membership) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        if (!isAuthor && commentTarget.targetAudience === 'Followers') {
            if (!userId) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: userId, followingId: commentTarget.authorId } }
            });
            if (!follow) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        const comments = await prisma.comment.findMany({
            where: { postId: id, parentId: null },
            include: {
                user: { select: SAFE_USER_SELECT },
                likesList: { select: { userId: true } },
                replies: {
                    orderBy: { createdAt: 'asc' },
                    include: { user: { select: SAFE_USER_SELECT }, likesList: { select: { userId: true } } }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(comments.map(c => mapComment(c, userId)));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
};

export const createComment = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const { text, content, parentId } = req.body;
    try {
        const id = await resolveInteractionTarget(rawId, 'comment');
        const userId = req.user?.userId || req.body.userId;

        const commentTarget = await prisma.post.findUnique({
            where: { id },
            select: {
                allowComments: true,
                authorId: true,
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

        const isAuthor = commentTarget.authorId === userId;
        const targetGroupIds = mapTargetGroups(commentTarget);
        if (!isAuthor && (commentTarget.targetAudience === 'Groups' || targetGroupIds.length > 0)) {
            const membership = await prisma.groupMember.findFirst({
                where: { userId, groupId: { in: targetGroupIds }, status: 'JOINED' }
            });
            if (!membership) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        if (!isAuthor && commentTarget.targetAudience === 'Followers') {
            const follow = await prisma.follow.findUnique({
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

        if (parentId) {
            const parentComment = await prisma.comment.findUnique({
                where: { id: parentId },
                select: { postId: true }
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

        const [comment, targetPost] = await prisma.$transaction([
            prisma.comment.create({
                data: { text: cleanText, userId, postId: id, parentId },
                include: { user: { select: SAFE_USER_SELECT } }
            }),
            prisma.post.update({ where: { id }, data: { commentsCount: { increment: 1 } } })
        ]);

        if (targetPost.authorId) {
            await notify(userId, targetPost.authorId, 'response', 'commented on your post', 'survey', id, { commentId: comment.id });
        }
        
        await extractAndNotifyMentions(cleanText, userId, 'comment', comment.id, { postId: id });

        res.json(mapComment(comment, userId));
    } catch (error) {
        res.status(500).json({ error: 'Failed to create comment' });
    }
};

export const likePost = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const { userId } = req.body;
    try {
        const id = await resolveInteractionTarget(rawId, 'like');
        const targetPostCheck = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
        if (targetPostCheck && targetPostCheck.authorId) {
            const canView = await PrivacyService.canViewUserContent(userId, targetPostCheck.authorId);
            if (!canView) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }
        const existing = await prisma.userLike.findUnique({ where: { userId_postId: { userId, postId: id } } });
        if (existing) {
            await prisma.$transaction([
                prisma.userLike.delete({ where: { userId_postId: { userId, postId: id } } }),
                prisma.post.update({ where: { id }, data: { likesCount: { decrement: 1 } } })
            ]);
            res.json({ isLiked: false });
        } else {
            const [_, targetPost] = await prisma.$transaction([
                prisma.userLike.create({ data: { userId, postId: id } }),
                prisma.post.update({ where: { id }, data: { likesCount: { increment: 1 } } })
            ]);
            if (targetPost.authorId) {
                await notify(userId, targetPost.authorId, 'like', 'liked your post', 'survey', id);
            }
            res.json({ isLiked: true });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to like post' });
    }
};

export const likeComment = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { userId } = req.body;
    try {
        const existing = await prisma.commentLike.findUnique({ where: { userId_commentId: { userId, commentId: id } } });
        if (existing) {
            await prisma.commentLike.delete({ where: { userId_commentId: { userId, commentId: id } } });
            await prisma.comment.update({ where: { id }, data: { likes: { decrement: 1 } } });
            res.json({ isLiked: false });
        } else {
            await prisma.commentLike.create({ data: { userId, commentId: id } });
            const targetComment = await prisma.comment.update({ where: { id }, data: { likes: { increment: 1 } } });
            if (targetComment.userId) {
                await notify(userId, targetComment.userId, 'like', 'liked your comment', 'comment', id);
            }
            res.json({ isLiked: true });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to like comment' });
    }
};

export const getPostLikers = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    try {
        const id = await resolveInteractionTarget(rawId, 'like');
        const currentUserId = req.user?.userId;
        const targetPostCheck = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
        if (targetPostCheck && targetPostCheck.authorId && currentUserId) {
            const canView = await PrivacyService.canViewUserContent(currentUserId, targetPostCheck.authorId);
            if (!canView) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }
        const likes = await prisma.userLike.findMany({
            where: { postId: id },
            include: { user: { select: SAFE_USER_SELECT } },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(likes.map(l => serializeUserMediaRecord(l.user)));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch likers' });
    }
};

export const getCommentLikers = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
        const likes = await prisma.commentLike.findMany({
            where: { commentId: id },
            include: { user: { select: SAFE_USER_SELECT } },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(likes.map(l => serializeUserMediaRecord(l.user)));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch comment likers' });
    }
};

export const savePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { userId } = req.body;
    try {
        const targetPostCheck = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
        if (targetPostCheck && targetPostCheck.authorId) {
            const canView = await PrivacyService.canViewUserContent(userId, targetPostCheck.authorId);
            if (!canView) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }
        const existing = await prisma.savedPost.findUnique({ where: { userId_postId: { userId, postId: id } } });
        if (existing) {
            await prisma.savedPost.delete({ where: { userId_postId: { userId, postId: id } } });
            res.json({ isSaved: false });
        } else {
            await prisma.savedPost.create({ data: { userId, postId: id } });
            res.json({ isSaved: true });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to save post' });
    }
};

export const hidePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { userId } = req.body;
    try {
        await prisma.hiddenPost.create({ data: { userId, postId: id } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to hide post' });
    }
};

export const reportPost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { userId, reason, description } = req.body;
    try {
        const report = await prisma.report.create({
            data: {
                targetId: id,
                targetType: 'POST',
                reporterId: userId,
                reason: description ? `${reason}: ${description}` : reason
            }
        });
        res.json(report);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to report post' });
    }
};

export const sharePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    const { caption } = req.body;
    try {
        const originalPost = await prisma.post.findUnique({
            where: { id },
            include: { questions: { include: { options: { orderBy: { order: 'asc' } } } }, targetedGroups: true }
        });
        if (!originalPost || (originalPost as any).isDeleted) {
            res.status(404).json({ error: 'Original post not found or has been deleted' });
            return;
        }

        if (originalPost.targetAudience === 'Private' || originalPost.targetAudience === 'Groups' || originalPost.groupId || (originalPost as any).targetedGroups?.length > 0) {
            res.status(403).json({ error: 'Cannot share private or group content' });
            return;
        }

        if (originalPost.authorId) {
            const canView = await PrivacyService.canViewUserContent(userId, originalPost.authorId);
            if (!canView) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }

        const actualSharedFromId = originalPost.sharedFromId ? originalPost.sharedFromId : originalPost.id;

        // If it's a direct repost (no caption), check if it already exists to toggle it off
        if (!caption || caption.trim() === '') {
            const existingRepost = await prisma.post.findFirst({
                where: {
                    authorId: userId,
                    sharedFromId: actualSharedFromId,
                    sharedCaption: null
                }
            });

            if (existingRepost) {
                // Un-repost!
                await prisma.$transaction([
                    prisma.post.delete({ where: { id: existingRepost.id } }),
                    prisma.post.update({
                        where: { id: actualSharedFromId },
                        data: { sharesCount: { decrement: 1 } }
                    })
                ]);
                res.json({ success: true, action: 'unshared' });
                return;
            }
        }

        const [newPost] = await prisma.$transaction([
            prisma.post.create({
            data: {
                title: originalPost.title,
                description: originalPost.description,
                type: originalPost.type,
                authorId: userId,
                expiresAt: originalPost.expiresAt,
                image: null,
                category: originalPost.category,
                targetAudience: originalPost.targetAudience,
                pollChoiceType: originalPost.pollChoiceType,
                imageLayout: originalPost.imageLayout,
                sharedFromId: actualSharedFromId,
                sharedCaption: caption || null,
                visibility: 'PUBLIC',
                status: 'PUBLISHED',
                allowAnonymous: originalPost.allowAnonymous,
                forceAnonymous: originalPost.forceAnonymous,
                allowComments: originalPost.allowComments,
                allowMultipleSelection: originalPost.allowMultipleSelection,
                allowUserOptions: originalPost.allowUserOptions,
                randomPairing: (originalPost as any).randomPairing,
                resultsWho: originalPost.resultsWho,
                resultsTiming: originalPost.resultsTiming,
                targetedGroups: (originalPost as any).targetedGroups && (originalPost as any).targetedGroups.length > 0 ? {
                    connect: (originalPost as any).targetedGroups.map((g: any) => ({ id: g.id }))
                } : undefined
            }
            }),
            prisma.post.update({
                where: { id: actualSharedFromId },
                data: { sharesCount: { increment: 1 } }
            })
        ]);

        const createdPost = await prisma.post.findUnique({
            where: { id: newPost.id },
            include: {
                author: { select: SAFE_USER_SELECT },
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                media: POST_MEDIA_INCLUDE,
                targetedGroups: true,
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
                    }
                }
            }
        });

        if (!createdPost) {
            res.status(500).json({ error: 'Failed to retrieve shared post' });
            return;
        }

        const p = serializePostMediaRecord(createdPost as any, userId);
        
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

        res.json(mappedPost);
    } catch (error) {
        console.error("Shared Post Error:", error);
        res.status(500).json({ error: 'Failed to share post' });
    }
};

export const updateComment = async (req: Request, res: Response) => {
    const id = req.params.id as string; // Comment ID
    const { text, userId } = req.body;
    try {
        const comment = await prisma.comment.findUnique({ where: { id } });
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        if (comment.userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized to edit this comment' });
        }

        const updated = await prisma.comment.update({
            where: { id },
            data: { text },
            include: {
                user: { select: SAFE_USER_SELECT },
                likesList: { select: { userId: true } },
                replies: {
                    include: { user: { select: SAFE_USER_SELECT }, likesList: { select: { userId: true } } }
                }
            }
        });

        res.json(mapComment(updated, userId));
    } catch (error) {
        console.error("Update Comment Error:", error);
        res.status(500).json({ error: 'Failed to update comment' });
    }
};

export const deleteComment = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { userId } = req.body;
    try {
        const comment = await prisma.comment.findUnique({ where: { id } });
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        if (comment.userId !== userId) {
            return res.status(403).json({ error: 'Unauthorized to delete this comment' });
        }

        // Must decrement commentsCount on the Post explicitly if needed, but the aggregate does it real-time.
        // Wait, aggregateMetrics fetches commentsCount natively if comments array is counted?
        // Actually the schema has `commentsCount` on the Post, but let's see how it was incremented.
        // createComment did: await tx.post.update({ where: { id: postId }, data: { commentsCount: { increment: 1 } } });
        await prisma.$transaction(async (tx) => {
            // Cascade delete likes and replies manually since no explicit schema cascade
            const replies = await tx.comment.findMany({ where: { parentId: id } });
            const replyIds = replies.map(r => r.id);
            if (replyIds.length > 0) {
                await tx.commentLike.deleteMany({ where: { commentId: { in: replyIds } } });
                await tx.comment.deleteMany({ where: { parentId: id } });
            }
            await tx.commentLike.deleteMany({ where: { commentId: id } });

            await tx.comment.delete({ where: { id } });

            // Decrement post commentsCount
            // We only decrement for root comments or we decrement for all? createComment increments for both.
            // Let's decrement by (1 + replies.length)
            await tx.post.update({
                where: { id: comment.postId },
                data: { commentsCount: { decrement: 1 + replyIds.length } }
            });
        });

        res.json({ success: true, message: 'Comment deleted successfully' });
    } catch (error) {
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
        if (post.authorId !== userId) {
            res.status(403).json({ error: 'Unauthorized to delete this post' });
            return;
        }

        const mediaAssetIds = [
            ...post.media.map(({ mediaAssetId }) => mediaAssetId),
            ...post.questions.flatMap((question) => [
                question.imageMediaId,
                ...question.options.map((option) => option.imageMediaId)
            ])
        ];

        // Hard Delete cascade via manual transaction
        await prisma.$transaction(async (tx) => {
            // Notifications about this post
            await tx.notification.deleteMany({ where: { targetId: id, targetType: 'survey' } });
            // Post interactions
            await tx.savedPost.deleteMany({ where: { postId: id } });
            await tx.hiddenPost.deleteMany({ where: { postId: id } });
            await tx.userLike.deleteMany({ where: { postId: id } });

            // Comments and their likes
            const comments = await tx.comment.findMany({ where: { postId: id } });
            const commentIds = comments.map(c => c.id);
            if (commentIds.length > 0) {
                await tx.commentLike.deleteMany({ where: { commentId: { in: commentIds } } });
                await tx.comment.deleteMany({ where: { postId: id } });
            }

            // Responses and Answers
            const responses = await tx.response.findMany({ where: { postId: id } });
            const responseIds = responses.map(r => r.id);
            if (responseIds.length > 0) {
                await tx.answer.deleteMany({ where: { responseId: { in: responseIds } } });
                await tx.response.deleteMany({ where: { postId: id } });
            }

            // Survey structure
            const questions = await tx.question.findMany({ where: { postId: id } });
            const questionIds = questions.map(q => q.id);
            if (questionIds.length > 0) {
                await tx.option.deleteMany({ where: { questionId: { in: questionIds } } });
                await tx.question.deleteMany({ where: { postId: id } });
            }
            await tx.section.deleteMany({ where: { postId: id } });

            // Finally delete the post
            await tx.post.delete({ where: { id } });

            // Decrement sharesCount of original post if applicable
            if (post.sharedFromId) {
                await tx.post.update({
                    where: { id: post.sharedFromId },
                    data: { sharesCount: { decrement: 1 } }
                });
            }
        });

        await scheduleMediaDeletion(mediaAssetIds);

        res.json({ success: true, message: 'Post permanently deleted' });
    } catch (error) {
        console.error("Hard delete failed:", error);
        res.status(500).json({ error: 'Failed to delete post permanently' });
    }
};

export const getPostAnalytics = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    try {
        const id = await resolveInteractionTarget(rawId, 'vote');
        const currentUserId = req.user?.userId;
        const originalPost = await prisma.post.findUnique({
            where: { id },
            select: {
                authorId: true,
                sharesCount: true,
                status: true,
                isDeleted: true
            }
        });

        if (!originalPost || originalPost.isDeleted || originalPost.status !== 'PUBLISHED') {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const canViewAuthorContent = await PrivacyService.canViewUserContent(currentUserId, originalPost.authorId);
        if (!canViewAuthorContent) {
            res.status(403).json({ error: 'You do not have access to this analytics data' });
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
