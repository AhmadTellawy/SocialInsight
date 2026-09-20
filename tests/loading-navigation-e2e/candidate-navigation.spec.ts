import { expect, test, type Page, type Route } from '@playwright/test';

type Profile = ReturnType<typeof profile>;
type MockState = {
  profiles: Record<string, Profile>;
  delayProfile: Set<string>;
  delayPosts: Set<string>;
  forbidden: Set<string>;
  failedPosts: Set<string>;
  emptyPosts: Set<string>;
  delayedMorePosts: Set<string>;
  morePostsStarted: Set<string>;
  connectionMoreStarted: Set<string>;
  feed?: unknown[];
  feedDelayMs?: number;
};

const profile = (id: string, handle: string, name: string) => ({
  id, handle, name, avatar: '', bio: `${name} bio`, location: '', website: '',
  email: `${handle}@example.test`, phone: '', language: 'en', isPrivate: false,
  groupPrivacy: 'Public', peopleTagPermission: 'EVERYONE', profileLinks: [],
  stats: { followers: 2, following: 3, posts: 1, responses: 4 },
  demographics: {}, updatedAt: '2026-09-20T00:00:00.000Z'
});

const post = (owner: Profile, index: number) => ({
  id: `${owner.id}-post-${index}`,
  type: 'Poll', status: 'PUBLISHED', title: `${owner.name} post ${index}`,
  content: `${owner.name} post ${index}`, createdAt: '2026-09-20T00:00:00.000Z',
  author: owner, participants: 0, likes: 0, comments: 0, shares: 0,
  options: [{ id: `${owner.id}-yes-${index}`, text: 'Yes', votes: 0 }, { id: `${owner.id}-no-${index}`, text: 'No', votes: 0 }],
  config: {}, resultsVisibility: 'Always'
});

const json = (route: Route, body: unknown, status = 200, headers?: Record<string, string>) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

const installMocks = async (page: Page, state: MockState) => {
  page.on('pageerror', error => console.log(`PAGE_ERROR: ${error.message}`));
  const viewer = state.profiles.viewer;
  await page.addInitScript((user) => {
    localStorage.setItem('si_token', 'candidate-token');
    localStorage.setItem('si_user', JSON.stringify(user));
  }, viewer);

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (request.method() !== 'GET') return json(route, {});
    if (pathname === '/api/users/me') return json(route, viewer);

    const handleMatch = /^\/api\/users\/handle\/([^/]+)$/.exec(pathname);
    const idMatch = /^\/api\/users\/([^/]+)$/.exec(pathname);
    const target = handleMatch
      ? Object.values(state.profiles).find(item => item.handle === decodeURIComponent(handleMatch[1]))
      : idMatch ? state.profiles[decodeURIComponent(idMatch[1])] : undefined;
    if (target) {
      if (state.delayProfile.has(target.id)) await new Promise(resolve => setTimeout(resolve, 900));
      if (state.forbidden.has(target.id)) return json(route, { error: 'Forbidden' }, 403);
      return json(route, target);
    }

    if (pathname === '/api/posts') {
      const authorId = url.searchParams.get('authorId');
      const authorHandle = url.searchParams.get('authorHandle');
      if (!authorId && !authorHandle && state.feed) {
        if (state.feedDelayMs) await new Promise(resolve => setTimeout(resolve, state.feedDelayMs));
        return json(route, { data: state.feed, nextCursor: null });
      }
      const owner = authorId
        ? state.profiles[authorId]
        : Object.values(state.profiles).find(item => item.handle === authorHandle) || viewer;
      if (owner && state.delayPosts.has(owner.id)) await new Promise(resolve => setTimeout(resolve, 1_200));
      if (owner && state.forbidden.has(owner.id)) return json(route, { error: 'Forbidden' }, 403);
      if (owner && state.failedPosts.has(owner.id)) return json(route, { error: 'Temporary failure' }, 500);
      if (owner && state.emptyPosts.has(owner.id)) return json(route, { data: [], nextCursor: null });
      const cursor = url.searchParams.get('cursor');
      if (cursor && owner && state.delayedMorePosts.has(owner.id)) {
        state.morePostsStarted.add(owner.id);
        await new Promise(resolve => setTimeout(resolve, 1_200));
      }
      const start = cursor ? 10 : 0;
      const count = cursor ? 6 : 10;
      return json(route, {
        data: owner ? Array.from({ length: count }, (_, index) => post(owner, start + index)) : [],
        nextCursor: cursor ? null : 'next-page'
      });
    }
    const followersMatch = /^\/api\/users\/(alpha|beta)\/followers$/.exec(pathname);
    if (followersMatch) {
      const ownerId = followersMatch[1];
      const cursor = url.searchParams.get('cursor');
      if (cursor && ownerId === 'alpha') {
        state.connectionMoreStarted.add(ownerId);
        await new Promise(resolve => setTimeout(resolve, 1_200));
        return json(route, [{ id: 'alpha-stale-follower', handle: 'alpha-stale', name: 'Alpha Stale Follower', avatar: '' }]);
      }
      const person = ownerId === 'alpha'
        ? { id: 'alpha-follower', handle: 'alpha-follower', name: 'Alpha Follower', avatar: '' }
        : { id: 'beta-follower', handle: 'beta-follower', name: 'Beta Follower', avatar: '' };
      return json(route, [person], 200, cursor ? undefined : { 'X-Next-Cursor': ownerId === 'alpha' ? 'alpha-next-followers' : '' });
    }
    if (/\/groups$|\/followers$|\/following$/.test(pathname)) return json(route, []);
    if (pathname.includes('/notifications')) return json(route, []);
    return json(route, []);
  });
};

