import { Prisma } from '@prisma/client';
import { ProfileValidationError } from '../utils/profileValidation';
import { Request, Response } from 'express';
import prisma from '../prisma';
import { notify } from '../services/notificationService';
import { PUBLIC_AVATAR_MEDIA_SELECT, serializePublicUserCard } from '../services/mediaService';

export const followUser = async (req: Request, res: Response) => {
    const targetId = req.params.userId as string;
    const actorId = req.user?.userId;
    if (!actorId) return res.status(401).json({ error: 'Unauthorized' });
    if (targetId === actorId) return res.status(400).json({ error: 'Cannot follow yourself' });
    try {
        const status = await prisma.$transaction(async tx => {
            await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${actorId}, ${targetId}) ORDER BY id FOR UPDATE`);
            const target = await tx.user.findUnique({ where: { id: targetId }, select: { status: true, isPrivate: true, mediaPrivacyTarget: true } });
            const block = await tx.userBlock.findFirst({ where: { OR: [{ blockerId: actorId, blockedId: targetId }, { blockerId: targetId, blockedId: actorId }] } });
            if (!target || target.status !== 'ACTIVE' || block) throw new ProfileValidationError('FOLLOW_UNAVAILABLE', 'Cannot follow this account.', 403);
            const existing = await tx.follow.findUnique({ where: { followerId_followingId: { followerId: actorId, followingId: targetId } } });
            if (existing) {
                await tx.follow.delete({ where: { id: existing.id } });
                if (existing.status === 'ACTIVE') {
                    await tx.user.updateMany({ where: { id: actorId, followingCount: { gt: 0 } }, data: { followingCount: { decrement: 1 } } });
                    await tx.user.updateMany({ where: { id: targetId, followersCount: { gt: 0 } }, data: { followersCount: { decrement: 1 } } });
                }
                return 'NONE';
            }
            const next = target.isPrivate || target.mediaPrivacyTarget === true ? 'PENDING' : 'ACTIVE';
            await tx.follow.create({ data: { followerId: actorId, followingId: targetId, status: next, requestedAt: new Date(), ...(next === 'ACTIVE' ? { approvedAt: new Date() } : {}) } });
            if (next === 'ACTIVE') {
                await tx.user.update({ where: { id: actorId }, data: { followingCount: { increment: 1 } } });
                await tx.user.update({ where: { id: targetId }, data: { followersCount: { increment: 1 } } });
            }
            return next;
        });
        if (status !== 'NONE') await notify(actorId, targetId, status === 'ACTIVE' ? 'follow' : 'follow_request', status === 'ACTIVE' ? 'Started following you' : 'Requested to follow you', 'profile', actorId);
        return res.json({ followStatus: status, isFollowing: status === 'ACTIVE' });
    } catch (error) {
        if (error instanceof ProfileValidationError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
        return res.status(500).json({ error: 'Failed to update follow status.' });
    }
};

export const getFollowStatus = async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const currentUserId = req.user?.userId;

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
        await prisma.$transaction(async tx => {
            await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${currentUserId}, ${followerId}) ORDER BY id FOR UPDATE`);
            const blocked = await tx.userBlock.findFirst({ where: { OR: [{ blockerId: currentUserId, blockedId: followerId }, { blockerId: followerId, blockedId: currentUserId }] } });
            const follower = await tx.user.findUnique({ where: { id: followerId }, select: { status: true } });
            if (blocked || follower?.status !== 'ACTIVE') throw new Error('FOLLOW_UNAVAILABLE');
            const follow = await tx.follow.findUnique({ where: { followerId_followingId: { followerId, followingId: currentUserId } } });
            if (!follow || follow.status !== 'PENDING') throw new Error('FOLLOW_UNAVAILABLE');
            await tx.follow.update({ where: { id: follow.id }, data: { status: 'ACTIVE', approvedAt: new Date() } });
            await tx.user.update({ where: { id: currentUserId }, data: { followersCount: { increment: 1 } } });
            await tx.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } });
        });

        await notify(currentUserId, followerId, 'follow_accept', 'Accepted your follow request', 'profile', currentUserId);

        res.json({ message: 'Request accepted' });
    } catch (error) {
        if (error instanceof Error && error.message === 'FOLLOW_UNAVAILABLE') return res.status(403).json({ error: 'This follow request is unavailable.' });
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
                        ...PUBLIC_AVATAR_MEDIA_SELECT,
                        verifiedBadge: true
                    }
                }
            },
            orderBy: { requestedAt: 'desc' }
        });

        res.json(requests.map((request) => ({
            ...request,
            follower: serializePublicUserCard(request.follower)
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch pending requests' });
    }
};
