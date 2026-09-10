import { devices, expect, test, type Page, type Route } from '@playwright/test';

test.setTimeout(60_000);

// Actual App and routed components; only the HTTP/native device boundaries are fixtures.
// Each Playwright context owns its localStorage, mock users and requests. No external writes.
async function fixture(page: Page, language: 'en' | 'ar' = 'en') {
  const profile = {
    id: 'closure-browser-owner', name: 'Closure browser owner', handle: 'closure_owner',
    email: 'closure-owner@example.invalid', bio: 'Synthetic browser fixture', avatar: '', avatarMedia: null,
    avatarMediaId: null, coverMedia: null, coverMediaId: null, birthday: '1995-04-01', country: 'Jordan',
    language, theme: 'light', updatedAt: '2026-09-08T00:00:00.000Z', isPrivate: false, groupPrivacy: 'Public',
    searchVisibility: true, allowSharing: true, profileLinks: [], groups: [], interests: [], type: 'Personal',
    demographics: { gender: '', ageGroup: '25-34', maritalStatus: '', educationLevel: '', employmentType: '', industry: '', employmentSector: '' },
    stats: { followers: 0, following: 0, posts: 2, responses: 0 }
  };
  const posts = [0, 1].map(index => ({
    id: `closure-share-${index}`, title: `Closure share fixture ${index}`, description: '', type: 'Poll', status: 'PUBLISHED',
    author: { id: profile.id, name: profile.name, handle: profile.handle, avatar: '' },
    options: [{ id: `closure-choice-${index}-a`, text: 'Fixture choice A', votes: 0 }, { id: `closure-choice-${index}-b`, text: 'Fixture choice B', votes: 0 }],
    demographics: [], pollChoiceType: 'single', resultsVisibility: 'Public', allowSharing: true,
    expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', participants: 0, likes: 0, commentsCount: 0
  }));
  const state = {
    profile, posts, verified: false, expired: false, failSave: '', logoutCalls: 0,
    profileWrites: [] as Record<string, any>[], aliases: [] as string[], sessionReads: 0,
    batches: [] as { expectedActorId: string; events: Record<string, any>[] }[], analyticsMode: 'offline' as 'offline' | 'ack'
  };
  await page.addInitScript(({ profile }) => {
    // Do not restore state again after reload/logout: that would conceal bootstrap bugs.
    if (!sessionStorage.getItem('closure-fixture-initialized')) {
      localStorage.setItem('si_user', JSON.stringify(profile));
      localStorage.setItem('i18nextLng', profile.language);
      sessionStorage.setItem('closure-fixture-initialized', 'true');
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as any).__copiedText = value; } } });
  }, { profile });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname, method = request.method();
    if (pathname === '/api/auth/session') {
      state.sessionReads++;
      return state.expired ? json(route, { code: 'AUTH_REQUIRED' }, 401) : json(route, { user: profile, csrfToken: 'closure-synthetic-csrf' });
    }
    if (pathname === '/api/auth/logout') { state.logoutCalls++; state.expired = true; return json(route, { success: true }); }
    if (pathname === '/api/users/me') return json(route, profile);
    if (pathname === '/api/auth/methods') return json(route, { hasPassword: true, emailVerified: true, providers: [], mfa: { enabled: false, available: true }, recentAuthUntil: state.verified ? '2099-01-01T00:00:00Z' : null });
    if (pathname === '/api/auth/reauthenticate') {
      if (request.postDataJSON().password !== 'FixturePass1!') return json(route, { code: 'INVALID_CREDENTIALS' }, 401);
      state.verified = true; return json(route, { success: true });
    }
    if (pathname === `/api/users/${profile.id}` && method === 'PUT') {
      const payload = request.postDataJSON(); state.profileWrites.push(payload);
      if (!state.verified && payload.handle !== profile.handle) return json(route, { code: 'REAUTHENTICATION_REQUIRED' }, 401);
      if (state.failSave) { const code = state.failSave; state.failSave = ''; return json(route, { code, error: code === 'PROFILE_UPDATE_CONFLICT' ? 'Profile changed elsewhere' : 'Unavailable handle' }, 409); }
      if (payload.expectedUpdatedAt !== profile.updatedAt) return json(route, { code: 'PROFILE_UPDATE_CONFLICT', error: 'Profile changed elsewhere' }, 409);
      if (payload.handle && payload.handle !== profile.handle) state.aliases.push(profile.handle);
      Object.assign(profile, payload, { updatedAt: '2026-09-08T00:00:01.000Z' });
      return json(route, profile);
    }
    if (pathname === `/api/users/${profile.id}`) return json(route, profile);
    if (pathname.startsWith('/api/users/handle/')) {
      const handle = decodeURIComponent(pathname.split('/').pop()!);
      return handle === profile.handle || state.aliases.includes(handle) ? json(route, profile) : json(route, { error: 'Not found' }, 404);
    }
    if (pathname === '/api/posts') return json(route, { data: posts, nextCursor: null });
    if (pathname.endsWith('/views') && method === 'POST') return json(route, { success: true });
    if (pathname === '/api/analytics/interactions/batch') {
      const payload = request.postDataJSON(); state.batches.push(payload);
      if (state.analyticsMode === 'offline') return route.abort('internetdisconnected');
      return json(route, { acceptedIds: payload.events.map((event: any) => event.id), rejected: [], retryableIds: [] });
    }
    if (method === 'GET') return json(route, []);
    throw new Error(`Unexpected fixture write: ${method} ${pathname}`);
  });
  return state;
}

