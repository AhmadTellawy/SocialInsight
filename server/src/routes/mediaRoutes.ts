import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { cancelMedia, finalizeMedia, getMedia, getMediaConfig, prepareMedia, startMediaUpload } from '../controllers/mediaController';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware';

const router = Router();

const mediaMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many media requests. Please try again later.' }
});

const heifPreparationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  keyGenerator: (req) => req.user!.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many HEIC/HEIF conversions. Please try again later.', code: 'HEIF_RATE_LIMITED' }
});

router.get('/config', getMediaConfig);
router.post('/uploads', mediaMutationLimiter, requireAuth, startMediaUpload);
router.post('/:id/prepare', mediaMutationLimiter, requireAuth, heifPreparationLimiter, prepareMedia);
router.post('/:id/finalize', mediaMutationLimiter, requireAuth, finalizeMedia);
router.get('/:id', optionalAuth, getMedia);
router.delete('/:id', mediaMutationLimiter, requireAuth, cancelMedia);

export default router;
