import { Router } from 'express';
import { getHashtagPosts, getTrendingHashtags } from '../controllers/hashtagController';
import { optionalAuth } from '../middleware/authMiddleware';

const router = Router();

router.get('/trending', optionalAuth, getTrendingHashtags);
router.get('/:name/posts', optionalAuth, getHashtagPosts);

export default router;
