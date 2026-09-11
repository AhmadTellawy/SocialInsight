import { test, expect, devices, type Page, type Route } from '@playwright/test';

type RequestBody = { initialize?: boolean; expectedActorId?: string | null; source?: string; deviceType?: string };
type Call = { body: RequestBody; at: number; route: Route };
const fixtureUrl = '/tests/profile-e2e/view-fixture/index.html';
const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(page: Page, actor: string | null = null, producer = '') {
  const calls: Call[] = [];
  let handler: (call: Call) => Promise<void> = async ({ route, body }) => reply(route,
    body.initialize ? { initialized: true } : { recorded: true, viewCount: 8, uniqueViewCount: 4 });
  const unexpected: string[] = [];
  const post = { id: 'producer-post', type: 'Poll', title: 'Producer view fixture', description: 'Synthetic fixture',
    author: { id: 'fixture-author', name: 'Fixture author', handle: 'fixture_author' }, status: 'Published',
    audience: 'Global', visibility: 'Public', groupId: 'fixture-group', allowSharing: true,
    resultsVisibility: 'Public', questions: [{ id: 'fixture-question', text: 'Choose', type: 'SingleChoice', options: [{ id: 'fixture-option', text: 'Option', votes: 0 }] }],
    participants: 0, likes: 0, commentsCount: 0, viewCount: 7, createdAt: '2026-09-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' };
  await page.addInitScript(actor => {
    if (actor) sessionStorage.setItem('si_auth_identity', actor);
    localStorage.setItem('i18nextLng', 'en');
  }, actor);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { unexpected.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/views')) {
      const call = { body: route.request().postDataJSON(), at: Date.now(), route };
      calls.push(call); return handler(call);
    }
    if (url.pathname.includes('/trends')) return reply(route, [post]);
    if (url.pathname.endsWith('/posts')) return reply(route, { data: [post], nextCursor: null, hasMore: false });
    if (url.pathname.endsWith('/stats')) return reply(route, { totalPosts: 1, totalMembers: 2 });
    if (url.pathname.includes('/membership')) return reply(route, { status: 'JOINED', role: 'MEMBER' });
    if (route.request().method() === 'GET') return reply(route, []);
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    return reply(route, { error: 'Unexpected fixture write' }, 500);
  });
  await page.goto(fixtureUrl + (producer ? `?producer=${producer}` : ''));
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  return { calls, views: () => calls.filter(call => !call.body.initialize), unexpected,
    respondWith(value: typeof handler) { handler = value; } };
}

async function cards(page: Page, values = [{ id: 'fixture-post', source: 'FEED', top: 200, count: 7 }]) {
  await page.evaluate(values => window.viewFixture.cards(values), values);
  await expect(page.getByTestId('card-0')).toHaveAttribute('data-ratio', /.+/);
}
async function position(page: Page, top: number, expectedRatio: number) {
  await page.evaluate(top => window.viewFixture.position(top), top);
  await expect.poll(async () => Number(await page.getByTestId('card-0').getAttribute('data-ratio'))).toBeCloseTo(expectedRatio, 1);
}
async function switchActor(page: Page, actor: string) {
  await page.evaluate(actor => window.viewFixture.actor(actor), actor);
  await expect(page.getByTestId('card-0')).toHaveAttribute('data-actor', actor);
}
async function settle() { await new Promise(resolve => setTimeout(resolve, 100)); }

