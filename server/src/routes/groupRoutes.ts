import { Router } from 'express';
import {
    getGroups,
    getGroupById,
    createGroup,
    getMembership,
    joinGroup,
    leaveGroup,
    getGroupStats,
    getGroupMembers,
    requestJoin,
    getGroupPosts
} from '../controllers/groupController';

import { requireAuth, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/', requireAuth, createGroup);
router.get('/', optionalAuth, getGroups);
router.get('/:id', optionalAuth, getGroupById);
router.get('/:id/membership', optionalAuth, getMembership);
router.post('/:id/join', requireAuth, joinGroup);
router.post('/:id/leave', requireAuth, leaveGroup);
router.post('/:id/request-join', requireAuth, requestJoin);
router.get('/:id/stats', optionalAuth, getGroupStats);
router.get('/:id/members', optionalAuth, getGroupMembers);
router.get('/:id/posts', optionalAuth, getGroupPosts);

export default router;
