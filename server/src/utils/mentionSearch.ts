import { PUBLIC_AVATAR_MEDIA_SELECT } from '../services/mediaService';

export const MENTION_SUGGESTION_LIMIT = 10;

export const MENTION_USER_SELECT = {
    id: true,
    name: true,
    handle: true,
    avatar: true,
    ...PUBLIC_AVATAR_MEDIA_SELECT
} as const;

export const buildMentionSearchWhere = (query: string, userId: string) => ({
    OR: [
        { handle: { startsWith: query, mode: 'insensitive' as const } },
        { name: { contains: query, mode: 'insensitive' as const } }
    ],
    status: 'ACTIVE',
    NOT: [
        { blockedBy: { some: { blockerId: userId } } },
        { blocking: { some: { blockedId: userId } } }
    ]
});
