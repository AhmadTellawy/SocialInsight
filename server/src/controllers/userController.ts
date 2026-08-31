import { Request, Response } from 'express';
import { PeopleTagPermission } from '@prisma/client';
import prisma from '../prisma';
import { PrivacyService } from '../services/privacyService';
import { notify } from '../services/notificationService';
import { processBase64Image } from '../utils/imageProcessor';
import { GroupPermissionService } from '../services/groupPermissionService';
import { MEMBERSHIP_STATUS, POST_STATUS } from '../utils/constants';
import {
    commitPreparedMedia,
    getMediaReadPresentation,
    getStoredMediaPresentation,
    PUBLIC_AVATAR_MEDIA_SELECT,
    PUBLIC_GROUP_MEDIA_INCLUDE,
    prepareMediaAttachments,
    rollbackPreparedMedia,
    scheduleMediaDeletion,
    serializeGroupMediaRecord,
    serializeUserMediaRecord
} from '../services/mediaService';
import type { PreparedMediaAttachment } from '../services/mediaService';
import { requestMediaPrivacyTransition } from '../services/mediaPrivacyTransitionService';
import { MediaValidationError } from '../services/mediaProcessor';
import { withNotificationDeepLink } from '../utils/notificationTarget';
import { buildMentionSearchWhere, MENTION_SUGGESTION_LIMIT, MENTION_USER_SELECT } from '../utils/mentionSearch';
import {
    ACTIVE_MENTION_REFERENCE_INCLUDE,
    MentionLimitError,
    reconcileProfileMentions,
    serializeMentionReferences
} from '../services/mentionLifecycleService';
import {
    ProfileValidationError,
    calculateAgeGroupFromDate,
    formatDateOnly,
    parseAndValidateDateOfBirth
} from '../utils/profileValidation';

const SAFE_USER_SELECT = {
    id: true,
    name: true,
    handle: true,
    avatar: true,
    ...PUBLIC_AVATAR_MEDIA_SELECT,
    bio: true,
    location: true,
    website: true,
    isPrivate: true,
    mediaPrivacyTarget: true,
    groupPrivacy: true,
    peopleTagPermission: true,
    verifiedBadge: true, // Renamed from isVerified
    followersCount: true,
    followingCount: true,
    createdAt: true,
    updatedAt: true,
    country: true,
    language: true,
    status: true
};

const PROFILE_LINK_SELECT = {
    id: true,
    title: true,
    url: true,
    normalizedUrl: true,
    sortOrder: true,
    createdAt: true,
    updatedAt: true
} as const;

const publicUserPayload = (user: Record<string, any>) => {
    const {
        mediaPrivacyTarget: _mediaPrivacyTarget,
        status: _status,
        coverMedia: _coverMedia,
        profileMentions: _profileMentions,
        profileLinks: _profileLinks,
        birthday: _birthday,
        email: _email,
        phone: _phone,
        password: _password,
        passwordHash: _passwordHash,
        passwordUpdatedAt: _passwordUpdatedAt,
        authProvider: _authProvider,
        ...safe
    } = user;
    return safe;
};

const profileCoverForViewer = async (coverMediaId: string | null | undefined, viewerId?: string): Promise<any | null> => {
    if (!coverMediaId) return null;
    try {
        return await getMediaReadPresentation(coverMediaId, viewerId);
    } catch (error) {
        if (error instanceof MediaValidationError && error.statusCode === 404) return null;
        throw error;
    }
};

export const getUsers = async (req: Request, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            take: 20,
            select: SAFE_USER_SELECT
        });
        res.json(users.map((user) => serializeUserMediaRecord(user)));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
};

