import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { cancelMedia, finalizeMedia, getMedia, getMediaConfig, startMediaUpload } from '../controllers/mediaController';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware';
import { pageMediaBytes } from '../pages/pageMediaService';
import { PagePolicyError } from '../pages/pagePolicy';

const router = Router();

const mediaMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many media requests. Please try again later.' }
});

router.get('/config', getMediaConfig);
router.get('/:id/content',(_req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.vary('Authorization');
  res.setHeader('X-Content-Type-Options','nosniff');
  next();
},optionalAuth,async(req,res)=>{
  try {
    const result=await pageMediaBytes(req.params.id as string,req.user?.userId);
    res.type(result.mime).send(result.bytes);
  } catch(error) {
    const status=error instanceof PagePolicyError?error.status:404;
    res.status(status).json({code:'PAGE_MEDIA_UNAVAILABLE',error:'Image unavailable'});
  }
});
router.post('/uploads', mediaMutationLimiter, requireAuth, startMediaUpload);
router.post('/:id/finalize', mediaMutationLimiter, requireAuth, finalizeMedia);
router.get('/:id', optionalAuth, getMedia);
router.delete('/:id', mediaMutationLimiter, requireAuth, cancelMedia);

export default router;
