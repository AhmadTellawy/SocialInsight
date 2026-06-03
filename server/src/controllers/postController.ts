import { Request, Response } from 'express';
import prisma from '../prisma';
import { notify, extractAndNotifyMentions } from '../services/notificationService';
import { processBase64Image } from '../utils/imageProcessor';
import { PrivacyService } from '../services/privacyService';

export const SAFE_USER_SELECT = {
    id: true,
    name: true,
    handle: true,
    avatar: true,
    verifiedBadge: true
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
    const userId = req.query.userId as any;
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
                            where: { followerId: userId },
                            select: { followerId: true }
                        } : false
                    }
                },
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
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
                        author: { select: SAFE_USER_SELECT },
                        questions: { include: { options: { orderBy: { order: 'asc' } } } },
                        sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
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

        const mappedPosts = posts.map((s: any) => {
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
                coverImage: s.image,
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

export const getPostById = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.query.userId as any;
    const guestId = req.query.guestId as any;
    try {
        const post = await prisma.post.findFirst({
            where: { id, isDeleted: false },
            include: {
                author: {
                    select: {
                        ...SAFE_USER_SELECT,
                        following: userId ? {
                            where: { followerId: userId },
                            select: { followerId: true }
                        } : false
                    }
                },
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
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
                        author: { select: SAFE_USER_SELECT },
                        questions: { include: { options: { orderBy: { order: 'asc' } } } },
                        sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
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

        const p = post as any;
        if (p.status === 'DRAFT' && (!userId || p.authorId !== userId)) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        const canView = await PrivacyService.canViewUserContent(userId, p.authorId);
        if (!canView) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const targetGroupIds = mapTargetGroups(p);
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
            coverImage: p.image,
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
    console.log(`[CREATE POST] Received payload:`, JSON.stringify({ ...data, coverImage: undefined, image: undefined }, null, 2));
    console.log(`[CREATE POST] allowAnonymous received:`, data.allowAnonymous);
    try {
        let authorId = req.user?.userId || data.userId || data.authorId || data.author?.id;
        if (!authorId) {
            const defaultUser = await prisma.user.findFirst();
            authorId = defaultUser?.id;
        }

        // --- PRE-PROCESS IMAGES ---
        if (data.coverImage) data.coverImage = await processBase64Image(data.coverImage);
        if (data.image) data.image = await processBase64Image(data.image);

        if (data.options && Array.isArray(data.options)) {
            for (let opt of data.options) {
                if (opt.image) opt.image = await processBase64Image(opt.image);
            }
        }

        if (data.sections && Array.isArray(data.sections)) {
            for (let sec of data.sections) {
                if (sec.questions && Array.isArray(sec.questions)) {
                    for (let q of sec.questions) {
                        if (q.image) q.image = await processBase64Image(q.image);
                        if (q.options && Array.isArray(q.options)) {
                            for (let opt of q.options) {
                                if (opt.image) opt.image = await processBase64Image(opt.image);
                            }
                        }
                    }
                }
            }
        }
        // --------------------------

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

                    if (!membership || membership.status !== 'JOINED') {
                        res.status(403).json({ error: 'You must be a member of the group to post.' });
                        return;
                    }

                    if (group.postingPermissions === 'AdminsOnly' && membership.role === 'Member') {
                        res.status(403).json({ error: 'Only admins can post in this group.' });
                        return;
                    }

                    if (group.postingPermissions === 'ApprovalNeeded' && membership.role === 'Member') {
                        res.status(403).json({ error: 'Posts require admin approval in this group (feature pending).' });
                        return;
                    }
                }
            }
        }

        const postData: any = {
            title: data.title || "Untitled",
            description: data.description || "",
            type: normalizePostType(data.type) || "Post",
            authorId: authorId,
            category: data.category,
            image: data.coverImage || data.image,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            pollChoiceType: data.pollChoiceType,
            imageLayout: data.imageLayout,
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
            status: data.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED'
        };

        const { post, createdOptions, createdSections } = await prisma.$transaction(async (tx) => {
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

            if (OPTION_POST_TYPES.includes(typeStr) && data.options) {
                const question = await tx.question.create({
                    data: { text: data.title || "Poll Question", type: 'SingleChoice', postId: newPost.id }
                });
                await tx.option.createMany({
                    data: data.options.map((opt: any, index: number) => ({
                        text: opt.text,
                        image: opt.image,
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
                                order: q.order !== undefined ? q.order : qIdx,
                                isRequired: q.isRequired !== undefined ? q.isRequired : true,
                                postId: newPost.id,
                                sectionId: section.id
                            }
                        });

                        if (q.options?.length) {
                            await tx.option.createMany({
                                data: q.options.map((opt: any, index: number) => ({
                                    text: opt.text,
                                    image: opt.image,
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

            return { post: newPost, createdOptions: optionsList, createdSections: sectionsList };
        });

        console.log(`[CREATE POST] Saved to DB:`, JSON.stringify({ id: post.id, allowAnonymous: postData.allowAnonymous, forceAnonymous: postData.forceAnonymous }));

        if (postData.status === 'PUBLISHED') {
            const fullText = `${post.title} ${post.description}`;
            await extractAndNotifyMentions(fullText, authorId, 'survey', post.id);
        }

        const mappedPost = {
            ...post,
            likes: post.likesCount,
                repostCount: post.sharesCount || 0,
            participants: post.responseCount,
            coverImage: post.image,
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
        res.status(500).json({ error: 'Failed to create post' });
    }
};

export const updatePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const data = req.body;
    console.log(`[UPDATE POST] ID: ${id} | Received payload:`, JSON.stringify({ ...data, coverImage: undefined, image: undefined }, null, 2));
    console.log(`[UPDATE POST] allowAnonymous received:`, data.allowAnonymous);
    try {
        const trustedUserId = req.user?.userId || data.userId;
        const existingPost = await prisma.post.findUnique({
            where: { id },
            select: { authorId: true, status: true, createdAt: true, isDeleted: true, responseCount: true }
        });

        if (!existingPost || existingPost.isDeleted) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }

        if (!trustedUserId || existingPost.authorId !== trustedUserId) {
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

        // --- PRE-PROCESS IMAGES ---
        if (data.coverImage) data.coverImage = await processBase64Image(data.coverImage);
        if (data.image) data.image = await processBase64Image(data.image);

        if (data.options && Array.isArray(data.options)) {
            for (let opt of data.options) {
                if (opt.image) opt.image = await processBase64Image(opt.image);
            }
        }

        if (data.sections && Array.isArray(data.sections)) {
            for (let sec of data.sections) {
                if (sec.questions && Array.isArray(sec.questions)) {
                    for (let q of sec.questions) {
                        if (q.image) q.image = await processBase64Image(q.image);
                        if (q.options && Array.isArray(q.options)) {
                            for (let opt of q.options) {
                                if (opt.image) opt.image = await processBase64Image(opt.image);
                            }
                        }
                    }
                }
            }
        }
        // --------------------------

        if (data.targetGroups && Array.isArray(data.targetGroups) && data.targetGroups.length > 0) {
            for (const groupId of data.targetGroups) {
                const group = await prisma.group.findUnique({
                    where: { id: groupId },
                    select: { postingPermissions: true }
                });
                if (!group) continue;

                const membership = await prisma.groupMember.findUnique({
                    where: { userId_groupId: { userId: trustedUserId, groupId } }
                });

                if (!membership || membership.status !== 'JOINED') {
                    res.status(403).json({ error: 'You must be a member of the group to post.' });
                    return;
                }

                if (group.postingPermissions === 'AdminsOnly' && membership.role === 'Member') {
                    res.status(403).json({ error: 'Only admins can post in this group.' });
                    return;
                }

                if (group.postingPermissions === 'ApprovalNeeded' && membership.role === 'Member') {
                    res.status(403).json({ error: 'Posts require admin approval in this group (feature pending).' });
                    return;
                }
            }
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
            ...(data.status !== undefined && { status: data.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED' }),
            ...(data.targetAudience !== undefined && { targetAudience: data.targetAudience }),
            ...(data.targetGroups !== undefined && { 
                targetedGroups: { 
                    set: Array.isArray(data.targetGroups) ? data.targetGroups.map((id: string) => ({ id })) : [] 
                } 
            }),
            ...(data.pollChoiceType !== undefined && { pollChoiceType: data.pollChoiceType }),
            ...(data.imageLayout !== undefined && { imageLayout: data.imageLayout }),
            ...(data.randomPairing !== undefined && { randomPairing: parseBoolean(data.randomPairing) }),
            ...(data.demographics !== undefined && { demographics: normalizeDemographicFilters(data.demographics) })
        };

        const post = await prisma.post.update({
            where: { id },
            data: updateData,
            include: {
                author: { select: SAFE_USER_SELECT },
                targetedGroups: true
            }
        });
        console.log(`[UPDATE POST] Saved to DB:`, JSON.stringify({ id: post.id, allowAnonymous: updateData.allowAnonymous }));

        if (existingPost.status !== 'PUBLISHED' && updateData.status === 'PUBLISHED') {
            const fullText = `${post.title} ${post.description}`;
            await extractAndNotifyMentions(fullText, trustedUserId, 'survey', post.id);
        }

        let finalOptions: any[] = [];
        let finalSections: any[] = [];
        const typeStr = normalizePostType(post.type) || '';

        if (OPTION_POST_TYPES.includes(typeStr) && data.options) {
            let question = await prisma.question.findFirst({ where: { postId: id } });
            if (!question) {
                question = await prisma.question.create({
                    data: { text: data.title || "Poll Question", type: 'SingleChoice', postId: id }
                });
            }

            const incomingOptions = data.options;
            const existingOptions = await prisma.option.findMany({ where: { questionId: question.id } });
            const existingIds = existingOptions.map(o => o.id);
            const incomingIds = incomingOptions.map((o: any) => o.id);

            const idsToDelete = existingIds.filter(optId => !incomingIds.includes(optId));
            if (idsToDelete.length > 0) {
                await prisma.option.deleteMany({ where: { id: { in: idsToDelete } } });
            }

            for (let i = 0; i < incomingOptions.length; i++) {
                const opt = incomingOptions[i];
                if (existingIds.includes(opt.id)) {
                    await prisma.option.update({
                        where: { id: opt.id },
                        data: {
                            text: opt.text,
                            image: opt.image,
                            isRating: opt.isRating || false,
                            ratingValue: opt.ratingValue || 0,
                            withFollowUp: parseBoolean(opt.withFollowUp),
                            followUpLabel: opt.followUpLabel || null,
                            order: i
                        }
                    });
                } else {
                    await prisma.option.create({
                        data: {
                            text: opt.text,
                            image: opt.image,
                            questionId: question.id,
                            isRating: opt.isRating || false,
                            ratingValue: opt.ratingValue || 0,
                            withFollowUp: parseBoolean(opt.withFollowUp),
                            followUpLabel: opt.followUpLabel || null,
                            order: i
                        }
                    });
                }
            }
            finalOptions = await prisma.option.findMany({ where: { questionId: question.id }, orderBy: { order: 'asc' } });
        } else if (OPTION_POST_TYPES.includes(typeStr)) {
            const question = await prisma.question.findFirst({ where: { postId: id } });
            if (question) {
                finalOptions = await prisma.option.findMany({ where: { questionId: question.id }, orderBy: { order: 'asc' } });
            }
        } else if (SECTION_POST_TYPES.includes(typeStr) && data.sections) {
            const oldSections = await prisma.section.findMany({ where: { postId: id }, include: { questions: true } });
            const oldSectionIds = oldSections.map(s => s.id);
            const oldQuestionIds = oldSections.flatMap(s => s.questions.map(q => q.id));

            if (oldQuestionIds.length > 0) {
                await prisma.option.deleteMany({ where: { questionId: { in: oldQuestionIds } } });
                await prisma.question.deleteMany({ where: { id: { in: oldQuestionIds } } });
            }
            if (oldSectionIds.length > 0) {
                await prisma.section.deleteMany({ where: { id: { in: oldSectionIds } } });
            }

            for (const [sIdx, sec] of data.sections.entries()) {
                const section = await prisma.section.create({
                    data: {
                        title: sec.title || `Section ${sIdx + 1}`,
                        order: sec.order !== undefined ? sec.order : sIdx,
                        postId: post.id
                    }
                });

                for (const [qIdx, q] of (sec.questions || []).entries()) {
                    const question = await prisma.question.create({
                        data: {
                            text: q.text,
                            type: typeStr === 'Quiz' ? 'multiple_choice' : (q.type || 'multiple_choice'),
                            image: q.image,
                            order: q.order !== undefined ? q.order : qIdx,
                            isRequired: q.isRequired !== undefined ? q.isRequired : true,
                            postId: post.id,
                            sectionId: section.id
                        }
                    });

                    if (q.options?.length) {
                        await prisma.option.createMany({
                            data: q.options.map((opt: any, index: number) => ({
                                text: opt.text,
                                image: opt.image,
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

            const fullyPopulatedPost = await prisma.post.findUnique({
                where: { id: post.id },
                include: { sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } } }
            });
            if (fullyPopulatedPost?.sections) {
                finalSections = fullyPopulatedPost.sections;
            }
        } else if (SECTION_POST_TYPES.includes(typeStr)) {
            const fullyPopulatedPost = await prisma.post.findUnique({
                where: { id: post.id },
                include: { sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } } }
            });
            if (fullyPopulatedPost?.sections) {
                finalSections = fullyPopulatedPost.sections;
            }
        }

        const mappedPost = {
            ...post,
            likes: post.likesCount,
                repostCount: post.sharesCount || 0,
            participants: post.responseCount,
            coverImage: post.image,
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
        res.status(500).json({ error: 'Failed to update post' });
    }
};

export const getDrafts = async (req: Request, res: Response) => {
    const userId = req.query.userId as any;
    try {
        const drafts = await prisma.post.findMany({
            where: { authorId: userId, status: 'DRAFT', isDeleted: false },
            include: {
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                targetedGroups: true,
                author: { select: SAFE_USER_SELECT }
            },
            orderBy: { updatedAt: 'desc' }
        });
        const mappedDrafts = drafts.map((d: any) => ({
            ...d,
            likes: d.likesCount,
                repostCount: d.sharesCount || 0,
            participants: d.responseCount,
            coverImage: d.image,
            options: OPTION_POST_TYPES.includes(normalizePostType(d.type) || '') && d.questions.length > 0 ? d.questions[0].options : [],
            sections: d.sections,
            allowAnonymous: d.allowAnonymous,
            forceAnonymous: d.forceAnonymous,
            randomPairing: d.randomPairing,
            demographics: parseJsonArray(d.demographics),
            targetGroups: mapTargetGroups(d)
        }));
        res.json(mappedDrafts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch drafts' });
    }
};

export const getSavedPosts = async (req: Request, res: Response) => {
    const userId = req.query.userId as any;
    try {
        const saved = await prisma.savedPost.findMany({
            where: { 
                userId, 
                post: { 
                    isDeleted: false,
                    ...PrivacyService.getPostPrivacyWhereClause(userId)
                } 
            },
            include: {
                post: {
                    include: {
                        author: { select: SAFE_USER_SELECT },
                        questions: { include: { options: { orderBy: { order: 'asc' } } } },
                        sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                        targetedGroups: true,
                        responses: userId ? { where: { userId }, take: 1, include: { answers: true } } : false,
                        likes: userId ? { where: { userId }, take: 1 } : false
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        const posts = saved.map((s: any) => {
            const p: any = s.post;
            const userResponse = p.responses?.[0];
            const userAnswers = userResponse?.answers || [];
            return {
                ...p,
                likes: p.likesCount,
                repostCount: p.sharesCount || 0,
                participants: p.responseCount,
                coverImage: p.image,
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
        const currentUserId = req.user?.userId || (req.query.userId as string | undefined);
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
        if (post && (post as any).forceAnonymous === true) {
            return res.json([]);
        }

        const isAuthor = !!currentUserId && (post as any).authorId === currentUserId;
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
            if (!follow) {
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
                 ...r.user,
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
        const currentUserId = req.user?.userId || (req.query.userId as string | undefined);
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
            if (!follow) {
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
            whoPasses = !!follow;
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

const mapComment = (c: any, currentUserId?: string) => ({
    id: c.id,
    text: c.text,
    author: {
        id: c.user?.id || 'unknown',
        name: c.user?.name || 'Unknown',
        avatar: c.user?.avatar || '',
        handle: c.user?.handle || '',
        verifiedBadge: c.user?.verifiedBadge || false
    },
    timestamp: c.createdAt.toISOString(),
    likes: c.likes || 0,
    isLiked: currentUserId && c.likesList ? c.likesList.some((l: any) => l.userId === currentUserId) : false,
    replies: c.replies ? c.replies.map((r: any) => mapComment(r, currentUserId)) : []
});

export const getComments = async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const userId = req.query.userId as string | undefined;
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
    const { text, parentId } = req.body;
    try {
        const id = await resolveInteractionTarget(rawId, 'comment');
        const userId = req.user?.userId || req.body.userId;
        const cleanText = typeof text === 'string' ? text.trim() : '';
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
        const likes = await prisma.userLike.findMany({
            where: { postId: id },
            include: { user: { select: SAFE_USER_SELECT } },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(likes.map(l => l.user));
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
        res.json(likes.map(l => l.user));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch comment likers' });
    }
};

export const savePost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { userId } = req.body;
    try {
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
    const { userId, caption } = req.body;
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
                image: originalPost.image,
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
                targetedGroups: true,
                sharedFrom: {
                    include: {
                        author: { select: SAFE_USER_SELECT },
                        questions: { include: { options: { orderBy: { order: 'asc' } } } },
                        sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                        targetedGroups: true,
                    }
                }
            }
        });

        if (!createdPost) {
            res.status(500).json({ error: 'Failed to retrieve shared post' });
            return;
        }

        const p = createdPost as any;
        
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
            coverImage: p.image,
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
    const { userId } = req.body;
    try {
        const post = await prisma.post.findUnique({ where: { id } });
        if (!post) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }
        if (post.authorId !== userId) {
            res.status(403).json({ error: 'Unauthorized to delete this post' });
            return;
        }

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

        res.json({ success: true, message: 'Post permanently deleted' });
    } catch (error) {
        console.error("Hard delete failed:", error);
        res.status(500).json({ error: 'Failed to delete post permanently' });
    }
};

export const getPostAnalytics = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
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
        
        const originalPost = await prisma.post.findUnique({
            where: { id },
            select: { sharesCount: true }
        });

        res.json({
            totalGlobalLikes: aggregateMetrics._sum?.likesCount || 0,
            totalGlobalComments: aggregateMetrics._sum?.commentsCount || 0,
            totalSharesCount: (originalPost as any)?.sharesCount || 0,
            totalParticipants: aggregateMetrics._sum?.responseCount || 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch global analytics' });
    }
};
