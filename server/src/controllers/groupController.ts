import { Request, Response } from 'express';
import prisma from '../prisma';
import { GROUP_ROLES, MEMBERSHIP_STATUS, JOIN_POLICIES, POSTING_PERMISSIONS, POST_STATUS } from '../utils/constants';
import { GroupPermissionService } from '../services/groupPermissionService';
import { notify } from '../services/notificationService';
import { processBase64Image } from '../utils/imageProcessor';

// Helper to update active member count on Group model
export const updateGroupMemberCount = async (groupId: string) => {
    const count = await prisma.groupMember.count({
        where: { groupId, status: MEMBERSHIP_STATUS.JOINED }
    });
    await prisma.group.update({
        where: { id: groupId },
        data: { memberCount: count }
    });
};

const softDeleteGroupAndCleanPosts = async (tx: any, groupId: string) => {
    await tx.group.update({
        where: { id: groupId },
        data: { isDeleted: true, deletedAt: new Date() }
    });

    const posts = await tx.post.findMany({
        where: {
            OR: [
                { groupId },
                { targetedGroups: { some: { id: groupId } } }
            ]
        },
        include: {
            group: { select: { id: true, isDeleted: true } },
            targetedGroups: { select: { id: true, isDeleted: true } }
        }
    });

    for (const post of posts) {
        const activeOtherTargetGroup = post.targetedGroups.find((group: any) => group.id !== groupId && !group.isDeleted);
        const activePrimaryGroup = post.group && post.group.id !== groupId && !post.group.isDeleted ? post.group : null;
        const replacementGroupId = activeOtherTargetGroup?.id || activePrimaryGroup?.id || null;

        if (!replacementGroupId) {
            await tx.post.update({
                where: { id: post.id },
                data: { isDeleted: true, deletedAt: new Date() }
            });
            continue;
        }

        await tx.post.update({
            where: { id: post.id },
            data: {
                groupId: post.groupId === groupId || post.group?.isDeleted ? replacementGroupId : post.groupId,
                targetedGroups: { disconnect: { id: groupId } }
            }
        });
    }
};

