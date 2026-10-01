import { Request, Response } from 'express';
import { attachPagePublishers } from '../pages/pagePostService';
import { pageDiscoveryPostWhere } from '../pages/pageFeature';
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
import { Prisma } from '@prisma/client';

export const MAX_SEARCH_QUERY_LENGTH = 120;

const buildSearchVisiblePostWhere = (viewerId?: string | null) => ({
    AND: [buildVisiblePublishedPostWhere(viewerId), pageDiscoveryPostWhere()]
});

// A share copies source text into its own Post row. Checking only the immediate
// source can expose a Page's text through a second-generation share while the
// Page is unpublished or awaiting purge. Verify every ancestor before search
// serializes the copied text; UNION also terminates if legacy data has a cycle.
const filterVisibleShareAncestry = async <T extends { id: string; sharedFromId?: string | null }>(posts: T[], viewerId?: string | null): Promise<T[]> => {
    const shares = posts.filter(post => post.sharedFromId);
    if (!shares.length) return posts;
    const ancestry = await prisma.$queryRaw<Array<{ seedId: string; id: string }>>(Prisma.sql`
        WITH RECURSIVE ancestors("seedId", id, "sharedFromId") AS (
            SELECT p.id, p.id, p."sharedFromId" FROM "Post" p WHERE p.id IN (${Prisma.join(shares.map(post => post.id))})
            UNION
            SELECT a."seedId", parent.id, parent."sharedFromId"
            FROM ancestors a JOIN "Post" parent ON parent.id = a."sharedFromId"
        )
        SELECT DISTINCT "seedId", id FROM ancestors`);
    const ancestorIds = [...new Set(ancestry.map(row => row.id))];
    const visible = await prisma.post.findMany({
        where: { AND: [{ id: { in: ancestorIds } }, buildSearchVisiblePostWhere(viewerId)] },
        select: { id: true }
    });
    const visibleIds = new Set(visible.map(post => post.id));
    const blocked = new Set(ancestry.filter(row => !visibleIds.has(row.id)).map(row => row.seedId));
    return posts.filter(post => !blocked.has(post.id));
};

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
                                where: { post: buildSearchVisiblePostWhere(viewerId) }
                            }
                        }
                    }
                }
            }),
            // 1. Search Published Posts
            prisma.post.findMany({
                where: {
                    AND: [
                        buildSearchVisiblePostWhere(viewerId),
                        {
                            OR: [
                                { title: { contains: query, mode: 'insensitive' } },
                                { description: { contains: query, mode: 'insensitive' } },
                                { category: { contains: query, mode: 'insensitive' } }
                            ]
                        }
                    ]
                },
                take: 80,
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

        const visiblePosts = (await filterVisibleShareAncestry(posts, viewerId)).slice(0, 20);
        await attachPagePublishers(visiblePosts, viewerId);
        // Extract categories from matching posts
        const categoriesSet = new Set<string>();
        visiblePosts.forEach(p => {
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
            surveys: visiblePosts.map((post) => serializePostMediaRecord(post, viewerId)),
            people: users.map(serializePublicUserCard),
            groups: groups.map((group) => serializeGroupMediaRecord(group)),
            categories: Array.from(categoriesSet)
        });
    } catch (error) {
        console.error('Unified search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
};