async function queuedShares(page: Page) {
  return page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('si_pending_analytics_'))
    .flatMap(key => { const parsed = JSON.parse(localStorage.getItem(key)!); return Array.isArray(parsed) ? parsed : [parsed]; })
    .filter(event => event.event_type === 'SHARE_OR_COPY_LINK'));
}

async function openShare(page: Page, index = 1) {
  await page.goto('/');
  await expect(page.getByText(`Closure share fixture ${index}`, { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Share', exact: true }).nth(index).click();
  await expect(page.getByRole('button', { name: 'Copy Link', exact: true })).toBeVisible();
}

for (const language of ['en', 'ar'] as const) for (const width of [390, 1280]) {
  test.describe(`${language} ${width}`, () => {
  const device = devices[width === 390 ? 'Pixel 5' : 'Desktop Chrome'];
  test.use({ userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch, viewport: { width, height: 1000 } });
  test('editable handle preserves draft through reauthentication and updates stable profile identity', async ({ page }, info) => {
    const state = await fixture(page, language), ar = language === 'ar';
    await page.goto('/settings/profile/edit-profile');
    const handle = page.locator('#profile-fixed-handle'), save = page.getByRole('button', { name: ar ? 'حفظ' : 'Save', exact: true });
    await expect(handle).toBeEditable({ timeout: 20_000 });
    await expect(handle).toHaveAttribute('dir', 'ltr');
    await handle.fill('@New_CLosure');
    await save.click();
    const dialog = page.getByRole('dialog', { name: ar ? 'تأكيد هويتك' : 'Verify your identity' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: ar ? 'إلغاء' : 'Cancel', exact: true }).click();
    await expect(handle).toHaveValue('New_CLosure');
    expect(state.profile.handle).toBe('closure_owner');
    await save.click();
    await dialog.getByLabel(ar ? 'كلمة المرور الحالية' : 'Current password', { exact: true }).fill('wrong');
    await dialog.getByRole('button', { name: ar ? 'تحقق ومتابعة' : 'Verify and continue' }).click();
    await expect(dialog.getByRole('alert')).toContainText(ar ? 'غير صحيحة' : 'incorrect');
    await dialog.getByLabel(ar ? 'كلمة المرور الحالية' : 'Current password', { exact: true }).fill('FixturePass1!');
    await dialog.getByRole('button', { name: ar ? 'تحقق ومتابعة' : 'Verify and continue' }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    expect(state.profileWrites).toHaveLength(3);
    expect(state.profileWrites.every(payload => payload.handle === 'new_closure' && payload.expectedUpdatedAt === '2026-09-08T00:00:00.000Z')).toBe(true);
    expect(state.profile.id).toBe('closure-browser-owner');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('si_user')!).handle)).toBe('new_closure');
    // The old-handle URL goes through the App alias route and renders the current server identity.
    await page.goto('/@closure_owner');
    await expect(page.getByText('@new_closure', { exact: true }).first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`renamed-profile-${language}-${width}.png`) });
  });
  });
}