export const getGroups = async (req: Request, res: Response) => {
    const currentUserId = req.user?.userId;
    try {
        const whereClause = currentUserId ? {
            isDeleted: false,
            OR: [
                { isPublic: true },
                { members: { some: { userId: currentUserId, status: MEMBERSHIP_STATUS.JOINED } } }
            ]
        } : { isPublic: true, isDeleted: false };

        const groups = await prisma.group.findMany({
            where: whereClause,
            include: {
                members: currentUserId ? { where: { userId: currentUserId } } : false
            }
        });
        
        const formattedGroups = await Promise.all(groups.map(async (g) => {
            const membership = currentUserId ? g.members?.[0] : null;
            const permissions = GroupPermissionService.calculatePermissions(g, membership?.role || null, membership?.status || null);
            
            // Fetch posts count dynamically from targetedPosts
            const postsCount = await prisma.post.count({
                where: { targetedGroups: { some: { id: g.id } }, isDeleted: false, status: POST_STATUS.PUBLISHED }
            });

            return {
                ...g,
                memberCount: g.memberCount,
                postsCount,
                permissions,
                role: membership?.role || null
            };
        }));
        
        res.json(formattedGroups);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
};

export const getGroupById = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;
    try {
        const group = await prisma.group.findUnique({
            where: { id: id as string }
        });

        if (!group || group.isDeleted) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canViewGroup) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        // Fetch paginated group members & posts
        const groupDetails = await prisma.group.findUnique({
            where: { id: id as string },
            include: {
                members: {
                    where: { status: MEMBERSHIP_STATUS.JOINED },
                    take: 10,
                    select: {
                        userId: true,
                        role: true,
                        user: {
                            select: { id: true, name: true, avatar: true, handle: true }
                        }
                    }
                }
            }
        });

        res.json({
            ...groupDetails,
            permissions
        });
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

    const trimmedName = name.trim();
    if (trimmedName.length < 3 || trimmedName.length > 50) {
        res.status(400).json({ error: 'Group name must be between 3 and 50 characters.' });
        return;
    }

    const trimmedDesc = (description || '').trim();
    if (trimmedDesc.length > 500) {
        res.status(400).json({ error: 'Group description cannot exceed 500 characters.' });
        return;
    }

    const allowedCategories = [
        'Hobby & Interests',
        'Education & Study',
        'Non-Profit & Community',
        'Gaming & Esports',
        'Health & Wellness',
        'Professional Networking',
        'Technology',
        'Marketing',
        'Finance',
        'Consumer Goods',
        'Retail',
        'Other'
    ];

    const finalCategory = allowedCategories.includes(category) ? category : 'Other';

    try {
        let processedImage = null;
        if (image) {
            if (image.startsWith('data:image/') && image.length > 3000000) {
                res.status(400).json({ error: 'Image size exceeds the 2MB limit.' });
                return;
            }
            processedImage = await processBase64Image(image);
        } else {
            processedImage = `https://ui-avatars.com/api/?name=${encodeURIComponent(trimmedName)}&background=random&color=fff&size=200`;
        }

        const newGroup = await prisma.group.create({
            data: {
                name: trimmedName,
                description: trimmedDesc,
                category: finalCategory,
                image: processedImage,
                isPublic: isPublic !== false,
                memberCount: 1,
                members: {
                    create: {
                        userId: creatorId,
                        role: GROUP_ROLES.OWNER,
                        status: MEMBERSHIP_STATUS.JOINED
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

export const updateGroup = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { name, description, category, image, isPublic, joinPolicy, postingPermissions } = req.body;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canManageSettings) {
            res.status(403).json({ error: 'Forbidden: You do not have permissions to manage settings.' });
            return;
        }

        const updateData: any = {};
        if (name !== undefined) {
            const trimmedName = name.trim();
            if (trimmedName.length < 3 || trimmedName.length > 50) {
                res.status(400).json({ error: 'Group name must be between 3 and 50 characters.' });
                return;
            }
            updateData.name = trimmedName;
        }

        if (description !== undefined) {
            const trimmedDesc = (description || '').trim();
            if (trimmedDesc.length > 500) {
                res.status(400).json({ error: 'Group description cannot exceed 500 characters.' });
                return;
            }
            updateData.description = trimmedDesc;
        }

        if (category !== undefined) updateData.category = category;
        if (isPublic !== undefined) updateData.isPublic = isPublic;

        if (joinPolicy !== undefined) {
            const validPolicies = Object.values(JOIN_POLICIES);
            if (!validPolicies.includes(joinPolicy)) {
                res.status(400).json({ error: 'Invalid join policy.' });
                return;
            }
            updateData.joinPolicy = joinPolicy;
        }

        if (postingPermissions !== undefined) {
            const validPerms = Object.values(POSTING_PERMISSIONS);
            if (!validPerms.includes(postingPermissions)) {
                res.status(400).json({ error: 'Invalid posting permissions.' });
                return;
            }
            updateData.postingPermissions = postingPermissions;
        }

        if (image !== undefined) {
            if (image && image.startsWith('data:image/') && image.length > 3000000) {
                res.status(400).json({ error: 'Image size exceeds the 2MB limit.' });
                return;
            }
            updateData.image = image ? await processBase64Image(image) : null;
        }

        const updated = await prisma.group.update({
            where: { id },
            data: updateData
        });

        res.json(updated);
    } catch (error) {
        console.error('Failed to update group settings:', error);
        res.status(500).json({ error: 'Failed to update group settings.' });
    }
};

export const deleteGroup = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canDeleteGroup) {
            res.status(403).json({ error: 'Forbidden: Only the group owner can delete the group.' });
            return;
        }

        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });

        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        await prisma.$transaction(async (tx) => {
            await softDeleteGroupAndCleanPosts(tx, id);
            await tx.groupMember.updateMany({
                where: { groupId: id },
                data: { status: MEMBERSHIP_STATUS.REMOVED }
            });
        });

        res.json({ success: true, message: 'Group soft deleted successfully.' });
    } catch (error) {
        console.error('Failed to delete group:', error);
        res.status(500).json({ error: 'Failed to delete group' });
    }
};

