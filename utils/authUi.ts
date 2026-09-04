export type OAuthFeedback = {
  tone: 'success' | 'error';
  code: string;
  provider?: 'google' | 'facebook';
};

export const sanitizeOtpCode = (value: string): string => value.replace(/\D/g, '').slice(0, 6);

export const isCompleteOtpCode = (value: string): boolean => /^\d{6}$/.test(value);

export const isEmailCandidate = (value: string): boolean => {
  const normalized = value.trim();
  return normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
};

export const oauthFeedbackTranslationKey = (feedback: OAuthFeedback): string => {
  if (feedback.tone === 'success') return 'auth.account.oauth.linked';
  const knownCodes = new Set([
    'ACCOUNT_LINK_REQUIRED',
    'OAUTH_ACCOUNT_CONFLICT',
    'OAUTH_PROVIDER_ALREADY_LINKED',
    'OAUTH_LINK_SESSION_INVALID',
    'OAUTH_STATE_INVALID',
    'OAUTH_CALLBACK_INVALID'
  ]);
  return `auth.account.oauth.errors.${knownCodes.has(feedback.code) ? feedback.code : 'OAUTH_AUTHENTICATION_FAILED'}`;
};
