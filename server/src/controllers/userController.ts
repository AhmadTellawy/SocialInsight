import { Request, Response } from 'express';
import { PeopleTagPermission, Prisma } from '@prisma/client';
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
    parseAndValidateDateOfBirth,
    withDerivedAgeGroup
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

const logUserRequestFailure = (req: Request, event: string, error: unknown): void => {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || 'UNKNOWN')
        : 'UNKNOWN';
    const requestId = (req as Request & { requestId?: string }).requestId;
    console.error(JSON.stringify({ event, requestId, errorCode }));
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

export const NOTIFICATION_PAGE_DEFAULT = 50;
export const NOTIFICATION_PAGE_MAX = 100;
export const SUGGESTION_INTERACTION_SAMPLE_LIMIT = 100;
const SUGGESTION_LIMIT = 10;
const INTERACTION_SUGGESTION_LIMIT = 5;

const firstQueryValue = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
};

const boundedPositiveInteger = (value: unknown, fallback: number, maximum: number): number => {
    const parsed = Number(firstQueryValue(value));
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export const getUsers = async (req: Request, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            take: 20,
            select: SAFE_USER_SELECT
        });
        res.json(users.map((user) => serializeUserMediaRecord(user)));
    } catch (error) {
        logUserRequestFailure(req, 'users_list_failed', error);
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
        logUserRequestFailure(req, 'users_search_failed', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
};

const PROFILE_READ_SELECT = {
    ...SAFE_USER_SELECT,
    coverMediaId: true,
    // Selected internally so ageGroup can be derived at serialization time;
    // publicUserPayload always removes the private DOB itself.
    birthday: true,
    profileMentions: ACTIVE_MENTION_REFERENCE_INCLUDE
} as const;

type EditableDemographics = {
    gender?: string;
    maritalStatus?: string;
    educationLevel?: string;
    employmentType?: string;
    industry?: string;
    employmentSector?: string;
};

const parseEditableDemographics = (value: unknown): EditableDemographics | undefined => {
    if (value === undefined || value === null) return undefined;

    let parsed: unknown = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            throw new ProfileValidationError('INVALID_DEMOGRAPHICS', 'Demographics must be a JSON object.');
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ProfileValidationError('INVALID_DEMOGRAPHICS', 'Demographics must be an object.');
    }

    const source = parsed as Record<string, unknown>;
    const stringField = (...keys: string[]): string | undefined => {
        for (const key of keys) {
            if (typeof source[key] === 'string') return source[key] as string;
        }
        return undefined;
    };

    // ageGroup is deliberately excluded: it is a cache derived from the private DOB.
    return {
        gender: stringField('gender'),
        maritalStatus: stringField('maritalStatus'),
        educationLevel: stringField('educationLevel', 'education'),
        employmentType: stringField('employmentType', 'employment'),
        industry: stringField('industry'),
        employmentSector: stringField('employmentSector', 'sector')
    };
};

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
    const [postsCount, responsesCount, profileLinks, coverMedia] = await Promise.all([
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
        // Demographics are private survey attributes used only for aggregate
        // analysis. Never attach them to a publicly addressable user DTO.
        demographics: {},
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
        logUserRequestFailure(req, 'public_profile_read_failed', error);
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
        logUserRequestFailure(req, 'public_profile_handle_read_failed', error);
        res.status(500).json({ error: 'Failed to fetch user by handle' });
    }
};

