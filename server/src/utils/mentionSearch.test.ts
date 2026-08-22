import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MENTION_SUGGESTION_LIMIT,
    MENTION_USER_SELECT,
    buildMentionSearchWhere
} from './mentionSearch';

test('uses a bounded ten-result autocomplete contract with a compact DTO', () => {
    assert.equal(MENTION_SUGGESTION_LIMIT, 10);
    assert.deepEqual(Object.keys(MENTION_USER_SELECT).sort(), [
        'avatar',
        'avatarMedia',
        'avatarMediaId',
        'handle',
        'id',
        'name'
    ]);
});

test('filters self, inactive, and both-direction blocked users from suggestions', () => {
    const where = buildMentionSearchWhere('ah', 'viewer-1');
    assert.equal(where.status, 'ACTIVE');
    assert.deepEqual(where.NOT, [
        { id: 'viewer-1' },
        { blockedBy: { some: { blockerId: 'viewer-1' } } },
        { blocking: { some: { blockedId: 'viewer-1' } } }
    ]);
    assert.deepEqual(where.OR[0], { handle: { startsWith: 'ah', mode: 'insensitive' } });
});
