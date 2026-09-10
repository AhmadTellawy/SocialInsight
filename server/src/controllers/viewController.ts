import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'crypto';
import prisma from '../prisma';
import { readRestoreMaintenance } from '../config/maintenance';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { assertActiveAccountSession } from '../services/accountSecurityPolicy';
import { AccountSecurityError, lockAccountSecurity } from '../services/mfaService';
import { hashSessionSecret, readCookies, SESSION_COOKIE_NAME } from '../services/sessionService';
import { GUEST_PROOF_TTL_MS } from '../services/guestParticipationService';
import { hasValidCsrf, isTrustedOrigin } from '../middleware/csrfProtection';

// This cache is only consulted after current authorization and the post lock.
// PostgreSQL remains authoritative for replicas, restarts and concurrent misses.
const viewCache = new Map<string, number>();
const CACHE_TTL = 60 * 60 * 1000;
if (!readRestoreMaintenance()) setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of viewCache.entries()) {
        if (now - timestamp > CACHE_TTL) viewCache.delete(key);
    }
}, 10 * 60 * 1000).unref();

const SOURCES = new Set(['FEED', 'PROFILE', 'SAVED', 'SEARCH', 'DEEP_LINK', 'COMPOSER', 'TOPIC', 'TRENDING', 'GROUP']);
const DEVICES = new Set(['WEB', 'ANDROID', 'IOS']);
const secureCookie = () => process.env.NODE_ENV === 'production' || process.env.AUTH_COOKIE_SECURE === 'true';
const proofCookieName = () => secureCookie() ? '__Host-si_view_proof' : 'si_view_proof';
type ViewProof = { nonce: string; expiresAt: number; token: string };
class ViewError extends Error { constructor(public code: string, public status: number) { super(code); } }
const signProof = (nonce: string, expiresAt: number) => hashSessionSecret('post-view-proof:v1:' + nonce + ':' + expiresAt);
const readProof = (req: Request): ViewProof | null => {
    const token = readCookies(req)[proofCookieName()] || '';
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1' || !/^[a-f0-9]{64}$/.test(parts[1]) || !/^\d{13}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) return null;
    const expiresAt = Number(parts[2]);
    if (expiresAt <= Date.now() || expiresAt > Date.now() + GUEST_PROOF_TTL_MS) return null;
    if (!timingSafeEqual(Buffer.from(parts[3], 'hex'), Buffer.from(signProof(parts[1], expiresAt), 'hex'))) return null;
    return { nonce: parts[1], expiresAt, token };
};
const issueProof = (res: Response, current: ViewProof | null) => {
    if (current && current.expiresAt > Date.now()) return;
    const nonce = randomBytes(32).toString('hex'), expiresAt = Date.now() + GUEST_PROOF_TTL_MS;
    const token = 'v1.' + nonce + '.' + expiresAt + '.' + signProof(nonce, expiresAt);
    res.cookie(proofCookieName(), token, { httpOnly: true, secure: secureCookie(), sameSite: 'lax', path: '/', maxAge: GUEST_PROOF_TTL_MS });
};

