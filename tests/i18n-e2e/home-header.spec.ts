import { expect, test } from '@playwright/test';

for (const locale of ['en', 'ar'] as const) {
  test(`Home header uses string labels and ${locale} page direction`, async ({ page }) => {
    const i18nErrors: string[] = [];
    page.on('console', message => {
      if (/returned an object instead of string/i.test(message.text())) i18nErrors.push(message.text());
    });
    await page.addInitScript((language) => localStorage.setItem('i18nextLng', language), locale);
    await page.goto('/');

    const signIn = locale === 'ar' ? 'تسجيل الدخول' : 'Sign in';
    const signUp = locale === 'ar' ? 'إنشاء حساب' : 'Sign up';
    await expect(page.locator('header').getByRole('button', { name: signIn, exact: true })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: signUp, exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByText(/returned an object instead of string/i)).toHaveCount(0);
    expect(i18nErrors).toEqual([]);

    const header = await page.locator('header').boundingBox();
    expect(header).not.toBeNull();
    expect(header!.x).toBeGreaterThanOrEqual(0);
    expect(header!.x + header!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });
}
