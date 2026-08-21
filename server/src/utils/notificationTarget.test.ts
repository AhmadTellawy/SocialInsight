import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildNotificationDeepLink,
    createMentionNotificationTarget,
    withNotificationDeepLink
} from './notificationTarget';

test('uses the canonical post route for post mentions', () => {
    assert.deepEqual(createMentionNotificationTarget({ postId: 'post 1' }), {
        postId: 'post 1',
        sourceType: 'post',
        deepLink: '/post/post%201'
    });
});

test('preserves comment and reply context in one canonical deep link', () => {
    assert.deepEqual(createMentionNotificationTarget({
        postId: 'post-1',
        commentId: 'comment-1',
        replyId: 'reply-1'
    }), {
        postId: 'post-1',
        commentId: 'comment-1',
        replyId: 'reply-1',
        sourceType: 'reply',
        deepLink: '/post/post-1?comment=comment-1&reply=reply-1'
    });
});

test('normalizes old survey targets and persisted JSON payloads', () => {
    assert.equal(
        buildNotificationDeepLink('survey', 'post-1', JSON.stringify({ commentId: 'comment-1' })),
        '/post/post-1?comment=comment-1'
    );
    assert.deepEqual(withNotificationDeepLink('profile', 'user-1'), { deepLink: '/profile/user-1' });
});
