import { Request, Response } from 'express';
import prisma from '../prisma';
import { consumeEmailOtp, issueEmailOtp, OtpError } from '../services/otpService';

const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const isEmail = (value: unknown): value is string => (
    typeof value === 'string'
    && value.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
);

const unavailablePhoneChannel = (res: Response) => res.status(503).json({
    error: 'Phone OTP delivery is unavailable',
    code: 'OTP_CHANNEL_UNAVAILABLE'
});

const authenticatedEmailSubject = async (req: Request, identifier: string) => {
    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) return null;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user?.email || normalizeEmail(user.email) !== normalizeEmail(identifier)) return null;
    return { userId: user.id, destination: normalizeEmail(user.email), storedEmail: user.email };
};

export const sendOTP = async (req: Request, res: Response) => {
    const { identifier, type } = req.body || {};
    if (type === 'phone') return unavailablePhoneChannel(res);
    if (type !== 'email' || !isEmail(identifier)) {
        return res.status(400).json({ error: 'Invalid OTP request', code: 'OTP_REQUEST_INVALID' });
    }

    try {
        const authenticated = await authenticatedEmailSubject(req, identifier);
        if (!authenticated) {
            return res.status(403).json({ error: 'OTP identifier does not match the authenticated account', code: 'OTP_IDENTIFIER_MISMATCH' });
        }
        const result = await issueEmailOtp({
            destination: authenticated.destination,
            purpose: 'EMAIL_VERIFICATION',
            subject: authenticated.userId
        });
        res.json({
            message: `OTP sent to ${identifier}`,
            cooldownUntil: result.cooldownUntil.toISOString()
        });
    } catch (error: any) {
        if (error instanceof OtpError) {
            const status = error.code === 'OTP_COOLDOWN' || error.code === 'OTP_RATE_LIMITED' ? 429 : 503;
            if (error.details?.retryAfterSeconds) res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
            return res.status(status).json({ error: error.message, code: error.code, ...(error.details || {}) });
        }
        console.error(JSON.stringify({ event: 'email_verification_otp_send_failed', errorCode: error?.code || 'UNKNOWN' }));
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};

export const verifyOTP = async (req: Request, res: Response) => {
    const { identifier, code } = req.body || {};
    if (typeof identifier === 'string' && !identifier.includes('@')) return unavailablePhoneChannel(res);
    if (!isEmail(identifier) || typeof code !== 'string') {
        return res.status(400).json({ error: 'Invalid OTP code', code: 'OTP_INVALID' });
    }

    try {
        const authenticated = await authenticatedEmailSubject(req, identifier);
        if (!authenticated) {
            return res.status(403).json({ error: 'OTP identifier does not match the authenticated account', code: 'OTP_IDENTIFIER_MISMATCH' });
        }
        await consumeEmailOtp({
            destination: authenticated.destination,
            purpose: 'EMAIL_VERIFICATION',
            subject: authenticated.userId,
            code
        }, async (tx) => {
            const updated = await tx.user.updateMany({
                where: { id: authenticated.userId, email: authenticated.storedEmail },
                data: { emailVerifiedAt: new Date() }
            });
            if (updated.count !== 1) {
                throw Object.assign(new Error('Authenticated email changed during verification'), { code: 'OTP_ACCOUNT_CHANGED' });
            }
        });

        res.json({ success: true, message: 'OTP verified successfully' });
    } catch (error: any) {
        if (error instanceof OtpError && error.code === 'OTP_INVALID') {
            return res.status(400).json({ error: 'Invalid OTP code', code: error.code });
        }
        console.error(JSON.stringify({ event: 'email_verification_otp_verify_failed', errorCode: error?.code || 'UNKNOWN' }));
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
};
