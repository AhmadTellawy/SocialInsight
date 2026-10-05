import { test, expect, Page } from '@playwright/test';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; }
async function setup(page: Page, language = 'en') {
  page.on('pageerror', error => { throw error; });
  const user = { id: 'interaction-test-user', name: 'Test User', handle: 'test-user', type: 'Personal', avatar: '', groups: [], interests: [], isPrivate: false, language, demographics: {}, stats: { followers: 0, following: 0, posts: 1 } };
  const state = { prepend: false, feedCount: 1, feedStatus: 200, sessionGets: 0, comments: [] as any[], commentGets: 0, sends: 0, likes: 0, failSend: false, participantStatus: 200, commentStatus: 200, feedHold: undefined as ReturnType<typeof deferred> | undefined, sendHold: undefined as ReturnType<typeof deferred> | undefined, getHold: undefined as ReturnType<typeof deferred> | undefined, participantsHold: undefined as ReturnType<typeof deferred> | undefined, actor: user.id };
  const post = (id = 'interaction-post') => ({ id, title: 'Interaction repair fixture', description: '', type: 'Poll', status: 'PUBLISHED', authorId: user.id, author: user, participants: 1, likes: state.likes, isLiked: !!state.likes, commentsCount: 0, repostCount: 0, createdAt: '2026-09-30T00:00:00Z', targetAudience: 'Public', targetGroups: [], demographics: [], media: [], category: '', resultsWho: 'Public', resultsTiming: 'AnyTime', allowComments: true, options: [{ id: 'a', text: 'First', votes: 1 }, { id: 'b', text: 'Second', votes: 0 }] });
  await page.addInitScript(lang => { localStorage.setItem('i18nextLng', lang); }, language);
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname, method = request.method();
    if (url.hostname !== '127.0.0.1') return route.abort();
    const json = (body: any, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
    if (p === '/api/auth/session') { state.sessionGets++; return json({ user: { ...user, id: state.actor }, csrfToken: 'synthetic-session-csrf-123456789' }); }
    if (p === '/api/posts') { await state.feedHold?.promise; return json(state.feedStatus === 200 ? { data: [...(state.prepend ? [post('new-first-post')] : []), ...Array.from({ length: state.feedCount }, (_, i) => post(i === 0 ? 'interaction-post' : 'fixture-' + i))], nextCursor: null } : { error: 'Synthetic feed failure' }, state.feedStatus); }
    if (p === '/api/posts/interaction-post/comments' && method === 'GET') {
      state.commentGets++; const snapshot = structuredClone(state.comments); await state.getHold?.promise;
      return json(state.commentStatus === 200 ? snapshot : { error: 'Access denied' }, state.commentStatus, { 'X-Total-Count': String(snapshot.length) });
    }
    if (p === '/api/posts/interaction-post/comments' && method === 'POST') {
      state.sends++; const body = request.postDataJSON(); await state.sendHold?.promise;
      if (state.failSend) return json({ error: 'Synthetic failure' }, 503);
      const created = { id: 'comment-' + state.sends, text: body.text, timestamp: new Date().toISOString(), likes: 0, author: user, replies: [] };
      state.comments.unshift(created); return json({ ...created, commentsCount: state.comments.length });
    }
    if (p.startsWith('/api/posts/comments/') && ['PUT', 'DELETE'].includes(method)) {
      const id = p.split('/').pop(), comment = state.comments.find(c => c.id === id);
      if (method === 'PUT') { comment.text = request.postDataJSON().text; return json(comment); }
      state.comments = state.comments.filter(c => c.id !== id);
      return json({ success: true, commentsCount: state.comments.length });
    }
    if (p === '/api/posts/interaction-post/like') { state.likes = state.likes ? 0 : 1; return json({ isLiked: !!state.likes, likes: state.likes, commentsCount: 0 }); }
    if (p === '/api/posts/interaction-post/likes') return json([user]);
    if (p === '/api/posts/interaction-post/participants') { await state.participantsHold?.promise; return json(state.participantStatus === 200 ? [] : { error: 'Denied' }, state.participantStatus, state.participantStatus === 200 ? { 'X-Total-Count': '0' } : {}); }
    if (p === '/api/posts/interaction-post') return json(post());
    if (method === 'GET') return json([]);
    if (p.includes('/analytics/') || p.endsWith('/views')) return json({ success: true });
    throw new Error(`Unexpected synthetic API request ${method} ${p}`);
  });
  return state;
}
const openComments = async (page: Page) => { await page.getByRole('button', { name: 'Comment', exact: true }).click(); return page.getByRole('dialog', { name: /^Comments/ }); };

