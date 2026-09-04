import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import prisma from '../prisma';
import { PUBLIC_AVATAR_MEDIA_SELECT, serializeUserMediaRecord } from '../services/mediaService';
import {
    ProfileValidationError,
    calculateAgeGroupFromDate,
    formatDateOnly,
    parseAndValidateDateOfBirth,
    withDerivedAgeGroup
} from '../utils/profileValidation';
import { consumeEmailOtp, issueEmailOtp, OtpError } from '../services/otpService';
import {
    clearSessionCookies,
    createSession,
    CSRF_COOKIE_NAME,
    readCookies,
    resolveSession,
    revokeSession,
    notifyUserSessionsRevoked,
    hashSessionSecret
} from '../services/sessionService';
import { beginOAuth, completeOAuth, OAuthError, OAuthProvider } from '../services/oauthService';
import { createLegacyBearerToken } from '../middleware/authMiddleware';

const db = prisma as any;
const GENERIC_LOGIN_ERROR = 'Invalid login credentials';
const GENERIC_RECOVERY_RESPONSE = 'If the account is eligible, a verification code will be sent';
const LEGACY_REGISTER_DISABLED_ERROR = 'Use the multi-step registration flow';
const DUMMY_PASSWORD_HASH = '$2b$12$qD051ezKJGGLFaT.muvKNuy9TdCT/j1TbSKsUKNSqa6VMtH4u6NAO';
const REGISTRATION_BROWSER_COOKIE_NAME = process.env.REGISTRATION_BROWSER_COOKIE_NAME?.trim() || 'si_registration_browser';
const REGISTRATION_BROWSER_TTL_SECONDS = 24 * 60 * 60;

const passwordSchema = z.string().min(8).max(128)
    .regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/).regex(/[!@#$%^&*]/);
const loginSchema = z.object({ identifier: z.string().min(1).max(320), password: z.string().min(1).max(128) });
const initRegistrationSchema = z.object({ fullName: z.string().trim().min(1).max(100), email: z.string().email().max(320), dob: z.string() });
const pendingSchema = z.object({ pendingId: z.string().uuid() });
const registrationPasswordSchema = pendingSchema.extend({ password: passwordSchema });
const reserveHandleSchema = pendingSchema.extend({
    handle: z.string().trim().min(3).max(30).regex(/^[a-z0-9_.]+$/i)
});
const completeRegistrationSchema = pendingSchema.extend({ otp: z.string().regex(/^\d{6}$/).optional(), code: z.string().regex(/^\d{6}$/).optional() })
    .refine((input) => Boolean(input.otp || input.code), { message: 'Verification code is required' })
    .refine((input) => !(input.otp && input.code && input.otp !== input.code), { message: 'Verification code is invalid' });
const emailSchema = z.object({ email: z.string().email().max(320) });
const passwordResetConfirmSchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/), password: passwordSchema });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const emailChangeConfirmSchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) });

const SAFE_USER_SELECT = {
    id: true, name: true, handle: true, email: true, emailVerifiedAt: true, avatar: true,
    ...PUBLIC_AVATAR_MEDIA_SELECT,
    country: true, bio: true, location: true, website: true, language: true, isPrivate: true,
    verifiedBadge: true, followersCount: true, followingCount: true, birthday: true,
    demographics: true, createdAt: true, updatedAt: true
};

const noStore = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
};

