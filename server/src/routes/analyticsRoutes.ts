import { Router } from 'express';
import { batchIngestInteractions } from '../controllers/analyticsController';

const router = Router();

router.post('/interactions/batch', batchIngestInteractions);

export default router;
