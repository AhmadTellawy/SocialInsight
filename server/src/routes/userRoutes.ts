import { Router } from 'express';
import { getUser, updateUser, getUsers, getUserAnalytics, getUserFollowers, getUserFollowing, getNotifications, markNotificationsRead, markSingleNotificationRead, getUserGroups, searchUsers } from '../controllers/userController';
import { followUser, getFollowStatus } from '../controllers/followController';

const router = Router();

router.get('/', getUsers);
router.get('/search', searchUsers);
router.get('/:id', getUser);
router.put('/:id', updateUser);
router.post('/:userId/follow', followUser);
router.get('/:userId/follow-status', getFollowStatus);
router.get('/:id/analytics', getUserAnalytics);
router.get('/:id/groups', getUserGroups);

router.get('/:id/followers', getUserFollowers);
router.get('/:id/following', getUserFollowing);

router.get('/:id/notifications', getNotifications);
router.post('/:id/notifications/read', markNotificationsRead);
router.post('/:id/notifications/:notifId/read', markSingleNotificationRead);

export default router;
