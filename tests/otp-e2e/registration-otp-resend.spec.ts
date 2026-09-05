import { expect, test, type Route } from '@playwright/test';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('registration capability and resend honor cooldown/failure state while keeping the JWT contract', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install({ time: new Date('2026-09-05T12:00:00.000Z') });
  let sendCalls = 0;
  let completionPayload: any;
  const registrationSecret = 'A'.repeat(43);
  const pendingReference = `pending-e2e.${registrationSecret}`;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'POST' && url.pathname === '/api/auth/register/init') {
      return json(route, { success: true, pendingId: pendingReference });
    }
    if (method === 'POST' && url.pathname === '/api/auth/register/password') {
      expect(request.postDataJSON().pendingId).toBe(pendingReference);
      return json(route, { success: true });
    }
    if (method === 'GET' && url.pathname === '/api/auth/handle/check') return json(route, { available: true });
    if (method === 'POST' && url.pathname === '/api/auth/handle/reserve') {
      expect(request.postDataJSON().pendingId).toBe(pendingReference);
      return json(route, { success: true });
    }
    if (method === 'POST' && url.pathname === '/api/auth/register/otp/send') {
      sendCalls += 1;
      expect(request.postDataJSON()).toEqual({ pendingId: pendingReference });
      if (sendCalls === 2) {
        return json(route, {
          error: 'Please wait before requesting another code',
          code: 'OTP_COOLDOWN',
          retryAfterSeconds: 2,
          cooldownUntil: '2026-09-05T12:00:04.000Z'
        }, 429);
      }
      if (sendCalls === 3) {
        return json(route, { error: 'Unable to send verification code', code: 'OTP_DELIVERY_FAILED' }, 503);
      }
      return json(route, {
        success: true,
        message: 'OTP sent successfully',
        cooldownUntil: sendCalls === 1 ? '2026-09-05T12:00:01.000Z' : '2026-09-05T12:02:01.000Z'
      });
    }
    if (method === 'POST' && url.pathname === '/api/auth/register/complete') {
      completionPayload = request.postDataJSON();
      return json(route, {
        user: { id: 'user-e2e', name: 'OTP E2E', handle: 'otp_e2e', email: 'otp-e2e@example.test' },
        token: 'jwt-contract-token'
      });
    }
    return json(route, {});
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.getByPlaceholder('e.g. John Doe').fill('OTP E2E');
  await page.getByPlaceholder('you@example.com').fill('otp-e2e@example.test');
  const selects = page.locator('select');
  await selects.nth(0).selectOption('2');
  await selects.nth(1).selectOption('9');
  await selects.nth(2).selectOption('2000');
  await page.getByText('I agree to the').locator('..').getByRole('button').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByPlaceholder('Your password').fill('StrongPass1!');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder('e.g. johndoe').fill('otp_e2e');
  await page.clock.fastForward(600);
  await expect(page.getByText('@otp_e2e is available!')).toBeVisible();
  await page.getByRole('button', { name: 'Complete Sign Up' }).click();

  await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
  expect(sendCalls).toBe(1);
  await page.clock.runFor(2_000);

  const otpInputs = page.locator('input[id^="otp-"]');
  for (let index = 0; index < 6; index += 1) await otpInputs.nth(index).fill(String(index + 1));
  await page.getByRole('button', { name: 'Resend Code' }).click();
  await expect(page.getByRole('status')).toContainText('Please wait before requesting another code');
  await expect(otpInputs.nth(0)).toHaveValue('1');
  expect(sendCalls).toBe(2);
  await expect(page.getByRole('button', { name: /Resend code in 2s/ })).toBeDisabled();
  await page.clock.runFor(3_000);

  await page.getByRole('button', { name: 'Resend Code' }).click();
  await expect(page.getByRole('status')).toContainText('Unable to send verification code');
  for (let index = 0; index < 6; index += 1) await expect(otpInputs.nth(index)).toHaveValue('');
  expect(sendCalls).toBe(3);

  await page.getByRole('button', { name: 'Resend Code' }).click();
  await expect(page.getByRole('status')).toContainText('A new code was sent.');
  expect(sendCalls).toBe(4);
  for (let index = 0; index < 6; index += 1) await expect(otpInputs.nth(index)).toHaveValue('');

  for (let index = 0; index < 6; index += 1) await otpInputs.nth(index).fill(String(index + 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect.poll(() => completionPayload).toEqual({ pendingId: pendingReference, code: '123456' });
});