const makeState = (): MockState => ({
  profiles: {
    viewer: profile('viewer', 'viewer', 'Viewer Profile'),
    alpha: profile('alpha', 'alpha', 'Alpha Profile'),
    beta: profile('beta', 'beta', 'Beta Profile')
  },
  delayProfile: new Set(), delayPosts: new Set(), forbidden: new Set(), failedPosts: new Set(), emptyPosts: new Set(),
  delayedMorePosts: new Set(), morePostsStarted: new Set(), connectionMoreStarted: new Set()
});

const spaNavigate = (page: Page, path: string) => page.evaluate((nextPath) => {
  window.history.pushState({}, '', nextPath);
  window.dispatchEvent(new PopStateEvent('popstate'));
}, path);

test.describe('candidate loading and navigation regressions', () => {
  test.setTimeout(90_000);

  test('profile A to B never flashes A and keeps header/back during delayed B loading', async ({ page }) => {
    const state = makeState();
    state.delayProfile.add('beta');
    state.delayPosts.add('beta');
    await installMocks(page, state);
    await page.goto('/@alpha');
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toBeVisible({ timeout: 15_000 });

    await spaNavigate(page, '/@beta');
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    await expect(page.locator('h2').filter({ hasText: /^Beta Profile$/ })).toBeVisible({ timeout: 15_000 });
  });

  test('profile settings roundtrip preserves tab and scroll without the full profile skeleton', async ({ page }) => {
    const state = makeState();
    await installMocks(page, state);
    await page.goto('/@viewer');
    await expect(page.locator('h2').filter({ hasText: /^Viewer Profile$/ })).toBeVisible({ timeout: 15_000 });
    const scroller = page.getByTestId('profile-scroll-container');
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
    await expect(page.getByText('Viewer Profile post 15', { exact: true })).toBeVisible();
    await scroller.evaluate(element => { element.scrollTop = 420; element.dispatchEvent(new Event('scroll')); });
    const before = await scroller.evaluate(element => element.scrollTop);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\/profile/);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/@viewer$/);
    await expect(page.locator('h2').filter({ hasText: /^Viewer Profile$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Viewer Profile post 15', { exact: true })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(before);
  });

  test('profile settings roundtrip preserves a non-default tab in the route', async ({ page }) => {
    const state = makeState();
    await installMocks(page, state);
    await page.goto('/@viewer?tab=groups');
    await expect(page.locator('h2').filter({ hasText: /^Viewer Profile$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Groups', exact: true })).toHaveClass(/border-blue-600/);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\/profile/);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/@viewer\?tab=groups$/);
    await expect(page.getByRole('button', { name: 'Groups', exact: true })).toHaveClass(/border-blue-600/);
  });

  test('a 403 refresh cannot retain a forbidden warm profile or its posts', async ({ page }) => {
    const state = makeState();
    await installMocks(page, state);
    await page.goto('/@alpha');
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toBeVisible({ timeout: 15_000 });
    state.forbidden.add('alpha');
    await spaNavigate(page, '/');
    await spaNavigate(page, '/@alpha');
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Profile unavailable' })).toBeVisible();
  });

  test('a successful terminal refresh removes posts no longer returned by the server', async ({ page }) => {
    const state = makeState();
    await installMocks(page, state);
    await page.goto('/@alpha');
    await expect(page.getByText('Alpha Profile post 0', { exact: true })).toBeVisible({ timeout: 15_000 });
    state.emptyPosts.add('alpha');
    await spaNavigate(page, '/');
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toHaveCount(0);
    await spaNavigate(page, '/@alpha');
    await expect(page.getByText('Alpha Profile post 0', { exact: true })).toHaveCount(0);
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toBeVisible();
  });

  test('a delayed profile page cannot append after switching from profile A to B', async ({ page }) => {
    const state = makeState();
    state.delayedMorePosts.add('alpha');
    await installMocks(page, state);
    await page.goto('/@alpha');
    const scroller = page.getByTestId('profile-scroll-container');
    await expect(page.getByText('Alpha Profile post 0', { exact: true })).toBeVisible({ timeout: 15_000 });
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
    await expect.poll(() => state.morePostsStarted.has('alpha')).toBe(true);
    await spaNavigate(page, '/@beta');
    await expect(page.getByText('Beta Profile post 0', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_300);
    await expect(page.getByText('Alpha Profile post 15', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Beta Profile post 0', { exact: true })).toBeVisible();
  });

  test('a delayed followers page cannot cross into a new profile target', async ({ page }) => {
    const state = makeState();
    await installMocks(page, state);
    await page.goto('/@alpha');
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Followers/ }).click();
    await expect(page.getByText('Alpha Follower', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect.poll(() => state.connectionMoreStarted.has('alpha')).toBe(true);
    await spaNavigate(page, '/@beta');
    await expect(page.locator('h2').filter({ hasText: /^Beta Profile$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Beta Follower', { exact: true })).toBeVisible();
    await page.waitForTimeout(1_300);
    await expect(page.getByText('Alpha Stale Follower', { exact: true })).toHaveCount(0);
  });

  test('session expiry immediately clears rendered profile and cached posts', async ({ page }) => {
    const state = makeState();
    await installMocks(page, state);
    await page.goto('/@alpha');
    await expect(page.getByText('Alpha Profile post 0', { exact: true })).toBeVisible({ timeout: 15_000 });
    state.forbidden.add('alpha');
    await page.evaluate(() => window.dispatchEvent(new Event('auth_expired')));
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toHaveCount(0);
    await expect(page.getByText('Alpha Profile post 0', { exact: true })).toHaveCount(0);
  });

  test('profile posts failure stays local and retry recovers without hiding metadata', async ({ page }) => {
    const state = makeState();
    state.failedPosts.add('alpha');
    await installMocks(page, state);
    await page.goto('/@alpha');
    await expect(page.locator('h2').filter({ hasText: /^Alpha Profile$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert')).toContainText('Failed to load posts.');
    state.failedPosts.delete('alpha');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Alpha Profile post 0', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('quiz result stays unknown until explicit progress arrives and preserves a real partial zero', async ({ page }) => {
    const state = makeState();
    const quizBase = {
      id: 'quiz-result', type: 'Quiz', status: 'PUBLISHED', title: 'Stable quiz result',
      content: 'Stable quiz result', createdAt: '2026-09-20T00:00:00.000Z', author: state.profiles.viewer,
      participants: 1, likes: 0, comments: 0, shares: 0, hasParticipated: true,
      questions: [
        { id: 'q1', text: 'First?', correctOptionId: 'q1-correct', options: [{ id: 'q1-correct', text: 'Correct' }, { id: 'q1-wrong', text: 'Wrong' }] },
        { id: 'q2', text: 'Second?', correctOptionId: 'q2-correct', options: [{ id: 'q2-correct', text: 'Correct' }, { id: 'q2-wrong', text: 'Wrong' }] }
      ],
      config: {}, resultsVisibility: 'Always'
    };
    state.feed = [{ ...quizBase, userProgress: { currentQuestionIndex: 0, answers: { q1: 'q1-wrong' }, followUpAnswers: {}, historyStack: [] } }];
    state.feedDelayMs = 900;
    await installMocks(page, state);
    await page.addInitScript((payload) => {
      localStorage.setItem('si_feed_cache:viewer', JSON.stringify([payload]));
    }, quizBase);
    await page.goto('/');
    await expect(page.getByTestId('quiz-result-loading')).toBeVisible();
    await expect(page.getByText('Good Effort!', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('quiz-result-loading')).toHaveCount(0);
    await expect(page.getByText('Good Effort!', { exact: true })).toBeVisible();
    const scorePanel = page.getByText('Correct', { exact: true }).locator('..');
    await expect(scorePanel.getByText('0', { exact: true })).toBeVisible();
    await expect(page.getByText('Questions', { exact: true }).locator('..').getByText('2', { exact: true })).toBeVisible();
  });

  test('RTL and reduced-motion profile loading smoke', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ar-JO', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const state = makeState();
    state.delayProfile.add('beta');
    await installMocks(page, state);
    await page.goto('/@beta');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: /Back|رجوع/i })).toBeVisible();
    const animation = await page.locator('.animate-pulse').first().evaluate(element => getComputedStyle(element).animationName);
    expect(animation).toBe('none');
  });
});