test('confirmed send, like, cached reopen and server counter stay consistent', async ({ page }, info) => {
  const state = await setup(page); await page.goto('/', { waitUntil: 'domcontentloaded' });
  const dialog = await openComments(page);
  await expect(dialog.getByText('No comments yet. Be the first!')).toBeVisible();
  expect(await page.locator('textarea').evaluate(el => el === document.activeElement)).toBe(false);
  state.sendHold = deferred();
  await dialog.getByPlaceholder('Write a comment...').fill('Persisted comment');
  await dialog.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(dialog.getByText('Sending comment…')).toBeVisible();
  await expect(dialog.getByText('No comments yet. Be the first!')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Send comment', exact: true })).toBeDisabled();
  expect(state.sends).toBe(1); state.sendHold.resolve();
  await expect(dialog.getByText('Persisted comment', { exact: true })).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Comments (1)');
  await page.keyboard.press('Escape'); // keyboard/focus first
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Comment', exact: true })).toHaveText('1');
  const before = state.commentGets, start = Date.now();
  const reopened = await openComments(page);
  await expect(reopened.getByText('Persisted comment', { exact: true })).toBeVisible();
  await expect(reopened).toHaveAccessibleName('Comments (1)');
  expect(state.commentGets).toBe(before);
  expect(await page.locator('textarea').evaluate(el => el === document.activeElement)).toBe(false);
  await info.attach('cached-reopen-measurement', { body: JSON.stringify({ elapsedMs: Date.now() - start, networkRequests: state.commentGets - before, environment: 'Desktop Chromium Pixel 7 emulation; not native Android' }), contentType: 'application/json' });
});

test('send failure keeps draft and retry has one in-flight request', async ({ page }) => {
  const state = await setup(page); state.failSend = true; await page.goto('/', { waitUntil: 'domcontentloaded' });
  const dialog = await openComments(page);
  await dialog.getByPlaceholder('Write a comment...').fill('Recoverable draft');
  await dialog.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Your text is kept');
  await expect(dialog.getByPlaceholder('Write a comment...')).toHaveValue('Recoverable draft');
  state.failSend = false;
  await dialog.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(dialog.getByPlaceholder('Write a comment...')).toHaveValue('');
  await expect(dialog.getByText('Recoverable draft', { exact: true })).toBeVisible();
  expect(state.sends).toBe(2);
});

test('late comments GET cannot undo a confirmed comment', async ({ page }) => {
  const state = await setup(page); state.getHold = deferred(); await page.goto('/', { waitUntil: 'domcontentloaded' });
  const dialog = await openComments(page);
  await expect.poll(() => state.commentGets).toBe(1);
  await dialog.getByPlaceholder('Write a comment...').fill('Wins over old response');
  await dialog.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Comments (1)');
  await expect(dialog.getByText('Wins over old response', { exact: true })).toBeVisible();
  state.getHold.resolve();
  await expect(dialog.getByText('Wins over old response', { exact: true })).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Comments (1)');
});

test('history closes keyboard first then sheet without moving the feed', async ({ page }) => {
  await setup(page); await page.goto('/', { waitUntil: 'domcontentloaded' });
  const dialog = await openComments(page);
  const length = await page.evaluate(() => history.length);
  await dialog.getByPlaceholder('Write a comment...').focus();
  await page.evaluate(() => history.back());
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder('Write a comment...')).not.toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.evaluate(() => history.back());
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL('http://127.0.0.1:4196/');
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await page.getByRole('button', { name: 'View likes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Likes', exact: true })).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.getByRole('heading', { name: 'Likes', exact: true })).toHaveCount(0);
});

