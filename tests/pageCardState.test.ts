import assert from 'node:assert/strict';
import test from 'node:test';
import { pageCardCallbacks, replacePagePost, updatePageProgress, settlePageVote, settlePageLike } from '../utils/pageCardState.ts';
import { commentComposerIdentity } from '../utils/commentComposerIdentity.ts';
import type { Comment, Survey, UserProfile } from '../types';

const post = (overrides = {}) => ({ id: 'post', type: 'Poll', participants: 0, options: [{ id: 'a', votes: 0 }], ...overrides }) as unknown as Survey;
const deferred = () => { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; }); return { promise, resolve }; };

test('failed Page like and unlike roll back even when reconciliation GET also fails', async () => {
  for (const liked of [false, true]) {
    const original = { isLiked: liked, likes: 6 }; let state = original; let failures = 0;
    const callbacks = pageCardCallbacks({ onLike: async () => false }, {
      refresh: async () => false, progress() {}, remove() {}, error() {}
    });
    await settlePageLike({ current: false }, original, () => callbacks.onLike!('post', !liked), next => { state = next; }, () => { failures++; });
    assert.deepEqual(state, original); assert.equal(failures, 1);
  }
});

test('same-valued authoritative Page DTO explicitly replaces optimistic like and unlike', async () => {
  for (const liked of [false, true]) {
    const original = { isLiked: liked, likes: 6 }; const states: typeof original[] = [];
    const callbacks = pageCardCallbacks({ onLike: async () => true }, {
      refresh: async () => [post(original)], progress() {}, remove() {}, error() {}
    });
    await settlePageLike({ current: false }, original, () => callbacks.onLike!('post', !liked), state => states.push(state), () => assert.fail('unexpected rollback'));
    assert.equal(states[0].isLiked, !liked); assert.deepEqual(states.at(-1), original);
  }
});

test('Page toggle overlap sends one write and releases the lock after rejection', async () => {
  const write = deferred(); const lock = { current: false }; let writes = 0;
  let state = { isLiked: false, likes: 3 };
  const submit = () => { writes++; return write.promise; };
  const apply = (next: typeof state) => { state = next; };
  const first = settlePageLike(lock, state, submit, apply, () => {});
  const second = settlePageLike(lock, state, submit, apply, () => {});
  await second; assert.equal(writes, 1); assert.equal(state.isLiked, true);
  write.resolve(false); await first;
  assert.deepEqual(state, { isLiked: false, likes: 3 }); assert.equal(lock.current, false);
  await settlePageLike(lock, state, async () => ({ isLiked: true, likes: 9 }), apply, () => {});
  assert.deepEqual(state, { isLiked: true, likes: 9 });
});

test('official comment and nested reply edits keep their stored author for avatar and name', () => {
  const human = { id: 'human', name: 'Person', avatar: 'person.png' } as UserProfile;
  const pageAuthor = { id: 'page', name: 'Page name', avatar: 'page.png', kind: 'PAGE' };
  const rows = [{ id: 'comment', author: pageAuthor, replies: [{ id: 'reply', author: pageAuthor }] }] as unknown as Comment[];
  const pagePost = post({ pageId: 'page', author: pageAuthor });
  for (const editingId of ['comment', 'reply']) {
    assert.equal(commentComposerIdentity(rows, editingId, false, pagePost, human), pageAuthor);
    assert.equal(commentComposerIdentity(rows, editingId, true, pagePost, human), pageAuthor);
  }
  assert.equal(commentComposerIdentity(rows, 'unavailable', true, pagePost, human), undefined);
  assert.equal(commentComposerIdentity(rows, null, false, pagePost, human), human);
  assert.equal(commentComposerIdentity(rows, null, true, pagePost, human), pageAuthor);
});

test('Page completion rolls back on rejected or failed submissions without touching answers', async () => {
  let completed = true; const answers = { q1: ['a'], q2: 'written answer' };
  const rollback = () => { completed = false; };
  assert.equal(await settlePageVote(async () => false, rollback), false);
  assert.equal(completed, false);
  completed = true;
  assert.equal(await settlePageVote(async () => { throw new Error('closed'); }, rollback), false);
  assert.equal(completed, false); assert.deepEqual(answers, { q1: ['a'], q2: 'written answer' });
  completed = true; await settlePageVote(async () => true, rollback); assert.equal(completed, true);
});

test('Page vote waits for commit, refreshes server totals, and preserves mutation result', async () => {
  const write = deferred(); let posts = [post()]; let reads = 0;
  const callbacks = pageCardCallbacks({ onVote: () => write.promise }, {
    refresh: async () => { reads++; posts = replacePagePost(posts, post({ participants: 7, options: [{ id: 'a', votes: 5 }], hasParticipated: true })); },
    progress() {}, remove() {}, error(error) { throw error; }
  });
  const pending = callbacks.onVote!('post', ['a']);
  assert.equal(reads, 0); assert.equal(posts[0].participants, 0);
  write.resolve(true); assert.equal(await pending, true);
  assert.equal(reads, 1); assert.equal(posts[0].participants, 7); assert.equal(posts[0].options![0].votes, 5);
});

test('failed vote reconciles without inventing participation or counts', async () => {
  let reads = 0;
  const callbacks = pageCardCallbacks({ onVote: async () => false }, {
    refresh: async () => { reads++; }, progress() {}, remove() {}, error() {}
  });
  assert.equal(await callbacks.onVote!('post', ['a']), false); assert.equal(reads, 1);
});

test('like reconciliation waits for the parent promise; confirmed delete keeps all returned IDs', async () => {
  const write = deferred(); const actions: string[] = [];
  const callbacks = pageCardCallbacks({ onLike: () => write.promise, onDelete: () => actions.push('parent-delete') }, {
    refresh: async id => { actions.push(id); }, progress() {},
    remove: (id, ids) => actions.push([id, ...ids || []].join(',')), error() {}
  });
  callbacks.onLike!('post', true); assert.deepEqual(actions, []);
  write.resolve(true); await write.promise; await Promise.resolve();
  assert.deepEqual(actions, ['post']);
  callbacks.onDelete!('post', ['wrapper']);
  assert.deepEqual(actions, ['post', 'post,wrapper', 'parent-delete']);
});

test('refresh removes revoked result fields while preserving unfinished progress in shared cards', () => {
  const progress = { index: 2, answers: { q1: ['a'] }, followUpAnswers: { a: 'explanation' }, historyStack: [0, 1], isAnonymous: true };
  let posts = [post({ id: 'wrapper', sharedFrom: post(), secretResult: 12 }), post({ id: 'unrelated' })];
  posts = updatePageProgress(posts, 'post', progress);
  const unrelated = posts[1];
  const refreshed = replacePagePost(posts, post({ id: 'wrapper', sharedFrom: post({ participants: 4, options: undefined }) }));
  assert.equal((refreshed[0] as any).secretResult, undefined);
  assert.equal(refreshed[0].sharedFrom!.options, undefined);
  assert.equal(refreshed[0].sharedFrom!.participants, 4);
  assert.equal(refreshed[0].sharedFrom!.userProgress!.currentQuestionIndex, 2);
  assert.deepEqual(refreshed[0].sharedFrom!.userProgress!.answers, progress.answers);
  assert.equal(refreshed[1], unrelated);
  assert.deepEqual(replacePagePost([unrelated], post()), [unrelated], 'late response cannot resurrect a deleted card');
});
