import prisma from '../prisma';
import { buildVisiblePublishedPostWhere } from './postVisibilityService';

export type NotificationVisibilityReason =
    | 'allowed'
    | 'inactive_recipient'
    | 'inactive_actor'
    | 'blocked_actor'
    | 'missing_source'
    | 'source_unavailable';

export interface NotificationVisibilityInput {
    userId: string;
    actorId?: string | null;
    type: string;
    targetType?: string | null;
    targetId?: string | null;
    payload?: Record<string, unknown>;
}

export interface NotificationVisibilityDecision {
    allowed: boolean;
    reason: NotificationVisibilityReason;
}

const stringValue = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

const allow = (): NotificationVisibilityDecision => ({ allowed: true, reason: 'allowed' });
const deny = (reason: Exclude<NotificationVisibilityReason, 'allowed'>): NotificationVisibilityDecision => ({ allowed: false, reason });

/**
 * Revalidates the recipient, actor, block relation, and referenced source at
 * delivery/read time. A denied notification is dropped rather than exposing a
 * stale message, actor, identifier, or deep link.
 */
export const evaluateNotificationVisibility = async (
    notification: NotificationVisibilityInput,
    db: any = prisma
): Promise<NotificationVisibilityDecision> => {
    const identityIds = Array.from(new Set([
        notification.userId,
        ...(notification.actorId ? [notification.actorId] : [])
    ]));
    const activeUsers = await db.user.findMany({
        where: { id: { in: identityIds }, status: 'ACTIVE' },
        select: { id: true }
    });
    const activeIds = new Set(activeUsers.map((user: { id: string }) => user.id));
    if (!activeIds.has(notification.userId)) return deny('inactive_recipient');
    if (notification.actorId && !activeIds.has(notification.actorId)) return deny('inactive_actor');

    if (notification.actorId) {
        const block = await db.userBlock.findFirst({
            where: {
                OR: [
                    { blockerId: notification.userId, blockedId: notification.actorId },
                    { blockerId: notification.actorId, blockedId: notification.userId }
                ]
            },
            select: { id: true }
        });
        if (block) return deny('blocked_actor');
    }

    const targetType = notification.targetType?.toLowerCase();
    const postId = stringValue(notification.payload?.postId)
        || ((targetType === 'post' || targetType === 'survey') ? stringValue(notification.targetId) : undefined);

    if ((targetType === 'post' || targetType === 'survey') && !postId) {
        return deny('missing_source');
    }

    if (postId) {
        const visiblePost = await db.post.findFirst({
            where: { id: postId, ...buildVisiblePublishedPostWhere(notification.userId) },
            select: { id: true }
        });
        if (!visiblePost) return deny('source_unavailable');

        const commentIds = Array.from(new Set([
            stringValue(notification.payload?.commentId),
            stringValue(notification.payload?.replyId)
        ].filter((value): value is string => Boolean(value))));
        if (commentIds.length > 0) {
            const sourceCommentCount = await db.comment.count({ where: { id: { in: commentIds }, postId } });
            if (sourceCommentCount !== commentIds.length) return deny('source_unavailable');
        }
        return allow();
    }

    if (targetType === 'group') {
        const groupId = stringValue(notification.targetId);
        if (!groupId) return deny('missing_source');
        const allowedMembershipStatuses = notification.type === 'group_invite' ? ['JOINED', 'INVITED'] : ['JOINED'];
        const visibleGroup = await db.group.findFirst({
            where: {
                id: groupId,
                isDeleted: false,
                OR: [
                    { isPublic: true },
                    { members: { some: { userId: notification.userId, status: { in: allowedMembershipStatuses } } } }
                ]
            },
            select: { id: true }
        });
        return visibleGroup ? allow() : deny('source_unavailable');
    }

    // Profile notifications contain no private source body. Actor status and
    // bilateral block checks above are the authoritative disclosure boundary.
    return allow();
};
