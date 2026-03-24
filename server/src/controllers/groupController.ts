import { Request, Response } from 'express';
import prisma from '../prisma';

export const getGroups = async (req: Request, res: Response) => {
    try {
        const groups = await prisma.group.findMany({
            include: {
                _count: {
                    select: { members: true, posts: true }
                }
            }
        });
        res.json(groups);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
};

export const getGroupById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const group = await prisma.group.findUnique({
            where: { id: id as string },
            include: {
                members: {
                    take: 10,
                    include: { user: true }
                },
                posts: {
                    take: 10,
                    orderBy: { createdAt: 'desc' },
                    include: { author: true }
                }
            }
        });

        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        res.json(group);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch group' });
    }
};

export const createGroup = async (req: Request, res: Response) => {
    const { name, description, category, image, isPublic, creatorId } = req.body;

    if (!name || !creatorId) {
        res.status(400).json({ error: 'Missing name or creatorId' });
        return;
    }

    try {
        const newGroup = await prisma.group.create({
            data: {
                name,
                description: description || '',
                category: category || 'General',
                image: image || null,
                isPublic: isPublic !== false,
                memberCount: 1,
                members: {
                    create: {
                        userId: creatorId,
                        role: 'Owner'
                    }
                }
            }
        });

        res.status(201).json(newGroup);
    } catch (error) {
        console.error('Failed to create group:', error);
        res.status(500).json({ error: 'Failed to create group' });
    }
};

export const getMembership = async (req: Request, res: Response) => {
    const { id } = req.params; // groupId
    const { currentUserId } = req.query;

    if (!currentUserId) {
        res.status(400).json({ error: 'currentUserId is required' });
        return;
    }

    try {
        const membership = await prisma.groupMember.findUnique({
            where: {
                userId_groupId: {
                    userId: currentUserId as string,
                    groupId: id as string
                }
            }
        });

        if (membership) {
            res.json({ status: 'JOINED', role: membership.role });
        } else {
            res.json({ status: 'NOT_JOINED', role: null });
        }
    } catch (error) {
        console.error('Failed to fetch membership:', error);
        res.status(500).json({ error: 'Failed to fetch membership' });
    }
};

export const joinGroup = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { currentUserId } = req.body;

    if (!currentUserId) {
        res.status(400).json({ error: 'currentUserId is required' });
        return;
    }

    try {
        const existingMember = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: String(currentUserId), groupId: String(id) } }
        });

        if (existingMember) {
            res.json({ status: 'JOINED', role: existingMember.role });
            return;
        }

        const newMember = await prisma.$transaction([
            prisma.groupMember.create({
                data: {
                    userId: String(currentUserId),
                    groupId: String(id),
                    role: 'Member'
                }
            }),
            prisma.group.update({
                where: { id: String(id) },
                data: { memberCount: { increment: 1 } }
            })
        ]);

        res.json({ status: 'JOINED', role: newMember[0].role });
    } catch (error) {
        console.error('Failed to join group:', error);
        res.status(500).json({ error: 'Failed to join group' });
    }
};

export const leaveGroup = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { currentUserId } = req.body;

    if (!currentUserId) {
        res.status(400).json({ error: 'currentUserId is required' });
        return;
    }

    try {
        await prisma.$transaction([
            prisma.groupMember.delete({
                where: { userId_groupId: { userId: currentUserId as string, groupId: id as string } }
            }),
            prisma.group.update({
                where: { id: id as string },
                data: { memberCount: { decrement: 1 } }
            })
        ]);

        res.json({ status: 'NOT_JOINED', role: null });
    } catch (error: any) {
        if (error.code === 'P2025') {
            res.status(404).json({ error: 'Not a member of this group' });
        } else {
            console.error('Failed to leave group:', error);
            res.status(500).json({ error: 'Failed to leave group' });
        }
    }
};

