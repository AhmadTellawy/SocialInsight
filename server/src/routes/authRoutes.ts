import { Router } from 'express';
import {
    checkHandleAvailability,
    completeRegistration,
    confirmEmailChange,
    confirmEmailVerification,
    confirmPasswordReset,
    getSession,
    initiateRegistration,
    login,
    logout,
    oauthCallback,
    register,
    requestEmailChange,
    requestEmailVerification,
    requestPasswordReset,
    reserveHandle,
    sendRegistrationOTP,
    setRegistrationPassword,
    startOAuth,
    startOAuthLink
} from '../controllers/authController';
import { requireAuth, requireRecentAuth } from '../middleware/authMiddleware';
import { requireTrustedOrigin } from '../middleware/csrfProtection';
import { authRateLimit } from '../middleware/authRateLimit';

const router = Router();

const loginRateLimit = authRateLimit('login', 10, ['identifier']);
const registrationRateLimit = authRateLimit('registration', 30, ['email', 'pendingId', 'handle']);
const otpIssueRateLimit = authRateLimit('otp-issue', 5, ['email', 'pendingId']);
const otpVerifyRateLimit = authRateLimit('otp-verify', 10, ['email', 'pendingId']);
const authenticatedOtpIssueRateLimit = authRateLimit('otp-issue-authenticated', 5, ['authenticatedUserId', 'email']);
const authenticatedOtpVerifyRateLimit = authRateLimit('otp-verify-authenticated', 10, ['authenticatedUserId', 'email']);
const oauthStartRateLimit = authRateLimit('oauth-start', 20);
const oauthLinkRateLimit = authRateLimit('oauth-link', 10, ['authenticatedUserId']);
const oauthCallbackRateLimit = authRateLimit('oauth-callback', 40);

router.post('/register', requireTrustedOrigin, register);
router.post('/login', loginRateLimit, requireTrustedOrigin, login);
router.get('/session', requireAuth, getSession);
router.post('/logout', requireAuth, logout);

router.post('/register/init', registrationRateLimit, requireTrustedOrigin, initiateRegistration);
router.post('/register/password', registrationRateLimit, requireTrustedOrigin, setRegistrationPassword);
router.get('/handle/check', checkHandleAvailability);
router.post('/handle/reserve', registrationRateLimit, requireTrustedOrigin, reserveHandle);
router.post('/register/otp/send', otpIssueRateLimit, requireTrustedOrigin, sendRegistrationOTP);
router.post('/register/complete', otpVerifyRateLimit, requireTrustedOrigin, completeRegistration);

router.post('/password-reset/request', otpIssueRateLimit, requireTrustedOrigin, requestPasswordReset);
router.post('/password-reset/confirm', otpVerifyRateLimit, requireTrustedOrigin, confirmPasswordReset);
router.post('/email-verification/request', requireAuth, authenticatedOtpIssueRateLimit, requestEmailVerification);
router.post('/email-verification/confirm', requireAuth, authenticatedOtpVerifyRateLimit, confirmEmailVerification);
router.post('/email-change/request', requireAuth, requireRecentAuth, authenticatedOtpIssueRateLimit, requestEmailChange);
router.post('/email-change/confirm', requireAuth, authenticatedOtpVerifyRateLimit, confirmEmailChange);

router.post('/oauth/:provider/start', oauthStartRateLimit, requireTrustedOrigin, startOAuth);
router.post('/oauth/:provider/link', requireAuth, requireRecentAuth, oauthLinkRateLimit, startOAuthLink);
router.get('/oauth/:provider/callback', oauthCallbackRateLimit, oauthCallback);

export default router;