export const getMembership = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.json({ status: 'NOT_JOINED', role: null });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id: id as string, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

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
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id: String(id), isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const existingMember = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: String(currentUserId), groupId: String(id) } }
        });

        if (existingMember) {
            if (existingMember.status === MEMBERSHIP_STATUS.BANNED) {
                res.status(403).json({ error: 'You are banned from this group.' });
                return;
            }
            if (existingMember.status === MEMBERSHIP_STATUS.JOINED) {
                res.json({ status: MEMBERSHIP_STATUS.JOINED, role: existingMember.role });
                return;
            }

            if (existingMember.status === MEMBERSHIP_STATUS.INVITED || (group.joinPolicy === JOIN_POLICIES.OPEN && (existingMember.status === MEMBERSHIP_STATUS.PENDING || existingMember.status === MEMBERSHIP_STATUS.REMOVED))) {
                const updated = await prisma.groupMember.update({
                    where: { id: existingMember.id },
                    data: { status: MEMBERSHIP_STATUS.JOINED }
                });
                await updateGroupMemberCount(id);
                res.json({ status: MEMBERSHIP_STATUS.JOINED, role: updated.role });
                return;
            } else if (group.joinPolicy === JOIN_POLICIES.REQUEST) {
                const updated = await prisma.groupMember.update({
                    where: { id: existingMember.id },
                    data: { status: MEMBERSHIP_STATUS.PENDING }
                });
                
                // Notify managers
                const managers = await prisma.groupMember.findMany({
                    where: { groupId: id, role: { in: [GROUP_ROLES.OWNER, GROUP_ROLES.ADMIN] }, status: MEMBERSHIP_STATUS.JOINED }
                });
                const user = await prisma.user.findUnique({ where: { id: currentUserId }, select: { name: true } });
                for (const manager of managers) {
                    await notify(currentUserId, manager.userId, 'group_join_request', `${user?.name || 'A user'} requested to join ${group.name}.`, 'group', id);
                }

                res.json({ status: MEMBERSHIP_STATUS.PENDING, role: updated.role });
                return;
            } else {
                res.json({ status: existingMember.status, role: existingMember.role });
                return;
            }
        }

        if (group.joinPolicy === JOIN_POLICIES.INVITE_ONLY) {
            res.status(403).json({ error: 'Group is invite-only' });
            return;
        }

        const newStatus = group.joinPolicy === JOIN_POLICIES.REQUEST ? MEMBERSHIP_STATUS.PENDING : MEMBERSHIP_STATUS.JOINED;

        const newMember = await prisma.groupMember.create({
            data: {
                userId: String(currentUserId),
                groupId: String(id),
                role: GROUP_ROLES.MEMBER,
                status: newStatus
            }
        });

        if (newStatus === MEMBERSHIP_STATUS.JOINED) {
            await updateGroupMemberCount(id);
        } else {
            // Notify managers
            const managers = await prisma.groupMember.findMany({
                where: { groupId: id, role: { in: [GROUP_ROLES.OWNER, GROUP_ROLES.ADMIN] }, status: MEMBERSHIP_STATUS.JOINED }
            });
            const user = await prisma.user.findUnique({ where: { id: currentUserId }, select: { name: true } });
            for (const manager of managers) {
                await notify(currentUserId, manager.userId, 'group_join_request', `${user?.name || 'A user'} requested to join ${group.name}.`, 'group', id);
            }
        }

        res.json({ status: newMember.status, role: newMember.role });
    } catch (error) {
        console.error('Failed to join group:', error);
        res.status(500).json({ error: 'Failed to join group' });
    }
};

export const leaveGroup = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id: id as string, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const membership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: currentUserId, groupId: id } }
        });

        if (!membership || membership.status !== MEMBERSHIP_STATUS.JOINED) {
            res.status(404).json({ error: 'Not a member of this group' });
            return;
        }

        if (membership.role === GROUP_ROLES.OWNER) {
            const otherOwnersCount = await prisma.groupMember.count({
                where: { groupId: id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED, userId: { not: currentUserId } }
            });

            if (otherOwnersCount === 0) {
                const otherMembersCount = await prisma.groupMember.count({
                    where: { groupId: id, status: MEMBERSHIP_STATUS.JOINED, userId: { not: currentUserId } }
                });

                if (otherMembersCount > 0) {
                    res.status(400).json({ error: 'You are the sole owner. You must transfer ownership to another member before leaving.' });
                    return;
                } else {
                    await prisma.$transaction(async (tx) => {
                        await softDeleteGroupAndCleanPosts(tx, id);
                        await tx.groupMember.delete({
                            where: { id: membership.id }
                        });
                    });
                    res.json({ status: 'NOT_JOINED', role: null, deleted: true });
                    return;
                }
            }
        }

        await prisma.groupMember.delete({
            where: { id: membership.id }
        });

        await updateGroupMemberCount(id);

        res.json({ status: 'NOT_JOINED', role: null });
    } catch (error) {
        console.error('Failed to leave group:', error);
        res.status(500).json({ error: 'Failed to leave group' });
    }
};

