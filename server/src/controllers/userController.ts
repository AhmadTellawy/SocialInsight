import { Request, Response } from 'express';
import prisma from '../prisma';
import { PrivacyService } from '../services/privacyService';
import { notify } from '../services/notificationService';
import { processBase64Image } from '../utils/imageProcessor';
import { GroupPermissionService } from '../services/groupPermissionService';
import { MEMBERSHIP_STATUS, POST_STATUS } from '../utils/constants';
import {
    commitPreparedMedia,
    getStoredMediaPresentation,
    prepareMediaAttachments,
    rollbackPreparedMedia,
    scheduleMediaDeletion
} from '../services/mediaService';
import { requestMediaPrivacyTransition } from '../services/mediaPrivacyTransitionService';
import { MediaValidationError } from '../services/mediaProcessor';

const SAFE_USER_SELECT = {
    id: true,
    name: true,
    handle: true,
    avatar: true,
    avatarMediaId: true,
    bio: true,
    location: true,
    website: true,
    isPrivate: true,
    mediaPrivacyTarget: true,
    groupPrivacy: true,
    verifiedBadge: true, // Renamed from isVerified
    followersCount: true,
    followingCount: true,
    createdAt: true,
    country: true,
    language: true,
    status: true
};

export const getUsers = async (req: Request, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            take: 20,
            select: SAFE_USER_SELECT
        });
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
};

