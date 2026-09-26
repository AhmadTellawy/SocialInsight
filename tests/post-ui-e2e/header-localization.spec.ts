import { expect, test } from '@playwright/test';

for (const [language, signIn, signUp] of [
  ['en', 'Sign in', 'Sign up'],
  ['ar', 'تسجيل الدخول', 'إنشاء حساب'],
] as const) {
  test(`guest header renders scalar auth labels in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/tests/post-ui-e2e/index.html?header&lang=${language}&dir=${language === 'ar' ? 'rtl' : 'ltr'}`);
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('button', { name: signIn, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: signUp, exact: true })).toBeVisible();
    await expect(page.locator('header')).not.toContainText('returned an object instead of string');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}
