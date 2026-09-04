import assert from 'node:assert/strict';
import test from 'node:test';
import { profileLinkApiErrorKey, shouldReconcileProfileLinkMutation } from './profileLinkErrors.ts';

test('maps profile-link authentication, authorization, throttling, and transport statuses precisely', () => {
  assert.equal(profileLinkApiErrorKey({ status: 401 }, 'add'), 'profileLinks.errors.sessionExpired');
  assert.equal(profileLinkApiErrorKey({ status: 403 }, 'add'), 'profileLinks.errors.forbidden');
  assert.equal(profileLinkApiErrorKey({ status: 404 }, 'load'), 'profileLinks.errors.unavailable');
  assert.equal(profileLinkApiErrorKey({ status: 408 }, 'add'), 'profileLinks.errors.timeout');
  assert.equal(profileLinkApiErrorKey({ status: 429 }, 'add'), 'profileLinks.errors.rateLimited');
  assert.equal(profileLinkApiErrorKey({ status: 0 }, 'add'), 'profileLinks.errors.network');
  assert.equal(profileLinkApiErrorKey({ status: 503 }, 'add'), 'profileLinks.errors.server');
});

test('maps backend profile-link validation codes to actionable messages', () => {
  assert.equal(
    profileLinkApiErrorKey({ status: 400, code: 'INVALID_PROFILE_LINK_SCHEME' }, 'add'),
    'profileLinks.validation.urlScheme'
  );
  assert.equal(
    profileLinkApiErrorKey({ status: 400, code: 'INVALID_PROFILE_LINK_CREDENTIALS' }, 'add'),
    'profileLinks.validation.urlCredentials'
  );
  assert.equal(
    profileLinkApiErrorKey({ status: 409, code: 'DUPLICATE_PROFILE_LINK' }, 'add'),
    'profileLinks.errors.duplicate'
  );
  assert.equal(
    profileLinkApiErrorKey({ status: 429, code: 'PROFILE_RATE_LIMITED' }, 'add'),
    'profileLinks.errors.rateLimited'
  );
  assert.equal(
    profileLinkApiErrorKey({ status: 400, code: 'PROFILE_LINK_URL_TOO_LONG' }, 'add'),
    'profileLinks.errors.urlTooLong'
  );
  assert.equal(
    profileLinkApiErrorKey({ status: 400, code: 'INVALID_PROFILE_LINK_TITLE' }, 'add'),
    'profileLinks.errors.invalidTitle'
  );
  assert.equal(
    profileLinkApiErrorKey({ status: 404, code: 'PROFILE_LINK_NOT_FOUND' }, 'update'),
    'profileLinks.errors.notFound'
  );
});

test('reconciles only ambiguous mutation outcomes and idempotent not-found or duplicate outcomes', () => {
  for (const error of [
    null,
    { status: 0, code: 'NETWORK_ERROR' },
    { status: 408, code: 'REQUEST_TIMEOUT' },
    { status: 500, code: 'PROFILE_LINK_OPERATION_FAILED' },
    { status: 409, code: 'DUPLICATE_PROFILE_LINK' },
    { status: 404, code: 'PROFILE_LINK_NOT_FOUND' }
  ]) {
    assert.equal(shouldReconcileProfileLinkMutation(error), true);
  }
  for (const error of [
    { status: 400, code: 'INVALID_PROFILE_LINK_URL' },
    { status: 401 },
    { status: 403 },
    { status: 409, code: 'PROFILE_LINK_LIMIT_REACHED' },
    { status: 429, code: 'PROFILE_RATE_LIMITED' }
  ]) {
    assert.equal(shouldReconcileProfileLinkMutation(error), false);
  }
});
