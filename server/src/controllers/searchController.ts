import { Request, Response } from 'express';
import prisma from '../prisma';
import {
    POST_MEDIA_INCLUDE,
    PUBLIC_AVATAR_MEDIA_SELECT,
    PUBLIC_GROUP_MEDIA_INCLUDE,
    serializeGroupMediaRecord,
    serializePostMediaRecord,
    serializeUserMediaRecord
} from '../services/mediaService';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { normalizeHashtag } from '../utils/textEntities';

export const searchAll = async (req: Request, res: Response) => {
    const query = (req.query.q as string || '').trim().toLowerCase();
    const viewerId = req.user?.userId;

    if (!query || query.length < 2) {
        res.json({ topics: [], surveys: [], people: [], groups: [], categories: [] });
        return;
    }

    try {
        const topicQuery = normalizeHashtag(query.replace(/^#/, ''));
        const [topics, posts, users, groups] = await Promise.all([
            prisma.hashtag.findMany({
                where: { normalizedName: { contains: topicQuery } },
                take: query.startsWith('#') ? 10 : 5,
                orderBy: { normalizedName: 'asc' },
                select: {
                    id: true,
                    normalizedName: true,
                    displayName: true,
                    _count: {
                        select: {
                            posts: {
                                where: { post: buildVisiblePublishedPostWhere(viewerId) }
                            }
                        }
                    }
                }
            }),
            // 1. Search Published Posts
            prisma.post.findMany({
                where: {
                    ...buildVisiblePublishedPostWhere(viewerId),
                    OR: [
                        { title: { contains: query, mode: 'insensitive' } },
                        { description: { contains: query, mode: 'insensitive' } },
                        { category: { contains: query, mode: 'insensitive' } }
                    ]
                },
                take: 20,
                include: {
                    author: { select: { id: true, name: true, avatar: true, handle: true, ...PUBLIC_AVATAR_MEDIA_SELECT } },
                    media: POST_MEDIA_INCLUDE
                }
            }),

            // 2. Search Users
            prisma.user.findMany({
                where: {
                    status: 'ACTIVE',
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { handle: { contains: query, mode: 'insensitive' } }
                    ],
                    ...(viewerId ? {
                        NOT: [
                            { blockedBy: { some: { blockerId: viewerId } } },
                            { blocking: { some: { blockedId: viewerId } } }
                        ]
                    } : {})
                },
                take: 10,
                select: {
                    id: true,
                    name: true,
                    handle: true,
                    avatar: true,
                    ...PUBLIC_AVATAR_MEDIA_SELECT
                }
            }),

            // 3. Search Public Groups
            prisma.group.findMany({
                where: {
                    isDeleted: false,
                    isPublic: true,
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { description: { contains: query, mode: 'insensitive' } },
                        { category: { contains: query, mode: 'insensitive' } }
                    ]
                },
                take: 10,
                include: PUBLIC_GROUP_MEDIA_INCLUDE
            })
        ]);

        // Extract categories from matching posts
        const categoriesSet = new Set<string>();
        posts.forEach(p => {
            if (p.category) categoriesSet.add(p.category);
        });

        res.json({
            topics: topics
                .map((topic) => ({
                    id: topic.id,
                    normalizedName: topic.normalizedName,
                    displayName: topic.displayName,
                    postCount: topic._count.posts
                }))
                .filter((topic) => topic.postCount > 0)
                .sort((left, right) => right.postCount - left.postCount),
            surveys: posts.map((post) => serializePostMediaRecord(post, viewerId)),
            people: users.map((user) => serializeUserMediaRecord(user)),
            groups: groups.map((group) => serializeGroupMediaRecord(group)),
            categories: Array.from(categoriesSet)
        });
    } catch (error) {
        console.error('Unified search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
};
