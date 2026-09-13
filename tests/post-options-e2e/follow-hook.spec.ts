import { test, expect, VIEWER } from './fixtures';

test('real hook rejects a late previous-viewer follow mutation after account switch', async ({ page, state, boot }) => {
  state.actor = VIEWER;
  let release!: () => void;
  state.holdFollow = new Promise<void>(resolve => { release = resolve; });
  await boot('/tests/post-options-e2e/follow-hook.html');
  await expect(page.getByTestId('ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Toggle follow' }).click();
  await expect.poll(() => state.calls.filter(c => c.method === 'POST').length).toBe(1);
  await page.getByRole('button', { name: 'Switch account' }).click();
  await expect(page.getByTestId('viewer')).toHaveText('synthetic-switched-viewer');
  await expect(page.getByTestId('ready')).toHaveText('true');
  release();
  await expect(page.getByTestId('completed')).toHaveText('1');
  await expect(page.getByTestId('relationship')).toHaveText('NONE');
  await expect(page.getByTestId('events')).toHaveText('0');
});

test('real hook rejects a late previous-viewer follow-status read after account switch', async ({ page, state, boot }) => {
  state.actor = VIEWER; state.follow = 'PENDING';
  let release!: () => void;
  state.holdFollowRead = new Promise<void>(resolve => { release = resolve; });
  await boot('/tests/post-options-e2e/follow-hook.html');
  await expect.poll(() => state.calls.filter(c => c.path.endsWith('/follow-status')).length).toBe(1);
  await page.getByRole('button', { name: 'Switch account' }).click();
  await expect(page.getByTestId('ready')).toHaveText('true');
  const oldResponse = page.waitForResponse(response => response.url().includes(`currentUserId=${VIEWER}`));
  release();
  await (await oldResponse).finished();
  await expect(page.getByTestId('relationship')).toHaveText('NONE');
  await expect(page.getByTestId('events')).toHaveText('0');
});

test('real hook queues a fresh status read when a boolean follow event arrives during an older read', async ({ page, state, boot }) => {
  state.actor = VIEWER;
  let release!: () => void;
  state.holdFollowRead = new Promise<void>(resolve => { release = resolve; });
  await boot('/tests/post-options-e2e/follow-hook.html');
  await expect.poll(() => state.calls.filter(c => c.path.endsWith('/follow-status')).length).toBe(1);
  state.follow = 'PENDING';
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('onFollowStateChange', {
    detail: { viewerId: 'post-options-viewer', targetUserId: 'post-options-owner', isFollowing: false },
  })));
  release();
  await expect.poll(() => state.calls.filter(c => c.path.endsWith('/follow-status')).length).toBe(2);
  await expect(page.getByTestId('ready')).toHaveText('true');
  await expect(page.getByTestId('relationship')).toHaveText('PENDING');
  expect(state.calls.filter(c => c.method === 'POST')).toHaveLength(0);
});
