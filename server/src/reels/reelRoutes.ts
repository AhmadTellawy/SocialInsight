import { Router, Request, Response, RequestHandler } from 'express';
import prisma from '../prisma';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware';
import { durableRateLimit } from '../middleware/authRateLimit';
import { arePublishedPostsVisible } from '../services/postVisibilitySql';
import { hasPostPageCapability } from '../pages/pagePostService';
import { readGuestParticipationHash } from '../services/guestParticipationService';
import { REEL_MAX_BYTES, REEL_MAX_SECONDS, REEL_MAX_QUESTIONS, ReelError } from './reelPolicy';
import { requireReels, reelsConfigured, streamProvider, verifyStreamWebhook } from './streamProvider';
import { reconcileVideo } from './videoService';

const router = Router();
const handle = (action: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res) => {
  res.set('Cache-Control', 'private, no-store').vary('Cookie').vary('Authorization');
  void action(req, res).catch(error => {
    const known = error instanceof ReelError;
    res.status(known ? error.status : 503).json({ code: known ? error.code : 'REELS_UNAVAILABLE', error: known ? error.message : 'Reels are temporarily unavailable. Try again.' });
  });
};
const uploadLimit = durableRateLimit('reel-upload', { windowMs: 60 * 60_000, userLimit: 15, networkLimit: 150, message: 'Please wait before uploading another video.', code: 'REEL_UPLOAD_LIMIT' });
router.get('/config', handle(async (_req, res) => { res.json({ enabled: reelsConfigured(), maxBytes: REEL_MAX_BYTES, maxSeconds: REEL_MAX_SECONDS, maxQuestions: REEL_MAX_QUESTIONS }); }));
router.post('/uploads', requireAuth, uploadLimit, handle(async (req, res) => {
  requireReels();
  const { size, mime, requestKey } = req.body || {};
  if (!Number.isInteger(size) || size < 1 || size > REEL_MAX_BYTES || !['video/mp4', 'video/webm', 'video/quicktime'].includes(mime) || typeof requestKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestKey)) throw new ReelError('INVALID_VIDEO', 'Choose an MP4, WebM or MOV video up to 150 MB.');
  const ownerId = req.user!.userId;
  const existing = await prisma.videoAsset.findUnique({ where: { ownerId_requestKey: { ownerId, requestKey } } });
  if (existing) {
    if (existing.bytes !== size || existing.mime !== mime || existing.createdAt.getTime() + 60 * 60_000 < Date.now() || !existing.uploadUrl || ['FAILED', 'DELETED', 'PENDING_DELETE'].includes(existing.status)) throw new ReelError('UPLOAD_EXPIRED', 'Start a new video upload.', 409);
    res.json({ id: existing.id, uploadUrl: existing.uploadUrl, status: existing.status }); return;
  }
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { status: true } });
  if (owner?.status !== 'ACTIVE') throw new ReelError('AUTH_REQUIRED', 'Sign in again.', 401);
  const asset = await prisma.videoAsset.create({ data: { ownerId, requestKey, bytes: size, mime, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
  try {
    const upload = await streamProvider.createUpload(size, asset.id, new Date(Date.now() + 60 * 60_000));
    await prisma.videoAsset.update({ where: { id: asset.id }, data: { ...upload, status: 'UPLOADING' } });
    res.status(201).json({ id: asset.id, uploadUrl: upload.uploadUrl, status: 'UPLOADING' });
  } catch (error) { await prisma.videoAsset.update({ where: { id: asset.id }, data: { status: 'FAILED' } }); throw error; }
}));
router.get('/videos/:id', requireAuth, handle(async (req, res) => {
  requireReels();
  const asset = await prisma.videoAsset.findUnique({ where: { id: req.params.id as string } });
  if (!asset || asset.ownerId !== req.user!.userId) throw new ReelError('VIDEO_UNAVAILABLE', 'Video unavailable.', 404);
  const current = ['UPLOADING', 'PROCESSING'].includes(asset.status) && Date.now() - asset.updatedAt.getTime() > 5000 ? await reconcileVideo(asset.id) : asset;
  res.json({ id: current!.id, status: current!.status, duration: current!.duration, width: current!.width, height: current!.height, errorCode: current!.errorCode });
}));
router.delete('/videos/:id', requireAuth, handle(async (req, res) => {
  const changed = await prisma.videoAsset.updateMany({ where: { id: req.params.id as string, ownerId: req.user!.userId, post: null, status: { notIn: ['DELETED', 'PENDING_DELETE'] } }, data: { status: 'PENDING_DELETE', uploadUrl: null } });
  if (!changed.count) throw new ReelError('VIDEO_UNAVAILABLE', 'Video is unavailable or already attached.', 409);
  res.status(204).end();
}));
router.get('/playback/:postId', optionalAuth, handle(async (req, res) => {
  requireReels();
  const grant = await prisma.$transaction(async tx => {
    const id = req.params.postId as string;
    if (!await arePublishedPostsVisible(tx, [id], req.user?.userId)) throw new ReelError('REEL_UNAVAILABLE', 'Reel unavailable.', 404);
    const post = await tx.post.findUnique({ where: { id }, include: { videoAsset: true } });
    if (post?.presentationFormat !== 'REEL' || post.videoAsset?.status !== 'READY' || !post.videoAsset.providerId) throw new ReelError('REEL_UNAVAILABLE', 'Reel unavailable.', 404);
    return streamProvider.playback(post.videoAsset.providerId);
  }, { isolationLevel: 'RepeatableRead' });
  res.json(grant);
}));
router.get('/result/:postId', optionalAuth, handle(async (req, res) => {
  const userId = req.user?.userId; const proof = readGuestParticipationHash(req);
  if (!userId && !proof) throw new ReelError('RESPONSE_UNAVAILABLE', 'Response unavailable.', 404);
  const result = await prisma.$transaction(async tx => {
    const id = req.params.postId as string;
    if (!await arePublishedPostsVisible(tx, [id], userId)) throw new ReelError('REEL_UNAVAILABLE', 'Reel unavailable.', 404);
    const post = await tx.post.findUnique({ where: { id }, select: { presentationFormat: true, type: true } });
    const response = await tx.response.findFirst({ where: { postId: id, completedAt: { not: null }, ...(userId ? { userId } : { guestProofHash: proof, guestProofExpiresAt: { gt: new Date() } }) }, include: { answers: { include: { option: { select: { isCorrect: true } } } } } });
    if (post?.presentationFormat !== 'REEL' || !response) throw new ReelError('RESPONSE_UNAVAILABLE', 'Response unavailable.', 404);
    return { completed: true, ...(post.type.toLowerCase() === 'quiz' ? { quizResult: { correct: response.answers.filter(answer => answer.option?.isCorrect).length, total: await tx.question.count({ where: { postId: id } }) } } : {}) };
  }, { isolationLevel: 'RepeatableRead' });
  res.json(result);
}));
router.get('/preview/:id', requireAuth, handle(async (req, res) => {
  requireReels();
  const asset = await prisma.videoAsset.findUnique({ where: { id: req.params.id as string }, include: { post: { select: { id: true, pageId: true, isDeleted: true, status: true } } } });
  if (!asset || asset.status !== 'READY' || !asset.providerId || asset.post?.isDeleted) throw new ReelError('VIDEO_UNAVAILABLE', 'Video unavailable.', 404);
  const allowed = asset.post?.pageId
    ? await hasPostPageCapability(asset.post.pageId, req.user!.userId, 'manageContent')
    : asset.ownerId === req.user!.userId;
  if (!allowed) throw new ReelError('VIDEO_UNAVAILABLE', 'Video unavailable.', 404);
  res.json(streamProvider.playback(asset.providerId));
}));

// Mounted with express.raw BEFORE the application's JSON parser. Verify exact bytes.
export const streamWebhook = handle(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !verifyStreamWebhook(req.body, req.get('Webhook-Signature'))) throw new ReelError('INVALID_WEBHOOK', 'Invalid signature.', 401);
  let body: any;
  try { body = JSON.parse(req.body.toString('utf8')); } catch { throw new ReelError('INVALID_WEBHOOK', 'Invalid payload.'); }
  if (typeof body.uid !== 'string' || !/^[a-f0-9]{32}$/i.test(body.uid)) throw new ReelError('INVALID_WEBHOOK', 'Invalid video identifier.');
  const asset = await prisma.videoAsset.findUnique({ where: { providerId: body.uid } });
  if (asset) await reconcileVideo(asset.id);
  res.status(204).end();
});
export default router;
