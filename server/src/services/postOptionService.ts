export const POST_REPORT_REASONS = [
  'INAPPROPRIATE_CONTENT',
  'SPAM',
  'HARASSMENT',
  'FALSE_INFORMATION',
  'COPYRIGHT_VIOLATION',
  'OTHER'
] as const;

export type PostReportReason = typeof POST_REPORT_REASONS[number];

export const POST_REPORT_DESCRIPTION_LIMIT = 1000;

export class PostOptionValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export const normalizePostReportInput = (
  rawReason: unknown,
  rawDescription: unknown
): { reason: PostReportReason; description: string | null } => {
  const reason = typeof rawReason === 'string' ? rawReason.trim().toUpperCase() : '';
  if (!POST_REPORT_REASONS.includes(reason as PostReportReason)) {
    throw new PostOptionValidationError('Select a valid report reason.', 'INVALID_REPORT_REASON');
  }

  const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';
  if (description.length > POST_REPORT_DESCRIPTION_LIMIT) {
    throw new PostOptionValidationError(
      `Report details cannot exceed ${POST_REPORT_DESCRIPTION_LIMIT} characters.`,
      'REPORT_DESCRIPTION_TOO_LONG'
    );
  }
  if (reason === 'OTHER' && !description) {
    throw new PostOptionValidationError('Add details for this report reason.', 'REPORT_DESCRIPTION_REQUIRED');
  }

  return { reason: reason as PostReportReason, description: description || null };
};

export const buildPostReportDedupeKey = (reporterId: string, postId: string): string =>
  `POST:${postId}:REPORTER:${reporterId}`;
