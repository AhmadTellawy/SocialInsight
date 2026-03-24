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

const router = Router();

router.post('/', createGroup);
router.get('/', getGroups);
router.get('/:id', getGroupById);
router.get('/:id/membership', getMembership);
router.post('/:id/join', joinGroup);
router.post('/:id/leave', leaveGroup);
router.post('/:id/request-join', requestJoin);
router.get('/:id/stats', getGroupStats);
router.get('/:id/members', getGroupMembers);
router.get('/:id/posts', getGroupPosts);

export default router;
