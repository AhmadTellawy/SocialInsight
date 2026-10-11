import { Router } from 'express';
import { cancelMedia, prepareMedia, finalizeMedia, getMedia, getMediaConfig, startMediaUpload, warmupHeif } from '../controllers/mediaController';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware';
import { durableRateLimit } from '../middleware/authRateLimit';
import { pageMediaBytes } from '../pages/pageMediaService';
import { PagePolicyError } from '../pages/pagePolicy';

const router = Router();

const mediaMutationLimiter = durableRateLimit('media-mutation', {
  windowMs: 15 * 60 * 1000,
  userLimit: 120,
  networkLimit: 6_000,
  message: 'Too many media requests. Please try again later.',
  code: 'MEDIA_RATE_LIMITED'
});

router.get('/config', getMediaConfig);
router.get('/:id/content', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Authorization');
  res.vary('Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}, optionalAuth, async (req, res) => {
  try {
    const rawWidth = req.query.width;
    const width = rawWidth === undefined ? undefined : typeof rawWidth === 'string' && /^\d+$/.test(rawWidth) ? Number(rawWidth) : NaN;
    if (width !== undefined && ![64,128,256,512,768,1080,1500].includes(width)) {
      res.status(400).json({code:'INVALID_MEDIA_WIDTH',error:'Unsupported image width'}); return;
    }
    const result = await pageMediaBytes(req.params.id as string, req.user?.userId, width);
    res.type(result.mime).send(result.bytes);
  } catch (error) {
    const status = error instanceof PagePolicyError ? error.status : 404;
    res.status(status).json({ code: 'PAGE_MEDIA_UNAVAILABLE', error: 'Image unavailable' });
  }
});
router.post('/heif/warmup', requireAuth, mediaMutationLimiter, warmupHeif);
router.post('/uploads', requireAuth, mediaMutationLimiter, startMediaUpload);
router.post('/:id/prepare', requireAuth, mediaMutationLimiter, prepareMedia);
router.post('/:id/finalize', requireAuth, mediaMutationLimiter, finalizeMedia);
router.get('/:id', optionalAuth, getMedia);
router.delete('/:id', requireAuth, mediaMutationLimiter, cancelMedia);

export default router;
