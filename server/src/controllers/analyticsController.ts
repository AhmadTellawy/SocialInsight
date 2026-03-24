import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VALID_EVENT_TYPES = [
    'POST_VIEW_START', 'POST_VIEW_END', 'LIKE', 'SAVE_TOGGLE',
    'COMMENT_CREATE', 'COMMENT_DELETE', 'SHARE_OR_COPY_LINK',
    'HIDE_POST', 'PROFILE_VISIT', 'FOLLOW_TOGGLE'
];

const VALID_SURFACES = ['FEED', 'PROFILE', 'SAVED', 'SEARCH', 'DEEP_LINK'];
const VALID_DEVICES = ['WEB', 'ANDROID', 'IOS'];
const VALID_SHARE_METHODS = ['COPY_LINK', 'NATIVE_SHARE', 'REPOST'];

export const batchIngestInteractions = async (req: Request, res: Response) => {
    const events = req.body;
    const authUserId = (req as any).user?.id;

    if (!Array.isArray(events)) {
        res.status(400).json({ error: 'Payload must be an array' });
        return;
    }

    let acceptedCount = 0;
    let rejectedCount = 0;
    const rejections: any[] = [];

    // WHITE-LISTED FIELDS ONLY (Requirement 6)
    const ALLOWED_FIELDS = [
        'id', 'actor_user_id', 'event_type', 'post_id', 'target_user_id',
        'comment_id', 'method', 'new_state', 'dwell_time_ms',
        'source_surface', 'position_in_feed', 'session_id', 'device_type', 'created_at'
    ];

    try {
        await prisma.$transaction(async (tx) => {
            for (const event of events) {
                try {
                    // Standardize keys (handling both camelCase from client and snake_case)
                    const normalizedEvent: any = {};
                    for (const key of Object.keys(event)) {
                        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                        if (ALLOWED_FIELDS.includes(snakeKey)) {
                            normalizedEvent[snakeKey] = event[key];
                        }
                    }

                    // 1. Mandatory Core Fields
                    if (!normalizedEvent.id) throw new Error('Missing id');

                    const event_type = normalizedEvent.event_type;
                    if (!event_type || !VALID_EVENT_TYPES.includes(event_type)) throw new Error('Invalid event_type');

                    if (!normalizedEvent.session_id) throw new Error('Missing session_id');

                    if (!normalizedEvent.device_type || !VALID_DEVICES.includes(normalizedEvent.device_type)) throw new Error('Invalid device_type');

                    if (!normalizedEvent.source_surface || !VALID_SURFACES.includes(normalizedEvent.source_surface)) throw new Error('Invalid source_surface');

                    const actor_user_id = authUserId || normalizedEvent.actor_user_id;
                    if (!actor_user_id) throw new Error('Missing actor_user_id');

                    // 2. Req 4: Position in Feed Consistency
                    let position_in_feed = null;
                    if (normalizedEvent.source_surface === 'FEED') {
                        position_in_feed = normalizedEvent.position_in_feed;
                        if (position_in_feed === undefined || position_in_feed === null || !Number.isInteger(Number(position_in_feed))) {
                            throw new Error('position_in_feed is REQUIRED as an integer for FEED surface');
                        }
                        position_in_feed = Number(position_in_feed);
                    }

                    // Final data object for DB - EXPLICITLY WHITELISTED (Requirement 6)
                    const data: any = {
                        id: normalizedEvent.id,
                        actor_user_id,
                        event_type,
                        session_id: normalizedEvent.session_id,
                        device_type: normalizedEvent.device_type,
                        source_surface: normalizedEvent.source_surface,
                        position_in_feed,
                        created_at: new Date()
                    };

                    // 3. Conditional Requirements per Event Type

                    if (['POST_VIEW_START', 'POST_VIEW_END', 'LIKE', 'SAVE_TOGGLE', 'COMMENT_CREATE', 'COMMENT_DELETE', 'SHARE_OR_COPY_LINK', 'HIDE_POST'].includes(event_type)) {
                        if (!normalizedEvent.post_id) throw new Error('post_id required');
                        data.post_id = normalizedEvent.post_id;
                    }

                    if (['PROFILE_VISIT', 'FOLLOW_TOGGLE'].includes(event_type)) {
                        if (!normalizedEvent.target_user_id) throw new Error('target_user_id required');
                        data.target_user_id = normalizedEvent.target_user_id;
                    }

                    if (event_type === 'SHARE_OR_COPY_LINK') {
                        // Req 5: Share Method Enum
                        const method = normalizedEvent.method;
                        if (!method || !VALID_SHARE_METHODS.includes(method)) {
                            throw new Error(`Invalid share method. Allowed: ${VALID_SHARE_METHODS.join(', ')}`);
                        }
                        data.method = method;
                    }

                    if (event_type === 'POST_VIEW_END') {
                        if (normalizedEvent.dwell_time_ms === undefined || normalizedEvent.dwell_time_ms === null) throw new Error('dwell_time_ms required');
                        data.dwell_time_ms = Number(normalizedEvent.dwell_time_ms);
                    }

                    if (['SAVE_TOGGLE', 'FOLLOW_TOGGLE'].includes(event_type)) {
                        if (normalizedEvent.new_state === undefined || normalizedEvent.new_state === null) throw new Error('new_state required');
                        data.new_state = !!normalizedEvent.new_state;
                    }

                    if (normalizedEvent.comment_id) data.comment_id = normalizedEvent.comment_id;

                    // 4. Req 3: LIKE is unique, no unlike
                    if (event_type === 'LIKE') {
                        const existing = await tx.interactionEvent.findFirst({
                            where: { actor_user_id, post_id: data.post_id, event_type: 'LIKE' }
                        });
                        if (existing) {
                            acceptedCount++; // Idempotent
                            continue;
                        }
                    }

                    // 5. POST_VIEW state machine
                    if (event_type === 'POST_VIEW_START') {
                        const existing = await tx.interactionEvent.findFirst({
                            where: { actor_user_id, post_id: data.post_id, session_id: data.session_id, event_type: 'POST_VIEW_START' }
                        });
                        if (existing) continue;
                    }
                    if (event_type === 'POST_VIEW_END') {
                        const start = await tx.interactionEvent.findFirst({
                            where: { actor_user_id, post_id: data.post_id, session_id: data.session_id, event_type: 'POST_VIEW_START' }
                        });
                        if (!start) throw new Error('END without START');
                        const existingEnd = await tx.interactionEvent.findFirst({
                            where: { actor_user_id, post_id: data.post_id, session_id: data.session_id, event_type: 'POST_VIEW_END' }
                        });
                        if (existingEnd) continue;
                    }

                    // SAVE ONLY WHITELISTED DATA (Req 1 & 6)
                    await tx.interactionEvent.create({ data });
                    acceptedCount++;
                } catch (err: any) {
                    rejectedCount++;
                    rejections.push({ id: event.id, eventType: event.event_type || event.eventType, reason: err.message });
                }
            }
        });
        res.json({ acceptedCount, rejectedCount, rejections });
    } catch (error) {
        console.error("Interaction Ingestion Error:", error);
        res.status(500).json({ error: 'Failed to process interactions' });
    }
};