test.describe('real view tracking hook', () => {
  test.use({ viewport: { width: 390, height: 900 } });
  test.setTimeout(45_000);

  test('real intersection and uninterrupted foreground dwell gate guest bootstrap and view', async ({ page }) => {
    const state = await setup(page);
    await cards(page, [{ id: 'fixture-post', source: 'FEED', top: 1100, count: 7 }]);
    await page.waitForTimeout(2200); expect(state.calls).toHaveLength(0);
    await position(page, 820, 0.4);
    await page.waitForTimeout(2200); expect(state.calls).toHaveLength(0);
    await position(page, 200, 1);
    await page.waitForTimeout(900); expect(state.calls).toHaveLength(0);
    await position(page, 1100, 0);
    await page.waitForTimeout(1400); expect(state.calls).toHaveLength(0);
    await position(page, 200, 1);
    await page.waitForTimeout(1000); expect(state.calls).toHaveLength(0);
    await expect(page.getByTestId('count-0')).toHaveText('8', { timeout: 4000 });
    expect(state.calls.map(call => call.body)).toEqual([
      { initialize: true, expectedActorId: null }, { source: 'FEED', deviceType: 'WEB', expectedActorId: null },
    ]);
    await position(page, 1100, 0); await position(page, 200, 1);
    await page.waitForTimeout(2300); expect(state.calls).toHaveLength(2);
    expect(state.unexpected).toEqual([]);
  });

  test('visibilitychange resets dwell and hidden time contributes no view', async ({ page }) => {
    const state = await setup(page, 'actor-a'); await cards(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(2300); expect(state.calls).toHaveLength(0);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1000); expect(state.calls).toHaveLength(0);
    await expect(page.getByTestId('count-0')).toHaveText('8', { timeout: 4000 });
    expect(state.views()).toHaveLength(1);
  });

  test('lost response retries after fifteen seconds and accepts server deduplication', async ({ page }) => {
    const state = await setup(page, 'actor-a');
    state.respondWith(async ({ route }) => state.views().length === 1 ? route.abort('connectionreset') : reply(route, { recorded: false, viewCount: 13 }));
    await cards(page); await expect.poll(() => state.views().length).toBe(1);
    await page.waitForTimeout(12_000); expect(state.views()).toHaveLength(1);
    await expect(page.getByTestId('count-0')).toHaveText('13', { timeout: 7000 });
    expect(state.views()).toHaveLength(2);
    expect(state.views()[1].at - state.views()[0].at).toBeGreaterThanOrEqual(14_800);
  });

  test('online recovery retries transient failure while duplicate cards share the pending request', async ({ page }) => {
    const state = await setup(page, 'actor-a'); let held: Route | undefined;
    state.respondWith(async ({ route }) => { if (state.views().length === 1) await reply(route, { error: 'Temporary' }, 503); else held = route; });
    await cards(page); await expect.poll(() => state.views().length).toBe(1); await settle();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => state.views().length, { timeout: 4000 }).toBe(2);
    await cards(page, [0, 1].map(index => ({ id: 'fixture-post', source: 'FEED', top: 200 + index * 250, count: 7 })));
    await page.waitForTimeout(2400); expect(state.views()).toHaveLength(2);
    await reply(held!, { recorded: false, viewCount: 12 });
    await expect(page.getByTestId('count-0')).toHaveText('12');
    await page.waitForTimeout(2300); expect(state.views()).toHaveLength(2);
  });

  test('permanent rejection stops visibility and online retry storms', async ({ page }) => {
    const state = await setup(page, 'actor-a');
    state.respondWith(async ({ route }) => reply(route, { error: 'Unavailable', code: 'VIEW_TARGET_UNAVAILABLE' }, 403));
    await cards(page); await expect.poll(() => state.views().length).toBe(1); await settle();
    for (let index = 0; index < 3; index++) await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await position(page, 1100, 0); await position(page, 200, 1);
    await page.waitForTimeout(2500); expect(state.views()).toHaveLength(1);
    await expect(page.getByTestId('count-0')).toHaveText('7');
  });

  test('account switch during guest initialization fences the old view and lets the new actor record', async ({ page }) => {
    const state = await setup(page); let initialize: Route | undefined; let newView: Route | undefined;
    state.respondWith(async ({ route, body }) => { if (body.initialize) initialize = route; else newView = route; });
    await cards(page); await expect.poll(() => state.calls.length).toBe(1);
    await switchActor(page, 'actor-b'); await reply(initialize!, { initialized: true });
    await expect.poll(() => state.views().length, { timeout: 4000 }).toBe(1);
    expect(state.views()[0].body.expectedActorId).toBe('actor-b');
    await expect(page.getByTestId('count-0')).toHaveText('7');
    await reply(newView!, { recorded: true, viewCount: 10 });
    await expect(page.getByTestId('count-0')).toHaveText('10');
    expect(state.calls).toHaveLength(2);
  });

  test('account switch during a pending view does not attribute the old response to the new actor', async ({ page }) => {
    const state = await setup(page, 'actor-a'); const held: Route[] = [];
    state.respondWith(async ({ route }) => { held.push(route); });
    await cards(page); await expect.poll(() => state.views().length).toBe(1);
    await switchActor(page, 'actor-b'); await reply(held[0], { recorded: true, viewCount: 99 });
    await expect(page.getByTestId('count-0')).toHaveText('7');
    await expect.poll(() => state.views().length, { timeout: 4000 }).toBe(2);
    expect(state.views().map(call => call.body.expectedActorId)).toEqual(['actor-a', 'actor-b']);
    await reply(held[1], { recorded: true, viewCount: 11 });
    await expect(page.getByTestId('count-0')).toHaveText('11');
  });

  test('share capture emits neither bootstrap nor view', async ({ page }) => {
    const state = await setup(page);
    await cards(page, [{ id: 'fixture-post', source: 'SHARE_CAPTURE', top: 200, count: 7 }]);
    await page.waitForTimeout(2500); await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(2300); expect(state.calls).toHaveLength(0);
    await expect(page.getByTestId('count-0')).toHaveText('7');
  });
});

test.describe('actual source producers to the real hook', () => {
  test.use({ userAgent: devices['Desktop Chrome'].userAgent, deviceScaleFactor: 1, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 900 } });
  for (const producer of ['trending', 'group']) test(`${producer} click preserves its source label`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const state = await setup(page, 'actor-a', producer);
    const title = page.getByText('Producer view fixture', { exact: true }).first();
    await expect(title).toBeVisible();
    await title.click();
    await expect(page.getByTestId('count-0')).toHaveText('8');
    expect(state.views().some(call => call.body.source === producer.toUpperCase())).toBe(true);
    expect(state.unexpected).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
