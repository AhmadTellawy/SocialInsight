import { Router } from 'express';
import { batchIngestInteractions } from '../controllers/analyticsController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/interactions/batch', requireAuth, batchIngestInteractions);

export default router;
