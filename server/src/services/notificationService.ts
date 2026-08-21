import prisma from '../prisma';
import { getIO, getUserNotificationRoom } from './socketService';
import { sendPushNotification } from './pushService';
import { PUBLIC_AVATAR_MEDIA_SELECT, serializeUserMediaRecord } from './mediaService';
import {
    MENTION_RECIPIENT_LIMIT,
    getUniqueMentionHandles
} from '../utils/textEntities';
import {
    MentionEligibilityResult,
    MentionSourceContext,
    canMention,
    loadMentionSourceContext
} from './mentionPolicyService';
import {
    MentionNotificationTarget,
    createMentionNotificationTarget,
    withNotificationDeepLink
} from '../utils/notificationTarget';

interface NotifyOptions {
    dedupe?: boolean;
}

const errorName = (error: unknown): string => error instanceof Error ? error.name : 'unknown';

export const notify = async (
    actorId: string | undefined | null,
    userId: string,
    type: string,
    message: string,
    targetType?: string,
    targetId?: string,
    payload?: unknown,
    options: NotifyOptions = {}
) => {
    try {
        if (actorId === userId) return;

        const normalizedPayload = withNotificationDeepLink(targetType, targetId, payload);
        const serializedPayload = normalizedPayload ? JSON.stringify(normalizedPayload) : null;

        if (options.dedupe) {
            const existing = await prisma.notification.findFirst({
                where: {
                    userId,
                    actorId: actorId || null,
                    type,
                    targetType: targetType || null,
                    targetId: targetId || null,
                    payload: serializedPayload
                },
                select: { id: true }
            });
            if (existing) return existing;
        }

        const settingsRecord = await prisma.notificationSettings.findUnique({ where: { userId } });
        let shouldNotify = true;

        if (settingsRecord && actorId) {
            try {
                const settings = JSON.parse(settingsRecord.settings);
                const checkFollowing = async () => {
                    const follow = await prisma.follow.findUnique({
                        where: {
                            followerId_followingId: {
                                followerId: userId,
                                followingId: actorId
                            }
                        }
                    });
                    return !!follow;
                };
                const evaluateTriOption = async (option: string | undefined, defaultOption = 'everyone') => {
                    const value = option || defaultOption;
                    if (value === 'off') return false;
                    if (value === 'following') return checkFollowing();
                    return true;
                };

                if (type === 'like') {
                    shouldNotify = await evaluateTriOption(settings.myPosts?.likes);
                } else if (type === 'comment' || type === 'response') {
                    shouldNotify = await evaluateTriOption(settings.myPosts?.comments);
                } else if (type === 'vote') {
                    shouldNotify = await evaluateTriOption(settings.myPosts?.comments);
                } else if (type === 'follow' && settings.toggles?.newFollowers === false) {
                    shouldNotify = false;
                }

                if (settings.toggles?.pushNotifications === false) shouldNotify = false;
            } catch (error) {
                console.error(JSON.stringify({ event: 'notification_settings_parse_failed', error: errorName(error) }));
            }
        }

        if (!shouldNotify) return;

        const newNotification = await prisma.notification.create({
            data: {
                userId,
                actorId: actorId || null,
                type,
                message,
                targetType,
                targetId,
                payload: serializedPayload
            } as any,
            include: {
                actor: {
                    select: { id: true, name: true, avatar: true, ...PUBLIC_AVATAR_MEDIA_SELECT }
                }
            }
        });

        const realtimeNotification = {
            id: newNotification.id,
            type: newNotification.type,
            message: newNotification.message,
            targetId: newNotification.targetId || undefined,
            targetType: newNotification.targetType || undefined,
            payload: normalizedPayload,
            deepLink: normalizedPayload?.deepLink,
            isRead: newNotification.isRead,
            timestamp: newNotification.createdAt.toISOString(),
            createdAt: newNotification.createdAt.getTime(),
            actor: newNotification.actor ? serializeUserMediaRecord(newNotification.actor) : undefined
        };

        try {
            const socketServer = getIO();
            if (socketServer) {
                socketServer.to(getUserNotificationRoom(userId)).emit('newNotification', realtimeNotification);
            }
        } catch (error) {
            console.error(JSON.stringify({ event: 'notification_socket_failed', type, error: errorName(error) }));
        }

        void sendPushNotification(userId, {
            title: newNotification.actor ? newNotification.actor.name : 'SocialInsight',
            body: newNotification.message,
            type: newNotification.type,
            url: normalizedPayload?.deepLink || '/'
        }).catch((error) => {
            console.error(JSON.stringify({
                event: type === 'mention' ? 'mention_push_failed' : 'notification_push_failed',
                type,
                error: errorName(error)
            }));
        });

        return newNotification;
    } catch (error) {
        console.error(JSON.stringify({ event: 'notification_create_failed', type, error: errorName(error) }));
        return undefined;
    }
};

