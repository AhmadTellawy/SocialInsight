import { test, expect, type Page } from '@playwright/test';
import { AggregateResults } from '../../server/src/services/aggregateResults';
import { AnalysisResults, parseAnalysisQuery } from '../../server/src/services/analysisResults';

function results(search: URLSearchParams, rare = false) {
  const aggregate = new AggregateResults(), analysis = new AnalysisResults();
  for (const [count, country, gender, marital, first, second] of [
    [30, 'Jordan', 'Male', 'Single', 'a', ['a', 'b']], [20, 'Jordan', 'Female', 'Married', 'b', ['b']],
    [15, 'Egypt', 'Male', 'Married', 'a', ['a']], [15, 'Egypt', 'Female', 'Single', 'c', ['a', 'c']]
  ] as const) for (let i = 0; i < count; i++) {
    // Deliberately differs from the survey's question order; comparison must follow the visible question.
    const row = { answers: [...second.map(option => ({ questionId: 'q2', optionId: `q2${option}` })), { questionId: 'q1', optionId: `q1${first}` }], user: { birthday: new Date('1990-01-01'), country, demographics: { gender, maritalStatus: marital, nationality: rare && i === 0 && country === 'Jordan' && gender === 'Male' ? 'Rare' : country } } };
    aggregate.add(row); analysis.add(row);
  }
  return analysis.toJSON(parseAnalysisQuery(Object.fromEntries(search))!, aggregate.toJSON());
}
async function setup(page: Page, ar = true, options: { rare?: boolean; status?: number; delay?: number; private?: boolean } = {}) {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(language => localStorage.setItem('i18nextLng', language), ar ? 'ar' : 'en');
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); requests.push(url.pathname + url.search);
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    const status = options.status || 200;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? results(url.searchParams, options.rare) : { error: 'Synthetic failure' }) });
  });
  await page.goto(`/tests/analytics-e2e/index.html${options.private ? '?private=1' : ''}`, { waitUntil: 'domcontentloaded' });
  return { errors, requests, options };
}
for (const ar of [true, false]) for (const width of [384, 320]) test(`results, filtering, comparison and details ${ar ? 'RTL' : 'LTR'} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 832 });
  const state = await setup(page, ar);
  const root = page.locator('.an-root').first(), select = root.locator('select');
  await expect(root.locator('.an-answer')).toHaveCount(3);
  await expect(root.locator('.an-sample')).toContainText('80');
  await expect(root.locator('.an-answer').first()).toContainText('56.3%');
  await expect(root.getByRole('button', { name: ar ? 'الجمهور' : 'Audience', exact: true })).toHaveCount(0);
  await expect(select.locator('option')).toHaveCount(10);
  await select.selectOption('gender'); await expect(root.locator('.an-group')).toHaveCount(2);
  await expect(root.locator('.an-reference')).toContainText('80');
  await expect(root.locator('.an-reference .an-stacked')).toContainText('56.3%');
  await expect(select).toBeFocused();
  await root.locator('.an-group').first().click();
  await expect(page.locator('.an-cohort-detail')).toHaveCount(3); await expect(page.locator('.an-cohort-detail').first()).toContainText(ar ? 'نقطة مئوية' : 'percentage points');
  await page.keyboard.press('Escape');
  await root.getByRole('button', { name: ar ? 'السؤال 2' : 'Question 2', exact: true }).click();
  await expect(root.locator('.an-multiple-bars')).toHaveCount(3);
  await expect(root.locator('.an-reference')).toContainText('75%');
  await select.selectOption(''); await expect(root.locator('.an-answer')).toHaveCount(3);
  await root.getByRole('button', { name: ar ? 'تصفية' : 'Filter', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.an-filter-heading').nth(0).click();
  await dialog.getByRole('searchbox').fill(ar ? 'الأردن' : 'Jordan');
  await dialog.locator('.an-filter-group').nth(0).getByLabel(ar ? 'الأردن' : 'Jordan', { exact: true }).check();
  await dialog.locator('.an-filter-heading').nth(1).click();
  await dialog.locator('.an-filter-group').nth(1).getByLabel(ar ? 'ذكر' : 'Male', { exact: true }).check();
  await dialog.getByRole('button', { name: ar ? 'تطبيق الفلاتر' : 'Apply filters' }).click();
  await expect(root.locator('.an-sample')).toContainText('30');
  await expect(root.locator('.an-answer').first()).toContainText('100%');
  await root.getByRole('button', { name: ar ? 'مسح الكل' : 'Clear all', exact: true }).click();
  await expect(root.locator('.an-sample')).toContainText('80');
  await root.getByRole('button', { name: ar ? 'السؤال 1' : 'Question 1', exact: true }).click();
  await expect(root.locator('.an-answer')).toHaveCount(3);
  await expect(root.locator('h1')).toContainText('عندما تستخدم تطبيقًا');
  await expect(root.getByRole('button', { name: ar ? 'مشاركة التحليل' : 'Share analysis', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/analytics/results-${ar ? 'ar' : 'en'}-${width}.png`, fullPage: true });
  expect(state.errors).toEqual([]); expect(state.requests.some(url => url.includes('filters='))).toBe(true);
});
test('image export and result-post preview work without publishing', async ({ page }) => {
  const state = await setup(page); await expect(page.locator('.an-answer')).toHaveCount(3);
  await page.getByRole('button', { name: 'مشاركة التحليل', exact: true }).click();
  await page.getByRole('button', { name: /صور خارج التطبيق/ }).click();
  await expect(page.locator('.an-export-choice')).toHaveCount(2);
  await page.getByRole('button', { name: /معاينة الصور/ }).click(); await expect(page.locator('.an-export-card')).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'تنزيل الصورة', exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toMatch(/\.png$/);
  await downloaded.saveAs('test-results/analytics/export-preview.png');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'مشاركة التحليل', exact: true }).click();
  await page.getByRole('button', { name: /معاينة منشور النتائج/ }).click(); await page.getByRole('textbox').fill('نتائج مهمة');
  await expect(page.getByText('هذه معاينة فقط، ولم يُنشر شيء.')).toBeVisible();
  expect(state.errors).toEqual([]); expect(state.requests.every(url => url.includes('/results?'))).toBe(true);
});
test('suppression retains overall reference and public filter options open without leaking participant categories', async ({ page }) => {
  await setup(page, true, { rare: true }); await expect(page.locator('.an-answer')).toHaveCount(3);
  await page.locator('.an-content select').selectOption('gender'); await expect(page.locator('.an-reference')).toContainText('80');
  await expect(page.locator('.an-group')).toHaveCount(0); await expect(page.getByText(/لا تتوفر هذه التفاصيل/)).toBeVisible();
  await page.getByRole('button', { name: 'تصفية', exact: true }).click(); const dialog = page.getByRole('dialog');
  for (let index = 0; index < 9; index++) {
    await dialog.locator('.an-filter-heading').nth(index).click();
    await expect(dialog.getByRole('checkbox').first()).toBeVisible();
    expect(await dialog.getByRole('checkbox').count()).toBeGreaterThan(1);
  }
  await expect(dialog.getByLabel('Rare', { exact: true })).toHaveCount(0);
  await dialog.locator('.an-filter-heading').nth(1).click();
  await dialog.getByLabel('ذكر', { exact: true }).check();
  await dialog.getByRole('button', { name: 'تطبيق الفلاتر' }).click();
  await expect(page.locator('.an-content').getByText(/لا تتوفر هذه التفاصيل/)).toBeVisible();
  await page.getByRole('button', { name: 'عرض الإجمالي', exact: true }).click();
  await expect(page.locator('.an-answer')).toHaveCount(3);
});
test('loading is distinct from zero; failed request can retry and denied results cannot be shared', async ({ page }) => {
  const state = await setup(page, true, { delay: 500, status: 500 });
  await expect(page.getByRole('status')).toHaveText('جارٍ تحميل النتائج…'); await expect(page.getByRole('alert')).toContainText('تعذر تحميل النتائج.');
  state.options.status = 200; state.options.delay = 0; await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click(); await expect(page.locator('.an-answer')).toHaveCount(3);
  state.options.status = 403; await page.locator('.an-content select').selectOption('gender');
  await expect(page.getByRole('status')).toContainText('النتائج غير متاحة'); await expect(page.getByRole('button', { name: 'مشاركة التحليل', exact: true })).toBeDisabled(); await expect(page.locator('.an-answer')).toHaveCount(0);
});
test('private Page analytics retain their dedicated capability route', async ({ page }) => {
  const state = await setup(page, true, { private: true }); await expect(page.locator('.an-answer')).toHaveCount(3);
  expect(state.requests[0]).toContain('/api/pages/manage/private-page/content/analysis-fixture/results?');
});

