import { expect, test, type Page, type Route } from '@playwright/test';

type FixtureOptions = { language?: 'en' | 'ar'; theme?: 'light' | 'dark' | 'system' };
async function installFixture(page: Page, options: FixtureOptions = {}) {
  const profile = {
    id: 'settings-qa-owner', name: 'Settings QA owner', handle: 'settings_qa_owner',
    email: 'private-owner@example.invalid', bio: 'Private owner-only bio', avatar: '', avatarMedia: null, avatarMediaId: null, coverMedia: null, hasLegacyAvatar: false,
    birthday: '1995-04-01', country: 'Jordan', language: options.language || 'en', theme: options.theme || 'light',
    updatedAt: '2026-09-08T00:00:00.000Z', isPrivate: true, groupPrivacy: 'Off',
    searchVisibility: true, allowSharing: true, groupInvites: true, profileLinks: [],
    demographics: { gender: '', ageGroup: '25-34', maritalStatus: '', educationLevel: '', employmentType: '', industry: '', employmentSector: '' },
    stats: { followers: 0, following: 0, posts: 0, responses: 0 }
  };
  const state = { profile, verified: false, exportCalls: 0, mutations: [] as string[], visitorQueries: 0,
    sessionExpired: false, failFeed: false, feedCalls: 0, logoutCalls: 0,
    posts: [] as Record<string, unknown>[], votes: [] as Record<string, unknown>[], avatarWrites: [] as Record<string, unknown>[],
    blocked: [{ id: 'blocked-person', name: 'Blocked fixture person', handle: 'blocked_fixture', avatar: '' }],
    failUnblock: false, failVisitor: false };
  await page.addInitScript(({ profile }) => {
    localStorage.setItem('si_user', JSON.stringify(profile));
    localStorage.setItem('i18nextLng', profile.language);
  }, { profile });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
    const method = request.method();
    if (pathname === '/api/auth/session') return state.sessionExpired
      ? json(route, { code: 'AUTH_REQUIRED' }, 401)
      : json(route, { user: profile, csrfToken: 'synthetic-csrf-token' });
    if (pathname === '/api/auth/logout') { state.logoutCalls++; return json(route, { error: 'Synthetic logout outage' }, 503); }
    if (pathname === '/api/users/me') return json(route, profile);
    if (pathname === '/api/auth/methods') return json(route, { hasPassword: true, emailVerified: true, providers: [{ provider: 'google', linked: false }, { provider: 'facebook', linked: false }], mfa: { enabled: false, available: true }, recentAuthUntil: state.verified ? '2099-01-01T00:00:00Z' : null });
    if (pathname === '/api/auth/sessions') return json(route, { sessions: [
      { id: 'current-session', current: true, deviceLabel: 'Current browser', createdAt: '2026-09-01T00:00:00Z', lastUsedAt: null, expiresAt: '2099-01-01T00:00:00Z' },
      { id: 'second-session', current: false, deviceLabel: 'Other browser', createdAt: '2026-09-01T00:00:00Z', lastUsedAt: null, expiresAt: '2099-01-01T00:00:00Z' }
    ] });
    if (pathname === '/api/auth/reauthenticate') {
      if (request.postDataJSON().password !== 'FixturePass1!') return json(route, { code: 'INVALID_CREDENTIALS' }, 401);
      state.verified = true; return json(route, { success: true });
    }
    if (pathname === '/api/account/export') {
      state.exportCalls++;
      return state.verified ? json(route, { formatVersion: 1, profile: { name: profile.name }, posts: [] }) : json(route, { code: 'REAUTHENTICATION_REQUIRED' }, 401);
    }
    if (pathname === '/api/account' || pathname === '/api/account/deactivate' || pathname.startsWith('/api/auth/sessions/')) {
      if (pathname === '/api/account' && method === 'DELETE') state.sessionExpired = true;
      state.mutations.push(`${method} ${pathname}`); return json(route, { success: true });
    }
    if (pathname === `/api/users/${profile.id}` && url.searchParams.get('viewAs') === 'visitor') {
      state.visitorQueries++;
      if (state.failVisitor) return json(route, { error: 'Synthetic unavailable visitor DTO' }, 503);
      return json(route, { id: profile.id, name: 'Public visitor identity', handle: profile.handle, isPrivate: true, profileLinks: [] });
    }
    if (pathname === '/api/users/me/blocks') return json(route, { items: state.blocked, nextCursor: null });
    if (pathname === '/api/users/me/blocks/blocked-person' && method === 'DELETE') {
      if (state.failUnblock) { state.failUnblock = false; return json(route, { error: 'Synthetic temporary error' }, 503); }
      state.mutations.push('unblock'); state.blocked = []; return route.fulfill({ status: 204 });
    }
    if (pathname === '/api/posts') { state.feedCalls++; return state.failFeed ? json(route, { error: 'Synthetic feed failure' }, 503) : json(route, { data: state.posts, nextCursor: null }); }
    if (pathname === '/api/posts/canonical-demographics-poll/vote' && method === 'POST') {
      state.votes.push(request.postDataJSON()); return json(route, { success: true });
    }
    if (pathname === '/api/analytics/interactions/batch' && method === 'POST') return route.fulfill({ status: 204 });
    if (pathname === `/api/users/${profile.id}` && method === 'PUT') {
      const payload = request.postDataJSON();
      // This fixture supports exactly the direct avatar removal contract.
      if (Object.keys(payload).sort().join(',') !== 'avatarMediaId,expectedUpdatedAt' || payload.avatarMediaId !== null || payload.expectedUpdatedAt !== profile.updatedAt) return json(route, { code: 'PROFILE_UPDATE_INVALID' }, 400);
      state.avatarWrites.push(payload); profile.hasLegacyAvatar = false; profile.avatar = ''; profile.avatarMediaId = null;
      profile.updatedAt = '2026-09-08T00:00:01.000Z'; return json(route, profile);
    }
    if (pathname === `/api/users/${profile.id}`) return json(route, profile);
    if (method === 'GET') return json(route, []);
    throw new Error(`Unexpected fixture write: ${method} ${pathname}`);
  });
  return state;
}

