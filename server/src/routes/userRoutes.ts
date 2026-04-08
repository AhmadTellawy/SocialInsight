import { Router } from 'express';
import { getUser, updateUser, getUsers, getUserAnalytics, getUserFollowers, getUserFollowing, getNotifications, markNotificationsRead, markSingleNotificationRead, getUserGroups, searchUsers, getSuggestedUsers } from '../controllers/userController';
import { followUser, getFollowStatus } from '../controllers/followController';

import { requireAuth, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

router.get('/', optionalAuth, getUsers);
router.get('/search', optionalAuth, searchUsers);
router.get('/:id', optionalAuth, getUser);
router.get('/:id/followers', optionalAuth, getUserFollowers);
router.get('/:id/following', optionalAuth, getUserFollowing);

router.put('/:id', requireAuth, updateUser);
router.post('/:userId/follow', requireAuth, followUser);
router.get('/:userId/follow-status', optionalAuth, getFollowStatus); // Just checking, optional
router.get('/:id/analytics', requireAuth, getUserAnalytics);
router.get('/:id/groups', optionalAuth, getUserGroups);
router.get('/:id/suggested', requireAuth, getSuggestedUsers);

router.get('/:id/notifications', requireAuth, getNotifications);
router.post('/:id/notifications/read', requireAuth, markNotificationsRead);
router.post('/:id/notifications/:notifId/read', requireAuth, markSingleNotificationRead);

export default router;