export const recordPostView = async (req: Request, res: Response) => {
    try {
        res.set('Cache-Control', 'private, no-store');
        if (!isTrustedOrigin(req)) throw new ViewError('ORIGIN_REJECTED', 403);
        const userId = req.user?.userId || null;
        if ((!userId && readCookies(req)[SESSION_COOKIE_NAME]) || (userId && req.user?.authMode !== 'session')) throw new AccountSecurityError('AUTH_REQUIRED', 401);
        if (userId && !hasValidCsrf(req)) throw new ViewError('CSRF_REJECTED', 403);
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).some(key => !['initialize', 'source', 'deviceType', 'guestSessionId', 'expectedActorId'].includes(key))
            || (body.initialize !== undefined && typeof body.initialize !== 'boolean')
            || (body.guestSessionId !== undefined && (typeof body.guestSessionId !== 'string' || body.guestSessionId.length > 128))) throw new ViewError('VIEW_METADATA_INVALID', 400);
        const initialize = body.initialize === true;
        if ((!initialize || body.source !== undefined) && !SOURCES.has(body.source)) throw new ViewError('VIEW_METADATA_INVALID', 400);
        if ((!initialize || body.deviceType !== undefined) && !DEVICES.has(body.deviceType)) throw new ViewError('VIEW_METADATA_INVALID', 400);
        if (body.expectedActorId !== null && (typeof body.expectedActorId !== 'string' || !body.expectedActorId || body.expectedActorId.length > 128)) throw new ViewError('VIEW_ACTOR_CHANGED', 409);
        const postId = req.params.id as string;
        if (!postId || postId.length > 128) throw new ViewError('VIEW_TARGET_UNAVAILABLE', 403);
        const proof = userId ? null : readProof(req);
        // The body UUID is accepted only for rolling compatibility, never as an
        // identity. Initialization is explicit and never records a view.
        const viewerKey = userId ? 'user:' + userId : proof ? 'guest:' + hashSessionSecret('post-view-identity:' + proof.nonce) : null;
        const result = await prisma.$transaction(async tx => {
            if (userId) {
                await lockAccountSecurity(tx, userId);
                await assertActiveAccountSession(tx, req, false);
            }
            if (body.expectedActorId !== userId) throw new ViewError('VIEW_ACTOR_CHANGED', 409);
            if (!initialize && !viewerKey) throw new ViewError('VIEW_PROOF_REQUIRED', 428);
            if (viewerKey) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'post-view:' + postId + ':' + viewerKey}, 0))`);
            await tx.$queryRaw(Prisma.sql`SELECT id FROM "Post" WHERE id = ${postId} FOR UPDATE`);
            // Recheck after any lock wait, including cached requests. Shared
            // source, privacy transitions, blocks and group access use the same
            // published-content predicate as the actual feed/detail surfaces.
            const post = await tx.post.findFirst({ where: { id: postId, ...buildVisiblePublishedPostWhere(userId) }, select: { viewCount: true, uniqueViewCount: true } });
            if (!post) throw new ViewError('VIEW_TARGET_UNAVAILABLE', 403);
            if (initialize) return { initialized: true };
            if (!userId && (!proof || proof.expiresAt <= Date.now())) throw new ViewError('VIEW_PROOF_REQUIRED', 428);
            const cacheKey = postId + ':' + viewerKey, now = Date.now();
            const cachedAt = viewCache.get(cacheKey);
            if (cachedAt !== undefined && now - cachedAt < CACHE_TTL) return { recorded: false, ...post };
            const previous = await tx.postView.findFirst({ where: { postId, viewerKey: viewerKey! }, orderBy: { viewedAt: 'desc' }, select: { viewedAt: true } });
            if (previous && previous.viewedAt.getTime() >= now - CACHE_TTL) return { recorded: false, ...post };
            const address = (req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 128);
            const userAgent = (req.get('user-agent') || 'unknown').slice(0, 512);
            await tx.postView.create({ data: { postId, viewerKey: viewerKey!, source: body.source, deviceType: body.deviceType,
                ipHash: hashSessionSecret('post-view-ip:' + address), userAgentHash: hashSessionSecret('post-view-ua:' + userAgent) } });
            const updatedPost = await tx.post.update({ where: { id: postId }, data: { viewCount: { increment: 1 }, uniqueViewCount: previous ? undefined : { increment: 1 } }, select: { viewCount: true, uniqueViewCount: true } });
            return { recorded: true, ...updatedPost };
        }, { maxWait: 10_000, timeout: 10_000 });
        if (initialize) {
            if (!userId) issueProof(res, proof);
        } else if ('recorded' in result && result.recorded && viewerKey) {
            if (viewCache.size >= 10_000) viewCache.delete(viewCache.keys().next().value!);
            viewCache.set(postId + ':' + viewerKey, Date.now());
        }
        return res.json(result);
    } catch (error) {
        if (error instanceof ViewError || error instanceof AccountSecurityError) return res.status(error.status).json({ error: 'The view request could not be accepted.', code: error.code });
        console.error(JSON.stringify({ event: 'post_view_failed', error: error instanceof Error ? error.name : 'unknown' }));
        res.set('Retry-After', '1');
        return res.status(503).json({ error: 'View recording is temporarily unavailable.', code: 'VIEW_RETRY_REQUIRED' });
    }
};