export const getGroupStats = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });

        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canViewGroup) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const postsCount = await prisma.post.count({
            where: { targetedGroups: { some: { id } }, isDeleted: false, status: POST_STATUS.PUBLISHED }
        });

        const votesCount = await prisma.response.count({
            where: { post: { targetedGroups: { some: { id } }, isDeleted: false, status: POST_STATUS.PUBLISHED } }
        });

        res.json({
            membersCount: group.memberCount,
            postsCount,
            votesCount
        });
    } catch (error: any) {
        console.error('Failed to get group stats:', error);
        res.status(500).json({ error: error.message || 'Failed to get group stats' });
    }
};

export const getGroupMembers = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const currentUserId = req.user?.userId;

    try {
        const group = await prisma.group.findUnique({ where: { id, isDeleted: false } });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canViewGroup) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const members = await prisma.groupMember.findMany({
            where: { groupId: id, status: MEMBERSHIP_STATUS.JOINED },
            skip: (page - 1) * limit,
            take: limit,
            include: {
                user: {
                    select: { id: true, name: true, avatar: true, handle: true }
                }
            }
        });

        const total = await prisma.groupMember.count({ where: { groupId: id, status: MEMBERSHIP_STATUS.JOINED } });

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
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id: id as string, isDeleted: false },
            select: { name: true, joinPolicy: true }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        if (group.joinPolicy === JOIN_POLICIES.INVITE_ONLY) {
            res.status(403).json({ error: 'Group is invite-only' });
            return;
        }

        if (group.joinPolicy === JOIN_POLICIES.OPEN) {
            res.status(400).json({ error: 'Group is open, use join endpoint instead' });
            return;
        }

        const existing = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: currentUserId, groupId: id as string } }
        });

        if (existing) {
            if (existing.status === MEMBERSHIP_STATUS.BANNED) {
                res.status(403).json({ error: 'You are banned from this group.' });
                return;
            }
            if (existing.status === MEMBERSHIP_STATUS.JOINED || existing.status === MEMBERSHIP_STATUS.PENDING) {
                res.json({ status: existing.status, role: existing.role });
                return;
            }
            if (existing.status === MEMBERSHIP_STATUS.INVITED) {
                await prisma.groupMember.update({
                    where: { id: existing.id },
                    data: { status: MEMBERSHIP_STATUS.JOINED }
                });
                await updateGroupMemberCount(id as string);
                res.json({ status: MEMBERSHIP_STATUS.JOINED, role: existing.role });
                return;
            }
            if (existing.status === MEMBERSHIP_STATUS.REMOVED) {
                await prisma.groupMember.update({
                    where: { id: existing.id },
                    data: { status: MEMBERSHIP_STATUS.PENDING }
                });

                // Notify managers
                const managers = await prisma.groupMember.findMany({
                    where: { groupId: id, role: { in: [GROUP_ROLES.OWNER, GROUP_ROLES.ADMIN] }, status: MEMBERSHIP_STATUS.JOINED }
                });
                const user = await prisma.user.findUnique({ where: { id: currentUserId }, select: { name: true } });
                for (const manager of managers) {
                    await notify(currentUserId, manager.userId, 'group_join_request', `${user?.name || 'A user'} requested to join ${group.name}.`, 'group', id);
                }

                res.json({ status: MEMBERSHIP_STATUS.PENDING, role: existing.role });
                return;
            }
        }

        await prisma.groupMember.create({
            data: {
                userId: currentUserId,
                groupId: id as string,
                role: GROUP_ROLES.MEMBER,
                status: MEMBERSHIP_STATUS.PENDING
            }
        });

        // Notify managers
        const managers = await prisma.groupMember.findMany({
            where: { groupId: id, role: { in: [GROUP_ROLES.OWNER, GROUP_ROLES.ADMIN] }, status: MEMBERSHIP_STATUS.JOINED }
        });
        const user = await prisma.user.findUnique({ where: { id: currentUserId }, select: { name: true } });
        for (const manager of managers) {
            await notify(currentUserId, manager.userId, 'group_join_request', `${user?.name || 'A user'} requested to join ${group.name}.`, 'group', id);
        }

        res.json({ status: MEMBERSHIP_STATUS.PENDING, role: GROUP_ROLES.MEMBER });
    } catch (error) {
        console.error('Failed to request join:', error);
        res.status(500).json({ error: 'Failed to request join' });
    }
};

