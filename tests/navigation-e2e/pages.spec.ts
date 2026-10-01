import { test, expect } from './fixtures';

test('Page owner creates, publishes, manages and opens the public Page', async ({ page, boot, state }, testInfo) => {
  state.pages = {};
  const ar = testInfo.project.name.startsWith('ar');
  await boot('/pages/mine');
  await expect(page.getByRole('heading', { name: ar ? 'صفحاتي' : 'My pages' })).toBeVisible();
  await page.getByRole('link', { name: ar ? 'إنشاء صفحة' : 'Create a page' }).first().click();
  await expect(page).toHaveURL('/pages/create');
  await page.locator('#page-field-name').fill('Navigation Test Studio');
  await page.locator('#page-field-bio').fill('Questions and ideas for our community');
  await page.locator('input[pattern="[a-zA-Z][a-zA-Z0-9_]{2,29}"]').fill('navigation_test_studio');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: ar ? 'متابعة' : 'Continue' }).click();
  await expect(page).toHaveURL(/\/pages\/create\?step=2&draft=/);
  await page.getByRole('button', { name: ar ? 'متابعة' : 'Continue' }).click();
  await expect(page).toHaveURL(/\/pages\/create\?step=3&draft=/);
  await expect(page.getByRole('heading', { name: 'Navigation Test Studio' }).first()).toBeVisible();
  await page.getByRole('button', { name: ar ? 'نشر الصفحة' : 'Publish page' }).click();
  await expect(page).toHaveURL(/\/pages\/manage\/00000000-0000-4000-8000-000000000101\?created=1/);
  await expect(page.getByText(ar ? 'نُشرت صفحتك' : 'Your page is published', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: ar ? 'عرض الصفحة العامة' : 'View public page' }).click();
  await expect(page).toHaveURL('/pages/navigation_test_studio');
  await expect(page.getByRole('heading', { name: 'Navigation Test Studio' })).toBeVisible();
  await expect(page.getByRole('link', { name: ar ? 'إدارة' : 'Manage', exact: true })).toBeVisible();
  expect(state.pages?.page?.publicationState).toBe('PUBLISHED');
  expect(state.calls).toContain('POST /api/pages');
  expect(state.calls).toContain('POST /api/pages/manage/00000000-0000-4000-8000-000000000101/lifecycle');
});

test('guest Following tab offers sign-in and preserves the return destination', async ({ page, boot, state }, testInfo) => {
  state.guest = true;
  state.pages = {};
  const ar = testInfo.project.name.startsWith('ar');
  await boot('/pages?tab=following');
  await expect(page.getByRole('heading', { name: ar ? 'سجّل الدخول لعرض الصفحات التي تتابعها' : 'Sign in to see the Pages you follow' })).toBeVisible();
  await page.getByRole('link', { name: ar ? 'تسجيل الدخول' : 'Sign in' }).click();
  await expect(page).toHaveURL('/login?returnTo=%2Fpages%3Ftab%3Dfollowing');
  expect(state.calls).not.toContain('GET /api/pages');
});

test('saved Page draft can recover from a transient management read failure', async ({ page, boot, state }, testInfo) => {
  const id = '00000000-0000-4000-8000-000000000101';
  state.pages = { failManageOnce: true, page: { id, kind: 'PAGE', handle: 'navigation_test_studio', name: 'Navigation Test Studio',
    category: 'company', bio: 'Questions and ideas', description: '', country: '', city: '', website: null,
    links: [], publicEmail: null, publicPhone: null, cta: null, avatarMediaId: null, coverMediaId: null,
    publicationState: 'DRAFT', platformState: 'NONE', role: 'OWNER', capabilities: ['editInfo'] } };
  const ar = testInfo.project.name.startsWith('ar');
  await boot(`/pages/create?draft=${id}&step=2`);
  await expect(page.getByRole('button', { name: ar ? 'إعادة المحاولة' : 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: ar ? 'إعادة المحاولة' : 'Try again' }).click();
  await expect(page.getByRole('heading', { name: ar ? 'أنشئ صفحتك' : 'Create your page' })).toBeVisible();
  await expect(page.getByText(ar ? 'حُفظت المسودة' : 'Your draft is saved', { exact: false })).toBeVisible();
});

test('temporary availability failure keeps the Pages entry reachable', async ({ page, boot, state }, testInfo) => {
  state.pages = { failAvailabilityOnce: true };
  const ar = testInfo.project.name.startsWith('ar');
  await boot('/');
  await expect(page.getByRole('button', { name: ar ? 'الصفحات' : 'Pages', exact: true })).toBeVisible();
  await page.getByRole('button', { name: ar ? 'الصفحات' : 'Pages', exact: true }).click();
  await expect(page).toHaveURL('/pages');
});

test('malformed public Page path shows a recoverable unavailable state', async ({ page, boot, state }, testInfo) => {
  state.pages = {};
  const ar = testInfo.project.name.startsWith('ar');
  await boot('/pages/%E0%A4%A');
  await expect(page.getByText(ar ? 'الصفحة غير متاحة' : 'Page unavailable', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: ar ? 'استكشف الصفحات' : 'Browse pages' }).click();
  await expect(page).toHaveURL('/pages');
});

test('extra public and management Page path segments are rejected', async ({ page, boot, state }, testInfo) => {
  state.pages = {};
  const ar = testInfo.project.name.startsWith('ar');
  for (const path of ['/pages/navigation_test_studio/extra', '/pages/manage/00000000-0000-4000-8000-000000000101/extra']) {
    await boot(path);
    await expect(page.getByText(ar ? 'الصفحة غير متاحة' : 'Page unavailable', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: ar ? 'استكشف الصفحات' : 'Browse pages' })).toBeVisible();
  }
  expect(state.calls).not.toContain('GET /api/pages/navigation_test_studio');
});
