import { test, expect, back, group, otherProfile, privateProfile } from './fixtures';

for (const tab of ['saved', 'drafts']) {
  test(`another profile ${tab} URL never requests or renders the current user's collection`, async ({ page, boot, state }) => {
    await boot(`/@${otherProfile.handle}?tab=${tab}`);
    await expect(page.getByRole('heading', { name: otherProfile.name, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Saved|Drafts|المحفوظات|المسودات)$/ })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Global Insights');
    expect(state.calls.filter(call => /\/posts\/(saved|drafts)$/.test(call))).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: otherProfile.name, exact: true })).toBeVisible();
    expect(state.calls.filter(call => /\/posts\/(saved|drafts)$/.test(call))).toEqual([]);
  });
}

test('private non-follower profile analysis link never requests private analytics', async ({ page, boot, state }) => {
  await boot(`/@${privateProfile.handle}?view=analysis`);
  await expect(page.getByRole('heading', { name: privateProfile.name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Global Insights' })).toHaveCount(0);
  expect(state.calls.filter(call => call.endsWith('/analytics'))).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: privateProfile.name, exact: true })).toBeVisible();
  expect(state.calls.filter(call => call.endsWith('/analytics'))).toEqual([]);
});

test('public other profile removes analysis view without exposing or requesting owner analytics', async ({ page, boot, state }) => {
  await boot(`/@${otherProfile.handle}?tab=reposts&view=analysis&from=share`);
  await expect(page.getByRole('heading', { name: otherProfile.name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(`/@${otherProfile.handle}?tab=reposts&from=share`);
  await expect(page.locator('button:has(svg.lucide-trending-up)')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Global Insights' })).toHaveCount(0);
  expect(state.calls.filter(call => call.endsWith('/analytics'))).toEqual([]);
});

test('followed private profile removes analysis view without exposing or requesting owner analytics', async ({ page, boot, state }) => {
  const followedPrivateProfile = { ...privateProfile, isFollowing: true, followStatus: 'ACTIVE' };
  await boot('/');
  await page.route(`**/api/users/handle/${privateProfile.handle}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(followedPrivateProfile),
  }));
  await page.route(`**/api/users/${privateProfile.id}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(followedPrivateProfile),
  }));

  await page.goto(`/@${privateProfile.handle}?tab=reposts&view=analysis&from=notification`);
  await expect(page.getByRole('heading', { name: privateProfile.name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(`/@${privateProfile.handle}?tab=reposts&from=notification`);
  await expect(page.locator('button:has(svg.lucide-trending-up)')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Global Insights' })).toHaveCount(0);
  expect(state.calls.filter(call => call.endsWith('/analytics'))).toEqual([]);
});

test('forbidden group members URL replaces query and Back exits without a hidden entry', async ({ page, boot, state }) => {
  state.denyGroupMembers = true;
  await boot(`/group/${group.id}?tab=members`);
  await expect(page.getByRole('heading', { name: group.name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(`/group/${group.id}`);
  await expect(page.getByRole('button', { name: 'Members', exact: true })).toHaveCount(0);
  expect(state.calls.filter(call => call.endsWith('/members'))).toEqual([]);
  await back(page);
  await expect(page).toHaveURL('/');
});
