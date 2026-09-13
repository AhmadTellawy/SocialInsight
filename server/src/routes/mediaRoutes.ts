import { Router } from 'express';
import { cancelMedia, prepareMedia, finalizeMedia, getMedia, getMediaConfig, startMediaUpload, warmupHeif } from '../controllers/mediaController';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware';
import { durableRateLimit } from '../middleware/authRateLimit';

const router = Router();

const mediaMutationLimiter = durableRateLimit('media-mutation', {
  windowMs: 15 * 60 * 1000,
  userLimit: 120,
  networkLimit: 6_000,
  message: 'Too many media requests. Please try again later.',
  code: 'MEDIA_RATE_LIMITED'
});

router.get('/config', getMediaConfig);
router.post('/heif/warmup', requireAuth, mediaMutationLimiter, warmupHeif);
router.post('/uploads', requireAuth, mediaMutationLimiter, startMediaUpload);
router.post('/:id/prepare', requireAuth, mediaMutationLimiter, prepareMedia);
router.post('/:id/finalize', requireAuth, mediaMutationLimiter, finalizeMedia);
router.get('/:id', optionalAuth, getMedia);
router.delete('/:id', requireAuth, mediaMutationLimiter, cancelMedia);

export default router;
