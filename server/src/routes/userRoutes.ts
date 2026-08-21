import { Router } from 'express';
import { getUser, getUserByHandle, updateUser, getUsers, getUserAnalytics, getUserFollowers, getUserFollowing, getNotifications, markNotificationsRead, markSingleNotificationRead, getUserGroups, searchUsers, getSuggestedUsers, deleteAccount } from '../controllers/userController';
import { followUser, getFollowStatus, acceptFollowRequest, rejectFollowRequest, removeFollower, getPendingRequests } from '../controllers/followController';

import { requireAuth, optionalAuth } from '../middleware/authMiddleware';
import { mentionSearchLimiter } from '../middleware/rateLimiters';

const router = Router();

router.get('/', optionalAuth, getUsers);
router.get('/search', requireAuth, mentionSearchLimiter, searchUsers);
router.get('/handle/:handle', optionalAuth, getUserByHandle);
router.get('/:id', optionalAuth, getUser);
router.get('/:id/followers', optionalAuth, getUserFollowers);
router.get('/:id/following', optionalAuth, getUserFollowing);

router.put('/:id', requireAuth, updateUser);
router.delete('/:id', requireAuth, deleteAccount);
router.post('/:userId/follow', requireAuth, followUser);
router.get('/:userId/follow-status', optionalAuth, getFollowStatus); // Just checking, optional

router.post('/:userId/accept-follow', requireAuth, acceptFollowRequest);
router.post('/:userId/reject-follow', requireAuth, rejectFollowRequest);
router.post('/:userId/remove-follower', requireAuth, removeFollower);
router.get('/:id/follow-requests', requireAuth, getPendingRequests);
router.get('/:id/analytics', requireAuth, getUserAnalytics);
router.get('/:id/groups', optionalAuth, getUserGroups);
router.get('/:id/suggested', requireAuth, getSuggestedUsers);

router.get('/:id/notifications', requireAuth, getNotifications);
router.post('/:id/notifications/read', requireAuth, markNotificationsRead);
router.post('/:id/notifications/:notifId/read', requireAuth, markSingleNotificationRead);

export default router;
