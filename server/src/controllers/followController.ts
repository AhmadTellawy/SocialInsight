import { Request, Response } from 'express';
import prisma from '../prisma';
import { notify } from '../services/notificationService';

export const followUser = async (req: Request, res: Response) => {
    const userId = req.params.userId as string; // The user to follow
    const { currentUserId } = req.body; // The user who is following

    if (!currentUserId) {
        res.status(400).json({ error: 'currentUserId is required' });
        return;
    }

    if (userId === currentUserId) {
        res.status(400).json({ error: 'Cannot follow yourself' });
        return;
    }

    try {
        // Check if already following
        const existingFollow = await prisma.follow.findUnique({
            where: {
                followerId_followingId: {
                    followerId: currentUserId,
                    followingId: userId
                }
            }
        });

        if (existingFollow) {
            // Unfollow
            const results = await prisma.$transaction([
                prisma.follow.delete({
                    where: {
                        followerId_followingId: {
                            followerId: currentUserId,
                            followingId: userId
                        }
                    }
                }),
                prisma.user.update({
                    where: { id: userId },
                    data: { followersCount: { decrement: 1 } }
                }),
                prisma.user.update({
                    where: { id: currentUserId },
                    data: { followingCount: { decrement: 1 } }
                })
            ]);

            res.json({
                isFollowing: false,
                message: 'Unfollowed successfully',
                targetUserFollowers: results[1].followersCount,
                currentUserFollowing: results[2].followingCount
            });
        } else {
            // Follow
            const results = await prisma.$transaction([
                prisma.follow.create({
                    data: {
                        followerId: currentUserId,
                        followingId: userId
                    }
                }),
                prisma.user.update({
                    where: { id: userId },
                    data: { followersCount: { increment: 1 } }
                }),
                prisma.user.update({
                    where: { id: currentUserId },
                    data: { followingCount: { increment: 1 } }
                })
            ]);

            // Notify the target user
            await notify(currentUserId, userId, 'follow', 'Started following you', 'user', currentUserId);

            res.json({
                isFollowing: true,
                message: 'Followed successfully',
                targetUserFollowers: results[1].followersCount,
                currentUserFollowing: results[2].followingCount
            });
        }
    } catch (error: any) {
        console.error('Follow Error:', error);
        res.status(500).json({ error: 'Failed to follow/unfollow user' });
    }
};

// Get follow status
export const getFollowStatus = async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const { currentUserId } = req.query;

    if (!currentUserId) {
        res.json({ isFollowing: false });
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

        res.json({ isFollowing: !!follow });
    } catch (error) {
        console.error('Get Follow Status Error:', error);
        res.status(500).json({ error: 'Failed to get follow status' });
    }
};