test('visual viewport reduction keeps title and input inside the sheet', async ({ page }) => {
  await setup(page); await page.goto('/', { waitUntil: 'domcontentloaded' }); const dialog = await openComments(page);
  await page.evaluate(() => { Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 380 }); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await expect.poll(async () => (await dialog.boundingBox())!.height).toBeLessThanOrEqual(361);
  const header = (await dialog.getByRole('heading', { name: /^Comments/ }).boundingBox())!;
  const input = (await dialog.getByPlaceholder('Write a comment...').boundingBox())!;
  expect(header.y).toBeGreaterThanOrEqual(0); expect(input.y + input.height).toBeLessThanOrEqual(380);
});

test('startup retains logo until useful feed and cold reload restores only coordinates', async ({ page }) => {
  const state = await setup(page); state.feedHold = deferred(); await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('img', { name: 'OpiniUp', exact: true })).toBeVisible();
  state.feedHold.resolve(); await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('opiniup_resume_v1')!));
  expect(Object.keys(saved).sort()).toEqual(['anchor', 'at', 'feedLimit', 'path', 'top', 'viewer']);
  expect(Object.keys(saved.anchor).sort()).toEqual(['id', 'offset']);
  await page.reload(); await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeVisible();
});

test('participants distinguish loading, failure and confirmed zero; back closes the third sheet', async ({ page }) => {
  const state = await setup(page); state.participantStatus = 503; state.participantsHold = deferred();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const requestStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/posts/interaction-post/participants');
  await page.getByRole('button', { name: '1 votes', exact: true }).click();
  await requestStarted; // The lazy module must load before asserting its pending-API footer.
  const dialog = page.getByRole('dialog', { name: 'Participants', exact: true });
  await expect(dialog.getByText('Loading participants…')).toBeVisible();
  await expect(dialog.getByText(/Total visible participants: 0/)).toHaveCount(0);
  state.participantsHold.resolve();
  await expect(dialog.getByText('Participant count unavailable')).toBeVisible();
  await expect(dialog.getByText(/Total visible participants: 0/)).toHaveCount(0);
  state.participantStatus = 200; await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByText('Total visible participants: 0')).toBeVisible();
  await page.evaluate(() => history.back()); await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL('http://127.0.0.1:4196/');
});

test('repeated sheet opens do not grow the history stack or lock body scrolling', async ({ page }) => {
  await setup(page); await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openComments(page); const length = await page.evaluate(() => history.length);
  for (let n = 0; n < 3; n++) {
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: /^Comments/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await openComments(page); expect(await page.evaluate(() => history.length)).toBe(length);
  }
});

