import { test, expect, type Page, type Locator } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
});

async function open(page: Page, kind: string, images = false, width = 320) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`/tests/post-ui-e2e/index.html?creatorSteps&create=${kind}&dir=${width === 320 ? 'rtl' : 'ltr'}${images ? '&stepsImages' : ''}`);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
}

function answer(page: Page, index = 1) {
  return page.getByPlaceholder(new RegExp(`^Option (?:name )?${index}$`)).first();
}

async function metrics(input: Locator) {
  return input.evaluate(element => {
    const style = getComputedStyle(element);
    const wrapper = getComputedStyle(element.parentElement!);
    return {
      input: Object.fromEntries(['fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'textAlign'].map(key => [key, style[key as any]])),
      row: Object.fromEntries(['borderTopWidth', 'borderRadius', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'minHeight'].map(key => [key, wrapper[key as any]])),
      height: element.parentElement!.getBoundingClientRect().height,
    };
  });
}

for (const kind of ['survey', 'quiz']) {
  for (const images of [false, true]) {
    for (const width of [320, 1280]) {
      test(`${kind} ${images ? 'image' : 'text'} options match Poll at ${width}`, async ({ page }) => {
        await open(page, 'poll', images, width);
        const reference = await metrics(answer(page));
        const addReference = await metrics(page.getByPlaceholder('Add option...', { exact: true }));
        await open(page, kind, images, width);
        const first = answer(page);
        expect(await metrics(first)).toEqual(reference);
        expect(await metrics(page.getByPlaceholder('Add option...', { exact: true }))).toEqual(addReference);
        await expect(first).toHaveAttribute('dir', 'auto');
        // The question editor must not add a framed card around the answer area.
        expect(await first.evaluate(element => {
          let parent = element.parentElement;
          while (parent && !parent.querySelector('textarea')) parent = parent.parentElement;
          return parent ? { border: getComputedStyle(parent).borderTopWidth, shadow: getComputedStyle(parent).boxShadow } : null;
        })).toEqual({ border: '0px', shadow: 'none' });
        await first.fill('');
        expect((await metrics(first)).height).toBe(reference.height);
        await first.fill(width === 320 ? '... 123 خيار عربي جديد' : '... 123 New English answer');
        await expect(first).toHaveCSS('direction', width === 320 ? 'rtl' : 'ltr');
        expect((await metrics(first)).input).toEqual(reference.input);
        const correct = kind === 'quiz' ? page.getByRole('button', { name: 'Mark option 2 as correct', exact: true }) : null;
        if (correct) {
          await correct.click();
          await expect(correct).toHaveAttribute('aria-pressed', 'true');
        }
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(first).toHaveValue(width === 320 ? '... 123 خيار عربي جديد' : '... 123 New English answer');
        if (correct) await expect(correct).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath('options.png'), fullPage: true });
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.getByRole('button', { name: 'Post', exact: true }).click();
        await expect(page.getByTestId('step-submit-count')).toHaveText('1');
        const payload = JSON.parse((await page.getByTestId('step-submit-payload').textContent())!);
        const question = payload.sections[0].questions[0];
        expect(question.options).toHaveLength(2);
        if (images) expect(question.options.every((option: any) => option.image || option.imageMediaId)).toBe(true);
        if (kind === 'quiz') expect(question.correctOptionId).toBe('step-option-1');
        expect(payload.targetAudience).toBe('Public');
      });
    }
  }
}

for (const kind of ['poll', 'survey', 'quiz', 'challenge']) {
  test(`${kind} second step follows Poll ordering and retains settings`, async ({ page }) => {
    await open(page, kind);
    if (kind === 'survey') {
      const title = page.getByPlaceholder('Survey Title', { exact: true });
      const description = page.getByPlaceholder('Describe what this survey is about...', { exact: true });
      await expect(description).toHaveCSS('font-size', await title.evaluate(element => getComputedStyle(element).fontSize));
      await expect(description).toHaveCSS('font-weight', '400');
      await expect(description).toHaveAttribute('dir', 'auto');
      await description.fill('... 123 وصف عربي مستقل');
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const visibility = page.getByRole('heading', { name: 'Post visibility', exact: true });
    const advanced = page.getByText('Advanced Settings', { exact: true }).filter({ visible: true });
    const analytics = page.getByText('Unlock Deeper Analytics', { exact: true });
    const [v, a, d] = await Promise.all([visibility.boundingBox(), advanced.boundingBox(), analytics.boundingBox()]);
    expect(v!.y).toBeLessThan(a!.y);
    expect(a!.y).toBeLessThan(d!.y);
    await page.getByRole('button', { name: /^custom$/i }).click();
    await page.getByRole('button', { name: /^Gender(?:\s|$)/ }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByTestId('step-submit-count')).toHaveText('1');
    const payload = JSON.parse((await page.getByTestId('step-submit-payload').textContent())!);
    expect(payload.demographics).toContain('gender');
    expect(payload.targetAudience).toBe('Public');
    if (kind === 'survey') expect(payload.description).toBe('... 123 وصف عربي مستقل');
  });
}

test('quiz image width and removal preserve the answer at 320', async ({ page }) => {
  await open(page, 'poll', true);
  const widths = (input: Locator) => input.evaluate(element => ({
    input: element.getBoundingClientRect().width,
    row: element.parentElement!.getBoundingClientRect().width,
  }));
  const poll = await widths(answer(page));
  await open(page, 'quiz', true);
  const quiz = await widths(answer(page));
  // Compare space inside the row independently of the creator inset and correct selector.
  expect(poll.input).toBeGreaterThanOrEqual(100);
  expect(quiz.input).toBeGreaterThanOrEqual(80);
  expect(quiz.row - quiz.input).toBeLessThanOrEqual(poll.row - poll.input + 2);
  const first = answer(page);
  await first.fill('إجابة صحيحة محفوظة');
  await page.getByRole('button', { name: 'Mark option 1 as correct', exact: true }).click();
  const remove = page.getByRole('button', { name: 'Remove image from option 1', exact: true });
  await expect(remove).toHaveCSS('position', 'absolute');
  const bounds = (await remove.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(24);
  expect(bounds.height).toBeGreaterThanOrEqual(24);
  await remove.click();
  await expect(remove).toBeHidden();
  await expect(first).toHaveValue('إجابة صحيحة محفوظة');
  await expect(page.getByRole('button', { name: 'Mark option 1 as correct', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Post visibility', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByTestId('step-submit-count')).toHaveText('1');
  const payload = JSON.parse((await page.getByTestId('step-submit-payload').textContent())!);
  expect(payload.sections[0].questions[0].correctOptionId).toBe('step-option-0');
  expect(payload.sections[0].questions[0].options[0].text).toBe('إجابة صحيحة محفوظة');
});
