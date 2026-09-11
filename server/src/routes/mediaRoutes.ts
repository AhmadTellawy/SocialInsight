import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { cancelMedia, prepareMedia, finalizeMedia, getMedia, getMediaConfig, startMediaUpload, warmupHeif } from '../controllers/mediaController';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware';

const router = Router();

const mediaMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many media requests. Please try again later.' }
});

router.get('/config', getMediaConfig);
router.post('/heif/warmup', mediaMutationLimiter, requireAuth, warmupHeif);
router.post('/uploads', mediaMutationLimiter, requireAuth, startMediaUpload);
router.post('/:id/prepare', mediaMutationLimiter, requireAuth, prepareMedia);
router.post('/:id/finalize', mediaMutationLimiter, requireAuth, finalizeMedia);
router.get('/:id', optionalAuth, getMedia);
router.delete('/:id', mediaMutationLimiter, requireAuth, cancelMedia);

export default router;
