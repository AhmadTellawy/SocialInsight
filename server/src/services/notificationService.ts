import prisma from '../prisma';
import { getIO } from './socketService';

export const notify = async (
    actorId: string | undefined | null,
    userId: string,
    type: string,
    message: string,
    targetType?: string,
    targetId?: string,
    payload?: any
) => {
    try {
        if (actorId === userId) return; // Don't notify self

        // Fetch user settings
        const settingsRecord = await prisma.notificationSettings.findUnique({
            where: { userId }
        });

        let shouldNotify = true;
        if (settingsRecord && actorId) {
            try {
                const settings = JSON.parse(settingsRecord.settings);

                // Helper to check user following status if needed
                const checkFollowing = async () => {
                    const f = await prisma.follow.findUnique({
                        where: {
                            followerId_followingId: {
                                followerId: userId,
                                followingId: actorId
                            }
                        }
                    });
                    return !!f;
                };

                // Helper to abstract the 'everyone' | 'following' | 'off' logic
                const evaluateTriOption = async (option: string | undefined, defaultOpt: string = 'everyone') => {
                    const val = option || defaultOpt;
                    if (val === 'off') return false;
                    if (val === 'following') {
                        return await checkFollowing();
                    }
                    return true;
                };

                // For interactions on 'My Posts' or default types
                if (type === 'like') {
                    // Check if it's a comment like or post like. The controller passes 'survey' or 'comment' as targetType.
                    const pref = settings.myPosts?.likes || 'everyone';
                    shouldNotify = await evaluateTriOption(pref);
                } else if (type === 'comment' || type === 'response') {
                    // response is a reply to a comment, comment is a reply to a post
                    const pref = settings.myPosts?.comments || 'everyone';
                    shouldNotify = await evaluateTriOption(pref);
                } else if (type === 'vote') {
                    // Treat votes as interactions/replies
                    const pref = settings.myPosts?.comments || 'everyone';
                    shouldNotify = await evaluateTriOption(pref);
                } else if (type === 'follow') {
                    // Settings for new followers is a boolean toggle
                    if (settings.toggles && settings.toggles.newFollowers === false) {
                        shouldNotify = false;
                    }
                }

                // General toggles (like email vs push) could be added here later
                if (settings.toggles?.pushNotifications === false) {
                    shouldNotify = false; // Override if all notifications are disabled via hypothetical master switch
                }
            } catch (e) {
                console.error("Failed to parse settings", e);
            }
        }

        if (!shouldNotify) return;

        const newNotif = await prisma.notification.create({
            data: {
                userId,
                actorId: actorId || null,
                type,
                message,
                targetType,
                targetId,
                payload: payload ? JSON.stringify(payload) : null
            } as any,
            include: {
                actor: {
                    select: { id: true, name: true, avatar: true }
                }
            }
        });
        
        console.log(`[NOTIFICATION] Created '${type}' for user ${userId} from actor ${actorId}`);

        // Emit real-time socket event
        try {
            const io = getIO();
            if (io) {
                io.to(userId).emit('newNotification', {
                    id: newNotif.id,
                    type: newNotif.type,
                    message: newNotif.message,
                    targetId: newNotif.targetId,
                    targetType: newNotif.targetType,
                    isRead: newNotif.isRead,
                    timestamp: newNotif.createdAt.toISOString(),
                    createdAt: newNotif.createdAt.getTime(),
                    actor: newNotif.actor ? {
                        id: newNotif.actor.id,
                        name: newNotif.actor.name,
                        avatar: newNotif.actor.avatar
                    } : undefined
                });
            }
        } catch (socketErr) {
            console.error('[SOCKET ERROR]: Failed to emit notification:', socketErr);
        }

    } catch (error) {
        console.error(`[NOTIFICATION SERVER ERROR]: Failed to create notification:`, error);
    }
};

export const extractAndNotifyMentions = async (
    text: string,
    actorId: string,
    targetType: string,
    targetId: string,
    payload?: any
) => {
    try {
        if (!text) return;
        
        // Match @username ignoring trailing punctuation
        const mentionRegex = /@([a-zA-Z0-9_.]+)/g;
        const matches = [...text.matchAll(mentionRegex)];
        const handles = [...new Set(matches.map(m => m[1]))]; // Ensure unique handles

        if (handles.length === 0) return;

        // Find users with these handles
        const mentionedUsers = await prisma.user.findMany({
            where: {
                handle: { in: handles },
                status: 'ACTIVE'
            },
            select: { id: true, handle: true }
        });

        // Notify each mentioned user
        for (const user of mentionedUsers) {
            // Don't notify the actor if they mention themselves
            if (user.id !== actorId) {
                await notify(
                    actorId,
                    user.id,
                    'mention',
                    `mentioned you in a ${targetType === 'survey' ? 'post' : 'comment'}`,
                    targetType,
                    targetId,
                    payload
                );
            }
        }
    } catch (error) {
        console.error(`[MENTION ALONG NOTIFY ERROR]: Failed to extract mentions:`, error);
    }
};
