import { test, expect } from './fixtures';

test('pending creator save blocks underlying post actions below the header', async ({ page, state, words, boot }) => {
  let release!: () => void;
  state.holdSave = new Promise<void>(resolve => { release = resolve; });
  state.failSave = true;
  await boot();
  const backgroundShare = (await page.getByRole('button', { name: 'Share', exact: true }).boundingBox())!;
  await page.getByRole('button', { name: words.postOptions.open, exact: true }).click();
  await page.getByRole('dialog', { name: words.postOptions.menuTitle, exact: true })
    .getByRole('button', { name: `${words.postOptions.edit} ${words.postOptions.editDescription}`, exact: true }).click();
  await page.getByPlaceholder('Ask a question...', { exact: true }).fill('Synthetic protected pending edit');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect.poll(() => state.calls.filter(call => call.method === 'PUT').length).toBe(1);
  try {
    await page.mouse.click(backgroundShare.x + backgroundShare.width / 2, backgroundShare.y + backgroundShare.height / 2);
    await expect(page.getByRole('dialog', { name: words.postSharing.menuTitle, exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/create\/poll$/);
    for (let index = 0; index < 8; index++) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/create\/poll$/);
    expect(state.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  } finally { release(); }
  await expect(page.getByRole('alert').filter({ hasText: words.postOptions.publishFailed })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByPlaceholder('Ask a question...', { exact: true })).toHaveValue('Synthetic protected pending edit');
});

test('busy repost drag recovers caption and retry fully inside the viewport after failure', async ({ page, context, state, words, boot }, info) => {
  let release!: () => void;
  state.holdShare = new Promise<void>(resolve => { release = resolve; });
  state.failShare = true;
  await boot();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: words.postSharing.menuTitle, exact: true });
  await dialog.getByRole('button', { name: `${words.postSharing.toFeed} ${words.postSharing.toFeedDescription}`, exact: true }).click();
  const caption = dialog.getByLabel(words.postSharing.caption, { exact: true });
  await caption.fill('Synthetic caption surviving a cancelled drag');
  await dialog.getByRole('button', { name: words.postSharing.post, exact: true }).click();
  await expect.poll(() => state.calls.filter(call => call.path.endsWith('/share')).length).toBe(1);
  const box = (await dialog.boundingBox())!;
  const session = await context.newCDPSession(page);
  try {
    const x = box.x + box.width / 2; const startY = box.y + 12;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    for (let index = 1; index <= 6; index++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY + index * 30 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { release(); await session.detach(); }
  await expect(dialog.getByRole('alert')).toHaveText(words.postSharing.failed);
  await expect(caption).toHaveValue('Synthetic caption surviving a cancelled drag');
  const retry = dialog.getByRole('button', { name: words.postSharing.post, exact: true });
  await expect(retry).toBeEnabled();
  for (const target of [dialog, caption, retry]) {
    await expect.poll(async () => (await target.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => { const recovered = (await target.boundingBox())!; return recovered.y + recovered.height; })
      .toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  }
  await dialog.screenshot({ path: info.outputPath('recovered-repost.png') });
  state.failShare = false;
  await retry.click();
  await expect(dialog.getByText(words.postSharing.success, { exact: true })).toBeVisible();
  expect(state.calls.filter(call => call.path.endsWith('/share'))).toHaveLength(2);
});
