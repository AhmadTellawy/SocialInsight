import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';

process.env.JWT_SECRET ||= 'page-write-fast-path-isolated-test';
process.env.PAGES_ENABLED = 'true';

const prisma = require('../prisma').default as typeof import('../prisma').default;
const pagePost = require('../pages/pagePostService') as typeof import('../pages/pagePostService');
const pageService = require('../pages/pageService') as typeof import('../pages/pageService');
const pageActivity = require('../pages/pageActivityNotifications') as typeof import('../pages/pageActivityNotifications');
const mentions = require('../services/mentionLifecycleService') as typeof import('../services/mentionLifecycleService');
const hashtags = require('../services/hashtagService') as typeof import('../services/hashtagService');
const notifications = require('../services/notificationService') as typeof import('../services/notificationService');
const media = require('../services/mediaService') as typeof import('../services/mediaService');
const audience = require('../services/postAudienceService') as typeof import('../services/postAudienceService');
const { PagePolicyError } = require('../pages/pagePolicy') as typeof import('../pages/pagePolicy');
const { createComment, updateComment, votePost } = require('./postController') as typeof import('./postController');

after(async () => prisma.$disconnect());

type ResponseState = { status: number; body?: any };
const responseFixture = () => {
  const state: ResponseState = { status: 200 };
  const response: any = {
    status(code: number) { state.status = code; return response; },
    json(body: any) { state.body = body; return response; },
    setHeader() { return response; }
  };
  return { state, response };
};

const replace = (restores: Array<() => void>, target: any, key: string, value: any) => {
  const original = target[key];
  target[key] = value;
  restores.push(() => { target[key] = original; });
};

type PreflightInput = {
  operation: 'vote' | 'comment';
  post?: Record<string, any>;
  body?: Record<string, any>;
  capability?: boolean;
  guardError?: InstanceType<typeof PagePolicyError>;
};

async function runPreflight(input: PreflightInput) {
  const restores: Array<() => void> = [];
  const post = {
    id: 'post', authorId: 'publisher-user', pageId: 'page', sharedFromId: null,
    allowComments: true, allowAnonymous: true, forceAnonymous: false,
    allowMultipleSelection: false, allowUserOptions: false, type: 'Poll',
    targetAudience: 'Public', targetedGroups: [], status: 'PUBLISHED',
    isDeleted: false, expiresAt: null, ...input.post
  };
  let roleChecks = 0, guardCalls = 0, followerChecks = 0, membershipChecks = 0, transactions = 0;
  const guardError = input.guardError || new PagePolicyError('PAGE_POST_UNAVAILABLE', 404);
  try {
    replace(restores, prisma.post, 'findUnique', async ({ select }: any) =>
      select?.sharedFromId && !select?.allowComments && !select?.allowAnonymous
        ? { id: post.id, sharedFromId: null, sharedCaption: null }
        : post);
    replace(restores, prisma.groupMember, 'findFirst', async () => { membershipChecks++; return { id: 'member' }; });
    replace(restores, prisma, '$transaction', async (work: any) => { transactions++; return work({}); });
    mock.method(pagePost, 'hasPostPageCapability', async () => { roleChecks++; return input.capability ?? false; });
    mock.method(pagePost, 'isPageFollower', async () => { followerChecks++; return true; });
    mock.method(pagePost, 'guardPagePostInteractions', async () => { guardCalls++; throw guardError; });
    mock.method(pagePost, 'guardPagePostPersistence', async () => { guardCalls++; throw guardError; });
    mock.method(audience, 'canInteractWithProfileAndGroups', async () => true);

    const { state, response } = responseFixture();
    const request: any = input.operation === 'vote'
      ? { params: { id: 'post' }, user: { userId: 'actor' }, body: { optionId: 'option', ...input.body }, ip: '127.0.0.1' }
      : { params: { id: 'post' }, user: { userId: 'actor' }, body: { text: 'plain comment', ...input.body } };
    await (input.operation === 'vote' ? votePost : createComment)(request, response);
    return { ...state, roleChecks, guardCalls, followerChecks, membershipChecks, transactions };
  } finally {
    mock.restoreAll();
    restores.reverse().forEach(restore => restore());
  }
}

