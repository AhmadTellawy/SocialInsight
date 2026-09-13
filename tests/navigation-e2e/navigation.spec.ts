import { test, expect, back, profilePath, group, post } from './fixtures';

test('profile settings return once to profile then home, with browser Forward intact', async ({ page, boot, word }) => {
  await boot();
  await page.locator('header button').last().click();
  await expect(page).toHaveURL(profilePath);
  await page.getByRole('button', { name: word('Settings'), exact: true }).click();
  await expect(page).toHaveURL('/settings/profile');
  await back(page);
  await expect(page).toHaveURL(profilePath);
  await back(page);
  await expect(page).toHaveURL('/');
  await page.goForward();
  await expect(page).toHaveURL(profilePath);
  await page.goForward();
  await expect(page).toHaveURL('/settings/profile');
});

const settings = [
  ['edit-profile', 'Edit Profile'], ['demographics', 'Demographic Info'], ['notifications-detailed', 'Notification Settings'],
  ['language', 'Language'], ['account-privacy', 'Account privacy'], ['group-privacy', 'Show my groups on profile'],
] as const;

for (const [slug, label] of settings) {
  test(`settings ${slug}: UI navigation, reload, Back and Forward preserve parent`, async ({ page, boot, word }) => {
    await boot('/settings/profile');
    await page.getByRole('button', { name: new RegExp(word(label), 'i') }).first().click();
    await expect(page).toHaveURL(`/settings/profile/${slug}`);
    await expect(page.locator('button').filter({ has: page.locator('svg.lucide-arrow-left') }).first()).toBeVisible();
    await page.reload();
    await expect(page.locator('button').filter({ has: page.locator('svg.lucide-arrow-left') }).first()).toBeVisible();
    await back(page);
    await expect(page).toHaveURL('/settings/profile');
    await page.goForward();
    await expect(page).toHaveURL(`/settings/profile/${slug}`);
  });
  test(`direct settings ${slug} back uses known parent`, async ({ page, boot }) => {
    await boot(`/settings/profile/${slug}`);
    await expect(page.locator('button').filter({ has: page.locator('svg.lucide-arrow-left') }).first()).toBeVisible();
    await back(page);
    await expect(page).toHaveURL('/settings/profile');
    await back(page);
    await expect(page).toHaveURL(profilePath);
    await back(page);
    await expect(page).toHaveURL('/');
  });
}

test('profile links nested return preserves editor and does not duplicate it', async ({ page, boot, word }) => {
  await boot('/settings/profile');
  await page.getByRole('button', { name: new RegExp(word('Edit Profile')) }).first().click();
  await page.locator('button').filter({ has: page.locator('svg.lucide-link-2') }).click();
  await expect(page).toHaveURL('/settings/profile/links');
  await back(page);
  await expect(page).toHaveURL('/settings/profile/edit-profile');
  await back(page);
  await expect(page).toHaveURL('/settings/profile');
  await page.goForward();
  await expect(page).toHaveURL('/settings/profile/edit-profile');
  await page.goForward();
  await expect(page).toHaveURL('/settings/profile/links');
});

for (const [tab, label] of [['reposts', 'Reposts'], ['groups', 'Groups'], ['drafts', 'Drafts'], ['saved', 'Saved']] as const) {
  test(`profile ${tab} tab survives reload and browser history`, async ({ page, boot, word }) => {
    await boot(profilePath);
    const tabButton = page.getByRole('button', { name: word(label), exact: true });
    await tabButton.click();
    await expect(page).toHaveURL(`${profilePath}?tab=${tab}`);
    await expect(tabButton).toHaveClass(/text-blue-600/);
    await page.reload();
    await expect(tabButton).toHaveClass(/text-blue-600/);
    await page.goBack();
    await expect(page).toHaveURL(profilePath);
    await expect(page.getByRole('button', { name: word('Posts'), exact: true })).toHaveClass(/text-blue-600/);
    await page.goForward();
    await expect(tabButton).toHaveClass(/text-blue-600/);
  });
}

