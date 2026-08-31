import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROFILE_LINK_LIMIT,
  ProfileValidationError,
  ageOnDate,
  calculateAgeGroupFromDate,
  formatDateOnly,
  normalizeProfileLinkInput,
  normalizeProfileLinkUrl,
  parseAndValidateDateOfBirth
} from './profileValidation';

test('normalizes domains without a protocol and canonicalizes host casing', () => {
  assert.deepEqual(normalizeProfileLinkUrl(' Example.COM/path '), {
    url: 'https://example.com/path',
    normalizedUrl: 'https://example.com/path'
  });
});

test('keeps display fragments but removes them from the duplicate key', () => {
  assert.deepEqual(normalizeProfileLinkUrl('Example.com/path#work'), {
    url: 'https://example.com/path#work',
    normalizedUrl: 'https://example.com/path'
  });
  assert.equal(
    normalizeProfileLinkUrl('https://example.com/path#other').normalizedUrl,
    'https://example.com/path'
  );
});

test('rejects dangerous, relative, credentialed, malformed, and control-character URLs', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/plain,hello',
    'file:///tmp/file',
    'intent://example.com',
    'blob:https://example.com/id',
    '//example.com/path',
    'https://user:secret@example.com',
    'https://exa\nmple.com',
    'https:\\example.com',
    'https://localhost',
    'not-a-domain'
  ]) {
    assert.throws(() => normalizeProfileLinkUrl(value), ProfileValidationError, value);
  }
});

test('trims plain-text titles and rejects empty, oversized, and HTML-like titles', () => {
  assert.equal(normalizeProfileLinkInput(' Portfolio ', 'portfolio.example').title, 'Portfolio');
  assert.throws(() => normalizeProfileLinkInput('   ', 'example.com'), ProfileValidationError);
  assert.throws(() => normalizeProfileLinkInput('x'.repeat(51), 'example.com'), ProfileValidationError);
  assert.throws(() => normalizeProfileLinkInput('<script>alert(1)</script>', 'example.com'), ProfileValidationError);
  assert.throws(() => normalizeProfileLinkInput('[Portfolio](https://example.com)', 'example.com'), ProfileValidationError);
  assert.equal(normalizeProfileLinkInput('😀'.repeat(50), 'example.com').title, '😀'.repeat(50));
  assert.throws(() => normalizeProfileLinkInput('😀'.repeat(51), 'example.com'), ProfileValidationError);
  assert.equal(PROFILE_LINK_LIMIT, 5);
});

test('parses date-only values without timezone rollover', () => {
  const today = new Date('2026-08-31T23:59:59.999Z');
  const parsed = parseAndValidateDateOfBirth('2000-02-29', today);
  assert.equal(formatDateOnly(parsed), '2000-02-29');
  assert.equal(ageOnDate(parsed, today), 26);
  assert.equal(calculateAgeGroupFromDate(parsed, today), '25-34');
});

test('enforces real dates, future dates, age 13, and a logical maximum age', () => {
  const today = new Date('2026-08-31T12:00:00.000Z');
  assert.equal(formatDateOnly(parseAndValidateDateOfBirth('2013-08-31', today)), '2013-08-31');
  assert.throws(() => parseAndValidateDateOfBirth('2013-09-01', today), /at least 13/i);
  assert.throws(() => parseAndValidateDateOfBirth('2027-01-01', today), ProfileValidationError);
  assert.throws(() => parseAndValidateDateOfBirth('2024-02-30', today), ProfileValidationError);
  assert.throws(() => parseAndValidateDateOfBirth('1900-01-01', today), ProfileValidationError);
});
