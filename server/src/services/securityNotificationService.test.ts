import assert from 'node:assert/strict';
import test from 'node:test';
import { discardAccountSecurityNotifications, enqueueSecurityNotification, processSecurityNotifications } from './securityNotificationService';

test('security outbox stores only minimal verified destinations and deduplicates old/new same address', async () => {
    let data: any;
    const now = new Date();
    await enqueueSecurityNotification({ securityEmailOutbox: { createMany: async (args: any) => { data = args.data; } } }, 'owner', 'EMAIL_CHANGED', ['A@example.test', 'a@example.test'], now);
    assert.equal(data.length, 1);
    assert.equal(data[0].recipient, 'a@example.test');
    assert.equal(data[0].expiresAt.getTime() - now.getTime(), 7 * 86400_000);
    assert.deepEqual(Object.keys(data[0]).sort(), ['createdAt', 'expiresAt', 'kind', 'nextAttemptAt', 'recipient', 'userId']);
});

const queue = () => {
    let current: any = { id: 'message-id', userId: 'owner', recipient: 'a@example.test', kind: 'PASSWORD_CHANGED', createdAt: new Date(), expiresAt: new Date(Date.now() + 86400_000), nextAttemptAt: new Date(0), lockedUntil: null, attempts: 0 };
    let status = 'ACTIVE';
    const outbox: any = {
        findMany: async () => current ? [{ ...current }] : [],
        findFirst: async () => current,
        updateMany: async ({ where, data }: any) => {
            if (!current) return { count: 0 };
            if (where.OR && current.lockedUntil && current.lockedUntil > new Date()) return { count: 0 };
            Object.assign(current, { ...data, ...(data.attempts ? { attempts: current.attempts + 1 } : {}) });
            return { count: 1 };
        },
        deleteMany: async ({ where }: any) => { if (where.id && current) { current = null; return { count: 1 }; } return { count: 0 }; }
    };
    const db: any = { securityEmailOutbox: outbox, user: { findUnique: async () => ({ status }) }, $executeRaw: async () => {} };
    db.$transaction = async (work: any) => work(db);
    return { db, row: () => current, deleteOwner: () => { status = 'DELETED'; } };
};

test('transient delivery failure keeps the row with backoff and retries with the same idempotency key', async () => {
    const q = queue();
    const keys: string[] = [];
    const first = await processSecurityNotifications(new Date(), { db: q.db, send: async input => { keys.push(input.idempotencyKey); throw new Error('provider unavailable'); } });
    assert.equal(first.retried, 1);
    assert.equal(q.row().attempts, 1);
    assert.equal(q.row().lockedUntil, null);
    assert.ok(q.row().nextAttemptAt > new Date());
    q.row().nextAttemptAt = new Date(0);
    const second = await processSecurityNotifications(new Date(), { db: q.db, send: async input => { keys.push(input.idempotencyKey); return { messageId: 'delivered' }; } });
    assert.equal(second.delivered, 1);
    assert.deepEqual(keys, ['security-email:message-id', 'security-email:message-id']);
    assert.equal(q.row(), null);
});

test('parallel workers lease once and deletion prevents a new provider send', async () => {
    const q = queue();
    let sends = 0;
    const send = async () => { sends++; return { messageId: 'delivered' }; };
    await Promise.all([processSecurityNotifications(new Date(), { db: q.db, send }), processSecurityNotifications(new Date(), { db: q.db, send })]);
    assert.equal(sends, 1);
    const deleted = queue();
    deleted.deleteOwner();
    const result = await processSecurityNotifications(new Date(), { db: deleted.db, send });
    assert.equal(sends, 1);
    assert.equal(result.deleted, 1);
});

test('explicit account deletion removes only the owner outbox records', async () => {
    let query: any;
    await discardAccountSecurityNotifications({ securityEmailOutbox: { deleteMany: async (args: any) => { query = args; } } }, 'owner');
    assert.deepEqual(query, { where: { userId: 'owner' } });
});