test('profile insights have a reloadable URL and return to the selected tab', async ({ page, boot }) => {
  await boot(`${profilePath}?tab=reposts`);
  await page.locator('button').filter({ has: page.locator('svg.lucide-trending-up') }).first().click();
  await expect(page).toHaveURL(`${profilePath}?tab=reposts&view=analysis`);
  await expect(page.getByRole('heading', { name: 'Global Insights' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Global Insights' })).toBeVisible();
  await back(page);
  await expect(page).toHaveURL(`${profilePath}?tab=reposts`);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Global Insights' })).toBeVisible();
});

test('post analysis URL survives reload and Back returns to post before feed', async ({ page, boot }) => {
  await boot();
  await page.getByText(post.title, { exact: true }).first().click();
  await expect(page).toHaveURL(`/post/${post.id}`);
  await page.getByRole('button', { name: 'Analysis', exact: true }).first().click();
  await expect(page).toHaveURL(`/post/${post.id}?tab=analysis`);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Analysis', exact: true }).first()).toHaveClass(/text-blue-600/);
  await back(page);
  await expect(page).toHaveURL(`/post/${post.id}`);
  await back(page);
  await expect(page).toHaveURL('/');
  await page.goForward();
  await page.goForward();
  await expect(page.getByRole('button', { name: 'Analysis', exact: true }).first()).toHaveClass(/text-blue-600/);
});

test('group tabs, settings and share use canonical paths without duplicate history', async ({ page, boot }) => {
  await boot(`/group/${group.id}`);
  await expect(page.getByRole('heading', { name: group.name })).toBeVisible();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(`/group/${group.id}?tab=about`);
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await expect(page).toHaveURL(`/group/${group.id}?tab=members`);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Members', exact: true })).toHaveClass(/text-blue-600/);
  await page.locator('button').filter({ has: page.locator('svg.lucide-share-2') }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copiedNavigationUrl)).toBe(new URL(`/group/${group.id}`, page.url()).href);
  await page.locator('button').filter({ has: page.locator('svg.lucide-settings') }).click();
  await expect(page).toHaveURL(`/group/${group.id}/settings`);
  await back(page);
  await expect(page).toHaveURL(`/group/${group.id}?tab=members`);
  await page.goBack();
  await expect(page).toHaveURL(`/group/${group.id}?tab=about`);
  await page.goBack();
  await expect(page).toHaveURL(`/group/${group.id}`);
});

for (const [input, output] of [
  ['/profile', profilePath], ['/groups/navigation-group', '/group/navigation-group'],
  ['/groups/navigation-group/settings', '/group/navigation-group/settings'],
] as const) {
  test(`direct URL ${input} canonicalizes to a valid rendered screen`, async ({ page, boot }) => {
    await boot(input);
    await expect(page).toHaveURL(output);
    await expect(page.locator('#root')).toContainText(output === '/' ? 'Navigation fixture poll' : output.startsWith('/group/') ? 'Group' : output.startsWith('/settings/') ? 'Gender' : 'Navigation Fixture');
    await expect(page.locator('#root')).not.toHaveText('');
    await page.reload();
    await expect(page).toHaveURL(output);
  });
}

for (const route of ['/settings/profile/no-such-page', '/settings/profile/username', '/settings/profile/edit-profile/extra', '/post/%E0%A4%A', '/group', '/not-a-route']) {
  test(`invalid URL ${route} renders not-found and offers safe Back`, async ({ page, boot, word, state }) => {
    await boot(route);
    await expect(page).toHaveURL(route);
    await expect(page.locator('h1')).toHaveText(word('navigation.notFound') === 'navigation.notFound' ? 'Page not found' : word('navigation.notFound'));
    await expect(page.getByTestId('survey-card')).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(route);
    await page.getByRole('button', { name: /Back|رجوع|العودة/ }).click();
    await expect(page).toHaveURL('/');
    expect(state.calls.some(call => call.includes('%E0%A4%A'))).toBe(false);
  });
}

test('direct post and group settings return inside app even with external history', async ({ page, boot }) => {
  await page.goto('about:blank');
  await boot(`/group/${group.id}/settings`);
  await expect(page.getByText('Group Settings', { exact: true })).toBeVisible();
  await back(page);
  await expect(page).toHaveURL(`/group/${group.id}`);
  await back(page);
  await expect(page).toHaveURL('/');
});

test('repeated active profile tab does not add a history entry', async ({ page, boot, word }) => {
  await boot(profilePath);
  const saved = page.getByRole('button', { name: word('Saved'), exact: true });
  await saved.click();
  await expect(page).toHaveURL(`${profilePath}?tab=saved`);
  const length = await page.evaluate(() => history.length);
  await saved.click();
  await saved.click();
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack();
  await expect(page).toHaveURL(profilePath);
});

test('delayed profile response cannot reopen profile after browser Back', async ({ page, boot, state }) => {
  let release!: () => void;
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  state.holdProfile = new Promise<void>(resolve => { release = resolve; });
  state.profileRequested = requested;
  try {
    await boot();
    await page.locator('header button').last().click();
    await pending;
    await page.goBack();
    await expect(page).toHaveURL('/');
    release();
    await expect(page.getByText(post.title, { exact: true }).first()).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    await expect(page).toHaveURL('/');
  } finally { release(); }
});

test('privacy reached from demographics returns to its real origin', async ({ page, boot }) => {
  await boot('/settings/profile/demographics');
  await page.locator('button').filter({ hasText: /Privacy Policy|سياسة الخصوصية/ }).click();
  await expect(page).toHaveURL('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await back(page);
  await expect(page).toHaveURL('/settings/profile/demographics');
  await page.goForward();
  await expect(page).toHaveURL('/privacy');
});

test('direct post app Back replaces with home, keeping external history out of the app', async ({ page, boot }) => {
  await boot(`/post/${post.id}`);
  await expect(page.getByText(post.title, { exact: true }).first()).toBeVisible();
  await back(page);
  await expect(page).toHaveURL('/');
  await expect(page.locator('header')).toBeVisible();
});

test('direct post analysis Back falls back to its post before home', async ({ page, boot }) => {
  await boot(`/post/${post.id}?tab=analysis`);
  await expect(page.getByRole('button', { name: 'Analysis', exact: true }).first()).toHaveClass(/text-blue-600/);
  await back(page);
  await expect(page).toHaveURL(`/post/${post.id}`);
  await expect(page.getByText(post.title, { exact: true }).first()).toBeVisible();
  await back(page);
  await expect(page).toHaveURL('/');
});

test('direct profile insights Back retains the requested profile tab', async ({ page, boot, word }) => {
  await boot(`${profilePath}?tab=reposts&view=analysis`);
  await expect(page.getByRole('heading', { name: 'Global Insights' })).toBeVisible();
  await back(page);
  await expect(page).toHaveURL(`${profilePath}?tab=reposts`);
  await expect(page.getByRole('button', { name: word('Reposts'), exact: true })).toHaveClass(/text-blue-600/);
});

test('search term and filter survive reload and Back restores previous filter', async ({ page, boot, word }) => {
  await boot('/search');
  await page.getByRole('textbox').fill('navigation');
  await expect(page).toHaveURL('/search?q=navigation');
  await page.getByRole('button', { name: word('Groups'), exact: true }).click();
  await expect(page).toHaveURL('/search?q=navigation&filter=Groups');
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('navigation');
  await expect(page.getByRole('button', { name: word('Groups'), exact: true })).toHaveClass(/bg-gray-900/);
  await page.goBack();
  await expect(page).toHaveURL('/search?q=navigation');
});

for (const type of ['Poll', 'Survey', 'Quiz', 'Challenge']) {
  test(`group ${type} creator preserves its group URL on reload and closes to group`, async ({ page, boot }) => {
    await boot(`/group/${group.id}`);
    await page.getByRole('button', { name: type, exact: true }).click();
    await expect(page).toHaveURL(`/create/${type.toLowerCase()}?group=${group.id}`);
    await expect(page.getByRole('heading', { name: `New ${type}`, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: `New ${type}`, exact: true })).toBeVisible();
    await expect(page).toHaveURL(`/create/${type.toLowerCase()}?group=${group.id}`);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page).toHaveURL(`/group/${group.id}`);
    await expect(page.getByRole('heading', { name: group.name, exact: true })).toBeVisible();
  });
}



