import { test, expect, type Locator } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); });

const names = ['... 123 الخيار العربي الكامل يحتاج إلى سطرين دون اختصار', '... 123 English option name remains fully readable across multiple lines'];
async function contentStyle(locator: Locator, direction: string, fontSize = '12px') {
  await expect(locator).toHaveCSS('font-size', fontSize);
  await expect(locator).toHaveCSS('font-weight', '400');
  await expect(locator).toHaveCSS('text-align', 'start');
  await expect(locator).toHaveCSS('direction', direction);
  await expect(locator).toHaveAttribute('dir', 'auto');
}

for (const width of [390, 768, 1280]) for (const dir of ['ltr', 'rtl']) for (const layout of ['horizontal', 'vertical', 'text']) {
  test(`${width} ${dir} ${layout}: real post and option UI`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(`/tests/post-ui-e2e/index.html?dir=${dir}&layout=${layout}`);
    const post = page.getByTestId('post');
    await contentStyle(post.locator('h2[dir="auto"]'), 'rtl');
    await contentStyle(post.locator('p[dir="auto"]').filter({ hasText: 'English post text' }), 'ltr', '16px');
    const carousel = post.getByRole('region', { name: 'Post images' });
    await expect(carousel.getByRole('status')).toHaveText('1/3');
    await expect(carousel).toHaveCSS('border-radius', '0px');
    const outer = await post.boundingBox();
    const imageBox = await carousel.boundingBox();
    expect(Math.abs(outer!.x - imageBox!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(outer!.width - imageBox!.width)).toBeLessThanOrEqual(2);
    await expect(carousel.locator('img').first()).toHaveCSS('object-fit', 'contain');
    await carousel.focus();
    await page.keyboard.press(dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    await expect(carousel.getByRole('status')).toHaveText('2/3');
    await expect.poll(async () => carousel.locator('[role="group"]').nth(1).evaluate(el => Math.round(el.getBoundingClientRect().x))).toBe(Math.round(imageBox!.x));
    const single = page.getByTestId('single').getByRole('region');
    await expect(single.getByRole('status')).toHaveCount(0);
    await expect(single).toHaveCSS('border-radius', '0px');
    const section = page.getByTestId('options');
    for (const [index, name] of names.entries()) {
      const label = section.getByText(name, { exact: true });
      await contentStyle(label, index ? 'ltr' : 'rtl');
      expect(await label.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    }
    if (layout === 'horizontal') {
      const row = section.locator('.snap-x');
      const first = await row.locator(':scope > div').first().boundingBox();
      const rowBox = await row.boundingBox();
      expect(first!.width).toBeLessThan(rowBox!.width);
      expect(first!.width / rowBox!.width).toBeGreaterThanOrEqual(0.8);
      if (width === 390) expect(await section.getByText(names[0], { exact: true }).evaluate(el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))).toBeGreaterThanOrEqual(2);
    }
    await section.screenshot({ path: testInfo.outputPath('before-vote.png') });
    await section.getByRole('button', { name: names[0], exact: true }).click();
    await expect(section.getByText('60%', { exact: true })).toBeVisible();
    if (layout === 'horizontal') {
      await expect(section.getByText('Voted', { exact: true })).toBeVisible();
      await expect(section.getByText('6 votes', { exact: true })).toBeVisible();
    }
    for (const [index, name] of names.entries()) {
      const label = section.getByText(name, { exact: true });
      await contentStyle(label, index ? 'ltr' : 'rtl');
      expect(await label.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    }
    await section.screenshot({ path: testInfo.outputPath('after-vote.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('touch swipe and single-image real post', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/tests/post-ui-e2e/index.html?dir=ltr');
  const carousel = page.getByTestId('post').getByRole('region');
  await expect(carousel.getByRole('status')).toHaveText('1/3');
  const box = (await carousel.boundingBox())!;
  const session = await context.newCDPSession(page);
  const y = box.y + box.height / 2;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width - 30, y }] });
  for (let i = 1; i <= 10; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width - 30 - i * (box.width - 60) / 10, y }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(carousel.getByRole('status')).toHaveText('2/3');
  await page.goto('/tests/post-ui-e2e/index.html?single');
  const single = page.getByTestId('post').getByRole('region');
  await expect(single.getByRole('status')).toHaveCount(0);
  await expect(single.locator('img')).toHaveCSS('object-fit', 'contain');
  await expect(single).toHaveCSS('border-radius', '0px');
  const postBox = (await page.getByTestId('post').boundingBox())!;
  const singleBox = (await single.boundingBox())!;
  expect(Math.abs(postBox.width - singleBox.width)).toBeLessThanOrEqual(2);
  await page.getByTestId('post').screenshot({ path: testInfo.outputPath('single-post.png') });
});

test('private results and hidden names policies remain respected', async ({ page }) => {
  await page.goto('/tests/post-ui-e2e/index.html?private&hiddenNames');
  const section = page.getByTestId('options');
  await expect(section.getByText(names[0], { exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Image option 1', exact: true }).click();
  await expect(section.getByText('Voted', { exact: true })).toBeVisible();
  await expect(section.getByText('60%', { exact: true })).toHaveCount(0);
  await expect(section.getByText('6 votes', { exact: true })).toHaveCount(0);
});

for (const create of ['poll', 'survey', 'quiz', 'challenge']) test(`320px ${create} composer independent text direction`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/tests/post-ui-e2e/index.html?create=${create}&dir=rtl`);
  const fields = page.locator('textarea, input[type="text"]').filter({ visible: true });
  await expect(fields.first()).toBeVisible();
  const count = await fields.count();
  expect(count).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    if ((await field.getAttribute('placeholder'))?.startsWith('Add ')) continue;
    await field.fill(i % 2 ? names[1] : names[0]);
    const isDescription = (await field.getAttribute('placeholder'))?.startsWith('Describe what');
    await contentStyle(field, i % 2 ? 'ltr' : 'rtl', isDescription ? '16px' : '12px');
    const box = (await field.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
  }
  await page.screenshot({ path: testInfo.outputPath('composer-320.png') });
});

for (const type of ['survey', 'quiz']) test(`${type} interactive question image is full bleed and heading independent`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/tests/post-ui-e2e/index.html?interactive=${type}&dir=rtl`);
  const card = page.getByTestId('interactive');
  const question = card.getByText('... 123 English independent question', { exact: true });
  await contentStyle(question, 'ltr');
  const image = card.getByRole('img', { name: 'Question context', exact: true });
  await expect(image).toHaveCSS('object-fit', 'contain');
  const cardBox = (await card.boundingBox())!;
  const imageBox = (await image.boundingBox())!;
  expect(Math.abs(cardBox.x - imageBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(cardBox.width - imageBox.width)).toBeLessThanOrEqual(2);
  await image.screenshot({ path: testInfo.outputPath('interactive-question.png') });
});

for (const create of ['poll', 'survey', 'quiz', 'challenge']) test(`320px ${create} image option composer`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/tests/post-ui-e2e/index.html?create=${create}&creationImages&dir=rtl`);
  for (const [index, name] of names.entries()) {
    const target = page.locator('input[type="text"]').filter({ visible: true });
    const indexOfField = await target.evaluateAll((nodes, expected) => nodes.findIndex(node => (node as HTMLInputElement).value === expected), name);
    expect(indexOfField).toBeGreaterThanOrEqual(0);
    const input = target.nth(indexOfField);
    await contentStyle(input, index ? 'ltr' : 'rtl');
    const box = (await input.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
  }
  await page.screenshot({ path: testInfo.outputPath('image-composer-320.png') });
});

test('challenge pair and winner retain full independent option typography', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/tests/post-ui-e2e/index.html?challenge&dir=rtl');
  const card = page.getByTestId('challenge');
  for (const [i, name] of names.entries()) await contentStyle(card.getByText(name, { exact: true }), i ? 'ltr' : 'rtl');
  await card.getByRole('button', { name: names[0], exact: true }).click();
  await expect(card.getByText('Your Final Choice', { exact: true })).toBeVisible();
  await contentStyle(card.locator('h4').filter({ hasText: names[0] }), 'rtl');
  await card.screenshot({ path: testInfo.outputPath('challenge-winner.png') });
});

test('embedded repost media fills embedded post and caption has independent direction', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/tests/post-ui-e2e/index.html?repost&dir=ltr');
  const card = page.getByTestId('repost');
  await contentStyle(card.getByText('... 123 تعليق عربي مستقل', { exact: true }).locator('xpath=ancestor::*[@dir="auto"][1]'), 'rtl', '16px');
  const carousel = card.getByRole('region');
  await expect(carousel).toHaveCSS('border-radius', '0px');
  const edge = await carousel.evaluate(el => {
    const frame = el.closest('.border-gray-200.rounded-2xl');
    return frame ? { width: frame.getBoundingClientRect().width, mediaWidth: el.getBoundingClientRect().width } : null;
  });
  expect(edge).not.toBeNull();
  expect(Math.abs(edge!.width - edge!.mediaWidth)).toBeLessThanOrEqual(2);
  await card.screenshot({ path: testInfo.outputPath('embedded-repost.png') });
});

test('post title mention and hashtag retain 12px normal weight', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/tests/post-ui-e2e/index.html?richTitle&dir=rtl');
  const title = page.getByTestId('post').locator('h2[dir="auto"]');
  await contentStyle(title, 'rtl');
  const links = title.locator('a');
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    await expect(link).toHaveCSS('font-size', '12px');
    await expect(link).toHaveCSS('font-weight', '400');
  }
});
