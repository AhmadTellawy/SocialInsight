import prisma from '../prisma';
import { sendSecurityChangeEmail, SecurityEmailKind } from './emailService';
import { lockAccountSecurity } from './mfaService';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const KINDS = new Set<SecurityEmailKind>(['PASSWORD_CHANGED', 'PASSWORD_RESET', 'EMAIL_CHANGED', 'USERNAME_CHANGED']);

// Call inside the credential transaction and supply only addresses whose
// ownership was verified. A failed enqueue rolls back the protected change.
export const enqueueSecurityNotification = async (tx: any, userId: string, kind: SecurityEmailKind, recipients: string[], now = new Date()): Promise<void> => {
    const addresses = [...new Set(recipients.map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (!KINDS.has(kind) || addresses.some(value => value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new Error('Invalid security notification');
    if (!addresses.length) return;
    await tx.securityEmailOutbox.createMany({ data: addresses.map(recipient => ({ userId, recipient, kind, createdAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS), nextAttemptAt: now })) });
};

export const discardAccountSecurityNotifications = async (tx: any, userId: string): Promise<void> => {
    await tx.securityEmailOutbox.deleteMany({ where: { userId } });
};

export interface SecurityEmailResult { delivered: number; retried: number; deleted: number }

export const cleanupSecurityNotifications = async (now = new Date(), db: any = prisma): Promise<number> => {
    return (await db.securityEmailOutbox.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { user: { status: 'DELETED' } }] } })).count;
};

// Lease delivery across processes and retain a stable provider idempotency key
// when a response is lost. No address, provider body or credentials are logged.
export const processSecurityNotifications = async (
    now = new Date(),
    dependencies: { db?: any; send?: typeof sendSecurityChangeEmail } = {}
): Promise<SecurityEmailResult> => {
    const db = dependencies.db || prisma as any;
    const send = dependencies.send || sendSecurityChangeEmail;
    const result: SecurityEmailResult = { delivered: 0, retried: 0, deleted: await cleanupSecurityNotifications(now, db) };
    const due = await db.securityEmailOutbox.findMany({ where: { nextAttemptAt: { lte: now }, expiresAt: { gt: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: 20 });
    for (const job of due) {
        const leaseStart = new Date();
        const lockedUntil = new Date(leaseStart.getTime() + 90_000);
        const claim = await db.securityEmailOutbox.updateMany({ where: { id: job.id, nextAttemptAt: { lte: leaseStart }, expiresAt: { gt: leaseStart }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: leaseStart } }] }, data: { lockedUntil, attempts: { increment: 1 } } });
        if (claim.count !== 1) continue;
        try {
            const delivered = await db.$transaction(async (tx: any) => {
                // Deletion uses the same account lock. Once deletion commits,
                // a queued message cannot begin a new provider delivery.
                await lockAccountSecurity(tx, job.userId);
                const current = await tx.securityEmailOutbox.findFirst({ where: { id: job.id, lockedUntil } });
                if (!current) return false;
                const owner = await tx.user.findUnique({ where: { id: job.userId }, select: { status: true } });
                if (!owner || !['ACTIVE', 'DEACTIVATED'].includes(owner.status) || current.expiresAt <= new Date() || !KINDS.has(current.kind)) {
                    await tx.securityEmailOutbox.deleteMany({ where: { id: job.id, lockedUntil } });
                    result.deleted += 1;
                    return false;
                }
                await send({ to: current.recipient, kind: current.kind, occurredAt: current.createdAt, idempotencyKey: `security-email:${current.id}` });
                await tx.securityEmailOutbox.deleteMany({ where: { id: current.id, lockedUntil } });
                return true;
            }, { maxWait: 5_000, timeout: 40_000 });
            if (delivered) result.delivered += 1;
        } catch {
            const delay = Math.min(3_600_000, 60_000 * 2 ** Math.min(job.attempts, 6));
            await db.securityEmailOutbox.updateMany({ where: { id: job.id, lockedUntil }, data: { lockedUntil: null, nextAttemptAt: new Date(Date.now() + delay) } });
            result.retried += 1;
        }
    }
    return result;
};
