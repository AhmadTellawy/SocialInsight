import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POST_REPORT_DESCRIPTION_LIMIT,
  PostOptionValidationError,
  buildPostReportDedupeKey,
  normalizePostReportInput
} from './postOptionService';

test('normalizes a supported report reason and trims optional details', () => {
  assert.deepEqual(normalizePostReportInput(' spam ', '  repeated links  '), {
    reason: 'SPAM',
    description: 'repeated links'
  });
});

test('requires details for OTHER and rejects unsupported reasons', () => {
  assert.throws(() => normalizePostReportInput('OTHER', ''), (error) =>
    error instanceof PostOptionValidationError && error.code === 'REPORT_DESCRIPTION_REQUIRED'
  );
  assert.throws(() => normalizePostReportInput('NOT_REAL', ''), (error) =>
    error instanceof PostOptionValidationError && error.code === 'INVALID_REPORT_REASON'
  );
});

test('bounds report detail length and builds a stable reporter/post key', () => {
  assert.throws(
    () => normalizePostReportInput('HARASSMENT', 'x'.repeat(POST_REPORT_DESCRIPTION_LIMIT + 1)),
    (error) => error instanceof PostOptionValidationError && error.code === 'REPORT_DESCRIPTION_TOO_LONG'
  );
  assert.equal(buildPostReportDedupeKey('user-1', 'post-1'), 'POST:post-1:REPORTER:user-1');
});
