import { Request, Response } from 'express';
import prisma from '../prisma';
import { notify } from '../services/notificationService';

export const followUser = async (req: Request, res: Response) => {
    const userId = req.params.userId as string; // The user to follow
    const currentUserId = req.user?.userId; // The user who is following

    if (!currentUserId) {
        res.status(400).json({ error: 'currentUserId is required' });
        return;
    }

    if (userId === currentUserId) {
        res.status(400).json({ error: 'Cannot follow yourself' });
        return;
    }

    try {
        // Check blocks
        const block = await prisma.userBlock.findFirst({
            where: {
                OR: [
                    { blockerId: currentUserId, blockedId: userId },
                    { blockerId: userId, blockedId: currentUserId }
                ]
            }
        });

        if (block) {
            res.status(403).json({ error: 'Cannot follow this user' });
            return;
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { isPrivate: true, mediaPrivacyTarget: true }
        });

        if (!targetUser) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const existingFollow = await prisma.follow.findUnique({
            where: {
                followerId_followingId: {
                    followerId: currentUserId,
                    followingId: userId
                }
            }
        });

        if (existingFollow) {
            // Cancel request or Unfollow
            if (existingFollow.status === 'ACTIVE') {
                await prisma.$transaction([
                    prisma.follow.delete({ where: { id: existingFollow.id } }),
                    prisma.user.update({ where: { id: userId }, data: { followersCount: { decrement: 1 } } }),
                    prisma.user.update({ where: { id: currentUserId }, data: { followingCount: { decrement: 1 } } })
                ]);
            } else {
                // Was PENDING or something else
                await prisma.follow.delete({ where: { id: existingFollow.id } });
            }

            res.json({
                followStatus: 'NONE',
                isFollowing: false,
                message: 'Unfollowed successfully'
            });
        } else {
            // Follow
            const status = targetUser.isPrivate || targetUser.mediaPrivacyTarget === true ? 'PENDING' : 'ACTIVE';
            const now = new Date();

            const follow = await prisma.follow.create({
                data: {
                    followerId: currentUserId,
                    followingId: userId,
                    status,
                    requestedAt: now,
                    ...(status === 'ACTIVE' ? { approvedAt: now } : {})
                }
            });

            if (status === 'ACTIVE') {
                await prisma.$transaction([
                    prisma.user.update({ where: { id: userId }, data: { followersCount: { increment: 1 } } }),
                    prisma.user.update({ where: { id: currentUserId }, data: { followingCount: { increment: 1 } } })
                ]);
                await notify(currentUserId, userId, 'follow', 'Started following you', 'profile', currentUserId);
            } else {
                // Send PENDING request notification
                await notify(currentUserId, userId, 'follow_request', 'Requested to follow you', 'profile', currentUserId);
            }

            res.json({
                followStatus: status,
                isFollowing: status === 'ACTIVE',
                message: status === 'ACTIVE' ? 'Followed successfully' : 'Follow request sent'
            });
        }
    } catch (error: any) {
        console.error('Follow Error:', error);
        res.status(500).json({ error: 'Failed to follow/unfollow user' });
    }
};

export const getFollowStatus = async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const currentUserId = req.user?.userId || req.query.currentUserId;

    if (!currentUserId) {
        res.json({ followStatus: 'NONE' });
        return;
    }

    try {
        const follow = await prisma.follow.findUnique({
            where: {
                followerId_followingId: {
                    followerId: currentUserId as string,
                    followingId: userId
                }
            }
        });

        res.json({ followStatus: follow ? follow.status : 'NONE' });
    } catch (error) {
        console.error('Get Follow Status Error:', error);
        res.status(500).json({ error: 'Failed to get follow status' });
    }
};

export const acceptFollowRequest = async (req: Request, res: Response) => {
    const followerId = req.params.userId as string; // User who sent the request
    const currentUserId = req.user?.userId; // Target user

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const follow = await prisma.follow.findUnique({
            where: { followerId_followingId: { followerId, followingId: currentUserId } }
        });

        if (!follow || follow.status !== 'PENDING') {
            res.status(400).json({ error: 'No pending request found' });
            return;
        }

        await prisma.$transaction([
            prisma.follow.update({
                where: { id: follow.id },
                data: { status: 'ACTIVE', approvedAt: new Date() }
            }),
            prisma.user.update({ where: { id: currentUserId }, data: { followersCount: { increment: 1 } } }),
            prisma.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } })
        ]);

        await notify(currentUserId, followerId, 'follow_accept', 'Accepted your follow request', 'profile', currentUserId);

        res.json({ message: 'Request accepted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to accept request' });
    }
};

export const rejectFollowRequest = async (req: Request, res: Response) => {
    const followerId = req.params.userId as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const follow = await prisma.follow.findUnique({
            where: { followerId_followingId: { followerId, followingId: currentUserId } }
        });

        if (!follow || follow.status !== 'PENDING') {
            res.status(400).json({ error: 'No pending request found' });
            return;
        }

        await prisma.follow.update({
            where: { id: follow.id },
            data: { status: 'REJECTED', rejectedAt: new Date() }
        });

        res.json({ message: 'Request rejected' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reject request' });
    }
};

export const removeFollower = async (req: Request, res: Response) => {
    const followerId = req.params.userId as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const follow = await prisma.follow.findUnique({
            where: { followerId_followingId: { followerId, followingId: currentUserId } }
        });

        if (!follow || follow.status !== 'ACTIVE') {
            res.status(400).json({ error: 'Follower not found' });
            return;
        }

        await prisma.$transaction([
            prisma.follow.delete({ where: { id: follow.id } }),
            prisma.user.update({ where: { id: currentUserId }, data: { followersCount: { decrement: 1 } } }),
            prisma.user.update({ where: { id: followerId }, data: { followingCount: { decrement: 1 } } })
        ]);

        res.json({ message: 'Follower removed' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to remove follower' });
    }
};

export const getPendingRequests = async (req: Request, res: Response) => {
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const requests = await prisma.follow.findMany({
            where: { followingId: currentUserId, status: 'PENDING' },
            include: {
                follower: {
                    select: {
                        id: true,
                        name: true,
                        handle: true,
                        avatar: true,
                        verifiedBadge: true
                    }
                }
            },
            orderBy: { requestedAt: 'desc' }
        });

        res.json(requests);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch pending requests' });
    }
};
