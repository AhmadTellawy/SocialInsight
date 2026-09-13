import { durableRateLimit } from './authRateLimit';

export const mentionSearchLimiter = durableRateLimit('mention-search', {
    windowMs: 60 * 1000,
    userLimit: 60,
    networkLimit: 1_200,
    message: 'Too many mention searches. Please try again shortly.',
    code: 'MENTION_SEARCH_RATE_LIMITED'
});

export const profileMutationLimiter = durableRateLimit('profile-mutation', {
    windowMs: 15 * 60 * 1000,
    userLimit: 90,
    networkLimit: 4_500,
    message: 'Too many profile changes. Please try again later.',
    code: 'PROFILE_RATE_LIMITED'
});
