import assert from 'node:assert/strict';
import test from 'node:test';
import { Resend } from 'resend';
import { buildAuthEmailContent, maskEmail, sendAuthEmail } from './emailService';

const envKeys = ['RESEND_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'] as const;
const restoreEnv = (snapshot: Record<string, string | undefined>) => {
  for (const key of envKeys) snapshot[key] === undefined ? delete process.env[key] : process.env[key] = snapshot[key]!;
};

test('email template uses configured TTL, bilingual safety copy, and escaped HTML', () => {
  const content = buildAuthEmailContent({ code: '<12345>', purpose: 'REGISTRATION', expiresInMinutes: 7 });
  assert.match(content.text, /expires in 7 minutes/i);
  assert.match(content.text, /If you did not request this message, ignore it/i);
  assert.match(content.text, /تنتهي صلاحية هذا الرمز خلال 7 دقيقة/);
  assert.equal(content.html.includes('<12345>'), false);
  assert.match(content.html, /&lt;12345&gt;/);
  assert.match(content.text, /^Opiniup\n/);
  assert.match(content.html, /<h2>Opiniup<\/h2>/);
  assert.doesNotMatch(content.text + content.html, /social\s*insight/i);
});

test('maskEmail limits log exposure', () => {
  assert.equal(maskEmail('private@example.test'), 'pr*****@example.test');
  assert.equal(maskEmail('a@example.test'), 'a*@example.test');
});

test('delivery fails closed when the three Resend sender variables are incomplete', async () => {
  const snapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
    await assert.rejects(
      sendAuthEmail({ to: 'private@example.test', code: '123456', purpose: 'REGISTRATION', idempotencyKey: 'test-idem', expiresInMinutes: 10 }),
      (error: any) => error?.code === 'EMAIL_NOT_CONFIGURED'
    );
  } finally { restoreEnv(snapshot); }
});

test('Resend request carries idempotency and configured sender without exposing the API key', async () => {
  const snapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalPost = (Resend.prototype as any).post;
  const originalInfo = console.info;
  let captured: any;
  try {
    process.env.RESEND_API_KEY = 're_test_non_secret_fixture';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@opiniup.com';
    process.env.EMAIL_FROM_NAME = 'Opiniup';
    console.info = () => undefined;
    (Resend.prototype as any).post = async function (path: string, body: unknown, options: unknown) {
      captured = { path, body, options };
      return { data: { id: 'email-fixture-id' }, error: null };
    };
    const result = await sendAuthEmail({
      to: 'private@example.test', code: '654321', purpose: 'EMAIL_VERIFICATION', idempotencyKey: 'otp-fixture-v1', expiresInMinutes: 6
    });
    assert.equal(result.messageId, 'email-fixture-id');
    assert.equal(captured.path, '/emails');
    assert.equal(captured.body.from, 'Opiniup <no-reply@opiniup.com>');
    assert.match(captured.body.subject, /Opiniup/);
    assert.doesNotMatch(captured.body.subject, /social\s*insight/i);
    assert.deepEqual(captured.body.to, ['private@example.test']);
    assert.equal(captured.options.idempotencyKey, 'otp-fixture-v1');
    assert.equal(JSON.stringify(captured).includes('re_test_non_secret_fixture'), false);
  } finally {
    console.info = originalInfo;
    (Resend.prototype as any).post = originalPost;
    restoreEnv(snapshot);
  }
});

test('provider failure is normalized without returning provider detail', async () => {
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
      (error: any) => error?.message === 'Email delivery failed' && !String(error).includes('sensitive upstream detail')
    );
  } finally {
    console.error = originalError;
    (Resend.prototype as any).post = originalPost;
    restoreEnv(snapshot);
  }
});

test('delivery timeout rejects a pending mocked provider request without sending over the network', async () => {
  const snapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalTimeout = process.env.EMAIL_DELIVERY_TIMEOUT_MS;
  const originalPost = (Resend.prototype as any).post;
  // Keep the test alive while the service's timeout timer is intentionally unref'd.
  const keepAlive = setInterval(() => undefined, 100);
  try {
    process.env.RESEND_API_KEY = 're_test_non_secret_fixture';
    process.env.EMAIL_FROM_ADDRESS = 'auth@example.test';
    process.env.EMAIL_FROM_NAME = 'Social Insight';
    process.env.EMAIL_DELIVERY_TIMEOUT_MS = '1000';
    (Resend.prototype as any).post = () => new Promise(() => undefined);
    await assert.rejects(sendAuthEmail({ to: 'private@example.test', code: '123456', purpose: 'REGISTRATION', idempotencyKey: 'mock-timeout', expiresInMinutes: 10 }),
      (error: any) => error.code === 'EMAIL_DELIVERY_TIMEOUT');
  } finally {
    clearInterval(keepAlive);
    (Resend.prototype as any).post = originalPost;
    if (originalTimeout === undefined) delete process.env.EMAIL_DELIVERY_TIMEOUT_MS;
    else process.env.EMAIL_DELIVERY_TIMEOUT_MS = originalTimeout;
    restoreEnv(snapshot);
  }
});