test('protected export cancellation makes no download; retry verifies identity and resumes exactly once', async ({ page }) => {
  const state = await installFixture(page);
  await page.goto('/settings/profile/data');
  const download = page.getByRole('button', { name: 'Download information', exact: true });
  await download.click();
  let dialog = page.getByRole('dialog', { name: 'Verify your identity' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.exportCalls).toBe(1); expect(state.verified).toBe(false);
  await expect(download).toBeEnabled();

  await download.click();
  dialog = page.getByRole('dialog', { name: 'Verify your identity' });
  await dialog.getByLabel('Current password', { exact: true }).fill('wrong');
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(dialog.getByRole('alert')).toContainText('password is incorrect');
  expect(state.exportCalls).toBe(2);
  await dialog.getByLabel('Current password', { exact: true }).fill('FixturePass1!');
  const finishedDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  expect((await finishedDownload).suggestedFilename()).toBe('opiniup-account.json');
  await expect(page.getByRole('status')).toContainText('export is ready');
  expect(state.exportCalls).toBe(3); expect(state.mutations).toEqual([]);
});

test('deletion confirmation supports keyboard focus trapping and Escape without invoking a destructive endpoint', async ({ page }) => {
  const state = await installFixture(page);
  await page.goto('/settings/profile/data');
  const trigger = page.getByRole('button', { name: 'Delete account permanently' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm permanent deletion' });
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  const input = dialog.getByLabel('Type DELETE', { exact: true });
  await input.fill('delete');
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(state.mutations).toEqual([]);
});

test('visitor preview never falls back to owner fields; blocked-list retry removes only the chosen account', async ({ page }) => {
  const state = await installFixture(page); state.failVisitor = true;
  await page.goto('/settings/profile/view-as');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Private owner-only bio')).toHaveCount(0);
  const queriesBeforeRetry = state.visitorQueries;
  state.failVisitor = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Public visitor identity' })).toBeVisible();
  await expect(page.getByText('private-owner@example.invalid')).toHaveCount(0);
  expect(state.visitorQueries).toBe(queriesBeforeRetry + 1);
  await page.goto('/settings/profile/blocked');
  state.failUnblock = true;
  await page.getByRole('button', { name: 'Unblock', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not unblock');
  await expect(page.getByText('Blocked fixture person')).toBeVisible();
  await page.getByRole('button', { name: 'Unblock', exact: true }).click();
  await expect(page.getByText('No blocked accounts.', { exact: true })).toBeVisible();
  expect(state.mutations).toEqual(['unblock']);
});

test('dirty demographics trigger a real native beforeunload dialog and dismiss preserves the selected draft', async ({ page }) => {
  await installFixture(page);
  await page.goto('/settings/profile/demographics');
  await page.getByRole('button', { name: 'Gender Not specified', exact: true }).click();
  await page.getByRole('radio', { name: 'Female', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  const native = page.waitForEvent('dialog');
  // runBeforeUnload does not wait for a navigation that the user cancels.
  const closing = page.close({ runBeforeUnload: true });
  const dialog = await native; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); await closing;
  expect(page.isClosed()).toBe(false);
  await expect(page.getByRole('button', { name: 'Gender Female', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  // Leave through the explicit discard path so teardown cannot conceal another prompt.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
});

test('an expired cookie and failed guest feed never render persisted private feed content, even briefly', async ({ page, context, baseURL }) => {
  const state = await installFixture(page); state.sessionExpired = true; state.failFeed = true;
  const marker = 'PRIVATE_CACHED_SURVEY_MUST_NEVER_RENDER';
  await context.addCookies([{ name: 'si_session', value: 'synthetic-expired-cookie', url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
  await page.addInitScript(({ profile, marker }) => {
    const cached = [{ id: 'cached-private-post', title: marker, description: marker, type: 'POLL', status: 'PUBLISHED', author: { id: profile.id, name: profile.name, handle: profile.handle }, questions: [], options: [], likesCount: 0, commentsCount: 0, responseCount: 0, createdAt: '2026-09-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }];
    localStorage.setItem(`si_feed_cache:${profile.id}`, JSON.stringify(cached));
    localStorage.setItem('si_feed_cache', JSON.stringify(cached));
    (window as any).__privateCacheWasRendered = false;
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.textContent?.includes(marker)) || record.type === 'characterData' && record.target.textContent?.includes(marker))) (window as any).__privateCacheWasRendered = true;
    }).observe(document, { childList: true, characterData: true, subtree: true });
  }, { profile: state.profile, marker });
  await page.goto('/');
  await expect.poll(() => state.feedCalls).toBeGreaterThanOrEqual(2);
  await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__privateCacheWasRendered)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('si_user'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('si_feed_cache:settings-qa-owner'))).toBeNull();
});

test('successful deletion enters the guest state without depending on another logout request', async ({ page }) => {
  const state = await installFixture(page);
  await page.goto('/settings/profile/data');
  await page.getByRole('button', { name: 'Delete account permanently' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm permanent deletion' });
  await dialog.getByLabel('Type DELETE', { exact: true }).fill('DELETE');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/(?:login)?$/);
  await expect(page.getByRole('heading', { name: 'Your data and account' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('si_user'))).toBeNull();
  expect(state.mutations).toEqual(['DELETE /api/account']);
  expect(state.logoutCalls).toBe(0);
});

test('voting does not ask again for education, employment or sector already saved using canonical server fields', async ({ page }) => {
  const state = await installFixture(page);
  Object.assign(state.profile.demographics, { educationLevel: 'Bachelor’s Degree', employmentType: 'Employed', employmentSector: 'Services' });
  state.posts = [{
    id: 'canonical-demographics-poll', title: 'Canonical demographic fixture poll', description: '', type: 'Poll', status: 'PUBLISHED',
    author: { id: 'other-poll-owner', name: 'Poll fixture author', handle: 'poll_fixture_author', avatar: '' },
    options: [{ id: 'canonical-choice-a', text: 'Fixture choice A', votes: 0 }, { id: 'canonical-choice-b', text: 'Fixture choice B', votes: 0 }],
    demographics: ['education', 'employment', 'sector'], pollChoiceType: 'single', resultsVisibility: 'Public',
    expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', participants: 0, likes: 0, commentsCount: 0
  }];
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByText('Canonical demographic fixture poll', { exact: true })).toBeVisible();
  await page.getByText('Fixture choice A', { exact: true }).click();
  await expect.poll(() => state.votes.length).toBe(1);
  expect(state.votes[0].optionIds).toEqual(['canonical-choice-a']);
  // The existing demographic prompt is deliberately delayed by 800ms.
  await page.clock.runFor(1200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const question of ['What is your highest level of education?', 'What is your current employment status?', 'What is your employment sector?']) await expect(page.getByText(question, { exact: true })).toHaveCount(0);
});

test('private legacy avatar can be removed directly using the owner-only presence flag without exposing its URL', async ({ page }) => {
  const state = await installFixture(page); state.profile.hasLegacyAvatar = true;
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Edit profile photo', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit profile photo', exact: true });
  await expect(editor.getByRole('status')).toContainText('existing photo cannot be opened');
  await expect(editor.getByRole('button', { name: 'Replace photo', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await editor.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect.poll(() => state.profile.hasLegacyAvatar).toBe(false);
  await expect(editor).toHaveCount(0);
  expect(state.avatarWrites).toEqual([{ avatarMediaId: null, expectedUpdatedAt: '2026-09-08T00:00:00.000Z' }]);
  expect(state.profile.avatar).toBe('');
  await expect(page).not.toHaveURL(/edit-profile/);
});

// Every width/theme pair occurs once; both languages occur with every width and theme.
const matrix = [
  [320, 'light', 'en'], [320, 'dark', 'ar'], [320, 'system', 'en'],
  [390, 'light', 'ar'], [390, 'dark', 'en'], [390, 'system', 'ar'],
  [1280, 'light', 'en'], [1280, 'dark', 'ar'], [1280, 'system', 'en']
] as const;
for (const [width, theme, language] of matrix) {
  test(`security layout and modal ${language} ${width}px ${theme}`, async ({ page }, testInfo) => {
    const state = await installFixture(page, { language, theme });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/settings/profile/security');
    const ar = language === 'ar';
    await expect(page.getByRole('heading', { name: ar ? 'كلمة المرور والأمان' : 'Password and security', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'system' ? 'dark' : theme);
    await expect(page.locator('main')).toHaveCSS('direction', ar ? 'rtl' : 'ltr');
    const overflow = await page.locator('main').evaluate(element => element.scrollWidth > element.clientWidth + 1);
    expect(overflow).toBe(false);
    const button = page.getByRole('button', { name: ar ? 'تسجيل خروج الأجهزة الأخرى' : 'Sign out other devices', exact: true });
    await button.scrollIntoViewIfNeeded();
    await button.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: ar ? 'تأكيد تسجيل الخروج' : 'Confirm sign-out' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`security-${language}-${width}-${theme}.png`) });
    await dialog.getByRole('button', { name: ar ? 'إلغاء' : 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0); expect(state.mutations).toEqual([]);
    if (theme === 'system') {
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    }
  });
}
