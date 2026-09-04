import assert from 'node:assert/strict';
import test from 'node:test';
import { Resend } from 'resend';
import { buildAuthEmailContent, maskEmail, sendAuthEmail } from './emailService';

const envKeys = ['NODE_ENV', 'RESEND_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'] as const;
const restoreEnv = (snapshot: Record<string, string | undefined>) => {
  for (const key of envKeys) snapshot[key] === undefined ? delete process.env[key] : process.env[key] = snapshot[key]!;
};

test('email template uses configured TTL and includes bilingual ignore/security copy', () => {
  const content = buildAuthEmailContent({ code: '123456', purpose: 'PASSWORD_RESET', expiresInMinutes: 7 });
  assert.match(content.text, /expires in 7 minutes/i);
  assert.match(content.text, /If you did not request this message, ignore it/i);
  assert.match(content.text, /تنتهي صلاحية هذا الرمز خلال 7 دقيقة/);
  assert.match(content.text, /إذا لم تطلب هذه الرسالة، فتجاهلها/);
  assert.match(content.html, /123456/);
  assert.equal(content.text.includes('10 minutes'), false, 'copy must not hard-code a TTL different from configuration');
});

test('email template escapes an unexpected code value before HTML interpolation', () => {
  const content = buildAuthEmailContent({ code: '<script>alert(1)</script>', purpose: 'REGISTRATION', expiresInMinutes: 1 });
  assert.equal(content.html.includes('<script>'), false);
  assert.match(content.html, /&lt;script&gt;/);
});

test('maskEmail limits log exposure', () => {
  assert.equal(maskEmail('private@example.test'), 'pr*****@example.test');
  assert.equal(maskEmail('a@example.test'), 'a*@example.test');
});

test('production delivery fails closed when Resend or sender configuration is missing', async () => {
  const snapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
    await assert.rejects(
      sendAuthEmail({ to: 'private@example.test', code: '123456', purpose: 'REGISTRATION', idempotencyKey: 'test-idem', expiresInMinutes: 10 }),
      (error: any) => error?.code === 'EMAIL_NOT_CONFIGURED'
    );
  } finally { restoreEnv(snapshot); }
});

test('Resend call carries idempotency, sender names and no secret-bearing content', async () => {
  const snapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalPost = (Resend.prototype as any).post;
  let captured: any;
  try {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_test_non_secret_fixture';
    process.env.EMAIL_FROM_ADDRESS = 'auth@example.test';
    process.env.EMAIL_FROM_NAME = 'Social Insight';
    (Resend.prototype as any).post = async function (path: string, body: unknown, options: unknown) {
      captured = { path, body, options, authorization: (this as any).headers?.Authorization };
      return { data: { id: 'email-fixture-id' }, error: null };
    };
    const result = await sendAuthEmail({
      to: 'private@example.test', code: '654321', purpose: 'EMAIL_CHANGE', idempotencyKey: 'otp-fixture-v1', expiresInMinutes: 6
    });
    assert.equal(result.messageId, 'email-fixture-id');
    assert.equal(captured.path, '/emails');
    assert.equal(captured.body.from, 'Social Insight <auth@example.test>');
    assert.deepEqual(captured.body.to, ['private@example.test']);
    assert.equal(captured.options.idempotencyKey, 'otp-fixture-v1');
    assert.equal(JSON.stringify(captured.body).includes('re_test_non_secret_fixture'), false);
  } finally {
    (Resend.prototype as any).post = originalPost;
    restoreEnv(snapshot);
  }
});

test('provider failure is normalized without returning Resend internals', async () => {
  const snapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalPost = (Resend.prototype as any).post;
  const originalError = console.error;
  try {
    process.env.RESEND_API_KEY = 're_test_non_secret_fixture';
    process.env.EMAIL_FROM_ADDRESS = 'auth@example.test';
    process.env.EMAIL_FROM_NAME = 'Social Insight';
    console.error = () => undefined;
    (Resend.prototype as any).post = async () => ({ data: null, error: { name: 'provider_error', message: 'sensitive upstream detail' } });
    await assert.rejects(
      sendAuthEmail({ to: 'private@example.test', code: '123456', purpose: 'REGISTRATION', idempotencyKey: 'otp-failure', expiresInMinutes: 10 }),
      (error: any) => error?.message === 'Email delivery failed' && error?.code === 'provider_error' && !String(error).includes('sensitive upstream detail')
    );
  } finally {
    console.error = originalError;
    (Resend.prototype as any).post = originalPost;
    restoreEnv(snapshot);
  }
});