export const searchUsers = async (req: Request, res: Response) => {
    try {
        const query = String(req.query.q || '').trim();
        const userId = req.user?.userId;

        if (!query) {
            return res.json([]);
        }
        if (query.length > 64) {
            return res.status(400).json({ error: 'Search query is too long', code: 'INVALID_MENTION_QUERY' });
        }

        const purpose = String(req.query.purpose || 'mention');
        const baseWhere = buildMentionSearchWhere(query, userId!);
        const users = await prisma.user.findMany({
            where: purpose === 'people-tag'
                ? {
                    ...baseWhere,
                    AND: [
                        {
                            OR: [
                                { peopleTagPermission: PeopleTagPermission.EVERYONE },
                                {
                                    peopleTagPermission: PeopleTagPermission.FOLLOWING,
                                    followedBy: {
                                        some: {
                                            followingId: userId!,
                                            status: 'ACTIVE'
                                        }
                                    }
                                }
                            ]
                        }
                    ]
                }
                : baseWhere,
            take: MENTION_SUGGESTION_LIMIT,
            select: MENTION_USER_SELECT
        });

        res.json(users.map((user) => serializeUserMediaRecord(user)));
    } catch (error) {
        console.error('Failed to search users:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
};

const PROFILE_READ_SELECT = {
    ...SAFE_USER_SELECT,
    coverMediaId: true,
    profileMentions: ACTIVE_MENTION_REFERENCE_INCLUDE
} as const;

const sendPublicProfile = async (req: Request, res: Response, user: any): Promise<void> => {
    const viewerId = req.user?.userId;
    let followStatus = 'NONE';
    let isBlocked = false;
    if (viewerId && viewerId !== user.id) {
        const [blockRecord, follow] = await Promise.all([
            prisma.userBlock.findFirst({
                where: {
                    OR: [
                        { blockerId: viewerId, blockedId: user.id },
                        { blockerId: user.id, blockedId: viewerId }
                    ]
                },
                select: { blockerId: true }
            }),
            prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: viewerId, followingId: user.id } },
                select: { status: true }
            })
        ]);
        if (blockRecord) {
            isBlocked = true;
        }
        if (follow) followStatus = follow.status;
    }

    if (isBlocked) {
        res.status(404).json({ error: 'User not found' });
        return;
    }

    const isPrivateProfile = user.isPrivate || user.mediaPrivacyTarget === true;
    const canViewPrivateDetails = viewerId === user.id
        || (!isPrivateProfile && !isBlocked)
        || followStatus === 'ACTIVE';
    const [demographics, postsCount, responsesCount, profileLinks, coverMedia] = await Promise.all([
        prisma.userDemographics.findUnique({ where: { userId: user.id } }),
        prisma.post.count({ where: { authorId: user.id, isDeleted: false, status: 'PUBLISHED', sharedFromId: null } }),
        prisma.response.count({ where: { post: { authorId: user.id, isDeleted: false, status: 'PUBLISHED' } } }),
        canViewPrivateDetails
            ? prisma.profileLink.findMany({ where: { userId: user.id }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: PROFILE_LINK_SELECT })
            : Promise.resolve([]),
        canViewPrivateDetails ? profileCoverForViewer(user.coverMediaId, viewerId) : Promise.resolve(null)
    ]);
    const serializedUser = publicUserPayload(serializeUserMediaRecord(user) as any);
    res.json({
        ...serializedUser,
        coverMediaId: coverMedia?.id || null,
        coverMedia,
        profileLinks,
        bioMentions: serializeMentionReferences(user.profileMentions),
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
};

export const getUser = async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.params.id as string }, select: PROFILE_READ_SELECT });
        if (!user) return res.status(404).json({ error: 'User not found' });
        await sendPublicProfile(req, res, user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
};

