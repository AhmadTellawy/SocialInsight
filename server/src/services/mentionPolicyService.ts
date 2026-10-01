import prisma from '../prisma';
import { GroupPermissionService } from './groupPermissionService';
import { PrivacyService } from './privacyService';
import { MEMBERSHIP_STATUS, POST_STATUS } from '../utils/constants';
import { buildVisiblePublishedPostWhere } from './postVisibilityService';

export interface MentionSourceContext {
    postId: string;
    authorId: string;
    pageId?: string | null;
    status: string;
    isDeleted: boolean;
    groupIds: string[];
}

export type MentionIneligibilityReason =
    | 'self'
    | 'inactive_account'
    | 'blocked'
    | 'source_unavailable'
    | 'source_forbidden'
    | 'group_membership_required'
    | 'author_privacy';

export type MentionEligibilityResult =
    | { allowed: true }
    | { allowed: false; reason: MentionIneligibilityReason };

export interface MentionPolicyDependencies {
    loadTargetStatus: (targetUserId: string) => Promise<string | null>;
    hasBlockRelationship: (actorUserId: string, targetUserId: string) => Promise<boolean>;
    loadSourceContext: (postId: string) => Promise<MentionSourceContext | null>;
    canViewPost: (postId: string, targetUserId: string) => Promise<boolean>;
    canViewAuthorContent: (targetUserId: string, authorId: string) => Promise<boolean>;
    hasJoinedGroupMembership: (targetUserId: string, groupIds: string[]) => Promise<boolean>;
    hasPageBlockRelationship?: (pageId: string, targetUserId: string) => Promise<boolean>;
    canViewPagePost?: (postId: string, targetUserId: string) => Promise<boolean>;
    loadCommentPageId?: (commentId: string) => Promise<string | null>;
}

const defaultDependencies: MentionPolicyDependencies = {
    loadTargetStatus: async (targetUserId) => {
        const user = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: { status: true }
        });
        return user?.status || null;
    },
    hasBlockRelationship: async (actorUserId, targetUserId) => {
        const block = await prisma.userBlock.findFirst({
            where: {
                OR: [
                    { blockerId: actorUserId, blockedId: targetUserId },
                    { blockerId: targetUserId, blockedId: actorUserId }
                ]
            },
            select: { id: true }
        });
        return !!block;
    },
    loadSourceContext: async (postId) => {
        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: {
                id: true,
                authorId: true,
                pageId: true,
                status: true,
                isDeleted: true,
                groupId: true,
                targetedGroups: { select: { id: true } }
            }
        });
        if (!post) return null;
        return {
            postId: post.id,
            authorId: post.authorId,
            pageId: post.pageId,
            status: post.status,
            isDeleted: post.isDeleted,
            groupIds: Array.from(new Set([
                post.groupId,
                ...post.targetedGroups.map((group) => group.id)
            ].filter((groupId): groupId is string => !!groupId)))
        };
    },
    hasPageBlockRelationship: async (pageId, userId) => !!await prisma.pageBlock.findFirst({ where: { pageId, userId }, select: { userId: true } }),
    canViewPagePost: async (postId, targetUserId) => !!await prisma.post.count({ where: { id: postId, ...buildVisiblePublishedPostWhere(targetUserId) } }),
    loadCommentPageId: async (id) => (await prisma.comment.findUnique({ where: { id }, select: { pageId: true } }))?.pageId || null,
    canViewPost: (postId, targetUserId) => GroupPermissionService.canViewPost(postId, targetUserId),
    canViewAuthorContent: (targetUserId, authorId) => PrivacyService.canViewUserContent(targetUserId, authorId),
    hasJoinedGroupMembership: async (targetUserId, groupIds) => {
        const membership = await prisma.groupMember.findFirst({
            where: {
                userId: targetUserId,
                groupId: { in: groupIds },
                status: MEMBERSHIP_STATUS.JOINED
            },
            select: { id: true }
        });
        return !!membership;
    }
};

export const canMention = async (
    input: { actorUserId: string; targetUserId: string; postId: string; commentId?: string },
    dependencies: MentionPolicyDependencies = defaultDependencies,
    preparedSource?: MentionSourceContext | null
): Promise<MentionEligibilityResult> => {
    const [targetStatus, source] = await Promise.all([
        dependencies.loadTargetStatus(input.targetUserId),
        preparedSource === undefined ? dependencies.loadSourceContext(input.postId) : Promise.resolve(preparedSource)
    ]);
    const pageActor = !!source?.pageId && (!input.commentId || await dependencies.loadCommentPageId?.(input.commentId) === source.pageId);
    if (!pageActor && input.actorUserId === input.targetUserId) return { allowed: false, reason: 'self' };
    const blocked = (!pageActor && await dependencies.hasBlockRelationship(input.actorUserId, input.targetUserId))
        || (!!source?.pageId && !!await dependencies.hasPageBlockRelationship?.(source.pageId, input.targetUserId));

    if (targetStatus !== 'ACTIVE') return { allowed: false, reason: 'inactive_account' };
    if (blocked) return { allowed: false, reason: 'blocked' };
    if (!source || source.isDeleted || source.status !== POST_STATUS.PUBLISHED) {
        return { allowed: false, reason: 'source_unavailable' };
    }

    const canView = source.pageId && dependencies.canViewPagePost ? dependencies.canViewPagePost : dependencies.canViewPost;
    if (!await canView(source.postId, input.targetUserId)) {
        return { allowed: false, reason: 'source_forbidden' };
    }

    if (source.pageId) return { allowed: true };

    if (source.groupIds.length > 0) {
        if (source.authorId === input.targetUserId) return { allowed: true };
        const isMember = await dependencies.hasJoinedGroupMembership(input.targetUserId, source.groupIds);
        return isMember ? { allowed: true } : { allowed: false, reason: 'group_membership_required' };
    }

    const canViewAuthor = await dependencies.canViewAuthorContent(input.targetUserId, source.authorId);
    return canViewAuthor ? { allowed: true } : { allowed: false, reason: 'author_privacy' };
};

export const loadMentionSourceContext = (postId: string): Promise<MentionSourceContext | null> =>
    defaultDependencies.loadSourceContext(postId);