test('exact Public Page vote and comment skip only the unused role preflight and retain authoritative denial', async () => {
  for (const operation of ['vote', 'comment'] as const) {
    for (const denial of [
      new PagePolicyError('PAGE_POST_UNAVAILABLE', 404), // post hidden or audience changed
      new PagePolicyError('PAGE_NOT_FOUND', 404),       // Page hidden or viewer blocked
      new PagePolicyError('PAGE_ACTIVE_ACCOUNT_REQUIRED', 401),
    ]) {
      const result = await runPreflight({ operation, guardError: denial });
      assert.equal(result.roleChecks, 0, `${operation}:${denial.code}`);
      assert.equal(result.guardCalls, 1, `${operation}:${denial.code}`);
      assert.equal(result.transactions, 1, `${operation}:${denial.code}`);
      assert.equal(result.status, denial.status);
      assert.equal(result.body.code, denial.code);
    }
  }
});

test('restricted Page audiences and official replies keep capability preflight behavior', async () => {
  for (const fixture of [
    { operation: 'vote' as const, post: { targetAudience: 'Public', targetedGroups: [{ id: 'group' }] } },
    { operation: 'vote' as const, post: { targetAudience: 'Followers' } },
    { operation: 'vote' as const, post: { targetAudience: null } },
    { operation: 'vote' as const, post: { targetAudience: 'CustomAudience' } },
    { operation: 'vote' as const, post: { targetAudience: 'Groups', targetedGroups: [{ id: 'group' }] } },
    { operation: 'vote' as const, post: { targetAudience: 'ProfileAndGroups', targetedGroups: [{ id: 'group' }] } },
    { operation: 'comment' as const, post: { targetAudience: 'Followers' } },
    { operation: 'comment' as const, post: { targetAudience: null } },
    { operation: 'comment' as const, post: { targetAudience: 'CustomAudience' } },
    { operation: 'comment' as const, post: { targetAudience: 'Groups', targetedGroups: [{ id: 'group' }] } },
  ]) {
    const result = await runPreflight(fixture);
    assert.equal(result.roleChecks, 1, `${fixture.operation}:${fixture.post.targetAudience}`);
    assert.equal(result.guardCalls, 1, `${fixture.operation}:${fixture.post.targetAudience}`);
    if (fixture.post.targetAudience === 'Followers') assert.equal(result.followerChecks, 1);
    if (fixture.post.targetAudience === 'Groups') assert.equal(result.membershipChecks, 1);
  }

  const allowedOfficial = await runPreflight({ operation: 'comment', capability: true, body: { pageId: 'page' } });
  assert.equal(allowedOfficial.roleChecks, 1);
  assert.equal(allowedOfficial.guardCalls, 1);

  const revokedOfficial = await runPreflight({ operation: 'comment', capability: false, body: { pageId: 'page' } });
  assert.equal(revokedOfficial.status, 403);
  assert.equal(revokedOfficial.body.code, 'PAGE_PERMISSION_DENIED');
  assert.equal(revokedOfficial.guardCalls, 0);

  const wrongPage = await runPreflight({ operation: 'comment', capability: true, body: { pageId: 'other-page' } });
  assert.equal(wrongPage.status, 403);
  assert.equal(wrongPage.body.code, 'PAGE_PERMISSION_DENIED');
  assert.equal(wrongPage.guardCalls, 0);
});

type CommentScenario = {
  pageId?: string | null;
  text: string;
  parentId?: string;
  mentionResult?: any;
  hashtagError?: Error;
  outboxError?: Error;
};

