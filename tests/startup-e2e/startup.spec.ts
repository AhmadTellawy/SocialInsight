import { test, expect, type Page, type Route } from '@playwright/test';

const post = {
  id: 'startup-public-post', title: 'Public startup fixture', type: 'Poll', status: 'PUBLISHED',
  author: { id: 'public-author', name: 'Public author', handle: 'public_author' },
  options: [{ id: 'a', text: 'Choice A', votes: 0 }, { id: 'b', text: 'Choice B', votes: 0 }],
  participants: 0, likes: 0, commentsCount: 0, targetAudience: 'Public', media: [],
};
const json = (route: Route, data: unknown, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(data),
});

async function setup(page: Page, language: string, options: {
  feed?: (route: Route) => Promise<void>;
  session?: (route: Route) => Promise<void>;
  availability?: (route: Route) => Promise<void>;
} = {}) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(language => localStorage.setItem('i18nextLng', language), language);
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4186') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/auth/session') return options.session?.(route) ?? json(route, { code: 'AUTH_REQUIRED' }, 401);
    if (url.pathname === '/api/posts') return options.feed?.(route) ?? json(route, { data: [post], nextCursor: null });
    if (url.pathname === '/api/pages/availability') return options.availability?.(route) ?? json(route, { available: false });
    if (/\/(suggested|groups|notifications)$/.test(url.pathname)) return json(route, []);
    // No browser request reaches a production API or creates data.
    return json(route, {});
  });
  return errors;
}

test('guest feed rejection reaches recovery and Retry loads content', async ({ page }, info) => {
  const language = info.project.name.startsWith('ar') ? 'ar' : 'en';
  let failed = true;
  const errors = await setup(page, language, { feed: route => failed
    ? json(route, { code: 'AUTH_REQUIRED' }, 401)
    : json(route, { data: [post], nextCursor: null }) });
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.screenshot({ path: info.outputPath('recoverable-feed-error.png') });
  failed = false;
  await page.getByRole('alert').getByRole('button').click();
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
  await page.screenshot({ path: info.outputPath('recovered-feed.png') });
  expect(errors).toEqual([]);
});

test('guest availability rejection cannot cancel the public feed', async ({ page }, info) => {
  const errors = await setup(page, info.project.name.startsWith('ar') ? 'ar' : 'en', {
    availability: async route => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await json(route, { code: 'AUTH_REQUIRED' }, 401);
    },
    feed: async route => {
      await new Promise(resolve => setTimeout(resolve, 600));
      await json(route, { data: [post], nextCursor: null });
    },
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
  expect(errors).toEqual([]);
});

test('slow public feed keeps guest navigation reachable', async ({ page }, info) => {
  const arabic = info.project.name.startsWith('ar');
  await setup(page, arabic ? 'ar' : 'en', { feed: async () => {} });
  await page.goto('/');
  await expect(page.getByRole('button', { name: arabic ? 'تسجيل الدخول' : 'Sign in', exact: true })).toBeVisible();
});

test('session outage shows bounded recovery and Retry rechecks the session', async ({ page }, info) => {
  let failed = true;
  await setup(page, info.project.name.startsWith('ar') ? 'ar' : 'en', {
    session: async route => { if (!failed) await json(route, { code: 'AUTH_REQUIRED' }, 401); },
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 23_000 });
  failed = false;
  await page.getByRole('alert').getByRole('button').click();
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
});

test('healthy guest opens the public feed without a recovery screen', async ({ page }, info) => {
  const errors = await setup(page, info.project.name.startsWith('ar') ? 'ar' : 'en');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('temporary feed failure retries once then displays posts', async ({ page }, info) => {
  let requests = 0;
  const errors = await setup(page, info.project.name.startsWith('ar') ? 'ar' : 'en', {
    feed: route => ++requests === 1 ? json(route, { error: 'Unavailable' }, 503) : json(route, { data: [post], nextCursor: null }),
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
});

test('expired authenticated viewer safely reloads the guest feed', async ({ page }, info) => {
  const language = info.project.name.startsWith('ar') ? 'ar' : 'en';
  let guestLoads = 0;
  const errors = await setup(page, language, {
    session: route => json(route, { user: { id: 'expired-user', name: 'Expired fixture', language } }),
    feed: route => {
      if (new URL(route.request().url()).searchParams.has('userId')) return json(route, { code: 'AUTH_REQUIRED' }, 401);
      guestLoads++;
      return json(route, { data: [post], nextCursor: null });
    },
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
  expect(guestLoads).toBe(1);
  await expect(page.getByText('Expired fixture', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('invalid session response exposes recovery without loading private content', async ({ page }, info) => {
  let feedLoads = 0;
  await setup(page, info.project.name.startsWith('ar') ? 'ar' : 'en', {
    session: route => json(route, { user: { name: 'Missing identity' } }),
    feed: async route => { feedLoads++; await json(route, { data: [post], nextCursor: null }); },
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(feedLoads).toBe(0);
});

test('session Retry retains OAuth callback recovery after URL cleanup', async ({ page }, info) => {
  let failed = true;
  const errors = await setup(page, info.project.name.startsWith('ar') ? 'ar' : 'en', {
    session: route => failed ? json(route, { error: 'Unavailable' }, 503) : json(route, { code: 'AUTH_REQUIRED' }, 401),
  });
  await page.goto('/?oauth_error=OAUTH_AUTHENTICATION_FAILED');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  failed = false;
  await page.getByRole('alert').getByRole('button').click();
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});
