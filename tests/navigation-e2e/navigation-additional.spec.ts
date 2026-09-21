import { test, expect, back, profile, post, otherProfile } from './fixtures';

for (const reply of [false, true]) {
  test(`notification ${reply ? 'reply' : 'comment'} target retains query through analysis, reload and Back to notifications`, async ({ page, boot, state }) => {
    state.notifications = [{ id: 'navigation-notification', type: reply ? 'reply' : 'comment', actor: otherProfile,
      targetId: post.id, targetType: 'post', isRead: true, message: 'Synthetic navigation notification',
      timestamp: '2026-09-13T00:00:00.000Z', payload: { postId: post.id, commentId: 'navigation-comment', ...(reply ? { replyId: 'navigation-reply' } : {}) } }];
    const target = `/post/${post.id}?comment=navigation-comment${reply ? '&reply=navigation-reply' : ''}`;
    await boot('/notifications');
    const row = page.locator('[data-notification-id="navigation-notification"]');
    await expect(row).toContainText('Synthetic navigation notification');
    await row.click();
    await expect(page).toHaveURL(target);
    await expect(page.getByText(post.title, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Analysis', exact: true }).first().click();
    await expect(page).toHaveURL(`${target}&tab=analysis`);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Analysis', exact: true }).first()).toHaveClass(/text-blue-600/);
    await back(page);
    await expect(page).toHaveURL(target);
    await back(page);
    await expect(page).toHaveURL('/notifications');
    await expect(row).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(target);
  });
}

test('hashtag post Back returns to the topic and direct topic Back uses search', async ({ page, boot }) => {
  await boot('/hashtag/navigation');
  await expect(page.getByRole('heading', { name: '#navigation', exact: true })).toBeVisible();
  await page.getByText(post.title, { exact: true }).first().click();
  await expect(page).toHaveURL(`/post/${post.id}`);
  await back(page);
  await expect(page).toHaveURL('/hashtag/navigation');
  await expect(page.getByRole('heading', { name: '#navigation', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(`/post/${post.id}`);
  await back(page);
  await back(page);
  await expect(page).toHaveURL('/search');
});

test('direct messages reload and app Back return home without leaving application', async ({ page, boot }) => {
  await boot('/messages');
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
  await back(page);
  await expect(page).toHaveURL('/');
  await expect(page.locator('header')).toBeVisible();
});

for (const route of ['/profile', '/settings/profile/edit-profile']) {
  test(`guest private entry ${route} replaces with login and closes safely to home`, async ({ page, boot, state }) => {
    state.guest = true;
    await boot(route);
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { name: 'Welcome Back', exact: true })).toBeVisible();
    await expect(page.locator('#profile-display-name')).toHaveCount(0);
    expect(state.calls.filter(call => call === 'GET /api/users/me' || call === `GET /api/users/${profile.id}/notifications`)).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome Back', exact: true })).toBeVisible();
    await page.locator('button').filter({ has: page.locator('svg.lucide-x') }).first().click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Welcome Back', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('si_token'))).toBeNull();
  });
}