async function runCreateComment(input: CommentScenario) {
  const restores: Array<() => void> = [];
  const isPage = input.pageId !== null;
  const post = {
    id: 'post', authorId: 'publisher-user', pageId: isPage ? (input.pageId || 'page') : null,
    allowComments: true, targetAudience: 'Public', targetedGroups: [], status: 'PUBLISHED', isDeleted: false
  };
  const calls = { mentions: 0, hashtags: 0, dispatch: [] as string[][], legacyNotify: 0, guards: 0, attach: 0 };
  const activity: any[] = [];
  const committed = { comments: 0, counters: 0, outbox: 0 };
  try {
    replace(restores, prisma.post, 'findUnique', async ({ select }: any) =>
      select?.sharedFromId ? { id: 'post', sharedFromId: null, sharedCaption: null } : post);
    replace(restores, prisma.comment, 'findUnique', async () => input.parentId
      ? { id: input.parentId, postId: 'post', userId: 'parent-user' }
      : null);
    replace(restores, prisma, '$transaction', async (work: any) => {
      const pending = { ...committed };
      const activityCountBefore = activity.length;
      const created = {
        id: 'comment', text: input.text.trim(), userId: 'actor', postId: 'post',
        parentId: input.parentId || null, pageId: null, createdAt: new Date(0),
        user: { id: 'actor', name: 'Actor', handle: 'actor', avatar: '', verifiedBadge: false },
        mentions: [], likes: 0, likesList: [], replies: []
      };
      const tx: any = {
        post: {
          findUnique: async () => ({ allowComments: true }),
          update: async () => { pending.counters++; return { authorId: 'publisher-user' }; }
        },
        comment: {
          create: async () => { pending.comments++; return created; },
          count: async () => 1,
          findUniqueOrThrow: async () => created
        }
      };
      try {
        const result = await work(tx);
        if (isPage) pending.outbox += activity.length - activityCountBefore;
        Object.assign(committed, pending);
        return result;
      } catch (error) {
        throw error;
      }
    });
    mock.method(pagePost, 'guardPagePostInteractions', async () => { calls.guards++; return isPage; });
    mock.method(pagePost, 'hasPostPageCapability', async () => false);
    mock.method(pagePost, 'attachPageCommentPublishers', async () => { calls.attach++; });
    mock.method(mentions, 'reconcileCommentMentions', async () => {
      calls.mentions++;
      return input.mentionResult || { targetUserIds: [], notificationIds: [], created: 0, retained: 0, removed: 0, unresolved: 0, ineligible: 0 };
    });
    mock.method(hashtags, 'reconcileCommentHashtags', async () => {
      calls.hashtags++;
      if (input.hashtagError) throw input.hashtagError;
      return 0;
    });
    mock.method(pageActivity, 'notifyPagePostInteraction', async (event: any) => {
      activity.push(event);
      if (input.outboxError) throw input.outboxError;
      return isPage;
    });
    mock.method(notifications, 'dispatchNotificationIds', async (ids: string[]) => { calls.dispatch.push(ids); });
    mock.method(notifications, 'notify', async () => { calls.legacyNotify++; return { id: 'notification' } as any; });
    mock.method(media, 'serializeUserMediaRecord', (record: any) => record);
    mock.method(console, 'error', () => {});

    const { state, response } = responseFixture();
    await createComment({
      params: { id: 'post' }, user: { userId: 'actor' },
      body: { text: input.text, ...(input.parentId ? { parentId: input.parentId } : {}) }
    } as any, response);
    return { ...state, calls, activity, committed };
  } finally {
    mock.restoreAll();
    restores.reverse().forEach(restore => restore());
  }
}

test('plain new Page comments and replies skip empty relation writes but retain counter and transactional outbox', async () => {
  for (const parentId of [undefined, 'parent']) {
    const result = await runCreateComment({ text: 'plain text', parentId });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.calls.mentions, 0);
    assert.equal(result.calls.hashtags, 0);
    assert.deepEqual(result.committed, { comments: 1, counters: 1, outbox: 1 });
    assert.equal(result.activity.length, 1);
    assert.equal(result.activity[0].kind, parentId ? 'reply' : 'comment');
    assert.equal(result.activity[0].parentCommentId, parentId);
    assert.equal(result.calls.legacyNotify, 0);
    assert.deepEqual(result.calls.dispatch, [[]]);
  }
});