export interface MentionExtractionResult {
    status: 'no_mentions' | 'over_limit' | 'processed';
    recipientCount: number;
    notifiedCount: number;
}

interface MentionedUserRecord {
    id: string;
    handle: string;
}

export interface MentionNotificationDependencies {
    findMentionedUsers: (handles: string[]) => Promise<MentionedUserRecord[]>;
    loadSourceContext: (postId: string) => Promise<MentionSourceContext | null>;
    checkEligibility: (
        input: { actorUserId: string; targetUserId: string; postId: string },
        source: MentionSourceContext | null
    ) => Promise<MentionEligibilityResult>;
    createNotification: (input: {
        actorId: string;
        userId: string;
        target: MentionNotificationTarget;
    }) => Promise<boolean>;
}

const defaultMentionNotificationDependencies: MentionNotificationDependencies = {
    findMentionedUsers: (handles) => prisma.user.findMany({
        where: {
            status: 'ACTIVE',
            OR: handles.map((handle) => ({ handle: { equals: handle, mode: 'insensitive' as const } }))
        },
        take: MENTION_RECIPIENT_LIMIT,
        select: { id: true, handle: true }
    }),
    loadSourceContext: loadMentionSourceContext,
    checkEligibility: (input, source) => canMention(input, undefined, source),
    createNotification: async ({ actorId, userId, target }) => {
        const notification = await notify(
            actorId,
            userId,
            'mention',
            `mentioned you in a ${target.sourceType === 'post' ? 'post' : target.sourceType}`,
            'post',
            target.postId,
            target,
            { dedupe: true }
        );
        return !!notification;
    }
};

export const extractAndNotifyMentions = async (
    text: string,
    actorId: string,
    target: Pick<MentionNotificationTarget, 'postId' | 'commentId' | 'replyId'>,
    dependencies: MentionNotificationDependencies = defaultMentionNotificationDependencies
): Promise<MentionExtractionResult> => {
    const handles = getUniqueMentionHandles(text || '');
    if (handles.length === 0) {
        return { status: 'no_mentions', recipientCount: 0, notifiedCount: 0 };
    }

    if (handles.length > MENTION_RECIPIENT_LIMIT) {
        console.warn(JSON.stringify({
            event: 'mention_limit_exceeded',
            recipientCount: handles.length,
            limit: MENTION_RECIPIENT_LIMIT
        }));
        return { status: 'over_limit', recipientCount: handles.length, notifiedCount: 0 };
    }

    try {
        const mentionedUsers = await dependencies.findMentionedUsers(handles);
        const sourceContext = await dependencies.loadSourceContext(target.postId);
        const notificationTarget = createMentionNotificationTarget(target);
        const outcomes = await Promise.allSettled(mentionedUsers.map(async (user) => {
            const eligibility = await dependencies.checkEligibility({
                actorUserId: actorId,
                targetUserId: user.id,
                postId: target.postId
            }, sourceContext);

            if (!eligibility.allowed) {
                console.info(JSON.stringify({
                    event: 'mention_ineligible',
                    reason: eligibility.reason,
                    sourceType: notificationTarget.sourceType
                }));
                return false;
            }

            return dependencies.createNotification({
                actorId,
                userId: user.id,
                target: notificationTarget
            });
        }));

        const notifiedCount = outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value).length;
        const failedCount = outcomes.filter((outcome) => outcome.status === 'rejected').length;
        if (failedCount > 0) {
            console.error(JSON.stringify({ event: 'mention_fanout_failed', failedCount }));
        }

        return { status: 'processed', recipientCount: handles.length, notifiedCount };
    } catch (error) {
        console.error(JSON.stringify({ event: 'mention_processing_failed', error: errorName(error) }));
        return { status: 'processed', recipientCount: handles.length, notifiedCount: 0 };
    }
};