export const getGroupPosts = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const currentUserId = req.user?.userId;

    try {
        const group = await prisma.group.findUnique({ where: { id, isDeleted: false } });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canViewGroup) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const whereClause = {
            targetedGroups: { some: { id } },
            status: POST_STATUS.PUBLISHED,
            isDeleted: false,
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
                        id: true, name: true, handle: true, avatar: true, bio: true, location: true, website: true,
                        isPrivate: true, groupPrivacy: true, verifiedBadge: true, followersCount: true, followingCount: true, createdAt: true,
                        ...(currentUserId ? {
                            following: {
                                where: { followerId: currentUserId },
                                select: { followerId: true }
                            }
                        } : {})
                    }
                },
                questions: { include: { options: { orderBy: { order: 'asc' } } } },
                sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                targetedGroups: true,
                responses: currentUserId ? { where: { userId: currentUserId }, take: 1, include: { answers: true } } : false,
                likes: currentUserId ? { where: { userId: currentUserId }, take: 1 } : false,
                shares: currentUserId ? { where: { authorId: currentUserId }, take: 1 } : false,
                savedBy: currentUserId ? { where: { userId: currentUserId }, take: 1 } : false,
                sharedFrom: {
                    include: {
                        author: { select: { id: true, name: true, handle: true, avatar: true } },
                        questions: { include: { options: { orderBy: { order: 'asc' } } } },
                        sections: { include: { questions: { include: { options: { orderBy: { order: 'asc' } } } } } },
                        targetedGroups: true,
                        responses: currentUserId ? { where: { userId: currentUserId }, take: 1, include: { answers: true } } : false,
                        likes: currentUserId ? { where: { userId: currentUserId }, take: 1 } : false,
                        shares: currentUserId ? { where: { authorId: currentUserId }, take: 1 } : false,
                        savedBy: currentUserId ? { where: { userId: currentUserId }, take: 1 } : false,
                    }
                }
            }
        });

        const total = await prisma.post.count({
            where: whereClause
        });

        // Note: Mapping logic to parse JSONs and formats
        const mappedPosts = posts.map((s: any) => {
            const actualResponse = s.sharedFrom ? s.sharedFrom.responses?.[0] : s.responses?.[0];
            const userAnswers = actualResponse?.answers || [];
            
            let mappedSharedFrom: any = undefined;
            if (s.sharedFrom) {
                mappedSharedFrom = {
                    ...s.sharedFrom,
                    options: ['Poll', 'Challenge', 'Prediction', 'Debate'].includes(s.sharedFrom.type || '') && s.sharedFrom.questions?.length > 0 ? s.sharedFrom.questions[0].options : [],
                    author: s.sharedFrom.author ? {
                        ...s.sharedFrom.author,
                        isFollowing: currentUserId ? (s.sharedFrom.author.following && s.sharedFrom.author.following.length > 0) : false
                    } : undefined,
                    likes: s.sharedFrom.likesCount,
                    repostCount: s.sharedFrom.sharesCount || 0,
                    commentsCount: s.sharedFrom.commentsCount || 0,
                    participants: s.sharedFrom.responseCount || 0,
                    targetGroups: Array.isArray(s.sharedFrom.targetedGroups) ? s.sharedFrom.targetedGroups.map((g: any) => g.id) : [],
                    hasParticipated: currentUserId ? (s.sharedFrom.responses && s.sharedFrom.responses.length > 0) : false,
                    isLiked: currentUserId ? (s.sharedFrom.likes && s.sharedFrom.likes.length > 0) : false,
                    isSaved: currentUserId ? (s.sharedFrom.savedBy && s.sharedFrom.savedBy.length > 0) : false,
                };
            }

            return {
                ...s,
                likes: s.likesCount,
                participants: s.responseCount,
                coverImage: s.image,
                hasParticipated: currentUserId ? (s.responses && s.responses.length > 0) : false,
                isLiked: currentUserId ? (s.likes && s.likes.length > 0) : false,
                isSaved: currentUserId ? (s.savedBy && s.savedBy.length > 0) : false,
                options: ['Poll', 'Challenge', 'Prediction', 'Debate'].includes(s.type || '') && s.questions?.length > 0 ? s.questions[0].options : [],
                author: {
                    ...s.author,
                    isFollowing: currentUserId ? (s.author.following && s.author.following.length > 0) : false
                },
                targetGroups: Array.isArray(s.targetedGroups) ? s.targetedGroups.map((g: any) => g.id) : [],
                sharedFrom: mappedSharedFrom,
                userSelectedOptions: userAnswers.map((a: any) => a.optionId).filter(Boolean),
                responses: actualResponse ? { answers: actualResponse.answers } : undefined,
            };
        });

        res.json({
            posts: mappedPosts,
            hasMore: page * limit < total
        });
    } catch (error: any) {
        console.error('Failed to fetch group posts:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch group posts' });
    }
};