test('Page entity comments and personal plain comments retain reconciliation and delivery behavior', async () => {
  const entity = await runCreateComment({
    text: 'hello @alice #Topic',
    mentionResult: { targetUserIds: ['alice'], notificationIds: ['mention-notification'], created: 1, retained: 0, removed: 0, unresolved: 0, ineligible: 0 }
  });
  assert.equal(entity.calls.mentions, 1);
  assert.equal(entity.calls.hashtags, 1);
  assert.deepEqual(entity.activity[0].excludedRecipientIds, ['alice']);
  assert.deepEqual(entity.calls.dispatch, [['mention-notification']]);

  const personal = await runCreateComment({ pageId: null, text: 'plain text' });
  assert.equal(personal.calls.mentions, 1);
  assert.equal(personal.calls.hashtags, 1);
  assert.equal(personal.calls.legacyNotify, 1);
  assert.deepEqual(personal.committed, { comments: 1, counters: 1, outbox: 0 });
});

test('comment entity limits still fail closed and transaction failures roll back comment, counter and outbox', async () => {
  const tooManyMentions = Array.from({ length: 11 }, (_, index) => `@person${index}`).join(' ');
  const mentionLimit = await runCreateComment({ text: tooManyMentions });
  assert.equal(mentionLimit.status, 400);
  assert.equal(mentionLimit.committed.comments, 0);
  assert.equal(mentionLimit.calls.guards, 0);

  const hashtagLimit = await runCreateComment({
    text: '#one #two #three #four #five #six #seven #eight #nine #ten #eleven',
    hashtagError: new hashtags.HashtagLimitError(10, 11)
  });
  assert.equal(hashtagLimit.status, 400);
  assert.equal(hashtagLimit.body.code, 'SOCIAL_TEXT_LIMIT_EXCEEDED');
  assert.deepEqual(hashtagLimit.committed, { comments: 0, counters: 0, outbox: 0 });

  const rollback = await runCreateComment({ text: 'plain text', outboxError: new Error('outbox unavailable') });
  assert.equal(rollback.status, 500);
  assert.deepEqual(rollback.committed, { comments: 0, counters: 0, outbox: 0 });
  assert.deepEqual(rollback.calls.dispatch, []);
});

test('editing a Page comment to plain text still reconciles removals for mentions and hashtags', async () => {
  const restores: Array<() => void> = [];
  const calls = { mentions: 0, hashtags: 0, guard: 0 };
  const comment = { id: 'comment', postId: 'post', userId: 'employee', pageId: 'page', parentId: null };
  const updated = {
    ...comment, text: 'plain now', createdAt: new Date(0),
    user: { id: 'employee', name: 'Employee', handle: 'employee', avatar: '', verifiedBadge: false },
    mentions: [], likes: 0, likesList: [], replies: []
  };
  try {
    replace(restores, prisma.comment, 'findUnique', async () => comment);
    replace(restores, prisma, '$transaction', async (work: any) => work({
      comment: {
        findUnique: async () => comment,
        update: async () => updated,
        findUniqueOrThrow: async () => updated
      }
    }));
    mock.method(pagePost, 'hasPostPageCapability', async () => true);
    mock.method(pagePost, 'guardPagePostPersistence', async () => { calls.guard++; });
    mock.method(pagePost, 'attachPageCommentPublishers', async () => {});
    mock.method(pageService, 'lockPage', async () => ({ id: 'page' } as any));
    mock.method(pageService, 'requirePageCapability', async () => 'EDITOR' as any);
    mock.method(mentions, 'reconcileCommentMentions', async () => {
      calls.mentions++;
      return { targetUserIds: [], notificationIds: [], created: 0, retained: 0, removed: 1, unresolved: 0, ineligible: 0 };
    });
    mock.method(hashtags, 'reconcileCommentHashtags', async () => { calls.hashtags++; return 0; });
    mock.method(notifications, 'dispatchNotificationIds', async () => {});
    mock.method(media, 'serializeUserMediaRecord', (record: any) => record);
    const { state, response } = responseFixture();
    await updateComment({ params: { id: 'comment' }, user: { userId: 'editor' }, body: { text: 'plain now' } } as any, response);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.deepEqual(calls, { mentions: 1, hashtags: 1, guard: 1 });
  } finally {
    mock.restoreAll();
    restores.reverse().forEach(restore => restore());
  }
});
