import { Request, Response } from 'express';
import prisma from '../prisma';

export const getGroups = async (req: Request, res: Response) => {
    const currentUserId = req.user?.userId;
    try {
        const whereClause = currentUserId ? {
            OR: [
                { isPublic: true },
                { members: { some: { userId: currentUserId, status: 'JOINED' } } }
            ]
        } : { isPublic: true };

        const groups = await prisma.group.findMany({
            where: whereClause,
            include: {
                _count: {
                    select: { posts: true } // We rely on memberCount for members, not _count
                }
            }
        });
        res.json(groups);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
};
const checkGroupAccess = async (groupId: string, userId: string | undefined): Promise<boolean> => {
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { isPublic: true } });
    if (!group) return false;
    if (group.isPublic) return true;
    if (!userId) return false;
    const member = await prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } }
    });
    return member?.status === 'JOINED';
};

export const getGroupById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUserId = req.user?.userId;
    try {
        const hasAccess = await checkGroupAccess(id as string, currentUserId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden or Group not found' });
            return;
        }
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
    const { name, description, category, image, isPublic } = req.body;
    const creatorId = req.user?.userId;

    if (!name || !creatorId) {
        res.status(400).json({ error: 'Missing name or not authenticated' });
        return;
    }

    try {
        const newGroup = await prisma.group.create({
            data: {
                name,
                description: description || '',
                category: category || 'General',
                image: image || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=200`,
                isPublic: isPublic !== false,
                memberCount: 1,
                members: {
                    create: {
                        userId: creatorId,
                        role: 'Owner',
                        status: 'JOINED'
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
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.json({ status: 'NOT_JOINED', role: null });
        return;
    }

    try {
        const membership = await prisma.groupMember.findUnique({
            where: {
                userId_groupId: {
                    userId: currentUserId,
                    groupId: id as string
                }
            }
        });

        if (membership) {
            res.json({ status: membership.status, role: membership.role });
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
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({ where: { id: String(id) }, select: { isPublic: true } });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const existingMember = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: String(currentUserId), groupId: String(id) } }
        });

        if (existingMember) {
            if (existingMember.status === 'JOINED') {
                res.json({ status: 'JOINED', role: existingMember.role });
                return;
            } else if (existingMember.status === 'INVITED' || (group.isPublic && existingMember.status === 'PENDING')) {
                // Accept invite or automatically accept pending if public
                const updated = await prisma.groupMember.update({
                    where: { userId_groupId: { userId: String(currentUserId), groupId: String(id) } },
                    data: { status: 'JOINED' }
                });
                res.json({ status: 'JOINED', role: updated.role });
                return;
            } else {
                // Still pending in a private group
                res.json({ status: 'PENDING', role: existingMember.role });
                return;
            }
        }

        if (!group.isPublic) {
            res.status(403).json({ error: 'Group is private, please request to join' });
            return;
        }

        const newMember = await prisma.$transaction([
            prisma.groupMember.create({
                data: {
                    userId: String(currentUserId),
                    groupId: String(id),
                    role: 'Member',
                    status: 'JOINED'
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
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const membership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: currentUserId as string, groupId: id as string } }
        });

        if (!membership) {
            res.status(404).json({ error: 'Not a member of this group' });
            return;
        }

        const transaction: any[] = [
            prisma.groupMember.delete({
                where: { userId_groupId: { userId: currentUserId as string, groupId: id as string } }
            })
        ];

        if (membership.status === 'JOINED') {
            transaction.push(
                prisma.group.update({
                    where: { id: id as string },
                    data: { memberCount: { decrement: 1 } }
                })
            );
        }

        await prisma.$transaction(transaction);

        res.json({ status: 'NOT_JOINED', role: null });
    } catch (error: any) {
        console.error('Failed to leave group:', error);
        res.status(500).json({ error: 'Failed to leave group' });
    }
};

export const getGroupStats = async (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUserId = req.user?.userId;

    try {
        const hasAccess = await checkGroupAccess(id as string, currentUserId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden or Group not found' });
            return;
        }

        const group = await prisma.group.findUnique({
            where: { id: id as string },
            select: { memberCount: true }
        });

        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        let postsCount = 0;
        try {
            postsCount = await prisma.post.count({
                where: {
                    targetedGroups: { some: { id: id as string } }
                }
            });
        } catch (err) {
            console.error('Failed to count group posts:', err);
        }

        // Calculate votes by counting responses on posts targeted at this group
        const votesCount = await prisma.response.count({
            where: {
                post: { targetedGroups: { some: { id: id as string } } }
            }
        });

        const activeMembersCount = await prisma.groupMember.count({
            where: { groupId: id as string, status: 'JOINED' }
        });

        res.json({
            membersCount: activeMembersCount,
            postsCount,
            votesCount
        });
    } catch (error: any) {
        console.error('Failed to get group stats:', error);
        res.status(500).json({ error: error.message || 'Failed to get group stats' });
    }
};

export const getGroupMembers = async (req: Request, res: Response) => {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const currentUserId = req.user?.userId;

    try {
        const hasAccess = await checkGroupAccess(id as string, currentUserId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden or Group not found' });
            return;
        }

        const members = await prisma.groupMember.findMany({
            where: { groupId: id as string, status: 'JOINED' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
                user: {
                    select: { id: true, name: true, avatar: true, handle: true }
                }
            }
        });

        const total = await prisma.groupMember.count({ where: { groupId: id as string, status: 'JOINED' } });

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
    const { id } = req.params;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const existing = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: currentUserId, groupId: id as string } }
        });

        if (existing) {
            if (existing.status === 'JOINED' || existing.status === 'PENDING') {
                res.json({ status: existing.status });
                return;
            }
            if (existing.status === 'INVITED') {
                await prisma.$transaction([
                    prisma.groupMember.update({
                        where: { userId_groupId: { userId: currentUserId, groupId: id as string } },
                        data: { status: 'JOINED' }
                    }),
                    prisma.group.update({
                        where: { id: id as string },
                        data: { memberCount: { increment: 1 } }
                    })
                ]);
                res.json({ status: 'JOINED' });
                return;
            }
        }

        await prisma.groupMember.create({
            data: {
                userId: currentUserId,
                groupId: id as string,
                role: 'Member',
                status: 'PENDING'
            }
        });
        res.json({ status: 'PENDING' });
    } catch (error) {
        console.error('Failed to request join:', error);
        res.status(500).json({ error: 'Failed to request join' });
    }
};

import { SAFE_USER_SELECT, normalizePostType, parseJsonArray } from './postController';

export const getGroupPosts = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const currentUserId = req.user?.userId;

    try {
        const hasAccess = await checkGroupAccess(id as string, currentUserId);
        if (!hasAccess) {
            res.status(403).json({ error: 'Forbidden or Group not found' });
            return;
        }

        const whereClause = {
            targetedGroups: { some: { id: id as string } },
            ...(currentUserId ? { NOT: { hiddenBy: { some: { userId: currentUserId } } } } : {})
        };

        const posts = await prisma.post.findMany({
            where: whereClause,
            take: limit,
            skip: (page - 1) * limit,
            orderBy: { createdAt: 'desc' },
            include: {
                author: {
                    select: {
                        ...SAFE_USER_SELECT,
                        ...(currentUserId ? {
                            following: {
                                where: { followerId: currentUserId },
                                select: { followerId: true }
                            }
                        } : {})
                    }
                },
                questions: { include: { options: true } },
                sections: { include: { questions: { include: { options: true } } } },
                ...(currentUserId ? {
                    responses: { where: { userId: currentUserId }, take: 1 },
                    likes: { where: { userId: currentUserId }, take: 1 },
                    savedBy: { where: { userId: currentUserId }, take: 1 }
                } : {})
            }
        });

        const total = await prisma.post.count({
            where: whereClause
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
    } catch (error: any) {
        console.error('Failed to fetch group posts:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch group posts' });
    }
};
