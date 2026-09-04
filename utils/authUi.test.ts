import assert from 'node:assert/strict';
import test from 'node:test';
import { isCompleteOtpCode, isEmailCandidate, oauthFeedbackTranslationKey, sanitizeOtpCode } from './authUi.ts';

test('OTP input keeps at most six ASCII digits', () => {
  assert.equal(sanitizeOtpCode('1a2 3-4567'), '123456');
  assert.equal(isCompleteOtpCode('123456'), true);
  assert.equal(isCompleteOtpCode('12345'), false);
});

test('email candidate validation rejects malformed and oversized values', () => {
  assert.equal(isEmailCandidate('person@example.com'), true);
  assert.equal(isEmailCandidate('person @example.com'), false);
  assert.equal(isEmailCandidate(`${'a'.repeat(310)}@example.com`), false);
});

test('OAuth feedback maps unknown server codes to a safe generic message', () => {
  assert.equal(
    oauthFeedbackTranslationKey({ tone: 'error', code: 'SECRET_PROVIDER_DETAIL' }),
    'auth.account.oauth.errors.OAUTH_AUTHENTICATION_FAILED'
  );
  assert.equal(
    oauthFeedbackTranslationKey({ tone: 'success', code: 'linked', provider: 'google' }),
    'auth.account.oauth.linked'
  );
});