test('actual App route displays one analytics header and returns to the post', async ({ page }) => {
  test.setTimeout(60_000);
  const profile = { id: 'analysis-owner', name: 'Analysis owner', handle: 'analysis_owner', email: 'analysis@example.invalid', avatar: '', language: 'ar', theme: 'light', country: 'Jordan', demographics: {}, groups: [], interests: [], stats: { followers: 0, following: 0, posts: 1, responses: 0 } };
  const post = { id: 'analysis-fixture', title: 'اختبار التحليلات داخل التطبيق', description: '', type: 'Poll', status: 'PUBLISHED', author: profile, options: ['a', 'b', 'c'].map((value, index) => ({ id: `q1${value}`, text: ['سهولة الاستخدام', 'سرعة التطبيق', 'وضوح النتائج'][index], votes: 0 })), sections: [{ id: 'section', title: '', questions: [{ id: 'q1', text: 'ما العامل الأهم بالنسبة لك؟', type: 'multiple_choice', maxSelection: 1, options: ['a', 'b', 'c'].map((value, index) => ({ id: `q1${value}`, text: ['سهولة الاستخدام', 'سرعة التطبيق', 'وضوح النتائج'][index], votes: 0 })) }] }], demographics: [], pollChoiceType: 'single', resultsVisibility: 'Public', resultsWho: 'Public', resultsTiming: 'AnyTime', allowSharing: true, expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', participants: 80, likes: 0, commentsCount: 0 };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(user => { localStorage.setItem('si_user', JSON.stringify(user)); localStorage.setItem('i18nextLng', 'ar'); }, profile);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let body: unknown = [];
    if (path === '/api/auth/session') body = { user: profile, csrfToken: 'synthetic-analysis-csrf' };
    else if (path === '/api/users/me') body = profile;
    else if (path === '/api/posts') body = { data: [post], nextCursor: null };
    else if (path === '/api/posts/analysis-fixture') body = post;
    else if (path === '/api/posts/analysis-fixture/results') body = results(url.searchParams);
    else if (path.endsWith('/views')) body = { success: true };
    else if (path === '/api/analytics/interactions/batch') body = { acceptedIds: route.request().postDataJSON().events.map((event: any) => event.id), rejected: [], retryableIds: [] };
    else if (route.request().method() !== 'GET') throw new Error(`Unexpected fixture write: ${path}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.setViewportSize({ width: 384, height: 832 });
  await page.goto('/post/analysis-fixture?tab=analysis');
  await expect(page.locator('.an-answer')).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByText('Detail View', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'مشاركة التحليل', exact: true })).toHaveCount(1);
  await page.locator('.an-content select').selectOption('gender');
  await expect(page.locator('.an-group')).toHaveCount(2);
  await expect(page.locator('.an-reference .an-stacked')).toContainText('56.3%');
  await page.screenshot({ path: 'test-results/analytics/app-ar-384.png', fullPage: true });
  await page.getByRole('button', { name: 'عرض المنشور', exact: true }).click();
  await expect(page).toHaveURL(/\/post\/analysis-fixture$/);
  await expect(page.getByText('Detail View', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Analysis', exact: true }).filter({ hasText: 'Analysis' }).click();
  await expect(page.locator('.an-answer')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('transient failures preserve clearly labelled results and filters can recover without retry', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('.an-answer')).toHaveCount(3);
  state.options.status = 500; state.options.delay = 700;
  await page.locator('.an-content select').selectOption('gender');
  await expect(page.getByRole('status')).toContainText('جارٍ التحديث');
  await expect(page.locator('.an-answer')).toHaveCount(3);
  await expect(page.getByRole('alert')).toContainText('آخر نتائج ناجحة');
  await expect(page.getByRole('button', { name: 'تصفية', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'مشاركة التحليل', exact: true })).toBeDisabled();
  state.options.status = 200; state.options.delay = 0;
  await page.locator('.an-content select').selectOption('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'مشاركة التحليل', exact: true })).toBeEnabled();
});

test('rapid comparison changes are coalesced and stale replies cannot overwrite the latest selection', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('.an-answer')).toHaveCount(3);
  const before = state.requests.length;
  state.options.delay = 700;
  const select = page.locator('.an-content select');
  await select.selectOption('gender');
  await page.waitForTimeout(250);
  await select.selectOption('country');
  await select.selectOption('age');
  await select.selectOption('marital');
  await expect(page.locator('.an-group').first()).toBeVisible();
  await expect(select).toHaveValue('marital');
  await expect(page.locator('.an-group').first()).toContainText('متزوج');
  expect(state.requests.length - before).toBeLessThanOrEqual(2);
  expect(state.requests.at(-1)).toContain('compareBy=marital');
});

test.describe('Android touch filters', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 384, height: 832 } });
  test('all nine sections expand, selecting and clearing remain reachable', async ({ page }) => {
    await setup(page, true, { rare: true });
    await expect(page.locator('.an-answer')).toHaveCount(3);
    await page.getByRole('button', { name: 'تصفية', exact: true }).tap();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'إغلاق', exact: true })).toBeFocused();
    await dialog.locator('.an-filter-heading').nth(1).tap();
    await dialog.getByLabel('أنثى', { exact: true }).tap();
    await expect(dialog.getByLabel('أنثى', { exact: true })).toBeChecked();
    const apply = dialog.getByRole('button', { name: 'تطبيق الفلاتر', exact: true });
    const box = await apply.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(832);
    await page.screenshot({ path: 'test-results/analytics/filters-touch-ar.png' });
    await dialog.getByRole('button', { name: 'مسح الاختيارات', exact: true }).tap();
    await expect(dialog.getByLabel('أنثى', { exact: true })).not.toBeChecked();
    await dialog.getByRole('button', { name: 'إغلاق', exact: true }).tap();
    await expect(dialog).not.toBeVisible();
  });
});
