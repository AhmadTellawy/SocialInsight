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

  test(`${kind}: category validation, tag chips and final payload`, async ({ page }) => {
    await openCreator(page, kind, '&missingCategory', 768, 'rtl');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByTestId('step-submit-count')).toHaveText('0');
    await expect(page.getByRole('heading', { name: 'Post visibility', exact: true })).toBeHidden();
    if (!(await page.getByRole('heading', { name: 'Select Category', exact: true }).isVisible())) {
      await page.getByRole('button', { name: 'Category', exact: true }).click();
    }
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
    await next(page);
    const payload = await submit(page);
    expect(payload.category).toBe('Sports');
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

  test(`${kind}: no destination and missing groups are rejected before a union submission`, async ({ page }) => {
    await openCreator(page, kind, '', 1280, index % 2 ? 'rtl' : 'ltr');
    await next(page);
    await expect(page.getByRole('checkbox', { name: 'Custom Audience', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'My Profile', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByText('Select at least one destination.', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('step-submit-count')).toHaveText('0');
    await page.getByRole('checkbox', { name: 'Selected Groups', exact: true }).check();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByTestId('step-submit-count')).toHaveText('0');
    await expect(page.getByRole('checkbox', { name: 'Unavailable Group', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Fixture Group', exact: true }).check();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'My Profile', exact: true }).check();
    const payload = await submit(page);
    expect(payload.targetAudience).toBe('ProfileAndGroups');
    expect(payload.targetGroups).toEqual(['fixture-group']);
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
    await expect(page.getByRole('checkbox', { name: 'Fixture Group', exact: true })).toBeChecked();
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
