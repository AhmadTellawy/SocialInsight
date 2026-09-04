export type ProfileLinkOperation = 'load' | 'add' | 'update' | 'delete';

export type ProfileLinkApiErrorLike = {
  status: number;
  code?: string;
};

export const profileLinkApiErrorKey = (
  error: ProfileLinkApiErrorLike | null,
  fallback: ProfileLinkOperation
): string => {
  if (!error) return `profileLinks.errors.${fallback}`;

  const code = error.code || '';
  if (['PROFILE_LINK_LIMIT', 'PROFILE_LINK_LIMIT_REACHED', 'MAX_PROFILE_LINKS'].includes(code)) {
    return 'profileLinks.errors.limit';
  }
  if (['DUPLICATE_PROFILE_LINK', 'PROFILE_LINK_DUPLICATE'].includes(code)) {
    return 'profileLinks.errors.duplicate';
  }
  if (['INVALID_PROFILE_LINK_URL', 'INVALID_URL'].includes(code)) {
    return 'profileLinks.validation.urlInvalid';
  }
  if (code === 'INVALID_PROFILE_LINK_SCHEME') return 'profileLinks.validation.urlScheme';
  if (code === 'INVALID_PROFILE_LINK_CREDENTIALS') return 'profileLinks.validation.urlCredentials';
  if (code === 'PROFILE_LINK_URL_TOO_LONG') return 'profileLinks.errors.urlTooLong';
  if (code === 'INVALID_PROFILE_LINK_TITLE') return 'profileLinks.errors.invalidTitle';
  if (code === 'PROFILE_LINK_NOT_FOUND') return 'profileLinks.errors.notFound';
  if (code === 'PROFILE_RATE_LIMITED') return 'profileLinks.errors.rateLimited';
  if (code === 'REQUEST_TIMEOUT') return 'profileLinks.errors.timeout';
  if (code === 'NETWORK_ERROR') return 'profileLinks.errors.network';

  if (error.status === 401) return 'profileLinks.errors.sessionExpired';
  if (error.status === 403) return 'profileLinks.errors.forbidden';
  if (error.status === 404) return 'profileLinks.errors.unavailable';
  if (error.status === 408) return 'profileLinks.errors.timeout';
  if (error.status === 429) return 'profileLinks.errors.rateLimited';
  if (error.status === 0) return 'profileLinks.errors.network';
  if (error.status >= 500) return 'profileLinks.errors.server';
  return `profileLinks.errors.${fallback}`;
};

export const shouldReconcileProfileLinkMutation = (error: ProfileLinkApiErrorLike | null): boolean => {
  if (!error) return true;
  if (['DUPLICATE_PROFILE_LINK', 'PROFILE_LINK_DUPLICATE', 'PROFILE_LINK_NOT_FOUND'].includes(error.code || '')) {
    return true;
  }
  return error.status === 0 || error.status === 404 || error.status === 408 || error.status >= 500;
};
