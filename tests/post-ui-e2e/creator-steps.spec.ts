import { test, expect, type Page } from '@playwright/test';

const creatorTypes = ['poll', 'survey', 'quiz', 'challenge'] as const;
const titles = { poll: 'Ask a question...', survey: 'Survey Title', quiz: 'Quiz Title', challenge: 'Create a challenge...' };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/users/search')
      ? [{ id: 'tag-fixture', name: 'Ada Fixture', handle: 'ada.fixture' }]
      : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  page.on('dialog', dialog => dialog.dismiss());
});

async function openCreator(page: Page, kind: string, extra = '', width = 390, direction = 'ltr') {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`/tests/post-ui-e2e/index.html?creatorSteps&create=${kind}&dir=${direction}${extra}`);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  await expect(page.getByTestId('step-submit-count')).toHaveText('0');
}

async function next(page: Page) {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Post visibility', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeVisible();
  await expect(page.getByTestId('step-submit-count')).toHaveText('0');
}

async function submit(page: Page) {
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByTestId('step-submit-count')).toHaveText('1');
  return JSON.parse((await page.getByTestId('step-submit-payload').textContent())!);
}

for (const [index, kind] of creatorTypes.entries()) {
  test(`${kind}: Next and Back preserve text/media and isolate the two steps`, async ({ page }) => {
    await openCreator(page, kind, '', 390, index % 2 ? 'rtl' : 'ltr');
    const title = page.getByPlaceholder(titles[kind], { exact: true });
    await expect(title).toHaveValue(kind === 'poll'
      ? 'Steps fixture title\n\n... 123 English post text stays aligned independently.'
      : 'Steps fixture title');
    const requiredContent = kind === 'quiz' ? page.getByPlaceholder('Question Text', { exact: true }) : title;
    await requiredContent.fill('');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Post visibility', exact: true })).toBeHidden();
    await expect(page.getByTestId('step-submit-count')).toHaveText('0');
    if (kind === 'quiz') await requiredContent.fill('Fixture question 1');
    const edited = '... 123 عنوان عربي محفوظ English';
    await title.fill(edited);
    await expect(title).toHaveCSS('font-size', '12px');
    await expect(title).toHaveCSS('font-weight', '400');
    await expect(page.getByRole('heading', { name: 'Post visibility', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: /Grid options? layout/ })).toHaveCount(0);
    const imageCount = await page.locator('img').filter({ visible: true }).count();
    expect(imageCount).toBeGreaterThan(0);
    await next(page);
    await expect(title).toBeHidden();
    await expect(page.getByRole('button', { name: /Tag people, / })).toBeHidden();
    await expect(page.getByText('Unlock Deeper Analytics', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(title).toHaveValue(edited);
    expect(await page.locator('img').filter({ visible: true }).count()).toBe(imageCount);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`${kind}: optional category selection, clearing, tag chips and final payload`, async ({ page }) => {
    await openCreator(page, kind, '&missingCategory', 768, 'rtl');
    await next(page);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Category', exact: true }).click();
    await page.getByRole('button', { name: 'Sports', exact: true }).click();
    const category = page.getByLabel('Post details', { exact: true }).getByRole('button', { name: 'Sports', exact: true });
    await expect(category).toHaveCSS('font-size', '12px');
    await expect(category).toHaveCSS('font-weight', '700');
    await expect(category).not.toHaveClass(/border-red-300/);
    await page.getByRole('button', { name: 'Tag people, 0 selected', exact: true }).click();
    await page.getByPlaceholder('Search people', { exact: true }).fill('ada');
    await page.getByRole('button', { name: /Ada Fixture @ada.fixture/ }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Tag people, 1 selected', exact: true })).toBeVisible();
    await next(page);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Tag people, 1 selected', exact: true })).toBeVisible();
    await page.getByLabel('Post details', { exact: true }).getByRole('button', { name: 'Sports', exact: true }).click();
    await page.getByRole('button', { name: 'Clear category', exact: true }).click();
    await next(page);
    const payload = await submit(page);
    expect(payload.category).toBe('');
    expect(payload.taggedUserIds).toEqual(['tag-fixture']);
    expect(payload.targetAudience).toBe('Public');
    expect(payload.targetGroups).toEqual([]);
    const questions = payload.sections?.flatMap((section: any) => section.questions);
    if (questions) {
      expect(questions).toHaveLength(2);
      expect(questions[0].options).toHaveLength(2);
      if (kind === 'quiz') expect(questions[0].correctOptionId).toBe('step-option-0');
    } else expect(payload.options).toHaveLength(2);
  });

  test(`${kind}: group page search, multi-select, discard and last destination`, async ({ page }) => {
    await openCreator(page, kind, '', index % 2 ? 1280 : 390, index % 2 ? 'ltr' : 'rtl');
    await next(page);
    await expect(page.getByRole('checkbox', { name: 'Custom Audience', exact: true })).toBeDisabled();
    const profile = page.getByRole('checkbox', { name: 'My Profile', exact: true });
    await profile.click();
    await expect(profile).toBeChecked();
    const trigger = page.getByRole('button', { name: 'Choose selected groups', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Selected Groups', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('checkbox', { name: 'Unavailable Group', exact: true })).toHaveCount(0);
    await dialog.getByRole('checkbox', { name: 'Fixture Group', exact: true }).check();
    await dialog.getByRole('textbox', { name: 'Search groups', exact: true }).fill('Second');
    await dialog.getByRole('checkbox', { name: 'Second Group', exact: true }).check();
    await dialog.getByRole('textbox', { name: 'Search groups', exact: true }).fill('');
    await expect(dialog.getByRole('checkbox', { name: 'Fixture Group', exact: true })).toBeChecked();
    await page.keyboard.press('Escape');
    const confirm = page.getByRole('alertdialog', { name: 'Discard group changes?', exact: true });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep Editing', exact: true }).click();
    if (kind === 'poll') await page.screenshot({ path: test.info().outputPath('group-picker.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(profile).toBeChecked();
    const groups = page.getByRole('checkbox', { name: 'Selected Groups', exact: true });
    await expect(groups).toBeChecked();
    await trigger.click();
    await dialog.getByRole('checkbox', { name: 'Fixture Group', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'Second Group', exact: true }).uncheck();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Back from selected groups', exact: true }).click();
    await confirm.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(dialog).toBeHidden();
    await profile.uncheck();
    await groups.click();
    await expect(groups).toBeChecked();
    await profile.check();
    const payload = await submit(page);
    expect(payload.targetAudience).toBe('ProfileAndGroups');
    expect(payload.targetGroups).toEqual(['fixture-group', 'second-group']);
  });

  test(`${kind}: image names controls removed while legacy names policy and images survive`, async ({ page }) => {
    await openCreator(page, kind, '&stepsImages&legacyHidden', 390, 'rtl');
    await expect(page.getByRole('switch', { name: /show.*names/i })).toHaveCount(0);
    await expect(page.getByText(/You can hide them from voters/)).toHaveCount(0);
    if (kind !== 'challenge') {
      const grid = page.getByRole('button', { name: /Grid options? layout/ });
      await expect(grid).toBeVisible();
      await grid.click();
    }
    await next(page);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('input[type="text"]').filter({ visible: true }).first()).toHaveCSS('font-size', '12px');
    await next(page);
    const payload = await submit(page);
    const question = payload.sections?.[0]?.questions?.[0];
    expect(question ? question.showOptionNames : payload.showOptionNames).toBe(false);
    expect((question ? question.options : payload.options).every((option: any) => option.text && (option.image || option.imageMediaId))).toBe(true);
  });

  test(`${kind}: audience switches clear old groups and settings survive Back`, async ({ page }) => {
    await openCreator(page, kind, '&initialBoth&verified', 320, index % 2 ? 'rtl' : 'ltr');
    await next(page);
    await expect(page.getByRole('checkbox', { name: 'Selected Groups', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Custom Domain', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Custom Audience', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: 'My Profile', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Selected Groups', exact: true })).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'My Profile', exact: true }).check();
    await page.getByRole('button', { name: /^custom$/i }).click();
    await page.getByRole('button', { name: /^Gender(?:\s|$)/ }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await next(page);
    await expect(page.getByRole('checkbox', { name: 'My Profile', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Selected Groups', exact: true })).not.toBeChecked();
    const post = page.getByRole('button', { name: 'Post', exact: true });
    await post.dblclick();
    await expect(page.getByTestId('step-submit-count')).toHaveText('1');
    const payload = JSON.parse((await page.getByTestId('step-submit-payload').textContent())!);
    expect(payload.targetAudience).toBe('Public');
    expect(payload.targetGroups).toEqual([]);
    expect(payload.demographics).toContain('gender');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const [kind, width, direction] of [['poll', 390, 'rtl'], ['survey', 1440, 'ltr']] as const) {
  test(`${kind}: final step visual evidence`, async ({ page }) => {
    await openCreator(page, kind, '', width, direction);
    await page.screenshot({ path: test.info().outputPath('step-1.png'), fullPage: true });
    await next(page);
    await page.screenshot({ path: test.info().outputPath('step-2.png'), fullPage: true });
  });
}

for (const [index, kind] of creatorTypes.entries()) {
  test(`${kind}: text and image Add option create editable rows without file chooser`, async ({ page }) => {
    let fileChoosers = 0;
    page.on('filechooser', () => fileChoosers++);
    for (const imageMode of [false, true]) {
      await openCreator(page, kind, imageMode ? '&stepsImages' : '', index % 2 ? 768 : 390, index % 2 ? 'ltr' : 'rtl');
      const fields = page.locator('input[type="text"]').filter({ visible: true });
      const before = await fields.count();
      await page.getByPlaceholder(kind === 'challenge' ? 'Add item to compare...' : 'Add option...', { exact: true }).focus();
      await expect(fields).toHaveCount(before + 1);
      const active = page.locator('input:focus');
      await expect(active).toHaveValue('');
      await active.fill('New editable option');
      await expect(active).toHaveValue('New editable option');
      expect(fileChoosers).toBe(0);
      if (imageMode && kind !== 'challenge') {
        const grid = page.getByRole('button', { name: /Grid options? layout/ });
        await expect(grid.locator('svg.lucide-gallery-horizontal-end')).toHaveCount(1);
      }
    }
  });
}

test('poll: empty Other category is optional', async ({ page }) => {
  await openCreator(page, 'poll', '&missingCategory');
  await page.getByRole('button', { name: 'Category', exact: true }).click();
  await page.getByRole('button', { name: 'Other', exact: true }).click();
  await next(page);
  expect((await submit(page)).category).toBe('');
});

for (const description of ['', '... 123 وصف اختباري مستقل English']) {
  test(`quiz: blank title remains blank with description '${description}'`, async ({ page }) => {
    await openCreator(page, 'quiz', '&blankQuiz&publishPreview', description ? 390 : 1440, description ? 'rtl' : 'ltr');
    const input = page.getByPlaceholder('Describe what this quiz is about (optional)...', { exact: true });
    await expect(input).toHaveCSS('font-size', '12px');
    await expect(input).toHaveCSS('font-weight', '400');
    await expect(input).toHaveAttribute('dir', 'auto');
    await input.fill(description);
    await next(page);
    const payload = await submit(page);
    expect(payload.title).toBe('');
    expect(payload.description).toBe(description);
    const preview = page.getByTestId('published-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByText('Untitled Quiz', { exact: true })).toHaveCount(0);
    await expect(preview.locator('h2')).toHaveCount(0);
    if (description) await expect(preview.getByText(description, { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('published-quiz.png'), fullPage: true });
  });
}


test('shared picker: 320px touch target, focus trap and nested Escape', async ({ page }) => {
  await openCreator(page, 'poll', '', 320, 'rtl');
  await next(page);
  const groups = page.getByRole('checkbox', { name: 'Selected Groups', exact: true });
  const labelBox = await groups.locator('..').boundingBox();
  expect(labelBox!.height).toBeGreaterThanOrEqual(44);
  expect(labelBox!.width).toBeGreaterThanOrEqual(44);
  const trigger = page.getByRole('button', { name: 'Choose selected groups', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Selected Groups', exact: true });
  const back = dialog.getByRole('button', { name: 'Back from selected groups', exact: true });
  await expect(back).toBeFocused();
  expect(await page.locator('#root').evaluate(element => element.inert)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('textbox', { name: 'Search groups', exact: true })).toBeFocused();
  await dialog.getByRole('checkbox', { name: 'Fixture Group', exact: true }).check();
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await save.focus();
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('alertdialog', { name: 'Discard group changes?', exact: true });
  const keep = confirm.getByRole('button', { name: 'Keep Editing', exact: true });
  await expect(keep).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm.getByRole('button', { name: 'Discard', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(keep).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(back).toBeFocused();
  await expect(dialog.getByRole('checkbox', { name: 'Fixture Group', exact: true })).toBeChecked();
  await save.click();
  await expect(trigger).toBeFocused();
  expect(await page.locator('#root').evaluate(element => element.inert)).toBe(false);
  await expect(groups).toBeChecked();
});


test('quiz: single question blank title preserves question without heading', async ({ page }) => {
  await openCreator(page, 'quiz', '&blankQuiz&singleQuiz&publishPreview', 390, 'ltr');
  await next(page);
  const payload = await submit(page);
  expect(payload.title).toBe('');
  expect(payload.sections[0].questions).toHaveLength(1);
  const preview = page.getByTestId('published-preview');
  await expect(preview.locator('h2')).toHaveCount(0);
  await expect(preview.getByText('Fixture question 1', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('single-question-quiz.png'), fullPage: true });
});

test('quiz: timed blank title keeps Start Quiz gate without placeholder heading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/tests/post-ui-e2e/index.html?blankTimedQuiz');
  const preview = page.getByTestId('timed-preview');
  await expect(preview.locator('h2')).toHaveCount(0);
  await expect(preview.locator('h3')).toHaveText(['Test Author']);
  await expect(preview.getByText('Timed fixture question', { exact: true })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('timed-quiz-start.png'), fullPage: true });
  await preview.getByRole('button', { name: 'Start Quiz', exact: true }).click();
  await expect(preview.getByText('Timed fixture question', { exact: true })).toBeVisible();
});
