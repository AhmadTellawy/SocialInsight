import type { Page } from '@playwright/test';
import { test, expect, ORIGINAL, OWNER, VIEWER, POST } from './fixtures';
import en from '../../locales/en/translation.json' with { type: 'json' };

type Words = typeof en;
async function options(page: Page, w: Words) {
  await page.getByRole('button', { name: w.postOptions.open, exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: w.postOptions.menuTitle, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function edit(page: Page, w: Words) {
  const menu = await options(page, w);
  await menu.getByRole('button', { name: `${w.postOptions.edit} ${w.postOptions.editDescription}`, exact: true }).click();
}
async function share(page: Page, w: Words) {
  await page.getByRole('button', { name: 'Share', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: w.postSharing.menuTitle, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const surface of ['/', '/profile']) test(`owner edit failure retains text and original ${surface} card; retry commits`, async ({ page, state, words, boot }) => {
  state.failSave = true;
  await boot(surface);
  await expect(page.getByText(ORIGINAL, { exact: true }).first()).toBeVisible();
  await edit(page, words);
  const title = page.getByPlaceholder('Ask a question...', { exact: true });
  await title.fill('Synthetic revised title');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: words.postOptions.publishFailed })).toBeVisible();
  await expect(page).toHaveURL(/\/create\/poll$/);
  expect(state.title).toBe(ORIGINAL);
  // The existing card remains unchanged in the mounted underlying feed/profile.
  await expect(page.getByRole('heading', { name: 'Synthetic revised title', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(title).toHaveValue('Synthetic revised title');
  state.failSave = false;
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(title).toHaveCount(0);
  await expect(page.getByText('Synthetic revised title', { exact: true }).first()).toBeVisible();
  expect(state.calls.filter(c => c.method === 'PUT' && c.path === `/api/posts/${POST}`)).toHaveLength(2);
});

for (const [kind, placeholder, type] of [
  ['challenge', 'Create a challenge...', 'Challenge'],
  ['survey', 'Survey Title', 'Survey'],
  ['quiz', 'Quiz Title', 'Quiz'],
]) test(`${kind} draft failure keeps editor and text; retry stores a real DRAFT API payload`, async ({ page, state, words, boot }) => {
  state.failSave = true;
  await boot(`/create/${kind}`);
  // A new single-question quiz uses its question as title; adding a second question exposes the optional quiz title.
  if (kind === 'quiz') await page.getByRole('button', { name: 'Add Question', exact: true }).click();
  const title = page.getByPlaceholder(placeholder, { exact: true });
  await title.fill(`Synthetic ${kind} draft`);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save as Draft', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: words.postOptions.draftFailed })).toBeVisible();
  await expect(title).toHaveValue(`Synthetic ${kind} draft`);
  await expect(page).toHaveURL(new RegExp(`/create/${kind}$`));
  state.failSave = false;
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Save as Draft', exact: true }).click();
  await expect(title).toHaveCount(0);
  const drafts = state.calls.filter(c => c.method === 'POST' && c.path === '/api/posts');
  expect(drafts).toHaveLength(2);
  for (const draft of drafts) expect(draft.body).toMatchObject({ title: `Synthetic ${kind} draft`, type, status: 'DRAFT', authorId: OWNER });
});

test('pending save prevents Back, further typing and duplicate submissions', async ({ page, state, words, boot }) => {
  let release!: () => void;
  state.holdSave = new Promise<void>(resolve => { release = resolve; });
  state.failSave = true;
  await boot();
  await edit(page, words);
  await page.getByPlaceholder('Ask a question...', { exact: true }).fill('Synthetic locked submission');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const back = page.getByRole('button', { name: 'Back', exact: true });
  const backBox = (await back.boundingBox())!;
  const submit = page.getByRole('button', { name: 'Post', exact: true });
  const submitBox = (await submit.boundingBox())!;
  await submit.click();
  await expect.poll(() => state.calls.filter(c => c.method === 'PUT').length).toBe(1);
  // Exercise actual input, because role locators can still match nodes inside native inert.
  try {
    await page.mouse.click(backBox.x + backBox.width / 2, backBox.y + backBox.height / 2);
    await expect(page).toHaveURL(/\/create\/poll$/);
    await page.mouse.click(submitBox.x + submitBox.width / 2, submitBox.y + submitBox.height / 2);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.type('This must not change submitted text');
    await expect(page).toHaveURL(/\/create\/poll$/);
    expect(state.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
  } finally { release(); }
  await expect(page.getByRole('alert').filter({ hasText: words.postOptions.publishFailed })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByPlaceholder('Ask a question...', { exact: true })).toHaveValue('Synthetic locked submission');
});

test('server unshared outcome is described as removal, never publication success', async ({ page, state, words, boot }) => {
  state.actor = VIEWER; state.unshare = true;
  await boot();
  const dialog = await share(page, words);
  await dialog.getByRole('button', { name: `${words.postSharing.toFeed} ${words.postSharing.toFeedDescription}`, exact: true }).click();
  await dialog.getByRole('button', { name: words.postSharing.post, exact: true }).click();
  await expect(dialog.getByText(words.postSharing.unshared, { exact: true })).toBeVisible();
  await expect(dialog.getByText(words.postSharing.success, { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: words.postSharing.close, exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('expired edit deletion failure stays in dialog; cancel is harmless and retry deletes', async ({ page, state, words, boot }) => {
  state.expired = true; state.failDelete = true;
  await boot();
  await edit(page, words);
  const dialog = page.getByRole('dialog', { name: words['Editing Disabled'], exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: words['Delete Post'], exact: true }).click();
  await dialog.getByRole('button', { name: words.postOptions.confirmDelete, exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(words.postOptions.deleteFailed);
  expect(state.deleted).toBe(false);
  await expect(page).toHaveURL(/\/$/);
  await dialog.getByRole('button', { name: words.postOptions.cancel, exact: true }).click();
  expect(state.calls.filter(c => c.method === 'DELETE')).toHaveLength(1);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  state.failDelete = false;
  await dialog.getByRole('button', { name: words['Delete Post'], exact: true }).click();
  await dialog.getByRole('button', { name: words.postOptions.confirmDelete, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(ORIGINAL, { exact: true })).toHaveCount(0);
  expect(state.calls.filter(c => c.method === 'DELETE')).toHaveLength(2);
});

test('private follow request remains PENDING in header and menu until explicit cancel', async ({ page, state, words, boot }) => {
  state.actor = VIEWER;
  await boot();
  await page.getByRole('button', { name: words['Follow'], exact: true }).click();
  await expect(page.getByRole('button', { name: words.postOptions.cancelRequest, exact: true })).toBeVisible();
  expect(state.follow).toBe('PENDING');
  const menu = await options(page, words);
  const name = words.postOptions.cancelRequestAuthor.replace('{{name}}', 'Synthetic Author');
  await expect(menu.getByText(words.postOptions.pendingDescription, { exact: true })).toBeVisible();
  await menu.getByRole('button', { name: `${name} ${words.postOptions.pendingDescription}`, exact: true }).click();
  await expect(page.getByRole('button', { name: words['Follow'], exact: true })).toBeVisible();
  expect(state.calls.filter(c => c.path === `/api/users/${OWNER}/follow` && c.method === 'POST')).toHaveLength(2);
  expect(state.follow).toBe('NONE');
});

test('quote waits for server, preserves caption on failure, and succeeds only after retry', async ({ page, state, words, boot }) => {
  state.actor = VIEWER; state.failShare = true;
  let release!: () => void;
  state.holdShare = new Promise<void>(resolve => { release = resolve; });
  await boot();
  const dialog = await share(page, words);
  await dialog.getByRole('button', { name: `${words.postSharing.toFeed} ${words.postSharing.toFeedDescription}`, exact: true }).click();
  const caption = dialog.getByLabel(words.postSharing.caption, { exact: true });
  await caption.fill('Synthetic preserved caption نص محفوظ');
  await dialog.getByRole('button', { name: words.postSharing.post, exact: true }).click();
  await expect(dialog.getByRole('button', { name: words.postSharing.posting, exact: true })).toBeDisabled();
  await expect(dialog.getByText(words.postSharing.success, { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(state.calls.filter(c => c.path.endsWith('/share'))).toHaveLength(1);
  release();
  await expect(dialog.getByRole('alert')).toHaveText(words.postSharing.failed);
  await expect(caption).toHaveValue('Synthetic preserved caption نص محفوظ');
  state.failShare = false;
  await dialog.getByRole('button', { name: words.postSharing.post, exact: true }).click();
  await expect(dialog.getByText(words.postSharing.success, { exact: true })).toBeVisible();
  expect(state.calls.filter(c => c.path.endsWith('/share'))).toHaveLength(2);
  await dialog.getByRole('button', { name: words.postSharing.close, exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('native AbortError cancels once without opening a second system share or error', async ({ page, state, words, boot }) => {
  state.actor = VIEWER;
  await boot();
  await page.evaluate(() => {
    (window as any).__syntheticShareCalls = 0;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {
      (window as any).__syntheticShareCalls++;
      throw new DOMException('Synthetic user cancellation', 'AbortError');
    } });
  });
  const dialog = await share(page, words);
  const outside = dialog.getByRole('button', { name: `${words.postSharing.outside} ${words.postSharing.outsideDescription}`, exact: true });
  await outside.click();
  await expect.poll(() => page.evaluate(() => (window as any).__syntheticShareCalls)).toBe(1);
  await expect(outside).toBeEnabled();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__syntheticShareCalls)).toBe(1);
  expect(state.calls.filter(c => c.path.endsWith('/share'))).toHaveLength(0);
});

test('report dialog native radio keyboard, failure recovery and bounded localized layout', async ({ page, state, words, boot }, info) => {
  state.actor = VIEWER; state.failAction = true;
  await boot();
  const menu = await options(page, words);
  await menu.getByRole('button', { name: `${words.postOptions.report} ${words.postOptions.reportDescription}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: words.postOptions.reportTitle, exact: true });
  const radios = dialog.getByRole('radio');
  await expect(radios).toHaveCount(6);
  await radios.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(radios.nth(0)).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(1)).toBeFocused();
  await dialog.getByRole('button', { name: words.postOptions.submitReport, exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(radios.nth(1)).toBeChecked();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await expect(dialog).toHaveCSS('direction', info.project.name.startsWith('ar') ? 'rtl' : 'ltr');
  await dialog.screenshot({ path: info.outputPath('localized-report.png') });
  state.failAction = false;
  await dialog.getByRole('button', { name: words.postOptions.submitReport, exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.calls.filter(c => c.path.endsWith('/report')).map(c => c.body.reason)).toEqual(['SPAM', 'SPAM']);
});

test('existing save/unsave, remove own tag and hide/undo stay functional', async ({ page, state, words, boot }) => {
  state.actor = VIEWER; state.tagged = true;
  await boot();
  let menu = await options(page, words);
  await menu.getByRole('button', { name: `${words.postOptions.save} ${words.postOptions.saveDescription}`, exact: true }).click();
  await expect.poll(() => state.saved).toBe(true);
  menu = await options(page, words);
  await menu.getByRole('button', { name: `${words.postOptions.unsave} ${words.postOptions.unsaveDescription}`, exact: true }).click();
  await expect.poll(() => state.saved).toBe(false);
  menu = await options(page, words);
  await menu.getByRole('button', { name: `${words.peopleTags.removeMine} ${words.peopleTags.removeMineDescription}`, exact: true }).click();
  await expect.poll(() => state.tagged).toBe(false);
  menu = await options(page, words);
  await expect(menu.getByText(words.peopleTags.removeMine, { exact: true })).toHaveCount(0);
  await menu.getByRole('button', { name: `${words.postOptions.hide} ${words.postOptions.hideDescription}`, exact: true }).click();
  await expect(page.getByText(ORIGINAL, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: words.postOptions.undo, exact: true }).click();
  await expect(page.getByText(ORIGINAL, { exact: true }).first()).toBeVisible();
  expect(state.calls.filter(c => c.path.endsWith('/hide')).map(c => c.method)).toEqual(['POST', 'DELETE']);
});
