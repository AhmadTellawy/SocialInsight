import prisma from '../prisma';
import { buildVisiblePublishedPostWhere } from './postVisibilityService';
import { GROUP_ROLES, MEMBERSHIP_STATUS, POSTING_PERMISSIONS, POST_STATUS, JOIN_POLICIES } from '../utils/constants';

export class GroupPermissionService {
    /**
     * Calculates permissions based on group settings and membership role/status.
     */
    static calculatePermissions(
        group: { isPublic: boolean; postingPermissions: string; isDeleted: boolean; joinPolicy: string },
        role: string | null,
        status: string | null
    ) {
        // If group is deleted, no permissions are granted
        if (group.isDeleted) {
            return {
                canViewGroup: false,
                canViewMembers: false,
                canPost: false,
                postRequiresApproval: false,
                canManageSettings: false,
                canManageRoles: false,
                canManageMembers: false,
                canDeleteGroup: false,
                canInviteMembers: false,
                canApproveRequests: false
            };
        }

        const isJoined = status === MEMBERSHIP_STATUS.JOINED;
        const isOwner = role === GROUP_ROLES.OWNER && isJoined;
        const isAdmin = role === GROUP_ROLES.ADMIN && isJoined;
        const isManager = isOwner || isAdmin;

        // Banned users cannot view private groups, only public ones
        const isBanned = status === MEMBERSHIP_STATUS.BANNED;
        const canViewGroup = group.isPublic ? true : (isJoined && !isBanned);

        const canPost = isJoined && (group.postingPermissions !== POSTING_PERMISSIONS.ADMINS_ONLY || isManager);
        const postRequiresApproval = isJoined && group.postingPermissions === POSTING_PERMISSIONS.APPROVAL_NEEDED && !isManager;

        return {
            canViewGroup,
            canViewMembers: canViewGroup,
            canPost,
            postRequiresApproval,
            canManageSettings: isManager,
            canManageRoles: isOwner,
            canManageMembers: isManager,
            canDeleteGroup: isOwner,
            canInviteMembers: group.joinPolicy === JOIN_POLICIES.INVITE_ONLY ? isManager : isJoined,
            canApproveRequests: isManager
        };
    }

    /**
     * Fetches details and returns calculated group permissions for a specific user.
     */
    static async getPermissions(groupId: string, userId: string | undefined) {
        const group = await prisma.group.findUnique({
            where: { id: groupId }
        });

        if (!group) {
            return {
                canViewGroup: false,
                canViewMembers: false,
                canPost: false,
                postRequiresApproval: false,
                canManageSettings: false,
                canManageRoles: false,
                canManageMembers: false,
                canDeleteGroup: false,
                canInviteMembers: false,
                canApproveRequests: false
            };
        }

        if (!userId) {
            return this.calculatePermissions(group, null, null);
        }

        const membership = await prisma.groupMember.findUnique({
            where: { userId_groupId: { userId, groupId } }
        });

        return this.calculatePermissions(group, membership?.role || null, membership?.status || null);
    }

    /**
     * Helper to verify if an actor can change the role of a target member.
     */
    static canChangeMemberRole(actorRole: string, targetRole: string, newRole: string): boolean {
        // Only Owners can manage roles
        if (actorRole !== GROUP_ROLES.OWNER) return false;
        return true;
    }

    /**
     * Helper to verify if an actor can kick/remove a target member.
     */
    static canRemoveMember(actorRole: string, targetRole: string): boolean {
        if (actorRole === GROUP_ROLES.OWNER) return true;
        if (actorRole === GROUP_ROLES.ADMIN) {
            // Admins can only kick regular Members (not Owners or other Admins)
            return targetRole === GROUP_ROLES.MEMBER;
        }
        return false;
    }

    /**
     * PostVisibilityGuard to check if a user is allowed to access/view a post.
     */
    static async canViewPost(postId: string, userId: string | undefined): Promise<boolean> {
        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: {
                id: true,
                status: true,
                isDeleted: true,
                authorId: true,
                groupId: true,
                targetAudience: true,
                group: { select: { id: true, isPublic: true, isDeleted: true } },
                targetedGroups: { select: { id: true, isPublic: true, isDeleted: true } }
            }
        });

        if (!post || post.isDeleted) return false;

        if (post.targetAudience === 'ProfileAndGroups' && post.status === POST_STATUS.PUBLISHED) {
            return (await prisma.post.count({ where: { id: postId, ...buildVisiblePublishedPostWhere(userId) } })) > 0;
        }

        const linkedGroups = [
            ...(post.group ? [post.group] : []),
            ...post.targetedGroups
        ];
        const activeGroupsById = new Map(
            linkedGroups
                .filter((group) => group && !group.isDeleted)
                .map((group) => [group.id, group])
        );
        const activeGroupIds = Array.from(activeGroupsById.keys());

        if ((post.targetAudience === 'Groups' || linkedGroups.length > 0) && activeGroupIds.length === 0) return false;

        // If not published (DRAFT, PENDING_APPROVAL, REJECTED), only author or target group admins can view it
        if (post.status !== POST_STATUS.PUBLISHED) {
            if (!userId) return false;
            if (post.authorId === userId) return true;
            if (activeGroupIds.length === 0) return false;
            const groupManagerMembership = await prisma.groupMember.findFirst({
                where: {
                    userId,
                    groupId: { in: activeGroupIds },
                    role: { in: [GROUP_ROLES.OWNER, GROUP_ROLES.ADMIN] },
                    status: MEMBERSHIP_STATUS.JOINED
                }
            });
            return !!groupManagerMembership;
        }

        if (activeGroupIds.length === 0) {
            if (post.authorId === userId) return true;
            const audience = post.targetAudience?.trim().toLowerCase();
            if (!audience || audience === 'public') return true;
            if (audience === 'followers') {
                if (!userId) return false;
                const follow = await prisma.follow.findUnique({
                    where: { followerId_followingId: { followerId: userId, followingId: post.authorId } },
                    select: { status: true }
                });
                return follow?.status === 'ACTIVE';
            }
            return false;
        }
        if (post.authorId === userId) return true;
        if (Array.from(activeGroupsById.values()).some((group) => group.isPublic)) return true;
        if (!userId) return false;

        const membership = await prisma.groupMember.findFirst({
            where: {
                userId,
                groupId: { in: activeGroupIds },
                status: MEMBERSHIP_STATUS.JOINED
            }
        });

        return !!membership;
    }
}
