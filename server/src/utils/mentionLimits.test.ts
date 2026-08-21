import assert from 'node:assert/strict';
import test from 'node:test';
import { getMentionLimitViolation } from './mentionLimits';

const mentions = (count: number) => Array.from({ length: count }, (_, index) => `@person_${index}`).join(' ');

test('accepts one and ten unique recipients', () => {
    assert.equal(getMentionLimitViolation(mentions(1)), null);
    assert.equal(getMentionLimitViolation(mentions(10)), null);
});

test('rejects eleven unique recipients with a stable validation contract', () => {
    assert.deepEqual(getMentionLimitViolation(mentions(11)), {
        error: 'You can mention up to 10 people.',
        code: 'MENTION_LIMIT_EXCEEDED',
        limit: 10,
        recipientCount: 11
    });
});

test('counts one repeatedly mentioned user once', () => {
    assert.equal(getMentionLimitViolation(Array.from({ length: 50 }, () => '@same_user').join(' ')), null);
});