export const getUserByHandle = async (req: Request, res: Response) => {
    try {
        const cleanHandle = (req.params.handle as string).replace(/^@/, '');
        const user = await prisma.user.findUnique({ where: { handle: cleanHandle }, select: PROFILE_READ_SELECT });
        if (!user) return res.status(404).json({ error: 'User not found' });
        await sendPublicProfile(req, res, user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch user by handle' });
    }
};

export const getMe = async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: {
                ...PROFILE_READ_SELECT,
                birthday: true,
                profileLinks: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: PROFILE_LINK_SELECT }
            }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });
        const [demographics, postsCount, responsesCount, coverMedia] = await Promise.all([
            prisma.userDemographics.findUnique({ where: { userId: user.id } }),
            prisma.post.count({ where: { authorId: user.id, isDeleted: false, status: 'PUBLISHED', sharedFromId: null } }),
            prisma.response.count({ where: { post: { authorId: user.id, isDeleted: false, status: 'PUBLISHED' } } }),
            profileCoverForViewer(user.coverMediaId, user.id)
        ]);
        const serializedUser = publicUserPayload(serializeUserMediaRecord(user) as any);
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({
            ...serializedUser,
            birthday: formatDateOnly(user.birthday),
            coverMediaId: coverMedia?.id || null,
            coverMedia,
            profileLinks: user.profileLinks,
            bioMentions: serializeMentionReferences(user.profileMentions),
            isPrivate: user.mediaPrivacyTarget === true || user.isPrivate,
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
        res.status(500).json({ error: 'Failed to fetch current user' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    
    if (req.user?.userId !== id) {
        return res.status(403).json({ error: 'Forbidden: You can only update your own profile' });
    }

    const data = req.body;

    try {
        const currentUser = await prisma.user.findUnique({
            where: { id },
            select: {
                avatar: true,
                avatarMediaId: true,
                coverMediaId: true,
                birthday: true,
                isPrivate: true,
                mediaPrivacyTarget: true,
                updatedAt: true
            }
        });
        if (!currentUser) return res.status(404).json({ error: 'User not found' });

        const expectedUpdatedAtValue = data.expectedUpdatedAt ?? data.updatedAt;
        let expectedUpdatedAt: Date | undefined;
        if (expectedUpdatedAtValue !== undefined) {
            expectedUpdatedAt = new Date(expectedUpdatedAtValue);
            if (Number.isNaN(expectedUpdatedAt.getTime())) {
                throw new ProfileValidationError('INVALID_PROFILE_VERSION', 'The profile version is invalid.');
            }
        }
        if (data.coverMediaId !== undefined && !expectedUpdatedAt) {
            throw new ProfileValidationError('PROFILE_VERSION_REQUIRED', 'The current profile version is required to change the cover photo.', 428);
        }

        const hasBirthday = Object.prototype.hasOwnProperty.call(data, 'birthday') || Object.prototype.hasOwnProperty.call(data, 'dateOfBirth');
        if (data.birthday !== undefined && data.dateOfBirth !== undefined && data.birthday !== data.dateOfBirth) {
            throw new ProfileValidationError('INVALID_DATE_OF_BIRTH', 'Provide one date of birth value.');
        }
        const birthdayValue = data.birthday !== undefined ? data.birthday : data.dateOfBirth;
        if (hasBirthday && (birthdayValue === null || birthdayValue === '') && currentUser.birthday) {
            throw new ProfileValidationError('DATE_OF_BIRTH_REQUIRED', 'Date of birth cannot be removed after it has been set.');
        }
        const parsedBirthday = hasBirthday
            ? (birthdayValue === null || birthdayValue === '' ? null : parseAndValidateDateOfBirth(birthdayValue))
            : undefined;
        const calculatedAgeGroup = hasBirthday ? (calculateAgeGroupFromDate(parsedBirthday) || null) : undefined;

        if (data.avatar && data.avatarMediaId === undefined) {
            data.avatar = await processBase64Image(data.avatar, currentUser?.avatar);
        }

        const allowedFields = ['name', 'handle', 'avatar', 'bio', 'location', 'website', 'language', 'country', 'groupPrivacy'];
        const updateData: any = {};
        allowedFields.forEach(field => {
            if (data[field] !== undefined) updateData[field] = data[field];
        });
        if (hasBirthday) updateData.birthday = parsedBirthday;
        updateData.updatedAt = new Date();
        if (data.peopleTagPermission !== undefined) {
            if (!Object.values(PeopleTagPermission).includes(data.peopleTagPermission)) {
                return res.status(400).json({ error: 'Invalid people tag permission', code: 'INVALID_PEOPLE_TAG_PERMISSION' });
            }
            updateData.peopleTagPermission = data.peopleTagPermission;
        }

        let oldAvatarMediaId: string | null | undefined;
        let oldCoverMediaId: string | null | undefined;
        let avatarPrepared: PreparedMediaAttachment | null = null;
        let coverPrepared: PreparedMediaAttachment | null = null;
        try {
            if (data.avatarMediaId !== undefined) {
                oldAvatarMediaId = currentUser?.avatarMediaId;
                if (data.avatarMediaId === null) {
                    updateData.avatarMediaId = null;
                    updateData.avatar = null;
                } else {
                    avatarPrepared = await prepareMediaAttachments(id, [{ id: data.avatarMediaId, purpose: 'PROFILE_AVATAR' }], 'PUBLIC');
                    const presentation = await getStoredMediaPresentation(data.avatarMediaId);
                    if (!presentation?.src) throw new MediaValidationError('MEDIA_NOT_READY', 'Avatar variants are unavailable.', 409);
                    updateData.avatarMediaId = data.avatarMediaId;
                    updateData.avatar = presentation.src;
                }
            }

            if (data.coverMediaId !== undefined) {
                oldCoverMediaId = currentUser.coverMediaId;
                if (data.coverMediaId === currentUser.coverMediaId) {
                    // A persisted cover sent back unchanged is not a new attachment.
                } else if (data.coverMediaId === null) {
                    updateData.coverMediaId = null;
                } else if (typeof data.coverMediaId === 'string') {
                    const targetIsPrivate = typeof data.isPrivate === 'boolean'
                        ? data.isPrivate
                        : (currentUser.mediaPrivacyTarget ?? currentUser.isPrivate);
                    coverPrepared = await prepareMediaAttachments(
                        id,
                        [{ id: data.coverMediaId, purpose: 'PROFILE_COVER' }],
                        targetIsPrivate ? 'RESTRICTED' : 'PUBLIC'
                    );
                    const presentation = await getStoredMediaPresentation(data.coverMediaId);
                    if (!presentation || Math.abs(presentation.aspectRatio - 3) > 0.0001) {
                        throw new MediaValidationError('MEDIA_NOT_READY', 'Cover variants are unavailable.', 409);
                    }
                    updateData.coverMediaId = data.coverMediaId;
                } else {
                    throw new ProfileValidationError('INVALID_COVER_MEDIA', 'Cover media must be a media ID or null.');
                }
            }

            await prisma.$transaction(async (tx) => {
                if (expectedUpdatedAt) {
                    const versionedUpdate = await tx.user.updateMany({
                        where: { id, updatedAt: expectedUpdatedAt },
                        data: updateData
                    });
                    if (versionedUpdate.count !== 1) {
                        throw new ProfileValidationError('PROFILE_UPDATE_CONFLICT', 'Your profile changed elsewhere. Refresh and try again.', 409);
                    }
                } else {
                    await tx.user.update({ where: { id }, data: updateData });
                }
                const updated = await tx.user.findUniqueOrThrow({ where: { id } });
                await reconcileProfileMentions(tx, {
                    profileUserId: id,
                    actorUserId: id,
                    bio: updated.bio || ''
                });
                if (hasBirthday) {
                    await tx.userDemographics.upsert({
                        where: { userId: id },
                        create: { userId: id, ageGroup: calculatedAgeGroup },
                        update: { ageGroup: calculatedAgeGroup }
                    });
                }
                if (avatarPrepared) await commitPreparedMedia(tx, avatarPrepared);
                if (coverPrepared) await commitPreparedMedia(tx, coverPrepared);
                if (oldCoverMediaId && oldCoverMediaId !== data.coverMediaId) {
                    await tx.mediaAsset.updateMany({
                        where: { id: oldCoverMediaId, ownerId: id, status: 'ATTACHED' },
                        data: { status: 'PENDING_DELETE' }
                    });
                }
            });
        } catch (error) {
            if (avatarPrepared) await rollbackPreparedMedia(avatarPrepared);
            if (coverPrepared) await rollbackPreparedMedia(coverPrepared);
            throw error;
        }

        if (oldAvatarMediaId && oldAvatarMediaId !== data.avatarMediaId) {
            await scheduleMediaDeletion([oldAvatarMediaId]);
        }
        if (oldCoverMediaId && oldCoverMediaId !== data.coverMediaId) {
            await scheduleMediaDeletion([oldCoverMediaId]);
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
                ageGroup?: string | null;
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
                ageGroup: hasBirthday ? calculatedAgeGroup : (typeof rawDemo.ageGroup === 'string' ? rawDemo.ageGroup : undefined),
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

        const user = await prisma.user.findUniqueOrThrow({
            where: { id },
            select: {
                ...SAFE_USER_SELECT,
                coverMediaId: true,
                birthday: true,
                profileLinks: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: PROFILE_LINK_SELECT },
                profileMentions: ACTIVE_MENTION_REFERENCE_INCLUDE
            }
        });
        const coverMedia = await profileCoverForViewer(user.coverMediaId, id);
        const serializedUser = publicUserPayload(serializeUserMediaRecord(user) as any);
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({
            ...serializedUser,
            birthday: formatDateOnly(user.birthday),
            coverMediaId: coverMedia?.id || null,
            coverMedia,
            profileLinks: user.profileLinks,
            bioMentions: serializeMentionReferences(user.profileMentions),
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
        if (error instanceof MentionLimitError) {
            return res.status(400).json({ error: error.message, code: 'MENTION_LIMIT_EXCEEDED', limit: error.limit });
        }
        if (error instanceof ProfileValidationError) {
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
    const currentUserId = req.user?.userId;
    try {
        const canView = await PrivacyService.canViewUserContent(currentUserId, id as string);
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
                            where: { followerId: currentUserId },
                            select: { status: true }
                        } : false
                    }
                }
            }
        });

        const mapped = (followers as any[]).map(f => {
            const follower = serializeUserMediaRecord(f.follower)!;
            return {
                ...follower,
                followStatus: currentUserId ? (f.follower.following && f.follower.following.length > 0 ? f.follower.following[0].status : 'NONE') : 'NONE'
            };
        });

        res.json(mapped);
    } catch (error) {
        console.error("Get Followers Error:", error);
        res.status(500).json({ error: 'Failed to fetch followers' });
    }
};

export const getUserFollowing = async (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    try {
        const canView = await PrivacyService.canViewUserContent(currentUserId, id as string);
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
                            where: { followerId: currentUserId },
                            select: { status: true }
                        } : false
                    }
                }
            }
        });

        const mapped = (following as any[]).map(f => {
            const followedUser = serializeUserMediaRecord(f.following)!;
            return {
                ...followedUser,
                followStatus: currentUserId ? (f.following.following && f.following.following.length > 0 ? f.following.following[0].status : 'NONE') : 'NONE'
            };
        });

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
                    select: { id: true, name: true, avatar: true, ...PUBLIC_AVATAR_MEDIA_SELECT }
                }
            }
        });
        console.log(`[API] prisma.notification returned ${notifications.length} rows`);

        const mapped = notifications.map((n: any) => {
            const targetType = n.targetType === 'user' ? 'profile' : n.targetType;
            const payload = withNotificationDeepLink(targetType, n.targetId, n.payload);
            return {
                id: n.id,
                type: n.type,
                message: n.message,
                targetId: n.targetId,
                targetType,
                payload,
                deepLink: payload?.deepLink,
                isRead: n.isRead,
                timestamp: n.createdAt.toISOString(),
                createdAt: n.createdAt.getTime(),
                actor: n.actor ? serializeUserMediaRecord(n.actor) : undefined
            };
        });

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
                group: { include: PUBLIC_GROUP_MEDIA_INCLUDE }
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
                ...serializeGroupMediaRecord(m.group),
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
            ...serializeUserMediaRecord(u)!,
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
                ...serializeUserMediaRecord(u)!,
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
                    coverMediaId: null,
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
            await tx.profileLink.deleteMany({ where: { userId: id } });

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
