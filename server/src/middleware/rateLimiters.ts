import rateLimit from 'express-rate-limit';

export const mentionSearchLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many mention searches. Please try again shortly.',
        code: 'MENTION_SEARCH_RATE_LIMITED'
    }
});
