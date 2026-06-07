import { Router } from 'express';
import {
    getGroups,
    getGroupById,
    createGroup,
    updateGroup,
    deleteGroup,
    getMembership,
    joinGroup,
    leaveGroup,
    getGroupStats,
    getGroupMembers,
    requestJoin,
    getGroupPosts,
    updateMemberRole,
    kickMember,
    banMember,
    getPendingRequests,
    approveJoinRequest,
    rejectJoinRequest,
    getPendingPosts,
    approvePendingPost,
    rejectPendingPost,
    inviteToGroup,
    declineGroupInvite,
    cancelJoinRequest,
    getBannedMembers,
    unbanMember
} from '../controllers/groupController';

import { requireAuth, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/', requireAuth, createGroup);
router.get('/', optionalAuth, getGroups);
router.get('/:id', optionalAuth, getGroupById);
router.put('/:id', requireAuth, updateGroup);
router.delete('/:id', requireAuth, deleteGroup);
router.get('/:id/membership', optionalAuth, getMembership);
router.post('/:id/join', requireAuth, joinGroup);
router.post('/:id/leave', requireAuth, leaveGroup);
router.post('/:id/request-join', requireAuth, requestJoin);
router.post('/:id/invite', requireAuth, inviteToGroup);
router.post('/:id/invite/decline', requireAuth, declineGroupInvite);
router.get('/:id/stats', optionalAuth, getGroupStats);
router.get('/:id/members', optionalAuth, getGroupMembers);
router.get('/:id/posts', optionalAuth, getGroupPosts);

// Roles, moderation and queue routing
router.put('/:id/members/:memberId/role', requireAuth, updateMemberRole);
router.post('/:id/members/:memberId/kick', requireAuth, kickMember);
router.post('/:id/members/:memberId/ban', requireAuth, banMember);
router.get('/:id/pending-requests', requireAuth, getPendingRequests);
router.post('/:id/members/:memberId/approve', requireAuth, approveJoinRequest);
router.post('/:id/members/:memberId/reject', requireAuth, rejectJoinRequest);
router.get('/:id/pending-posts', requireAuth, getPendingPosts);
router.post('/:id/posts/:postId/approve', requireAuth, approvePendingPost);
router.post('/:id/posts/:postId/reject', requireAuth, rejectPendingPost);

// Cancel join request, banned members, unban
router.delete('/:id/cancel-request', requireAuth, cancelJoinRequest);
router.get('/:id/banned-members', requireAuth, getBannedMembers);
router.delete('/:id/members/:memberId/unban', requireAuth, unbanMember);

export default router;