export const getMe = async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: {
                ...PROFILE_READ_SELECT,
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
            demographics: withDerivedAgeGroup(demographics, user.birthday),
            stats: {
                followers: user.followersCount,
                following: user.followingCount,
                posts: postsCount,
                responses: responsesCount
            }
        });
    } catch (error) {
        logUserRequestFailure(req, 'private_profile_read_failed', error);
        res.status(500).json({ error: 'Failed to fetch current user' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    
    if (req.user?.userId !== id) {
        return res.status(403).json({ error: 'Forbidden: You can only update your own profile' });
    }

    const data = req.body || {};

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
        const authoritativeBirthday = hasBirthday ? parsedBirthday : currentUser.birthday;
        const calculatedAgeGroup = calculateAgeGroupFromDate(authoritativeBirthday) || null;
        const editableDemographics = parseEditableDemographics(data.demographics);
        const shouldPersistDemographics = editableDemographics !== undefined || hasBirthday || Boolean(authoritativeBirthday);

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
                if (shouldPersistDemographics) {
                    const editable = editableDemographics || {};
                    await tx.userDemographics.upsert({
                        where: { userId: id },
                        create: { userId: id, ...editable, ageGroup: calculatedAgeGroup },
                        update: { ...editable, ageGroup: calculatedAgeGroup }
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
                demographics: true,
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
            demographics: withDerivedAgeGroup(user.demographics, user.birthday),
            stats: {
                followers: user.followersCount,
                following: user.followingCount,
                posts: postsCount,
                responses: responsesCount
            }
        });
    } catch (error) {
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
        logUserRequestFailure(req, 'profile_update_failed', error);
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
        const rows = await prisma.$queryRaw<Array<{
            type: string | null;
            country: string | null;
            gender: string | null;
            ageGroup: string | null;
            count: bigint;
        }>>(Prisma.sql`
            SELECT
                post."type",
                viewer."country",
                demographics."gender",
                CASE
                    WHEN viewer."birthday" IS NULL THEN NULL
                    WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) < 18 THEN 'Under 18'
                    WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) <= 24 THEN '18-24'
                    WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) <= 34 THEN '25-34'
                    WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) <= 44 THEN '35-44'
                    WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) <= 54 THEN '45-54'
                    ELSE '55+'
                END AS "ageGroup",
                COUNT(*)::bigint AS "count"
            FROM "Response" response
            INNER JOIN "Post" post ON post."id" = response."postId"
            LEFT JOIN "users" viewer ON viewer."id" = response."userId"
            LEFT JOIN "user_demographics" demographics ON demographics."user_id" = viewer."id"
            WHERE post."authorId" = ${id}
              AND post."isDeleted" = FALSE
              AND post."status" = 'PUBLISHED'
              AND post."sharedFromId" IS NULL
            GROUP BY 1, 2, 3, 4
        `);

        let totalResponses = 0;
        const byType: Record<string, number> = {};
        const byCountry: Record<string, number> = {};
        const byGender: Record<string, number> = {};
        const byAge: Record<string, number> = {};

        ['Poll', 'Survey', 'Quiz', 'Challenge'].forEach(k => byType[k] = 0);
        ['Male', 'Female'].forEach(k => byGender[k] = 0);

        rows.forEach(row => {
            const count = Number(row.count);
            const type = row.type || 'Survey';
            totalResponses += count;
            byType[type] = (byType[type] || 0) + count;
            if (row.country) byCountry[row.country] = (byCountry[row.country] || 0) + count;
            if (row.gender) byGender[row.gender] = (byGender[row.gender] || 0) + count;
            if (row.ageGroup) byAge[row.ageGroup] = (byAge[row.ageGroup] || 0) + count;
        });

        res.json({ totalResponses, byType, byCountry, byGender, byAge });
    } catch (error) {
        logUserRequestFailure(req, 'profile_analytics_read_failed', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
};

export const getUserFollowers = async (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    const limit = boundedPositiveInteger(req.query.limit, 50, 100);
    const cursor = firstQueryValue(req.query.cursor)?.trim() || undefined;
    try {
        const canView = await PrivacyService.canViewUserContent(currentUserId, id as string);
        if (!canView) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const followers = await prisma.follow.findMany({
            where: { followingId: id as string, status: 'ACTIVE' },
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

        const hasMore = followers.length > limit;
        if (hasMore) followers.pop();
        if (hasMore && followers.length > 0) {
            res.setHeader('X-Next-Cursor', followers[followers.length - 1].id);
        }

        const mapped = (followers as any[]).map(f => {
            const follower = serializeUserMediaRecord(f.follower)!;
            return {
                ...follower,
                followStatus: currentUserId ? (f.follower.following && f.follower.following.length > 0 ? f.follower.following[0].status : 'NONE') : 'NONE'
            };
        });

        res.json(mapped);
    } catch (error) {
        logUserRequestFailure(req, 'followers_read_failed', error);
        res.status(500).json({ error: 'Failed to fetch followers' });
    }
};

export const getUserFollowing = async (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    const limit = boundedPositiveInteger(req.query.limit, 50, 100);
    const cursor = firstQueryValue(req.query.cursor)?.trim() || undefined;
    try {
        const canView = await PrivacyService.canViewUserContent(currentUserId, id as string);
        if (!canView) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const following = await prisma.follow.findMany({
            where: { followerId: id as string, status: 'ACTIVE' },
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

        const hasMore = following.length > limit;
        if (hasMore) following.pop();
        if (hasMore && following.length > 0) {
            res.setHeader('X-Next-Cursor', following[following.length - 1].id);
        }

        const mapped = (following as any[]).map(f => {
            const followedUser = serializeUserMediaRecord(f.following)!;
            return {
                ...followedUser,
                followStatus: currentUserId ? (f.following.following && f.following.following.length > 0 ? f.following.following[0].status : 'NONE') : 'NONE'
            };
        });

        res.json(mapped);
    } catch (error) {
        logUserRequestFailure(req, 'following_read_failed', error);
        res.status(500).json({ error: 'Failed to fetch following' });
    }
};


export const getNotifications = async (req: Request, res: Response) => {
    const id = req.params.id as string;

    if (req.user?.userId !== id) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const limit = boundedPositiveInteger(req.query.limit, NOTIFICATION_PAGE_DEFAULT, NOTIFICATION_PAGE_MAX);
        const cursor = firstQueryValue(req.query.cursor)?.trim() || undefined;
        const notifications = await prisma.notification.findMany({
            where: { userId: id as string },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
                id: true,
                type: true,
                message: true,
                targetId: true,
                targetType: true,
                payload: true,
                isRead: true,
                createdAt: true,
                actor: {
                    select: { id: true, name: true, avatar: true, ...PUBLIC_AVATAR_MEDIA_SELECT }
                }
            }
        });
        const hasMore = notifications.length > limit;
        if (hasMore) notifications.pop();
        if (hasMore && notifications.length > 0) {
            res.setHeader('X-Next-Cursor', notifications[notifications.length - 1].id);
        }

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
        logUserRequestFailure(req, 'notifications_read_failed', error);
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
        logUserRequestFailure(req, 'notifications_mark_read_failed', error);
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
        logUserRequestFailure(req, 'notification_mark_read_failed', error);
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
                group: {
                    include: {
                        ...PUBLIC_GROUP_MEDIA_INCLUDE,
                        _count: {
                            select: {
                                members: {
                                    where: { status: MEMBERSHIP_STATUS.JOINED }
                                },
                                targetedPosts: {
                                    where: {
                                        isDeleted: false,
                                        status: POST_STATUS.PUBLISHED
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const groups = memberships.map((membership) => {
            const { _count, ...group } = membership.group;
            return {
                ...serializeGroupMediaRecord(group),
                memberCount: _count.members,
                postsCount: _count.targetedPosts,
                permissions: GroupPermissionService.calculatePermissions(group, membership.role, membership.status),
                role: membership.role
            };
        });

        res.json(groups);
    } catch (error) {
        logUserRequestFailure(req, 'user_groups_read_failed', error);
        res.status(500).json({ error: 'Failed to fetch user groups' });
    }
};

export const getSuggestedUsers = async (req: Request, res: Response) => {
    try {
        // Keep the legacy /users/:id/suggested route shape for clients, but
        // derive the subject exclusively from the authenticated actor.
        const viewerId = req.user!.userId;
        const recentAuthors = await prisma.$queryRaw<Array<{ authorId: string }>>(Prisma.sql`
            WITH recent_interactions AS (
                (SELECT post."authorId", likes."createdAt" AS "interactedAt"
                 FROM "UserLike" likes
                 INNER JOIN "Post" post ON post."id" = likes."postId"
                 WHERE likes."userId" = ${viewerId}
                 ORDER BY likes."createdAt" DESC
                 LIMIT ${SUGGESTION_INTERACTION_SAMPLE_LIMIT})
                UNION ALL
                (SELECT post."authorId", comment."createdAt" AS "interactedAt"
                 FROM "Comment" comment
                 INNER JOIN "Post" post ON post."id" = comment."postId"
                 WHERE comment."userId" = ${viewerId}
                 ORDER BY comment."createdAt" DESC
                 LIMIT ${SUGGESTION_INTERACTION_SAMPLE_LIMIT})
                UNION ALL
                (SELECT post."authorId", response."timestamp" AS "interactedAt"
                 FROM "Response" response
                 INNER JOIN "Post" post ON post."id" = response."postId"
                 WHERE response."userId" = ${viewerId}
                 ORDER BY response."timestamp" DESC
                 LIMIT ${SUGGESTION_INTERACTION_SAMPLE_LIMIT})
            )
            SELECT "authorId"
            FROM recent_interactions
            WHERE "authorId" <> ${viewerId}
            GROUP BY "authorId"
            ORDER BY MAX("interactedAt") DESC, "authorId" ASC
            LIMIT ${INTERACTION_SUGGESTION_LIMIT}
        `);
        const interactedAuthorIds = recentAuthors.map((row) => row.authorId);

        const interactionSuggestions = interactedAuthorIds.length > 0
            ? await prisma.user.findMany({
                where: {
                    id: { in: interactedAuthorIds, not: viewerId },
                    status: 'ACTIVE',
                    following: { none: { followerId: viewerId } }
                },
                take: INTERACTION_SUGGESTION_LIMIT,
                select: SAFE_USER_SELECT
            })
            : [];

        const suggestedList = interactionSuggestions.map(u => ({
            ...serializeUserMediaRecord(u)!,
            suggestionReason: 'Recently interacted'
        }));

        if (suggestedList.length < SUGGESTION_LIMIT) {
            const currentIds = [viewerId, ...suggestedList.map(u => u.id)];
            const popularSuggestions = await prisma.user.findMany({
                where: {
                    id: { notIn: currentIds },
                    status: 'ACTIVE',
                    following: { none: { followerId: viewerId } }
                },
                orderBy: [{ followersCount: 'desc' }, { id: 'asc' }],
                take: SUGGESTION_LIMIT - suggestedList.length,
                select: SAFE_USER_SELECT
            });

            suggestedList.push(...popularSuggestions.map(u => ({
                ...serializeUserMediaRecord(u)!,
                suggestionReason: 'Suggested for you'
            })));
        }

        res.json(suggestedList);
    } catch (error) {
        logUserRequestFailure(req, 'suggested_users_read_failed', error);
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
        logUserRequestFailure(req, 'account_delete_failed', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
};
