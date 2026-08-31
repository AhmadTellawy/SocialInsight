import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROFILE_LINK_TITLE_MAX_LENGTH,
  calculateAgeFromDateOnly,
  formatDateOnly,
  normalizeProfileLinkUrl,
  parseDateOnly,
  validateDateOfBirth,
  validateProfileLinkTitle
} from './profileValidation.ts';

test('profile link titles are trimmed and plain text', () => {
  assert.deepEqual(validateProfileLinkTitle('  My Website  '), { valid: true, value: 'My Website' });
  assert.deepEqual(validateProfileLinkTitle('   '), { valid: false, error: 'required' });
  assert.deepEqual(validateProfileLinkTitle('<script>alert(1)</script>'), { valid: false, error: 'markup' });
  assert.deepEqual(validateProfileLinkTitle('[Portfolio](https://example.com)'), { valid: false, error: 'markup' });
  assert.deepEqual(validateProfileLinkTitle('Bad\u0000Title'), { valid: false, error: 'controlCharacters' });
  assert.deepEqual(validateProfileLinkTitle('\nTitle'), { valid: false, error: 'controlCharacters' });
});

test('profile link title limit counts Unicode code points', () => {
  assert.equal(validateProfileLinkTitle('😀'.repeat(PROFILE_LINK_TITLE_MAX_LENGTH)).valid, true);
  assert.deepEqual(
    validateProfileLinkTitle('😀'.repeat(PROFILE_LINK_TITLE_MAX_LENGTH + 1)),
    { valid: false, error: 'tooLong' }
  );
});

test('profile URLs add HTTPS and produce a stable duplicate key', () => {
  assert.deepEqual(normalizeProfileLinkUrl(' Example.COM/path#work '), {
    valid: true,
    value: {
      url: 'https://example.com/path#work',
      normalizedUrl: 'https://example.com/path',
      protocolAdded: true
    }
  });
  assert.deepEqual(normalizeProfileLinkUrl('HTTPS://Example.COM:443'), {
    valid: true,
    value: {
      url: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      protocolAdded: false
    }
  });
  assert.equal(normalizeProfileLinkUrl('http://example.com').valid, true);
  assert.equal(normalizeProfileLinkUrl('https://xn--mgbh0fb.xn--kgbechtv').valid, true);
});

test('profile URLs reject unsafe and malformed input without network access', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/a',
    'intent://example.com',
    'blob:https://example.com/id'
  ]) {
    assert.deepEqual(normalizeProfileLinkUrl(value), { valid: false, error: 'invalidScheme' });
  }
  assert.deepEqual(normalizeProfileLinkUrl('//example.com/path'), { valid: false, error: 'protocolRelative' });
  assert.deepEqual(normalizeProfileLinkUrl('https://user:pass@example.com'), { valid: false, error: 'credentials' });
  assert.deepEqual(normalizeProfileLinkUrl('https://example.com/a\nb'), { valid: false, error: 'controlCharacters' });
  assert.deepEqual(normalizeProfileLinkUrl('https:\\example.com'), { valid: false, error: 'invalidUrl' });
  assert.deepEqual(normalizeProfileLinkUrl('not-a-domain'), { valid: false, error: 'invalidUrl' });
  assert.deepEqual(normalizeProfileLinkUrl(`https://example.com/${'a'.repeat(2048)}`), { valid: false, error: 'tooLong' });
});

test('date-only parsing rejects impossible dates and accepts leap days', () => {
  assert.equal(parseDateOnly('2025-02-29'), null);
  assert.deepEqual(parseDateOnly('2024-02-29'), { year: 2024, month: 2, day: 29 });
  assert.equal(parseDateOnly('2024-2-9'), null);
});

test('date-of-birth validation enforces exact age boundaries without Date parsing', () => {
  assert.deepEqual(validateDateOfBirth('2012-08-31', { today: '2025-08-31' }), { valid: true, value: '2012-08-31' });
  assert.deepEqual(validateDateOfBirth('2012-09-01', { today: '2025-08-31' }), { valid: false, error: 'underage' });
  assert.deepEqual(validateDateOfBirth('2025-09-01', { today: '2025-08-31' }), { valid: false, error: 'future' });
  assert.deepEqual(validateDateOfBirth('1904-08-30', { today: '2025-08-31' }), { valid: false, error: 'tooOld' });
  assert.equal(calculateAgeFromDateOnly('2000-09-01', '2025-08-31'), 24);
  assert.equal(calculateAgeFromDateOnly('2000-08-31', '2025-08-31'), 25);
});

test('optional empty dates remain null and localized formatting keeps the calendar day', () => {
  assert.deepEqual(validateDateOfBirth(null), { valid: true, value: null });
  assert.deepEqual(validateDateOfBirth('', { required: true }), { valid: false, error: 'required' });
  assert.equal(formatDateOnly('2000-01-02', 'en-CA'), 'January 2, 2000');
});
