import assert from 'node:assert/strict';
import test from 'node:test';
import type { MentionNotificationDependencies } from './notificationService';
import type { MentionSourceContext } from './mentionPolicyService';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'notification-service-test-secret';

const { extractAndNotifyMentions } = require('./notificationService') as typeof import('./notificationService');

const source: MentionSourceContext = {
    postId: 'post-1',
    authorId: 'author-1',
    status: 'PUBLISHED',
    isDeleted: false,
    groupIds: []
};

const dependencies = (
    overrides: Partial<MentionNotificationDependencies> = {}
): MentionNotificationDependencies => ({
    findMentionedUsers: async (handles) => handles.map((handle) => ({ id: `id-${handle}`, handle })),
    loadSourceContext: async () => source,
    checkEligibility: async () => ({ allowed: true }),
    createNotification: async () => true,
    ...overrides
});

test('an ineligible manually typed mention stops before DB/socket/push notification effects', async () => {
    let notificationEffects = 0;
    const result = await extractAndNotifyMentions('@blocked_user', 'actor-1', { postId: source.postId }, dependencies({
        checkEligibility: async () => ({ allowed: false, reason: 'blocked' }),
        createNotification: async () => {
            notificationEffects += 1;
            return true;
        }
    }));

    assert.deepEqual(result, { status: 'processed', recipientCount: 1, notifiedCount: 0 });
    assert.equal(notificationEffects, 0);
});

test('duplicate handles resolve once and count only a successfully created notification', async () => {
    let resolvedHandles: string[] = [];
    let notificationEffects = 0;
    const result = await extractAndNotifyMentions(
        '@Recipient @recipient @RECIPIENT',
        'actor-1',
        { postId: source.postId },
        dependencies({
            findMentionedUsers: async (handles) => {
                resolvedHandles = handles;
                return [{ id: 'recipient-1', handle: 'recipient' }];
            },
            createNotification: async () => {
                notificationEffects += 1;
                return true;
            }
        })
    );

    assert.deepEqual(resolvedHandles, ['recipient']);
    assert.equal(notificationEffects, 1);
    assert.deepEqual(result, { status: 'processed', recipientCount: 1, notifiedCount: 1 });
});

test('fan-out runs concurrently but remains bounded by the ten-recipient cap', async () => {
    let active = 0;
    let maxActive = 0;
    const text = Array.from({ length: 10 }, (_, index) => `@person_${index}`).join(' ');
    const result = await extractAndNotifyMentions(text, 'actor-1', { postId: source.postId }, dependencies({
        createNotification: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return true;
        }
    }));

    assert.equal(maxActive > 1, true);
    assert.equal(maxActive <= 10, true);
    assert.deepEqual(result, { status: 'processed', recipientCount: 10, notifiedCount: 10 });
});