const registrationBrowserCookie = (value: string, maxAgeSeconds = REGISTRATION_BROWSER_TTL_SECONDS): string => [
    `${REGISTRATION_BROWSER_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/api/auth/register',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    ...((process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production') ? ['Secure'] : [])
].join('; ');

const registrationIsBoundToBrowser = (req: Request, pending: { browserSecretHash?: string | null }): boolean => {
    const browserSecret = readCookies(req)[REGISTRATION_BROWSER_COOKIE_NAME] || '';
    return Boolean(browserSecret.length >= 32 && pending.browserSecretHash
        && hashSessionSecret(`registration:${browserSecret}`) === pending.browserSecretHash);
};

const findBoundPendingRegistration = async (req: Request, pendingId: string): Promise<any | null> => {
    const pending = await db.pendingRegistration.findUnique({ where: { id: pendingId } });
    return pending && registrationIsBoundToBrowser(req, pending) ? pending : null;
};

const logFailure = (req: Request, event: string, error: unknown): void => {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || 'UNKNOWN')
        : 'UNKNOWN';
    console.error(JSON.stringify({ event, requestId: req.requestId, errorCode }));
};

const requestContext = (req: Request) => ({ requestIp: req.ip, userAgent: req.header('user-agent') || undefined });
const publicUser = (user: any): any => {
    const serialized = serializeUserMediaRecord(user) || user;
    const { password: _password, passwordHash: _passwordHash, ...safe } = serialized;
    return {
        ...safe,
        birthday: formatDateOnly(user.birthday),
        demographics: withDerivedAgeGroup(user.demographics || null, user.birthday),
        stats: { followers: user.followersCount || 0, following: user.followingCount || 0, responses: 0 }
    };
};

const validationFailure = (res: Response, code = 'INVALID_REQUEST'): void => {
    res.status(400).json({ error: 'Invalid request', code });
};

const legacyBearerBody = (userId: string): { token: string } | Record<string, never> => {
    const token = createLegacyBearerToken(userId);
    return token ? { token } : {};
};

const authenticationResponse = (user: any, csrfToken: string): Record<string, unknown> => {
    const safeUser = publicUser(user);
    // Keep the flat fields for one bounded legacy-client rollout window while
    // new clients consume `user`. No credential is emitted unless the explicit
    // legacy compatibility flag is enabled.
    return { ...safeUser, user: safeUser, csrfToken, ...legacyBearerBody(user.id) };
};

export const register = async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json({ error: LEGACY_REGISTER_DISABLED_ERROR, code: 'LEGACY_REGISTRATION_DISABLED' });
};

export const login = async (req: Request, res: Response): Promise<void> => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'INVALID_LOGIN_REQUEST');
    const identifier = parsed.data.identifier.trim();
    try {
        const user = await prisma.user.findFirst({
            where: { OR: [{ email: { equals: identifier, mode: 'insensitive' } }, { handle: { equals: identifier, mode: 'insensitive' } }] } as any,
            include: { avatarMedia: { include: { variants: true } } }
        });
        const passwordMatches = await bcrypt.compare(parsed.data.password, user?.passwordHash || DUMMY_PASSWORD_HASH);
        const valid = Boolean(user?.passwordHash) && passwordMatches;
        if (!user || user.status !== 'ACTIVE' || !valid) {
            noStore(res);
            res.status(401).json({ error: GENERIC_LOGIN_ERROR, code: 'INVALID_CREDENTIALS' });
            return;
        }
        const demographics = await prisma.userDemographics.findUnique({ where: { userId: user.id } });
        const session = await createSession(user.id, res);
        noStore(res);
        res.json(authenticationResponse({ ...user, demographics }, session.csrfToken));
    } catch (error) {
        logFailure(req, 'login_failed', error);
        res.status(500).json({ error: 'Unable to sign in', code: 'AUTHENTICATION_FAILED' });
    }
};

export const initiateRegistration = async (req: Request, res: Response): Promise<void> => {
    const parsed = initRegistrationSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'INVALID_REGISTRATION_REQUEST');
    const email = parsed.data.email.toLowerCase();
    try {
        const dob = parseAndValidateDateOfBirth(parsed.data.dob);
        const browserSecret = randomBytes(32).toString('base64url');
        const pending = await prisma.pendingRegistration.create({
            data: {
                email,
                fullName: parsed.data.fullName,
                dob,
                currentStep: 2,
                browserSecretHash: hashSessionSecret(`registration:${browserSecret}`)
            }
        });
        appendResponseCookie(res, registrationBrowserCookie(browserSecret));
        noStore(res);
        res.status(201).json({ pendingId: pending.id });
    } catch (error) {
        if (error instanceof ProfileValidationError) {
            res.status(error.statusCode).json({ error: error.message, code: error.code });
            return;
        }
        logFailure(req, 'registration_init_failed', error);
        res.status(500).json({ error: 'Unable to start registration', code: 'REGISTRATION_FAILED' });
    }
};

export const setRegistrationPassword = async (req: Request, res: Response): Promise<void> => {
    const parsed = registrationPasswordSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'INVALID_PASSWORD');
    try {
        const pending = await findBoundPendingRegistration(req, parsed.data.pendingId);
        if (!pending || pending.currentStep < 2) return validationFailure(res, 'REGISTRATION_SESSION_INVALID');
        const passwordHash = await bcrypt.hash(parsed.data.password, 12);
        const updated = await prisma.pendingRegistration.updateMany({
            where: { id: pending.id, browserSecretHash: pending.browserSecretHash, currentStep: { gte: 2 } },
            data: { password: passwordHash, currentStep: 3 }
        });
        if (updated.count !== 1) return validationFailure(res, 'REGISTRATION_SESSION_INVALID');
        res.json({ success: true });
    } catch (error) {
        logFailure(req, 'registration_password_failed', error);
        res.status(500).json({ error: 'Unable to continue registration', code: 'REGISTRATION_FAILED' });
    }
};

export const checkHandleAvailability = async (req: Request, res: Response): Promise<void> => {
    const parsed = z.string().trim().min(3).max(30).regex(/^[a-z0-9_.]+$/i).safeParse(req.query.handle);
    if (!parsed.success) return validationFailure(res, 'INVALID_HANDLE');
    try {
        const existing = await prisma.user.findFirst({ where: { handle: { equals: parsed.data.toLowerCase(), mode: 'insensitive' } } });
        res.json({ available: !existing });
    } catch {
        res.status(500).json({ error: 'Unable to check handle', code: 'HANDLE_CHECK_FAILED' });
    }
};

export const reserveHandle = async (req: Request, res: Response): Promise<void> => {
    const parsed = reserveHandleSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'INVALID_HANDLE');
    const handle = parsed.data.handle.toLowerCase();
    try {
        const pending = await findBoundPendingRegistration(req, parsed.data.pendingId);
        if (!pending || !pending.password || pending.currentStep < 3) return validationFailure(res, 'REGISTRATION_SESSION_INVALID');
        const existing = await prisma.user.findFirst({ where: { handle: { equals: handle, mode: 'insensitive' } } });
        if (existing) {
            res.status(409).json({ error: 'Handle is unavailable', code: 'HANDLE_UNAVAILABLE' });
            return;
        }
        const updated = await prisma.pendingRegistration.updateMany({
            where: { id: pending.id, browserSecretHash: pending.browserSecretHash, password: { not: null }, currentStep: { gte: 3 } },
            data: { handle, currentStep: 4 }
        });
        if (updated.count !== 1) return validationFailure(res, 'REGISTRATION_SESSION_INVALID');
        res.json({ success: true });
    } catch (error: any) {
        if (error?.code === 'P2002') {
            res.status(409).json({ error: 'Handle is unavailable', code: 'HANDLE_UNAVAILABLE' });
            return;
        }
        logFailure(req, 'registration_handle_failed', error);
        res.status(500).json({ error: 'Unable to continue registration', code: 'REGISTRATION_FAILED' });
    }
};

export const sendRegistrationOTP = async (req: Request, res: Response): Promise<void> => {
    const parsed = pendingSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'REGISTRATION_SESSION_INVALID');
    try {
        const pending = await findBoundPendingRegistration(req, parsed.data.pendingId);
        if (!pending || !pending.password || !pending.handle || pending.currentStep < 4) return validationFailure(res, 'REGISTRATION_SESSION_INVALID');
        const issued = await issueEmailOtp({ destination: pending.email, purpose: 'REGISTRATION', subject: pending.id, ...requestContext(req) });
        await prisma.pendingRegistration.update({ where: { id: pending.id }, data: { currentStep: 5, otpCode: null, otpExpiresAt: null } });
        noStore(res);
        res.status(202).json({ success: true, cooldownUntil: issued.cooldownUntil.toISOString() });
    } catch (error) {
        if (error instanceof OtpError) {
            const status = error.code === 'OTP_COOLDOWN' ? 429 : 503;
            res.status(status).json({ error: error.message, code: error.code });
            return;
        }
        logFailure(req, 'registration_otp_failed', error);
        res.status(500).json({ error: 'Unable to send verification code', code: 'OTP_DELIVERY_FAILED' });
    }
};

export const completeRegistration = async (req: Request, res: Response): Promise<void> => {
    const parsed = completeRegistrationSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'INVALID_REGISTRATION_COMPLETION');
    try {
        const pending = await findBoundPendingRegistration(req, parsed.data.pendingId);
        if (!pending || !pending.password || !pending.handle || pending.currentStep < 5) return validationFailure(res, 'REGISTRATION_SESSION_INVALID');
        const pendingHandle = pending.handle;
        const pendingPassword = pending.password;
        const birthday = parseAndValidateDateOfBirth(formatDateOnly(pending.dob)!);
        const consumed = await consumeEmailOtp({ destination: pending.email, purpose: 'REGISTRATION', subject: pending.id, code: parsed.data.otp || parsed.data.code! }, async (tx) => {
            const created = await tx.user.create({
                data: {
                    email: pending.email, name: pending.fullName, birthday, handle: pendingHandle,
                    passwordHash: pendingPassword, emailVerifiedAt: new Date(), authProvider: 'Email', avatar: null,
                    demographics: { create: { ageGroup: calculateAgeGroupFromDate(birthday) } }
                },
                select: SAFE_USER_SELECT
            });
            await tx.notificationSettings.create({ data: { userId: created.id, settings: JSON.stringify({
                myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' },
                sharedPosts: { likes: 'following', comments: 'following', shares: 'off' },
                toggles: { activityFollowed: true, invitations: true, commentInteractions: true, newFollowers: true, emailNotifications: false }
            }) } });
            await tx.pendingRegistration.delete({ where: { id: pending.id } });
            return created;
        });
        const user = consumed.value;
        if (!user) throw new Error('Registration transaction did not return a user');
        const session = await createSession(user.id, res);
        const existingCookies = res.getHeader('Set-Cookie');
        const cookieValues = Array.isArray(existingCookies) ? existingCookies.map(String) : existingCookies ? [String(existingCookies)] : [];
        res.setHeader('Set-Cookie', [...cookieValues, registrationBrowserCookie('', 0)]);
        noStore(res);
        res.status(201).json(authenticationResponse(user, session.csrfToken));
    } catch (error: any) {
        if (error instanceof OtpError) {
            res.status(400).json({ error: error.message, code: error.code });
            return;
        }
        if (error instanceof ProfileValidationError) {
            res.status(error.statusCode).json({ error: error.message, code: error.code });
            return;
        }
        if (error?.code === 'P2002') {
            res.status(409).json({ error: 'Account cannot be created', code: 'ACCOUNT_UNAVAILABLE' });
            return;
        }
        logFailure(req, 'registration_completion_failed', error);
        res.status(500).json({ error: 'Unable to complete registration', code: 'REGISTRATION_FAILED' });
    }
};

export const requestPasswordReset = async (req: Request, res: Response): Promise<void> => {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res);
    try {
        const email = parsed.data.email.toLowerCase();
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } as any, select: { id: true, status: true, passwordHash: true } });
        noStore(res);
        res.status(202).json({ message: GENERIC_RECOVERY_RESPONSE });

        // Keep provider latency and delivery failures out of the public response
        // so this endpoint cannot be used to distinguish registered addresses.
        void (async () => {
            if (user?.status === 'ACTIVE' && user.passwordHash) {
                await issueEmailOtp({ destination: email, purpose: 'PASSWORD_RESET', subject: user.id, ...requestContext(req) });
            } else {
                await bcrypt.hash('non-enumerating-password-reset', 10);
            }
        })().catch((error) => logFailure(req, 'password_reset_delivery_failed', error));
        return;
    } catch (error) {
        logFailure(req, 'password_reset_request_failed', error);
    }
    noStore(res);
    res.status(202).json({ message: GENERIC_RECOVERY_RESPONSE });
};

export const confirmPasswordReset = async (req: Request, res: Response): Promise<void> => {
    const parsed = passwordResetConfirmSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'PASSWORD_RESET_INVALID');
    const email = parsed.data.email.toLowerCase();
    try {
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } as any, select: { id: true, status: true } });
        if (!user || user.status !== 'ACTIVE') throw new OtpError('OTP_INVALID', 'Invalid or expired code');
        const passwordHash = await bcrypt.hash(parsed.data.password, 12);
        await consumeEmailOtp({ destination: email, purpose: 'PASSWORD_RESET', subject: user.id, code: parsed.data.code }, async (tx) => {
            const invalidatedAt = new Date();
            await tx.user.update({ where: { id: user.id }, data: { passwordHash, password: null, passwordUpdatedAt: invalidatedAt, authInvalidatedAt: invalidatedAt } });
            await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        });
        notifyUserSessionsRevoked(user.id);
        clearSessionCookies(res);
        noStore(res);
        res.json({ success: true });
    } catch (error) {
        if (error instanceof OtpError) {
            res.status(400).json({ error: 'Invalid or expired code', code: 'PASSWORD_RESET_INVALID' });
            return;
        }
        logFailure(req, 'password_reset_confirm_failed', error);
        res.status(500).json({ error: 'Unable to reset password', code: 'PASSWORD_RESET_FAILED' });
    }
};

export const requestEmailVerification = async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true, emailVerifiedAt: true } });
        if (!user?.email) return validationFailure(res, 'EMAIL_UNAVAILABLE');
        if (!user.emailVerifiedAt) await issueEmailOtp({ destination: user.email, purpose: 'EMAIL_VERIFICATION', subject: req.user!.userId, ...requestContext(req) });
        noStore(res);
        res.status(202).json({ success: true });
    } catch (error) {
        if (error instanceof OtpError) {
            res.status(error.code === 'OTP_COOLDOWN' ? 429 : 503).json({ error: error.message, code: error.code });
            return;
        }
        logFailure(req, 'email_verification_request_failed', error);
        res.status(500).json({ error: 'Unable to send verification code', code: 'OTP_DELIVERY_FAILED' });
    }
};

export const confirmEmailVerification = async (req: Request, res: Response): Promise<void> => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'EMAIL_VERIFICATION_INVALID');
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true, emailVerifiedAt: true } });
        if (!user?.email) return validationFailure(res, 'EMAIL_UNAVAILABLE');
        if (!user.emailVerifiedAt) {
            await consumeEmailOtp({ destination: user.email, purpose: 'EMAIL_VERIFICATION', subject: req.user!.userId, code: parsed.data.code }, async (tx) => {
                await tx.user.update({ where: { id: req.user!.userId }, data: { emailVerifiedAt: new Date() } });
            });
        }
        res.json({ success: true });
    } catch (error) {
        if (error instanceof OtpError) {
            res.status(400).json({ error: 'Invalid or expired code', code: 'EMAIL_VERIFICATION_INVALID' });
            return;
        }
        logFailure(req, 'email_verification_confirm_failed', error);
        res.status(500).json({ error: 'Unable to verify email', code: 'EMAIL_VERIFICATION_FAILED' });
    }
};

export const requestEmailChange = async (req: Request, res: Response): Promise<void> => {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'EMAIL_CHANGE_INVALID');
    const email = parsed.data.email.toLowerCase();
    try {
        const issued = await issueEmailOtp({ destination: email, purpose: 'EMAIL_CHANGE', subject: req.user!.userId, ...requestContext(req) });
        noStore(res);
        res.status(202).json({ success: true, cooldownUntil: issued.cooldownUntil.toISOString() });
    } catch (error) {
        if (error instanceof OtpError) {
            res.status(error.code === 'OTP_COOLDOWN' ? 429 : 503).json({ error: error.message, code: error.code });
            return;
        }
        logFailure(req, 'email_change_request_failed', error);
        res.status(500).json({ error: 'Unable to send verification code', code: 'EMAIL_CHANGE_FAILED' });
    }
};

export const confirmEmailChange = async (req: Request, res: Response): Promise<void> => {
    const parsed = emailChangeConfirmSchema.safeParse(req.body);
    if (!parsed.success) return validationFailure(res, 'EMAIL_CHANGE_INVALID');
    const email = parsed.data.email.toLowerCase();
    try {
        await consumeEmailOtp({ destination: email, purpose: 'EMAIL_CHANGE', subject: req.user!.userId, code: parsed.data.code }, async (tx) => {
            await tx.user.update({ where: { id: req.user!.userId }, data: { email, emailVerifiedAt: new Date(), authInvalidatedAt: new Date() } });
            await tx.authSession.updateMany({ where: { userId: req.user!.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        });
        notifyUserSessionsRevoked(req.user!.userId);
        const session = await createSession(req.user!.userId, res);
        noStore(res);
        res.json({ success: true, email, csrfToken: session.csrfToken });
    } catch (error: any) {
        if (error instanceof OtpError) {
            res.status(400).json({ error: 'Invalid or expired code', code: 'EMAIL_CHANGE_INVALID' });
            return;
        }
        if (error?.code === 'P2002') {
            res.status(409).json({ error: 'Email is unavailable', code: 'EMAIL_UNAVAILABLE' });
            return;
        }
        logFailure(req, 'email_change_confirm_failed', error);
        res.status(500).json({ error: 'Unable to change email', code: 'EMAIL_CHANGE_FAILED' });
    }
};

export const getSession = async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: SAFE_USER_SELECT });
        if (!user) {
            res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
            return;
        }
        const csrfToken = readCookies(req)[CSRF_COOKIE_NAME];
        if (!csrfToken) {
            res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
            return;
        }
        noStore(res);
        res.json({ user: publicUser(user), csrfToken });
    } catch (error) {
        logFailure(req, 'session_read_failed', error);
        res.status(500).json({ error: 'Unable to read session', code: 'SESSION_FAILED' });
    }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
    try {
        if (req.authSession) await revokeSession(req.authSession.id);
        if (req.user?.authMode === 'legacy_bearer') {
            await prisma.user.update({ where: { id: req.user.userId }, data: { authInvalidatedAt: new Date() } });
        }
        clearSessionCookies(res);
        noStore(res);
        res.status(204).send();
    } catch (error) {
        logFailure(req, 'logout_failed', error);
        res.status(500).json({ error: 'Unable to sign out', code: 'LOGOUT_FAILED' });
    }
};

const parseProvider = (value: unknown): OAuthProvider | null => {
    if (typeof value !== 'string') return null;
    const provider = value.toUpperCase();
    return provider === 'GOOGLE' || provider === 'FACEBOOK' ? provider : null;
};

const OAUTH_BROWSER_COOKIE_NAME = process.env.OAUTH_BROWSER_COOKIE_NAME?.trim() || 'si_oauth_browser';
const oauthBrowserCookie = (value: string, maxAgeSeconds: number): string => {
    const secure = process.env.NODE_ENV === 'production';
    return [
        `${OAUTH_BROWSER_COOKIE_NAME}=${encodeURIComponent(value)}`,
        'Path=/api/auth/oauth',
        `Max-Age=${maxAgeSeconds}`,
        'HttpOnly',
        'SameSite=Lax',
        ...(secure ? ['Secure'] : [])
    ].join('; ');
};

const appendResponseCookie = (res: Response, cookie: string): void => {
    const current = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
    const values = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
    res.setHeader('Set-Cookie', [...values, cookie]);
};

const oauthClientRedirect = (params: Record<string, string>): string => {
    const configured = process.env.OAUTH_CLIENT_REDIRECT_URL?.trim() || process.env.CLIENT_URL?.trim()
        || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
    if (!configured) throw new OAuthError('OAUTH_REDIRECT_NOT_CONFIGURED');
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
        throw new OAuthError('OAUTH_REDIRECT_NOT_CONFIGURED');
    }
    url.hash = '';
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return url.toString();
};

export const startOAuth = async (req: Request, res: Response): Promise<void> => {
    const provider = parseProvider(req.params.provider);
    if (!provider) return validationFailure(res, 'OAUTH_PROVIDER_INVALID');
    try {
        const started = await beginOAuth(provider, 'LOGIN');
        appendResponseCookie(res, oauthBrowserCookie(started.browserSecret, started.maxAgeSeconds));
        noStore(res);
        res.json({ authorizationUrl: started.authorizationUrl });
    } catch (error) {
        logFailure(req, 'oauth_start_failed', error);
        res.status(503).json({ error: 'OAuth is unavailable', code: 'OAUTH_UNAVAILABLE' });
    }
};

export const startOAuthLink = async (req: Request, res: Response): Promise<void> => {
    const provider = parseProvider(req.params.provider);
    if (!provider) return validationFailure(res, 'OAUTH_PROVIDER_INVALID');
    try {
        const started = await beginOAuth(provider, 'LINK', req.user!.userId);
        appendResponseCookie(res, oauthBrowserCookie(started.browserSecret, started.maxAgeSeconds));
        noStore(res);
        res.json({ authorizationUrl: started.authorizationUrl });
    } catch (error) {
        logFailure(req, 'oauth_link_start_failed', error);
        res.status(503).json({ error: 'OAuth is unavailable', code: 'OAUTH_UNAVAILABLE' });
    }
};

export const oauthCallback = async (req: Request, res: Response): Promise<void> => {
    const provider = parseProvider(req.params.provider);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const browserSecret = readCookies(req)[OAUTH_BROWSER_COOKIE_NAME] || '';
    if (!provider || !code || !state) {
        appendResponseCookie(res, oauthBrowserCookie('', 0));
        try {
            res.redirect(302, oauthClientRedirect({ oauth_error: 'OAUTH_CALLBACK_INVALID' }));
        } catch {
            validationFailure(res, 'OAUTH_CALLBACK_INVALID');
        }
        return;
    }
    try {
        const callbackSession = await resolveSession(req);
        const result = await completeOAuth(provider, code, state, browserSecret, callbackSession?.userId);
        noStore(res);
        if (result.mode === 'LINK') {
            appendResponseCookie(res, oauthBrowserCookie('', 0));
            res.redirect(302, oauthClientRedirect({ oauth: 'linked', oauth_provider: provider.toLowerCase() }));
            return;
        }
        await createSession(result.user.id, res);
        appendResponseCookie(res, oauthBrowserCookie('', 0));
        res.redirect(302, oauthClientRedirect({ oauth: 'success', oauth_provider: provider.toLowerCase() }));
    } catch (error) {
        const codeValue = error instanceof OAuthError ? error.code : 'OAUTH_AUTHENTICATION_FAILED';
        logFailure(req, 'oauth_callback_failed', error);
        const safeCode = [
            'ACCOUNT_LINK_REQUIRED', 'OAUTH_ACCOUNT_CONFLICT', 'AUTH_ACCOUNT_INACTIVE',
            'OAUTH_PROVIDER_ALREADY_LINKED', 'OAUTH_LINK_SESSION_INVALID', 'OAUTH_STATE_INVALID', 'OAUTH_CALLBACK_INVALID'
        ].includes(codeValue) ? codeValue : 'OAUTH_AUTHENTICATION_FAILED';
        appendResponseCookie(res, oauthBrowserCookie('', 0));
        try {
            res.redirect(302, oauthClientRedirect({ oauth_error: safeCode }));
        } catch {
            res.status(safeCode === 'ACCOUNT_LINK_REQUIRED' ? 409 : 400).json({ error: 'OAuth authentication failed', code: safeCode });
        }
    }
};
