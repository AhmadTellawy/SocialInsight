import { Router } from 'express';
import { searchAll } from '../controllers/searchController';
import { optionalAuth } from '../middleware/authMiddleware';

const router = Router();

router.get('/', optionalAuth, searchAll);

export default router;
