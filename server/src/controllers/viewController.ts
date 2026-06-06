import { Request, Response } from 'express';
import prisma from '../prisma';
import crypto from 'crypto';

// In-memory cache to prevent DB spam for the 60-minute window
// Key: "postId:viewerKey", Value: timestamp
const viewCache = new Map<string, number>();
const CACHE_TTL = 60 * 60 * 1000; // 60 minutes

// Cleanup cache every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of viewCache.entries()) {
        if (now - timestamp > CACHE_TTL) {
            viewCache.delete(key);
        }
    }
}, 10 * 60 * 1000);

function hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
}

export const canViewPost = async (postId: string, userId?: string): Promise<boolean> => {
    const post = await prisma.post.findUnique({
        where: { id: postId },
        include: { targetedGroups: true }
    });

    if (!post || post.isDeleted) return false;
    if (post.status === 'DRAFT' && post.authorId !== userId) return false;
    
    // Note: If post is for specific groups, we should ideally check membership.
    // For now, if visibility is strictly private and not author, deny.
    if (post.visibility === 'PRIVATE' && post.authorId !== userId) return false;

    return true;
};

export const recordPostView = async (req: Request, res: Response) => {
    try {
        const { id: postId } = req.params;
        const { source, deviceType, guestSessionId } = req.body;
        const user = (req as any).user;
        const userId = user?.id;

        // Determine viewer key
        let viewerKey = '';
        if (userId) {
            viewerKey = `user:${userId}`;
        } else if (guestSessionId) {
            viewerKey = `session:${guestSessionId}`;
        } else {
            return res.status(400).json({ error: 'Missing viewer identification' });
        }

        // 1. Authorization check
        const isAllowed = await canViewPost(postId, userId);
        if (!isAllowed) {
            return res.status(403).json({ error: 'Not allowed to view this post' });
        }

        // 2. Cache check (Optimization Layer)
        const cacheKey = `${postId}:${viewerKey}`;
        const now = Date.now();
        const lastViewedAt = viewCache.get(cacheKey);

        if (lastViewedAt && (now - lastViewedAt) < CACHE_TTL) {
            const post = await prisma.post.findUnique({
                where: { id: postId },
                select: { viewCount: true, uniqueViewCount: true }
            });
            return res.json({ recorded: false, viewCount: post?.viewCount || 0, uniqueViewCount: post?.uniqueViewCount || 0 });
        }

        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const ipHash = hashString(ip);
        const userAgentHash = hashString(userAgent);

        // 3. Database Transaction
        const result = await prisma.$transaction(async (tx) => {
            // Check for recent view in DB (Cache miss fallback)
            const sixtyMinsAgo = new Date(Date.now() - CACHE_TTL);
            const recentView = await tx.postView.findFirst({
                where: {
                    postId,
                    viewerKey,
                    viewedAt: { gte: sixtyMinsAgo }
                }
            });

            if (recentView) {
                const p = await tx.post.findUnique({ where: { id: postId }, select: { viewCount: true, uniqueViewCount: true } });
                return { recorded: false, viewCount: p?.viewCount || 0, uniqueViewCount: p?.uniqueViewCount || 0 };
            }

            // Check if this is the first view EVER by this viewerKey for this post
            const firstViewEver = await tx.postView.findFirst({
                where: { postId, viewerKey }
            });
            const isFirstView = !firstViewEver;

            // Record the view
            await tx.postView.create({
                data: {
                    postId,
                    viewerKey,
                    source: source || 'UNKNOWN',
                    deviceType: deviceType || 'UNKNOWN',
                    ipHash,
                    userAgentHash
                }
            });

            // Update Post counters safely using atomic increment
            const updatedPost = await tx.post.update({
                where: { id: postId },
                data: {
                    viewCount: { increment: 1 },
                    uniqueViewCount: isFirstView ? { increment: 1 } : undefined
                },
                select: { viewCount: true, uniqueViewCount: true }
            });

            return {
                recorded: true,
                viewCount: updatedPost.viewCount,
                uniqueViewCount: updatedPost.uniqueViewCount
            };
        }); // default isolation level is fine since atomic increment is used

        // Update Cache
        if (result.recorded) {
            viewCache.set(cacheKey, now);
        }

        return res.json(result);
    } catch (error) {
        console.error('Error recording post view:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
