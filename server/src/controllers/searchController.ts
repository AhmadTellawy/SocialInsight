import { Request, Response } from 'express';
import prisma from '../prisma';
import { POST_STATUS } from '../utils/constants';

export const searchAll = async (req: Request, res: Response) => {
    const query = (req.query.q as string || '').trim().toLowerCase();

    if (!query || query.length < 2) {
        res.json({ surveys: [], people: [], groups: [], categories: [] });
        return;
    }

    try {
        const [posts, users, groups] = await Promise.all([
            // 1. Search Published Posts
            prisma.post.findMany({
                where: {
                    isDeleted: false,
                    status: POST_STATUS.PUBLISHED,
                    OR: [
                        { title: { contains: query, mode: 'insensitive' } },
                        { description: { contains: query, mode: 'insensitive' } },
                        { category: { contains: query, mode: 'insensitive' } }
                    ]
                },
                take: 20,
                include: {
                    author: { select: { id: true, name: true, avatar: true, handle: true } }
                }
            }),

            // 2. Search Users
            prisma.user.findMany({
                where: {
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { handle: { contains: query, mode: 'insensitive' } }
                    ]
                },
                take: 10,
                select: {
                    id: true,
                    name: true,
                    handle: true,
                    avatar: true
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
                take: 10
            })
        ]);

        // Extract categories from matching posts
        const categoriesSet = new Set<string>();
        posts.forEach(p => {
            if (p.category) categoriesSet.add(p.category);
        });

        res.json({
            surveys: posts,
            people: users,
            groups: groups,
            categories: Array.from(categoriesSet)
        });
    } catch (error) {
        console.error('Unified search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
};