test('permission loss removes cached comments on background revalidation', async ({ page }) => {
  const state = await setup(page); await page.goto('/', { waitUntil: 'domcontentloaded' }); const dialog = await openComments(page);
  await dialog.getByPlaceholder('Write a comment...').fill('Access controlled text');
  await dialog.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(dialog.getByText('Access controlled text', { exact: true })).toBeVisible();
  state.commentStatus = 403;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(dialog.getByText('Access controlled text', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Failed to load comments. Please try again.')).toBeVisible();
});

test('edit and delete update cached text and both counters', async ({ page }) => {
  await setup(page); await page.goto('/'); const dialog = await openComments(page);
  await dialog.getByPlaceholder('Write a comment...').fill('Original text');
  await dialog.getByRole('button', { name: 'Send comment', exact: true }).click();
  await dialog.getByText('Original text', { exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: /Edit Comment Modify/ }).click();
  await dialog.getByPlaceholder('Edit your comment...').fill('Edited text');
  await dialog.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(dialog.getByText('Edited text', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await openComments(page);
  await expect(dialog.getByText('Edited text', { exact: true })).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Comments (1)');
  page.once('dialog', native => native.accept());
  await dialog.getByText('Edited text', { exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: /Delete Comment Remove/ }).click();
  await expect(dialog).toHaveAccessibleName('Comments (0)');
  await expect(dialog.getByText('No comments yet. Be the first!')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Comment', exact: true })).toHaveText('');
});

test('nonzero feed position survives sheets, background resume and cold reload', async ({ page }) => {
  const state = await setup(page); state.feedCount = 12; await page.goto('/');
  const target = page.locator('[data-post-id="fixture-5"]');
  await target.scrollIntoViewIfNeeded();
  const scroll = page.locator('[data-app-scroll]');
  const top = await scroll.evaluate(el => el.scrollTop); expect(top).toBeGreaterThan(300);
  await target.getByRole('button', { name: 'Comment', exact: true }).click();
  await page.evaluate(() => history.back()); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await scroll.evaluate(el => el.scrollTop)).toBeCloseTo(top, 0);
  const sessions = state.sessionGets;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await expect.poll(() => state.sessionGets).toBe(sessions + 1);
  await expect(page.getByText('Restoring your page…', { exact: true })).toHaveCount(0);
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeCloseTo(top, 0);
  await page.reload(); await expect(target).toBeVisible();
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeCloseTo(top, 0);
});

test('switching accounts during resume discards cached comments and navigation state', async ({ page }) => {
  const state = await setup(page); await page.goto('/'); const dialog = await openComments(page);
  await dialog.getByPlaceholder('Write a comment...').fill('Previous account private text');
  await dialog.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(dialog.getByText('Previous account private text', { exact: true })).toBeVisible();
  state.actor = 'different-account'; state.comments = [];
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByText('Previous account private text', { exact: true })).toHaveCount(0);
  await expect(dialog).toHaveCount(0); await openComments(page);
  await expect(dialog.getByText('No comments yet. Be the first!')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('opiniup_resume_v1'))).toBeNull();
});

test('nested likes closes alone and keeps parent comments scroll lock', async ({ page }) => {
  const state = await setup(page);
  state.comments = [{ id: 'nested-comment', text: 'Nested likes example', timestamp: new Date().toISOString(), likes: 1, author: { id: state.actor, name: 'Test User' }, replies: [] }];
  await page.goto('/'); const comments = await openComments(page);
  await comments.locator('[data-comment-id="nested-comment"]').getByRole('button', { name: '1', exact: true }).click();
  const likes = page.getByRole('dialog', { name: 'Likes', exact: true });
  await expect(likes).toBeVisible(); await page.keyboard.press('Escape');
  await expect(likes).toHaveCount(0); await expect(comments).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.evaluate(() => history.back()); await expect(comments).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('startup failure exposes retry and recovers to useful feed', async ({ page }) => {
  const state = await setup(page); state.feedStatus = 400; await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not load posts');
  state.feedStatus = 200; await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeVisible();
});

test('Arabic sending state and viewport layout remain usable', async ({ page }) => {
  const state = await setup(page, 'ar'); state.sendHold = deferred(); await page.goto('/');
  await openComments(page);
  const dialog = page.getByRole('dialog');
  await dialog.locator('textarea').fill('تعليق عربي للاختبار');
  await dialog.getByRole('button', { name: 'إرسال التعليق', exact: true }).click();
  await expect(dialog.getByText('جارٍ إرسال التعليق…')).toBeVisible();
  state.sendHold.resolve(); await expect(dialog.getByText('تعليق عربي للاختبار', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('resume keeps the same post offset when a new post is prepended', async ({ page }) => {
  const state = await setup(page); state.feedCount = 12; await page.goto('/');
  await page.locator('[data-post-id="fixture-5"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('opiniup_resume_v1')!));
  expect(saved.top).toBeGreaterThan(300); state.prepend = true;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('[data-post-id="new-first-post"]')).toHaveCount(1);
  const target = page.locator(`[data-post-id="${saved.anchor.id}"]`);
  await expect.poll(() => target.evaluate(el => el.getBoundingClientRect().top - document.querySelector('[data-app-scroll]')!.getBoundingClientRect().top)).toBeCloseTo(saved.anchor.offset, 0);
});

test('cold restart restores profile route and nonzero position after fresh reads', async ({ page }) => {
  const state = await setup(page); state.feedCount = 12; await page.goto('/profile');
  await page.locator('[data-post-id="fixture-5"]').scrollIntoViewIfNeeded();
  const scroll = page.locator('[data-app-scroll]'); const top = await scroll.evaluate(el => el.scrollTop);
  expect(top).toBeGreaterThan(300);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.goto('/'); await expect(page).toHaveURL('http://127.0.0.1:4196/profile');
  await expect(page.locator('[data-post-id="fixture-5"]')).toBeVisible();
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeCloseTo(top, 0);
});