test('handle validation, unavailable name and stale version preserve the editor for correction', async ({ page }) => {
  const state = await fixture(page); state.verified = true;
  await page.goto('/settings/profile/edit-profile');
  const handle = page.locator('#profile-fixed-handle'), save = page.getByRole('button', { name: 'Save', exact: true });
  await handle.fill('bad handle'); await save.click();
  await expect(handle).toHaveAttribute('aria-invalid', 'true'); expect(state.profileWrites).toHaveLength(0);
  for (const code of ['HANDLE_RESERVED', 'HANDLE_UNAVAILABLE']) {
    state.failSave = code; await handle.fill(code === 'HANDLE_RESERVED' ? 'admin' : 'taken_name'); await save.click();
    await expect(page.getByRole('alert')).toContainText('unavailable'); await expect(handle).toHaveAttribute('aria-invalid', 'true');
  }
  state.failSave = 'PROFILE_UPDATE_CONFLICT'; await handle.fill('free_closure'); await save.click();
  await expect(page.getByRole('alert')).toContainText('changed'); await expect(handle).toHaveValue('free_closure');
  expect(state.profile.handle).toBe('closure_owner');
  await save.click(); await expect(page).toHaveURL(/\/settings\/profile$/); expect(state.profile.handle).toBe('free_closure');
});

test('actual App bootstrap retains offline event IDs on reload and removes only acknowledged events after recovery', async ({ page }) => {
  const state = await fixture(page);
  await openShare(page); await page.getByRole('button', { name: 'Copy Link', exact: true }).click();
  await expect.poll(async () => (await queuedShares(page)).length).toBe(1);
  const original = (await queuedShares(page))[0];
  expect(original).toMatchObject({ method: 'COPY_LINK', post_id: 'closure-share-1', source_surface: 'FEED', position_in_feed: 1 });
  await page.goto('/settings/profile'); await expect(page.getByRole('button', { name: 'Log Out', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Log Out', exact: true })).toBeVisible();
  expect(state.sessionReads).toBeGreaterThanOrEqual(3);
  expect((await queuedShares(page)).map(event => event.id)).toContain(original.id);
  state.analyticsMode = 'ack';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await queuedShares(page)).length).toBe(0);
  const sent = state.batches.filter(batch => batch.events.some(event => event.id === original.id));
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.every(batch => batch.expectedActorId === state.profile.id)).toBe(true);
});

test('confirmed App logout removes queued data and fences later online flushes', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await openShare(page); await page.getByRole('button', { name: 'Copy Link', exact: true }).click();
  await expect.poll(async () => (await queuedShares(page)).length).toBe(1);
  const id = (await queuedShares(page))[0].id;
  await page.goto('/settings/profile'); await page.getByRole('button', { name: 'Log Out', exact: true }).click();
  await page.getByRole('dialog', { name: 'Log out of your account?' }).getByRole('button', { name: 'Log Out', exact: true }).click();
  await expect.poll(() => state.logoutCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('si_user'))).toBe(null);
  await expect.poll(async () => (await queuedShares(page)).length).toBe(0);
  const count = state.batches.filter(batch => batch.events.some(event => event.id === id)).length;
  state.analyticsMode = 'ack'; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.clock.fastForward(10_020);
  // Queue has no active identity; the public browser event must not replay the old account.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('si_analytics_actor_v3')!).actor)).toBe(null);
  expect(state.batches.filter(batch => batch.events.some(event => event.id === id))).toHaveLength(count);
});

for (const outcome of ['success', 'cancel', 'fallback-cancel'] as const) {
  test(`real ShareSheet native ${outcome} records only successful FEED share with its position`, async ({ page }) => {
    test.setTimeout(60_000);
    await fixture(page);
    await page.addInitScript(outcome => {
      (window as any).__nativeShareCalls = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (payload: ShareData) => {
        (window as any).__nativeShareCalls.push({ url: payload.url, fileCount: payload.files?.length || 0 });
        if (outcome === 'cancel' || (outcome === 'fallback-cancel' && (window as any).__nativeShareCalls.length > 1)) throw new DOMException('Synthetic user cancellation', 'AbortError');
        if (outcome === 'fallback-cancel') throw new DOMException('Synthetic file share unsupported', 'NotSupportedError');
      } });
    }, outcome);
    await openShare(page);
    await page.getByRole('button', { name: /Share Outside/ }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__nativeShareCalls.length), { timeout: 40_000 }).toBe(outcome === 'fallback-cancel' ? 2 : 1);
    expect(await page.evaluate(() => (window as any).__nativeShareCalls.map((call: any) => call.fileCount))).toEqual(outcome === 'fallback-cancel' ? [1, 0] : [1]);
    if (outcome === 'success') {
      await expect.poll(async () => (await queuedShares(page)).length).toBe(1);
      expect((await queuedShares(page))[0]).toMatchObject({ method: 'NATIVE_SHARE', source_surface: 'FEED', position_in_feed: 1, post_id: 'closure-share-1' });
      await expect(page.getByRole('button', { name: 'Copy Link', exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByRole('button', { name: /Share Outside/ })).toBeEnabled();
      expect(await queuedShares(page)).toEqual([]);
    }
  });
}
