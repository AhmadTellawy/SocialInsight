import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { PrivacyService } from '../services/privacyService';
import { lockAccountSecurity, AccountSecurityError } from '../services/mfaService';
import { assertActiveAccountSession } from '../services/accountSecurityPolicy';

const CLIENT_TYPES = new Set(['POST_VIEW_START', 'POST_VIEW_END', 'SHARE_OR_COPY_LINK', 'PROFILE_VISIT', 'MENTION_SUGGESTION_OPENED', 'MENTION_SELECTED', 'MENTION_PROFILE_OPENED', 'HASHTAG_CLICKED', 'HASHTAG_TOPIC_OPENED', 'HASHTAG_SEARCH_SELECTED']);
const SURFACES = new Set(['FEED', 'PROFILE', 'SAVED', 'SEARCH', 'DEEP_LINK', 'COMPOSER', 'TOPIC']);
const DEVICES = new Set(['WEB', 'ANDROID', 'IOS']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class EventError extends Error { constructor(public code: string) { super(code); } }
const validId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128;
function parseEvent(raw: any, actor: string): any {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > 4096) throw new EventError('INVALID_EVENT');
    const e: any = {};
    for (const [key, value] of Object.entries(raw)) e[key.replace(/[A-Z]/g, c => '_' + c.toLowerCase())] = value;
    if (typeof e.id !== 'string' || !UUID.test(e.id)) throw new EventError('INVALID_EVENT_ID');
    if (!CLIENT_TYPES.has(e.event_type)) throw new EventError('SERVER_EVENT_REQUIRED');
    if (!validId(e.session_id) || !SURFACES.has(e.source_surface) || !DEVICES.has(e.device_type)) throw new EventError('INVALID_CONTEXT');
    if (e.timestamp !== undefined && (typeof e.timestamp !== 'string' || !Number.isFinite(Date.parse(e.timestamp)) || Date.parse(e.timestamp) < Date.now() - 86400000 || Date.parse(e.timestamp) > Date.now() + 60000)) throw new EventError('EVENT_EXPIRED');
    const data: any = { id: e.id, actor_user_id: actor, event_type: e.event_type, session_id: e.session_id, device_type: e.device_type, source_surface: e.source_surface, position_in_feed: null, post_id: null, target_user_id: null, method: null, dwell_time_ms: null };
    if (e.source_surface === 'FEED') { if (!Number.isInteger(e.position_in_feed) || e.position_in_feed < 0 || e.position_in_feed > 100000) throw new EventError('INVALID_POSITION'); data.position_in_feed = e.position_in_feed; }
    if (['POST_VIEW_START', 'POST_VIEW_END', 'SHARE_OR_COPY_LINK'].includes(e.event_type) || e.post_id !== undefined) { if (!validId(e.post_id)) throw new EventError('INVALID_POST'); data.post_id = e.post_id; }
    if (['PROFILE_VISIT', 'MENTION_SELECTED', 'MENTION_PROFILE_OPENED'].includes(e.event_type) || e.target_user_id !== undefined) { if (!validId(e.target_user_id)) throw new EventError('INVALID_TARGET'); data.target_user_id = e.target_user_id; }
    if (e.event_type === 'POST_VIEW_END') { if (!Number.isInteger(e.dwell_time_ms) || e.dwell_time_ms < 0 || e.dwell_time_ms > 1800000) throw new EventError('INVALID_DURATION'); data.dwell_time_ms = e.dwell_time_ms; }
    if (e.event_type === 'SHARE_OR_COPY_LINK') { if (!['COPY_LINK', 'NATIVE_SHARE'].includes(e.method)) throw new EventError('SERVER_EVENT_REQUIRED'); data.method = e.method; }
    return data;
}

export const batchIngestInteractions = async (req: Request, res: Response) => {
    const { events, expectedActorId } = req.body || {};
    if (!req.user) return void res.status(401).json({ error: 'Authentication required' });
    if (expectedActorId !== req.user.userId) return void res.status(409).json({ error: 'Analytics account changed', code: 'ANALYTICS_ACTOR_CHANGED' });
    if (!Array.isArray(events) || events.length > 50) return void res.status(400).json({ error: 'Expected at most 50 events' });
    const acceptedIds: string[] = [], rejected: { id: string | null; code: string }[] = [], retryableIds: string[] = [];
    for (const raw of events) {
        const id = raw && typeof raw.id === 'string' && raw.id.length <= 128 ? raw.id : null;
        try {
            const data = parseEvent(raw, req.user.userId);
            await prisma.$transaction(async tx => {
                await lockAccountSecurity(tx, req.user!.userId);
                await assertActiveAccountSession(tx, req, false);
                await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'analytics:' + data.id}, 0))`);
                const previous = await tx.interactionEvent.findUnique({ where: { id: data.id } });
                if (previous) {
                    if (Object.keys(data).some(key => (previous as any)[key] !== data[key])) throw new EventError('EVENT_ID_CONFLICT');
                    return;
                }
                if (data.post_id && !(await tx.post.count({ where: { id: data.post_id, ...buildVisiblePublishedPostWhere(req.user!.userId) } }))) throw new EventError('TARGET_UNAVAILABLE');
                if (data.target_user_id && !(await PrivacyService.canViewUserContent(req.user!.userId, data.target_user_id, tx))) throw new EventError('TARGET_UNAVAILABLE');
                // END may arrive before START. Store it as an observation; it never fabricates a confirmed view or vote.
                await tx.interactionEvent.create({ data });
            });
            acceptedIds.push(data.id);
        } catch (error) {
            if (error instanceof EventError) rejected.push({ id, code: error.code });
            else if (error instanceof AccountSecurityError) return void res.status(error.status).json({ error: 'Session unavailable', code: error.code });
            else if (id) retryableIds.push(id);
            else rejected.push({ id: null, code: 'INVALID_EVENT' });
        }
    }
    res.set('Cache-Control', 'private, no-store').json({ acceptedIds, rejected, retryableIds, acceptedCount: acceptedIds.length, rejectedCount: rejected.length });
};
