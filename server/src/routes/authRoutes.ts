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
    startOAuthLink,
    startOAuthReauthentication
} from '../controllers/authController';
import { requireAuth, requireRecentAuth } from '../middleware/authMiddleware';
import { requireTrustedOrigin } from '../middleware/csrfProtection';
import { authRateLimit } from '../middleware/authRateLimit';
import {
    getSignInMethods, reauthenticate, unlinkSignInMethod, changeAccountPassword,
    listAccountSessions, revokeAccountSession, revokeOtherAccountSessions,
    beginMfaEnrollment, confirmMfaEnrollment, replaceMfaRecoveryCodes, disableMfa,
    getAuthChallenge, completeAuthChallenge
} from '../controllers/accountSecurityController';

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
router.post('/email-change/confirm', requireAuth, requireRecentAuth, authenticatedOtpVerifyRateLimit, confirmEmailChange);

router.post('/oauth/:provider/start', oauthStartRateLimit, requireTrustedOrigin, startOAuth);
router.post('/oauth/:provider/link', requireAuth, requireRecentAuth, oauthLinkRateLimit, startOAuthLink);
router.post('/oauth/:provider/reauthenticate', requireAuth, oauthLinkRateLimit, startOAuthReauthentication);
router.get('/oauth/:provider/callback', oauthCallbackRateLimit, oauthCallback);

const securityRateLimit = authRateLimit('account-security', 20, ['authenticatedUserId']);
router.get('/methods', requireAuth, getSignInMethods);
router.post('/reauthenticate', requireAuth, authRateLimit('reauthenticate', 8, ['authenticatedUserId']), reauthenticate);
router.delete('/methods/:provider', requireAuth, requireRecentAuth, securityRateLimit, unlinkSignInMethod);
router.put('/password', requireAuth, requireRecentAuth, securityRateLimit, changeAccountPassword);
router.get('/sessions', requireAuth, listAccountSessions);
router.post('/sessions/revoke-others', requireAuth, requireRecentAuth, securityRateLimit, revokeOtherAccountSessions);
router.delete('/sessions/:id', requireAuth, requireRecentAuth, securityRateLimit, revokeAccountSession);
router.post('/mfa/enrollment', requireAuth, requireRecentAuth, securityRateLimit, beginMfaEnrollment);
router.post('/mfa/enrollment/confirm', requireAuth, requireRecentAuth, securityRateLimit, confirmMfaEnrollment);
router.post('/mfa/recovery-codes', requireAuth, requireRecentAuth, securityRateLimit, replaceMfaRecoveryCodes);
router.delete('/mfa', requireAuth, requireRecentAuth, securityRateLimit, disableMfa);
router.get('/challenge', getAuthChallenge);
router.post('/challenge/complete', requireTrustedOrigin, authRateLimit('auth-challenge', 15), completeAuthChallenge);

export default router;
