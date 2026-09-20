import { expect, test, type Route } from '@playwright/test';

const json = (route: Route, body: unknown, status = 200, headers?: Record<string, string>) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

test('comments pagination failure keeps loaded items and retry appends once', async ({ page }) => {
  const viewer = {
    id: 'viewer', handle: 'viewer', name: 'Viewer Profile', avatar: '', bio: '', location: '', website: '',
    email: 'viewer@example.test', phone: '', language: 'en', isPrivate: false, groupPrivacy: 'Public',
    peopleTagPermission: 'EVERYONE', profileLinks: [], stats: { followers: 0, following: 0, posts: 1, responses: 0 },
    demographics: {}, updatedAt: '2026-09-20T00:00:00.000Z'
  };
  const poll = {
    id: 'poll-1', type: 'Poll', status: 'PUBLISHED', title: 'Comments stability poll', content: 'Comments stability poll',
    createdAt: '2026-09-20T00:00:00.000Z', author: viewer, participants: 0, likes: 0, comments: 1, commentsCount: 1,
    shares: 0, options: [{ id: 'yes', text: 'Yes', votes: 0 }, { id: 'no', text: 'No', votes: 0 }],
    config: {}, resultsVisibility: 'Always'
  };
  const comment = (id: string, text: string) => ({
    id, author: { id: 'viewer', name: 'Viewer Profile', avatar: '' }, text,
    timestamp: '2026-09-20T00:00:00.000Z', likes: 0, replies: []
  });
  let appendAttempts = 0;

  await page.addInitScript((user) => {
    localStorage.setItem('si_token', 'sheets-stability-token');
    localStorage.setItem('si_user', JSON.stringify(user));
  }, viewer);
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') return json(route, {});
    if (url.pathname === '/api/users/me') return json(route, viewer);
    if (url.pathname === '/api/posts') return json(route, { data: [poll], nextCursor: null });
    if (url.pathname === '/api/posts/poll-1/comments') {
      if (!url.searchParams.get('cursor')) return json(route, [comment('comment-1', 'First retained comment')], 200, { 'X-Next-Cursor': 'next-comments' });
      appendAttempts += 1;
      if (appendAttempts === 1) return json(route, { error: 'Temporary failure' }, 500);
      return json(route, [comment('comment-2', 'Second appended comment')]);
    }
    if (url.pathname.includes('/notifications') || url.pathname.endsWith('/groups')) return json(route, []);
    return json(route, []);
  });

  await page.goto('/');
  await expect(page.getByText('Comments stability poll', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Comment' }).click();
  await expect(page.getByText('First retained comment', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more comments' }).click();
  await expect(page.getByRole('alert')).toContainText('Failed to load comments');
  await expect(page.getByText('First retained comment', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Second appended comment', { exact: true })).toBeVisible();
  await expect(page.getByText('First retained comment', { exact: true })).toHaveCount(1);
  expect(appendAttempts).toBe(2);
});

test('closing comments ignores a delayed response from the closed sheet', async ({ page }) => {
  const viewer = {
    id: 'viewer', handle: 'viewer', name: 'Viewer Profile', avatar: '', bio: '', location: '', website: '',
    email: 'viewer@example.test', phone: '', language: 'en', isPrivate: false, groupPrivacy: 'Public',
    peopleTagPermission: 'EVERYONE', profileLinks: [], stats: { followers: 0, following: 0, posts: 1, responses: 0 },
    demographics: {}, updatedAt: '2026-09-20T00:00:00.000Z'
  };
  const poll = {
    id: 'poll-delayed', type: 'Poll', status: 'PUBLISHED', title: 'Delayed comments poll', content: 'Delayed comments poll',
    createdAt: '2026-09-20T00:00:00.000Z', author: viewer, participants: 0, likes: 0, comments: 1, commentsCount: 1,
    shares: 0, options: [{ id: 'yes-delayed', text: 'Yes', votes: 0 }, { id: 'no-delayed', text: 'No', votes: 0 }],
    config: {}, resultsVisibility: 'Always'
  };
  let delayedRequestStarted = false;

  await page.addInitScript((user) => {
    localStorage.setItem('si_token', 'sheets-stale-token');
    localStorage.setItem('si_user', JSON.stringify(user));
  }, viewer);
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') return json(route, {});
    if (url.pathname === '/api/users/me') return json(route, viewer);
    if (url.pathname === '/api/posts') return json(route, { data: [poll], nextCursor: null });
    if (url.pathname === '/api/posts/poll-delayed/comments') {
      delayedRequestStarted = true;
      await new Promise(resolve => setTimeout(resolve, 900));
      return json(route, [{
        id: 'stale-comment', author: { id: 'viewer', name: 'Viewer Profile', avatar: '' },
        text: 'This delayed comment must stay closed', timestamp: '2026-09-20T00:00:00.000Z', likes: 0, replies: []
      }]);
    }
    if (url.pathname.includes('/notifications') || url.pathname.endsWith('/groups')) return json(route, []);
    return json(route, []);
  });

  await page.goto('/');
  await expect(page.getByText('Delayed comments poll', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Comment' }).click();
  await expect.poll(() => delayedRequestStarted).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Comments/ })).toHaveCount(0, { timeout: 2_000 });
  await page.waitForTimeout(1_000);
  await expect(page.getByText('This delayed comment must stay closed', { exact: true })).toHaveCount(0);
});