// --- NEW MANAGEMENT ENDPOINTS ---

export const updateMemberRole = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const memberId = req.params.memberId as string;
    const { role: newRole } = req.body;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const callerMembership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: currentUserId, groupId: id } }
        });

        if (!callerMembership || callerMembership.status !== MEMBERSHIP_STATUS.JOINED) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const targetMembership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: memberId, groupId: id } }
        });

        if (!targetMembership || targetMembership.status !== MEMBERSHIP_STATUS.JOINED) {
            res.status(404).json({ error: 'Member not found or not in group.' });
            return;
        }

        const isAuthorized = GroupPermissionService.canChangeMemberRole(callerMembership.role, targetMembership.role, newRole);
        if (!isAuthorized) {
            res.status(403).json({ error: 'Forbidden: You do not have permissions to manage roles.' });
            return;
        }

        if (targetMembership.role === GROUP_ROLES.OWNER && newRole !== GROUP_ROLES.OWNER) {
            const ownersCount = await prisma.groupMember.count({
                where: { groupId: id, role: GROUP_ROLES.OWNER, status: MEMBERSHIP_STATUS.JOINED }
            });
            if (ownersCount <= 1) {
                res.status(400).json({ error: 'Cannot demote the sole owner. Transfer ownership first.' });
                return;
            }
        }

        const updated = await prisma.groupMember.update({
            where: { id: targetMembership.id },
            data: { role: newRole }
        });

        res.json({ success: true, member: updated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update role.' });
    }
};

export const kickMember = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const memberId = req.params.memberId as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const callerMembership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: currentUserId, groupId: id } }
        });

        if (!callerMembership || callerMembership.status !== MEMBERSHIP_STATUS.JOINED) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const targetMembership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: memberId, groupId: id } }
        });

        if (!targetMembership || targetMembership.status !== MEMBERSHIP_STATUS.JOINED) {
            res.status(404).json({ error: 'Member not found or not in group.' });
            return;
        }

        const canKick = GroupPermissionService.canRemoveMember(callerMembership.role, targetMembership.role);
        if (!canKick) {
            res.status(403).json({ error: 'Forbidden: You cannot kick this member.' });
            return;
        }

        if (targetMembership.role === GROUP_ROLES.OWNER) {
            res.status(400).json({ error: 'Cannot kick a group owner.' });
            return;
        }

        await prisma.groupMember.update({
            where: { id: targetMembership.id },
            data: { status: MEMBERSHIP_STATUS.REMOVED }
        });

        await updateGroupMemberCount(id);

        res.json({ success: true, message: 'Member kicked successfully.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to kick member.' });
    }
};

export const banMember = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const memberId = req.params.memberId as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const callerMembership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: currentUserId, groupId: id } }
        });

        if (!callerMembership || callerMembership.status !== MEMBERSHIP_STATUS.JOINED) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const targetMembership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: memberId, groupId: id } }
        });

        if (!targetMembership) {
            // Can ban non-member directly
            await prisma.groupMember.create({
                data: {
                    userId: memberId,
                    groupId: id,
                    status: MEMBERSHIP_STATUS.BANNED
                }
            });
            res.json({ success: true, message: 'User banned successfully.' });
            return;
        }

        const canBan = GroupPermissionService.canRemoveMember(callerMembership.role, targetMembership.role);
        if (!canBan) {
            res.status(403).json({ error: 'Forbidden: You cannot ban this member.' });
            return;
        }

        if (targetMembership.role === GROUP_ROLES.OWNER) {
            res.status(400).json({ error: 'Cannot ban a group owner.' });
            return;
        }

        await prisma.groupMember.update({
            where: { id: targetMembership.id },
            data: { status: MEMBERSHIP_STATUS.BANNED }
        });

        await updateGroupMemberCount(id);

        res.json({ success: true, message: 'Member banned successfully.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to ban member.' });
    }
};

