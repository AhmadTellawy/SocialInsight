import { Request, Response } from 'express';
import prisma from '../prisma';
import {
    POST_MEDIA_INCLUDE,
    PUBLIC_AVATAR_MEDIA_SELECT,
    PUBLIC_GROUP_MEDIA_INCLUDE,
    serializeGroupMediaRecord,
    serializePostMediaRecord,
    serializePublicUserCard
} from '../services/mediaService';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { normalizeHashtag } from '../utils/textEntities';
import { z } from 'zod';

export const MAX_SEARCH_QUERY_LENGTH = 120;

const searchQuerySchema = z.string().max(MAX_SEARCH_QUERY_LENGTH);

export const parseSearchQuery = (value: unknown): { kind: 'empty' | 'invalid' | 'valid'; query?: string } => {
    if (value === undefined || value === '') return { kind: 'empty' };
    const parsed = searchQuerySchema.safeParse(value);
    if (!parsed.success) return { kind: 'invalid' };
    const query = parsed.data.trim().toLowerCase();
    return query.length < 2 ? { kind: 'empty' } : { kind: 'valid', query };
};

export const searchAll = async (req: Request, res: Response) => {
    const parsedQuery = parseSearchQuery(req.query.q);
    const viewerId = req.user?.userId;

    if (parsedQuery.kind === 'invalid') {
        res.status(400).json({ error: 'Search query must be a single text value of at most 120 characters.', code: 'INVALID_SEARCH_QUERY' });
        return;
    }
    if (parsedQuery.kind === 'empty') {
        res.json({ topics: [], surveys: [], people: [], groups: [], categories: [] });
        return;
    }
    const query = parsedQuery.query!;

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
                    AND: [
                        buildVisiblePublishedPostWhere(viewerId),
                        {
                            OR: [
                                { title: { contains: query, mode: 'insensitive' } },
                                { description: { contains: query, mode: 'insensitive' } },
                                { category: { contains: query, mode: 'insensitive' } }
                            ]
                        }
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
                    searchVisibility: true,
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
            people: users.map(serializePublicUserCard),
            groups: groups.map((group) => serializeGroupMediaRecord(group)),
            categories: Array.from(categoriesSet)
        });
    } catch (error) {
        console.error('Unified search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
};