export const searchUsers = async (req: Request, res: Response) => {
    try {
        const query = String(req.query.q || '').trim();
        const userId = req.query.userId as string | undefined;

        if (!query) {
            return res.json([]);
        }

        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { handle: { contains: query, mode: 'insensitive' } },
                    { name: { contains: query, mode: 'insensitive' } }
                ],
                status: 'ACTIVE',
                ...(userId ? {
                    NOT: [
                        { blockedBy: { some: { blockerId: userId } } },
                        { blocking: { some: { blockedId: userId } } }
                    ]
                } : {})
            },
            take: 10,
            select: SAFE_USER_SELECT
        });

        res.json(users);
    } catch (error) {
        console.error('Failed to search users:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
};

export const getUser = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const user = await prisma.user.findUnique({
            where: { id: id as string }
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const { password: _, passwordHash: __, ...safeUser } = user;

        const demographics = await prisma.userDemographics.findUnique({
            where: { userId: user.id }
        });

        let followStatus = 'NONE';
        if (req.user?.userId && req.user.userId !== user.id) {
            const blockRecord = await prisma.userBlock.findFirst({
                where: {
                    OR: [
                        { blockerId: req.user.userId, blockedId: user.id },
                        { blockerId: user.id, blockedId: req.user.userId }
                    ]
                }
            });
            if (blockRecord) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: req.user.userId, followingId: user.id } }
            });
            if (follow) {
                followStatus = follow.status;
            }
        }

        const [postsCount, responsesCount] = await Promise.all([
            prisma.post.count({
                where: { authorId: user.id, isDeleted: false, status: 'PUBLISHED', sharedFromId: null }
            }),
            prisma.response.count({
                where: { post: { authorId: user.id, isDeleted: false, status: 'PUBLISHED' } }
            })
        ]);

        res.json({
            ...safeUser,
            followStatus,
            isFollowing: followStatus === 'ACTIVE',
            demographics: demographics || {},
            stats: {
                followers: user.followersCount,
                following: user.followingCount,
                posts: postsCount,
                responses: responsesCount
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
};

export const getUserByHandle = async (req: Request, res: Response) => {
    const { handle } = req.params;
    try {
        let cleanHandle = handle as string;
        if (cleanHandle.startsWith('@')) {
            cleanHandle = cleanHandle.substring(1);
        }

        const user = await prisma.user.findUnique({
            where: { handle: cleanHandle }
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const { password: _, passwordHash: __, ...safeUser } = user;

        const demographics = await prisma.userDemographics.findUnique({
            where: { userId: user.id }
        });

        let followStatus = 'NONE';
        if (req.user?.userId && req.user.userId !== user.id) {
            const blockRecord = await prisma.userBlock.findFirst({
                where: {
                    OR: [
                        { blockerId: req.user.userId, blockedId: user.id },
                        { blockerId: user.id, blockedId: req.user.userId }
                    ]
                }
            });
            if (blockRecord) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: req.user.userId, followingId: user.id } }
            });
            if (follow) {
                followStatus = follow.status;
            }
        }

        const [postsCount, responsesCount] = await Promise.all([
            prisma.post.count({
                where: { authorId: user.id, isDeleted: false, status: 'PUBLISHED', sharedFromId: null }
            }),
            prisma.response.count({
                where: { post: { authorId: user.id, isDeleted: false, status: 'PUBLISHED' } }
            })
        ]);

        res.json({
            ...safeUser,
            followStatus,
            isFollowing: followStatus === 'ACTIVE',
            demographics: demographics || {},
            stats: {
                followers: user.followersCount,
                following: user.followingCount,
                posts: postsCount,
                responses: responsesCount
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch user by handle' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    
    if (req.user?.userId !== id) {
        return res.status(403).json({ error: 'Forbidden: You can only update your own profile' });
    }

    const data = req.body;

    try {
        if (data.avatar && data.avatarMediaId === undefined) {
            data.avatar = await processBase64Image(data.avatar);
        }

        const allowedFields = ['name', 'handle', 'avatar', 'bio', 'location', 'website', 'language', 'country', 'groupPrivacy'];
        const updateData: any = {};
        allowedFields.forEach(field => {
            if (data[field] !== undefined) updateData[field] = data[field];
        });

        const currentUser = await prisma.user.findUnique({ where: { id }, select: { avatarMediaId: true } });
        let oldAvatarMediaId: string | null | undefined;
        if (data.avatarMediaId !== undefined) {
            oldAvatarMediaId = currentUser?.avatarMediaId;
            if (data.avatarMediaId === null) {
                updateData.avatarMediaId = null;
                updateData.avatar = null;
            } else {
                const prepared = await prepareMediaAttachments(id, [{ id: data.avatarMediaId, purpose: 'PROFILE_AVATAR' }], 'PUBLIC');
                try {
                    const presentation = await getStoredMediaPresentation(data.avatarMediaId);
                    if (!presentation?.src) throw new MediaValidationError('MEDIA_NOT_READY', 'Avatar variants are unavailable.', 409);
                    updateData.avatarMediaId = data.avatarMediaId;
                    updateData.avatar = presentation.src;
                    await prisma.$transaction(async (tx) => {
                        await tx.user.update({ where: { id }, data: updateData });
                        await commitPreparedMedia(tx, prepared);
                    });
                } catch (error) {
                    await rollbackPreparedMedia(prepared);
                    throw error;
                }
            }
        }

        if (data.avatarMediaId === undefined || data.avatarMediaId === null) {
            await prisma.user.update({ where: { id }, data: updateData });
        }

        if (oldAvatarMediaId && oldAvatarMediaId !== data.avatarMediaId) {
            await scheduleMediaDeletion([oldAvatarMediaId]);
        }

        if (typeof data.isPrivate === 'boolean') {
            await requestMediaPrivacyTransition(id, data.isPrivate);
        }

        // Auto-accept pending requests when switching to Public
        if (data.isPrivate === false) {
            const pendingRequests = await prisma.follow.findMany({
                where: { followingId: id as string, status: 'PENDING' }
            });

            if (pendingRequests.length > 0) {
                await prisma.follow.updateMany({
                    where: { followingId: id as string, status: 'PENDING' },
                    data: { status: 'ACTIVE', approvedAt: new Date() }
                });

                await prisma.user.update({
                    where: { id: id as string },
                    data: { followersCount: { increment: pendingRequests.length } }
                });

                for (const req of pendingRequests) {
                    await prisma.user.update({
                        where: { id: req.followerId },
                        data: { followingCount: { increment: 1 } }
                    });
                    await notify(id as string, req.followerId, 'follow_accept', 'Automatically accepted your follow request', 'profile', id as string);
                }
            }
        }

        let demographics = null;
        if (data.demographics) {
            interface DemoData {
                gender?: string;
                maritalStatus?: string;
                ageGroup?: string;
                educationLevel?: string;
                employmentType?: string;
                industry?: string;
                sector?: string;
            }
            const rawDemo: any = typeof data.demographics === 'string' ? JSON.parse(data.demographics) : data.demographics;
            // Force type assertion to avoid ambiguity
            const demoData: DemoData = {
                gender: typeof rawDemo.gender === 'string' ? rawDemo.gender : undefined,
                maritalStatus: typeof rawDemo.maritalStatus === 'string' ? rawDemo.maritalStatus : undefined,
                ageGroup: typeof rawDemo.ageGroup === 'string' ? rawDemo.ageGroup : undefined,
                educationLevel: typeof rawDemo.educationLevel === 'string' ? rawDemo.educationLevel : undefined,
                employmentType: typeof rawDemo.employmentType === 'string' ? rawDemo.employmentType : undefined,
                industry: typeof rawDemo.industry === 'string' ? rawDemo.industry : undefined,
                sector: typeof rawDemo.sector === 'string' ? rawDemo.sector : undefined
            };

            demographics = await prisma.userDemographics.upsert({
                where: { userId: id },
                create: {
                    userId: id,
                    gender: demoData.gender,
                    maritalStatus: demoData.maritalStatus,
                    ageGroup: demoData.ageGroup,
                    educationLevel: demoData.educationLevel,
                    employmentType: demoData.employmentType,
                    industry: demoData.industry,
                    employmentSector: demoData.sector
                },
                update: {
                    gender: demoData.gender,
                    maritalStatus: demoData.maritalStatus,
                    ageGroup: demoData.ageGroup,
                    educationLevel: demoData.educationLevel,
                    employmentType: demoData.employmentType,
                    industry: demoData.industry,
                    employmentSector: demoData.sector
                }
            });
        } else {
            demographics = await prisma.userDemographics.findUnique({ where: { userId: id } });
        }

        const [postsCount, responsesCount] = await Promise.all([
            prisma.post.count({
                where: { authorId: id as string, isDeleted: false, status: 'PUBLISHED', sharedFromId: null }
            }),
            prisma.response.count({
                where: { post: { authorId: id as string, isDeleted: false, status: 'PUBLISHED' } }
            })
        ]);

        const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: SAFE_USER_SELECT });
        res.json({
            ...user,
            isPrivate: user.mediaPrivacyTarget === true || user.isPrivate,
            demographics,
            stats: {
                followers: user.followersCount,
                following: user.followingCount,
                posts: postsCount,
                responses: responsesCount
            }
        });
    } catch (error) {
        console.error("Update User Error:", error);
        if (error instanceof MediaValidationError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        if (error instanceof Error && error.message.includes('privacy transition')) {
            return res.status(409).json({ error: error.message, code: 'PRIVACY_TRANSITION_IN_PROGRESS' });
        }
        res.status(500).json({ error: 'Failed to update user' });
    }
};

export const getUserAnalytics = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;
    try {
        if (currentUserId) {
            const canView = await PrivacyService.canViewUserContent(currentUserId, id);
            if (!canView) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        } else if (id !== currentUserId) { // No auth provided and they are not the same
            const targetUser = await prisma.user.findUnique({ where: { id }, select: { isPrivate: true } });
            if (targetUser?.isPrivate) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }
        const posts = await prisma.post.findMany({
            where: { authorId: id, isDeleted: false, status: 'PUBLISHED', sharedFromId: null },
            include: {
                responses: {
                    include: {
                        user: {
                            select: {
                                country: true,
                                demographics: true, // This now selects the relation!
                                // birthday: true // Removed
                            }
                        }
                    }
                }
            }
        });

        let totalResponses = 0;
        const byType: Record<string, number> = {};
        const byCountry: Record<string, number> = {};
        const byGender: Record<string, number> = {};
        const byAge: Record<string, number> = {};

        ['Poll', 'Survey', 'Quiz', 'Challenge'].forEach(k => byType[k] = 0);
        ['Male', 'Female'].forEach(k => byGender[k] = 0);

        posts.forEach(post => {
            const type = post.type || 'Survey';
            const responseCount = post.responses.length;
            totalResponses += responseCount;
            byType[type] = (byType[type] || 0) + responseCount;

            post.responses.forEach((response: any) => {
                const rUser = response.user;
                if (rUser && rUser.country) {
                    byCountry[rUser.country] = (byCountry[rUser.country] || 0) + 1;
                }

                const demo = rUser?.demographics as any;
                if (demo) {
                    if (demo.gender) byGender[demo.gender] = (byGender[demo.gender] || 0) + 1;
                    if (demo.ageGroup) byAge[demo.ageGroup] = (byAge[demo.ageGroup] || 0) + 1;
                }
            });
        });

        res.json({ totalResponses, byType, byCountry, byGender, byAge });
    } catch (error) {
        console.error("Analytics Error:", error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
};

export const getUserFollowers = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { currentUserId } = req.query;
    try {
        const canView = await PrivacyService.canViewUserContent(currentUserId as string, id as string);
        if (!canView) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const followers = await prisma.follow.findMany({
            where: { followingId: id as string, status: 'ACTIVE' },
            include: {
                follower: {
                    select: {
                        ...SAFE_USER_SELECT,
                        following: currentUserId ? {
                            where: { followerId: currentUserId as string },
                            select: { status: true }
                        } : false
                    }
                }
            }
        });

        const mapped = (followers as any[]).map(f => ({
            id: f.follower.id,
            name: f.follower.name,
            handle: f.follower.handle,
            avatar: f.follower.avatar,
            followStatus: currentUserId ? (f.follower.following && f.follower.following.length > 0 ? f.follower.following[0].status : 'NONE') : 'NONE'
        }));

        res.json(mapped);
    } catch (error) {
        console.error("Get Followers Error:", error);
        res.status(500).json({ error: 'Failed to fetch followers' });
    }
};

export const getUserFollowing = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { currentUserId } = req.query;
    try {
        const canView = await PrivacyService.canViewUserContent(currentUserId as string, id as string);
        if (!canView) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const following = await prisma.follow.findMany({
            where: { followerId: id as string, status: 'ACTIVE' },
            include: {
                following: {
                    select: {
                        ...SAFE_USER_SELECT,
                        following: currentUserId ? {
                            where: { followerId: currentUserId as string },
                            select: { status: true }
                        } : false
                    }
                }
            }
        });

        const mapped = (following as any[]).map(f => ({
            id: f.following.id,
            name: f.following.name,
            handle: f.following.handle,
            avatar: f.following.avatar,
            followStatus: currentUserId ? (f.following.following && f.following.following.length > 0 ? f.following.following[0].status : 'NONE') : 'NONE'
        }));

        res.json(mapped);
    } catch (error) {
        console.error("Get Following Error:", error);
        res.status(500).json({ error: 'Failed to fetch following' });
    }
};


export const getNotifications = async (req: Request, res: Response) => {
    console.log(`[API] getNotifications requested for userId: ${req.params.id}`);
    const id = req.params.id as string;

    if (req.user?.userId !== id) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        console.log(`[API] Calling prisma.notification.findMany for ${id}`);
        const notifications = await prisma.notification.findMany({
            where: { userId: id as string },
            orderBy: { createdAt: 'desc' },
            include: {
                actor: {
                    select: { id: true, name: true, avatar: true }
                }
            }
        });
        console.log(`[API] prisma.notification returned ${notifications.length} rows`);

        const mapped = notifications.map((n: any) => ({
            id: n.id,
            type: n.type,
            message: n.message,
            targetId: n.targetId,
            targetType: n.targetType === 'user' ? 'profile' : n.targetType,
            isRead: n.isRead,
            timestamp: n.createdAt.toISOString(),
            createdAt: n.createdAt.getTime(),
            actor: n.actor ? {
                id: n.actor.id,
                name: n.actor.name,
                avatar: n.actor.avatar
            } : undefined
        }));

        res.json(mapped);
    } catch (error) {
        console.error("Get Notifications Error:", error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

export const getNotificationSettings = async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID is missing' });
    }

    try {
        const settings = await prisma.notificationSettings.findUnique({
            where: { userId }
        });

        if (!settings) {
            return res.status(404).json({ error: 'Settings not found' });
        }
        res.json({
            settings: JSON.parse(settings.settings),
            updatedAt: settings.updatedAt.toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
};

export const updateNotificationSettings = async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: User ID is missing' });
    }

    const { settings, updatedAt } = req.body;
    try {
        const record = await prisma.notificationSettings.upsert({
            where: { userId },
            update: { settings: JSON.stringify(settings), updatedAt: new Date() },
            create: { userId, settings: JSON.stringify(settings) }
        });
        res.json({
            settings: JSON.parse(record.settings),
            updatedAt: record.updatedAt.toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
};

export const markNotificationsRead = async (req: Request, res: Response) => {
    const id = req.params.id as string;

    if (req.user?.userId !== id) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        await prisma.notification.updateMany({
            where: { userId: id as string, isRead: false },
            data: { isRead: true }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Mark Notifications Read Error:", error);
        res.status(500).json({ error: 'Failed to mark notifications read' });
    }
};

export const markSingleNotificationRead = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const notifId = req.params.notifId as string;

    if (req.user?.userId !== id) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        await prisma.notification.update({
            where: { id: notifId, userId: id as string },
            data: { isRead: true, readAt: new Date() }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Mark Single Notification Read Error:", error);
        res.status(500).json({ error: 'Failed to mark single notification read' });
    }
};

export const getUserGroups = async (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    try {
        if (currentUserId) {
            const canView = await PrivacyService.canViewUserContent(currentUserId, id as string);
            if (!canView) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        } else {
            const targetUser = await prisma.user.findUnique({ where: { id: id as string }, select: { isPrivate: true } });
            if (targetUser?.isPrivate) {
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
        }
        const memberships = await prisma.groupMember.findMany({
            where: {
                userId: id as string,
                status: MEMBERSHIP_STATUS.JOINED,
                group: { isDeleted: false }
            },
            include: {
                group: true
            }
        });

        const groups = await Promise.all(memberships.map(async (m) => {
            const [memberCount, postsCount] = await Promise.all([
                prisma.groupMember.count({
                    where: { groupId: m.groupId, status: MEMBERSHIP_STATUS.JOINED }
                }),
                prisma.post.count({
                    where: {
                        targetedGroups: { some: { id: m.groupId } },
                        isDeleted: false,
                        status: POST_STATUS.PUBLISHED
                    }
                })
            ]);

            return {
                ...m.group,
                memberCount,
                postsCount,
                permissions: GroupPermissionService.calculatePermissions(m.group, m.role, m.status),
                role: m.role
            };
        }));

        res.json(groups);
    } catch (error) {
        console.error("Get User Groups Error:", error);
        res.status(500).json({ error: 'Failed to fetch user groups' });
    }
};

export const getSuggestedUsers = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // 1. Get users I already follow to exclude them
        const following = await prisma.follow.findMany({
            where: { followerId: id as string },
            select: { followingId: true }
        });
        const excludedIds = following.map(f => f.followingId);
        excludedIds.push(id as string); // Also exclude myself

        // 2. Find interaction-based suggestions
        const likes = await prisma.userLike.findMany({
            where: { userId: id as string },
            include: { post: { select: { authorId: true } } }
        });
        const comments = await prisma.comment.findMany({
            where: { userId: id as string },
            include: { post: { select: { authorId: true } } }
        });
        const responses = await prisma.response.findMany({
            where: { userId: id as string },
            include: { post: { select: { authorId: true } } }
        });

        // Collect unique authors we've interacted with (but don't follow)
        const interactedAuthorIds = new Set<string>();
        [...likes, ...comments, ...responses].forEach((interaction: any) => {
            const authorId = interaction.post?.authorId;
            if (authorId && !excludedIds.includes(authorId)) {
                interactedAuthorIds.add(authorId);
            }
        });

        const interactionSuggestions = await prisma.user.findMany({
            where: {
                id: { in: Array.from(interactedAuthorIds) },
                status: 'ACTIVE'
            },
            take: 5,
            select: SAFE_USER_SELECT
        });

        // Add a "reason" field
        const suggestedList = interactionSuggestions.map(u => ({
            ...u,
            suggestionReason: 'Recently interacted'
        }));

        // 3. If we don't have enough (less than 10), pad with popular users
        if (suggestedList.length < 10) {
            const currentIds = [...excludedIds, ...suggestedList.map(u => u.id)];
            
            const popularSuggestions = await prisma.user.findMany({
                where: {
                    id: { notIn: currentIds },
                    status: 'ACTIVE'
                },
                orderBy: { followersCount: 'desc' },
                take: 10 - suggestedList.length,
                select: SAFE_USER_SELECT
            });

            suggestedList.push(...popularSuggestions.map(u => ({
                ...u,
                suggestionReason: 'Suggested for you'
            })));
        }

        // Shuffle the list slightly (optional) or just return
        res.json(suggestedList);
    } catch (error) {
        console.error("Get Suggested Users Error:", error);
        res.status(500).json({ error: 'Failed to fetch suggested users' });
    }
};

export const deleteAccount = async (req: Request, res: Response) => {
    const id = req.params.id as string;

    if (req.user?.userId !== id) {
        return res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
    }
    try {
        const ownedMediaIds = (await prisma.mediaAsset.findMany({
            where: { ownerId: id, status: { not: 'DELETED' } },
            select: { id: true }
        })).map((asset) => asset.id);
        await prisma.$transaction(async (tx) => {
            // Nullify user PII and soft delete
            await tx.user.update({
                where: { id },
                data: {
                    status: 'DELETED',
                    deletedAt: new Date(),
                    name: 'Deleted User',
                    handle: `deleted_${id.substring(0, 8)}`,
                    email: null,
                    phone: null,
                    passwordHash: null,
                    avatar: null,
                    avatarMediaId: null,
                    bio: null,
                    location: null,
                    website: null,
                    birthday: null,
                    language: null,
                    country: null,
                    authProvider: null
                }
            });

            // Delete demographics
            await tx.userDemographics.deleteMany({ where: { userId: id } });

            // Delete relationships
            await tx.follow.deleteMany({ where: { OR: [{ followerId: id }, { followingId: id }] } });
            
            // Delete likes & saves to clear private data
            await tx.userLike.deleteMany({ where: { userId: id } });
            await tx.commentLike.deleteMany({ where: { userId: id } });
            await tx.savedPost.deleteMany({ where: { userId: id } });
            await tx.hiddenPost.deleteMany({ where: { userId: id } });
            
            // Delete notifications and settings
            await tx.notification.deleteMany({ where: { OR: [{ userId: id }, { actorId: id }] } });
            await tx.notificationSettings.deleteMany({ where: { userId: id } });
            
            // Remove from groups
            await tx.groupMember.deleteMany({ where: { userId: id } });
            
            // Leave posts, comments, responses intact to preserve survey integrity
        });

        await scheduleMediaDeletion(ownedMediaIds);

        res.json({ success: true, message: 'Account deleted and anonymized successfully' });
    } catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
};
