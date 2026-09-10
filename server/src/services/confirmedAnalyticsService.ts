import { Prisma } from '@prisma/client';
// The response and this event commit together; client telemetry cannot create these records.
export async function recordConfirmedVote(tx: Prisma.TransactionClient, responseId: string, postId: string, actorId: string | null) {
    if (!actorId) return; // Guest source counts come from Response; never persist a browser identity in telemetry.
    await tx.interactionEvent.create({ data: { id: 'vote:' + responseId, actor_user_id: actorId, event_type: 'VOTE', post_id: postId, source_surface: 'SERVER', session_id: 'server', device_type: 'SERVER' } });
}