export const getGroupStats = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const group = await prisma.group.findUnique({
            where: { id: id as string },
            select: { memberCount: true }
        });

        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const postsCount = await prisma.post.count({
            where: {
                targetGroups: { contains: `"${id}"` }
            }
        });

        // Summing up votes requires aggregating responses or likes, but for now we fallback to 0 or count responses via Post
        // simplified logic since we don't have direct group-level vote aggregation
        res.json({
            membersCount: group.memberCount,
            postsCount,
            votesCount: 0 // Placeholder or computed if needed
        });
    } catch (error) {
        console.error('Failed to get group stats:', error);
        res.status(500).json({ error: 'Failed to get group stats' });
    }
};

export const getGroupMembers = async (req: Request, res: Response) => {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    try {
        const members = await prisma.groupMember.findMany({
            where: { groupId: id as string },
            skip: (page - 1) * limit,
            take: limit,
            include: {
                user: {
                    select: { id: true, name: true, avatar: true, handle: true }
                }
            }
        });

        const total = await prisma.groupMember.count({ where: { groupId: id as string } });

        const formattedMembers = members.map((m: any) => ({
            id: m.userId,
            name: m.user.name,
            avatar: m.user.avatar,
            handle: m.user.handle,
            role: m.role
        }));

        res.json({
            members: formattedMembers,
            hasMore: page * limit < total
        });
    } catch (error) {
        console.error('Failed to get group members:', error);
        res.status(500).json({ error: 'Failed to get group members' });
    }
};

export const requestJoin = async (req: Request, res: Response) => {
    // Basic placeholder, in a real system this might create a PendingRequest record
    // For now we just return PENDING
    res.json({ status: 'PENDING' });
};

import { SAFE_USER_SELECT, normalizePostType, parseJsonArray } from './postController';

export const getGroupPosts = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const currentUserId = req.query.currentUserId as string | undefined;

    try {
        const posts = await prisma.post.findMany({
            where: {
                targetGroups: {
                    contains: `"${id}"`
                },
                ...(currentUserId ? {
                    NOT: { hiddenBy: { some: { userId: currentUserId } } }
                } : {})
            },
            take: limit,
            skip: (page - 1) * limit,
            orderBy: { createdAt: 'desc' },
            include: {
                author: {
                    select: {
                        ...SAFE_USER_SELECT,
                        following: currentUserId ? {
                            where: { followerId: currentUserId },
                            select: { followerId: true }
                        } : false
                    }
                },
                questions: { include: { options: true } },
                sections: { include: { questions: { include: { options: true } } } },
                responses: currentUserId ? { where: { userId: currentUserId }, take: 1 } : false,
                likes: currentUserId ? { where: { userId: currentUserId }, take: 1 } : false,
                savedBy: currentUserId ? { where: { userId: currentUserId }, take: 1 } : false
            }
        });

        const total = await prisma.post.count({
            where: {
                targetGroups: {
                    contains: id
                },
                ...(currentUserId ? {
                    NOT: { hiddenBy: { some: { userId: currentUserId } } }
                } : {})
            }
        });

        const mappedPosts = posts.map((s: any) => ({
            ...s,
            likes: s.likesCount,
            participants: s.responseCount,
            coverImage: s.image,
            hasParticipated: currentUserId ? (s.responses && s.responses.length > 0) : false,
            isLiked: currentUserId ? (s.likes && s.likes.length > 0) : false,
            isSaved: currentUserId ? (s.savedBy && s.savedBy.length > 0) : false,
            options: normalizePostType(s.type) === 'Poll' && s.questions?.length > 0 ? s.questions[0].options : [],
            author: {
                ...s.author,
                isFollowing: currentUserId ? (s.author.following && s.author.following.length > 0) : false
            },
            allowAnonymous: s.allowAnonymous,
            forceAnonymous: s.forceAnonymous,
            demographics: parseJsonArray(s.demographics)
        }));

        res.json({
            posts: mappedPosts,
            hasMore: page * limit < total
        });
    } catch (error) {
        console.error('Failed to fetch group posts:', error);
        res.status(500).json({ error: 'Failed to fetch group posts' });
    }
};
