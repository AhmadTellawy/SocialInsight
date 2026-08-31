import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_FEED_LIMIT,
  attachFeedContentRelations,
  attachFeedViewerState,
  buildFeedCursorWhere,
  decodeFeedCursor,
  encodeFeedCursor,
  parseFeedLimit
} from './postFeedService';

test('feed limit defaults safely and is capped', () => {
  assert.equal(parseFeedLimit(undefined), 10);
  assert.equal(parseFeedLimit('not-a-number'), 10);
  assert.equal(parseFeedLimit('0'), 10);
  assert.equal(parseFeedLimit('7'), 7);
  assert.equal(parseFeedLimit('500'), MAX_FEED_LIMIT);
});

test('opaque feed cursor round-trips the deterministic createdAt/id boundary', () => {
  const boundary = { id: 'post-b', createdAt: new Date('2026-08-31T10:11:12.345Z') };
  const encoded = encodeFeedCursor(boundary);
  assert.match(encoded, /^feed_v1_[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeFeedCursor(encoded), boundary);
  assert.equal(decodeFeedCursor('legacy-post-id'), null);
  assert.equal(decodeFeedCursor('feed_v1_not-json'), null);
  assert.deepEqual(buildFeedCursorWhere(boundary), {
    OR: [
      { createdAt: { lt: boundary.createdAt } },
      {
        AND: [
          { createdAt: { equals: boundary.createdAt } },
          { id: { lt: boundary.id } }
        ]
      }
    ]
  });
});

test('flat feed relations are stitched for posts and media without leaking unrelated users', () => {
  const posts: any[] = [{ id: 'post-1', authorId: 'author-1', sharedFrom: null }];
  attachFeedContentRelations(posts, {
    users: [
      { id: 'author-1', name: 'Author', avatarMediaId: 'avatar-1' },
      { id: 'tagged-1', name: 'Tagged', avatarMediaId: null }
    ],
    sections: [{ id: 'section-1', postId: 'post-1', order: 0, title: 'Section' }],
    questions: [
      { id: 'question-1', postId: null, sectionId: 'section-1', order: 0, imageMediaId: null }
    ],
    options: [
      { id: 'option-2', questionId: 'question-1', order: 2, imageMediaId: null },
      { id: 'option-1', questionId: 'question-1', order: 1, imageMediaId: null }
    ],
    mentions: [],
    mentionOccurrences: [],
    tags: [{ id: 'tag-1', postId: 'post-1', taggedUserId: 'tagged-1', createdAt: '2026-01-01' }],
    postMedia: [{ postId: 'post-1', mediaAssetId: 'post-media-1', sortOrder: 0 }],
    mediaAssets: [
      { id: 'avatar-1', accessScope: 'PUBLIC', aspectRatio: 1 },
      { id: 'post-media-1', accessScope: 'PUBLIC', aspectRatio: 1.5 }
    ],
    mediaVariants: [
      { mediaAssetId: 'avatar-1', width: 200 },
      { mediaAssetId: 'post-media-1', width: 800 }
    ],
    targetGroups: [{ postId: 'post-1', group: { id: 'group-1', name: 'Group' } }],
    responses: [],
    answers: [],
    likes: [],
    shares: [],
    savedPosts: [],
    follows: []
  });

  assert.equal(posts[0].author.id, 'author-1');
  assert.equal(posts[0].author.avatarMedia.variants[0].width, 200);
  assert.deepEqual(posts[0].sections[0].questions[0].options.map((option: any) => option.id), ['option-1', 'option-2']);
  assert.equal(posts[0].taggedUsers[0].taggedUser.id, 'tagged-1');
  assert.equal(posts[0].media[0].mediaAsset.id, 'post-media-1');
  assert.deepEqual(posts[0].targetedGroups, [{ id: 'group-1', name: 'Group' }]);
});

test('batched viewer state is attached to both repost and source with legacy relation arrays', () => {
  const source: any = { id: 'source-1', author: { id: 'author-2' } };
  const posts: any[] = [{ id: 'post-1', author: { id: 'author-1' }, sharedFrom: source }];
  attachFeedViewerState(posts, {
    hasResponseIdentity: true,
    userId: 'viewer-1',
    responses: [
      { id: 'response-new', postId: 'source-1', timestamp: '2026-08-31T10:00:00.000Z' },
      { id: 'response-old', postId: 'source-1', timestamp: '2026-08-30T10:00:00.000Z' }
    ],
    answers: [{ id: 'answer-1', responseId: 'response-new', questionId: 'question-1' }],
    likes: [{ id: 'like-1', postId: 'source-1' }],
    shares: [{ id: 'share-1', sharedFromId: 'source-1' }],
    savedPosts: [{ userId: 'viewer-1', postId: 'post-1' }],
    follows: [{ followerId: 'viewer-1', followingId: 'author-2' }]
  });

  assert.deepEqual(posts[0].responses, []);
  assert.equal(posts[0].savedBy[0].postId, 'post-1');
  assert.deepEqual(posts[0].author.following, []);
  assert.equal(source.responses[0].id, 'response-new');
  assert.equal(source.responses[0].answers[0].id, 'answer-1');
  assert.equal(source.likes[0].id, 'like-1');
  assert.equal(source.shares[0].id, 'share-1');
  assert.deepEqual(source.author.following, [{ followerId: 'viewer-1' }]);
});