export const getPendingRequests = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canApproveRequests) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const pending = await prisma.groupMember.findMany({
            where: { groupId: id, status: MEMBERSHIP_STATUS.PENDING },
            include: { user: { select: { id: true, name: true, avatar: true, handle: true } } }
        });

        const formatted = pending.map((m: any) => ({
            id: m.userId,
            name: m.user.name,
            avatar: m.user.avatar,
            handle: m.user.handle,
            status: m.status
        }));

        res.json(formatted);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to get pending requests' });
    }
};

export const approveJoinRequest = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const memberId = req.params.memberId as string;
    const currentUserId = req.user?.userId;

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canApproveRequests) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const record = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: memberId, groupId: id } }
        });

        if (!record || record.status !== MEMBERSHIP_STATUS.PENDING) {
            res.status(404).json({ error: 'Join request not found.' });
            return;
        }

        await prisma.groupMember.update({
            where: { id: record.id },
            data: { status: MEMBERSHIP_STATUS.JOINED }
        });

        await updateGroupMemberCount(id);

        // Notify user
        await notify(currentUserId, memberId, 'group_join_approved', `Your request to join ${group?.name} has been approved.`, 'group', id);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to approve request' });
    }
};

export const rejectJoinRequest = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const memberId = req.params.memberId as string;
    const currentUserId = req.user?.userId;

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canApproveRequests) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const record = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId: memberId, groupId: id } }
        });

        if (!record || record.status !== MEMBERSHIP_STATUS.PENDING) {
            res.status(404).json({ error: 'Join request not found.' });
            return;
        }

        // Just delete the record or mark it as REMOVED so they can request again
        await prisma.groupMember.delete({
            where: { id: record.id }
        });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reject request' });
    }
};

export const getPendingPosts = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canApproveRequests) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const pendingPosts = await prisma.post.findMany({
            where: { targetedGroups: { some: { id } }, status: POST_STATUS.PENDING_APPROVAL, isDeleted: false },
            include: {
                author: { select: { id: true, name: true, handle: true, avatar: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(pendingPosts);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to get pending posts queue' });
    }
};

export const approvePendingPost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const postId = req.params.postId as string;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canApproveRequests) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: { targetedGroups: true }
        });

        if (!post || post.status !== POST_STATUS.PENDING_APPROVAL) {
            res.status(404).json({ error: 'Post not found or not pending approval.' });
            return;
        }

        const isLinkedToGroup = post.groupId === id || (post as any).targetedGroups.some((g: any) => g.id === id);
        if (!isLinkedToGroup) {
            res.status(400).json({ error: 'Post is not linked to this group.' });
            return;
        }

        const updated = await prisma.post.update({
            where: { id: postId },
            data: {
                status: POST_STATUS.PUBLISHED,
                approvedById: currentUserId,
                approvedAt: new Date()
            }
        });

        // Notify author
        await notify(currentUserId, post.authorId, 'group_post_approved', `Your post "${post.title}" has been approved in ${group?.name}.`, 'post', postId);

        res.json({ success: true, post: updated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to approve post' });
    }
};

export const rejectPendingPost = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const postId = req.params.postId as string;
    const { reason } = req.body;
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const group = await prisma.group.findUnique({
            where: { id, isDeleted: false }
        });
        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        const permissions = await GroupPermissionService.getPermissions(id, currentUserId);
        if (!permissions.canApproveRequests) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: { targetedGroups: true }
        });

        if (!post || post.status !== POST_STATUS.PENDING_APPROVAL) {
            res.status(404).json({ error: 'Post not found or not pending approval.' });
            return;
        }

        const isLinkedToGroup = post.groupId === id || (post as any).targetedGroups.some((g: any) => g.id === id);
        if (!isLinkedToGroup) {
            res.status(400).json({ error: 'Post is not linked to this group.' });
            return;
        }

        const updated = await prisma.post.update({
            where: { id: postId },
            data: {
                status: POST_STATUS.REJECTED,
                rejectedById: currentUserId,
                rejectedAt: new Date(),
                rejectionReason: reason || 'No reason specified'
            }
        });

        // Notify author
        await notify(currentUserId, post.authorId, 'group_post_rejected', `Your post "${post.title}" in ${group?.name} was rejected. Reason: ${reason || 'No reason specified'}`, 'group', id);

        res.json({ success: true, post: updated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reject post' });
    }
};
