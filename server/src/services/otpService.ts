import { createHmac, randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '../prisma';
import { AuthEmailPurpose, sendAuthEmail } from './emailService';

export type OtpPurpose = AuthEmailPurpose;

interface IssueOtpInput {
    destination: string;
    purpose: OtpPurpose;
    subject: string;
    onSent?: (tx: any) => Promise<void>;
}

interface VerifyOtpInput extends IssueOtpInput {
    code: string;
}

interface OtpErrorDetails {
    cooldownUntil?: string;
    retryAfterSeconds?: number;
}

export class OtpError extends Error {
    constructor(
        public readonly code: 'OTP_COOLDOWN' | 'OTP_RATE_LIMITED' | 'OTP_INVALID' | 'OTP_DELIVERY_FAILED',
        message: string,
        public readonly details?: OtpErrorDetails
    ) {
        super(message);
        this.name = 'OtpError';
    }
}

const boundedInt = (name: string, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const secret = (): string => process.env.OTP_HASH_SECRET?.trim()
    || process.env.JWT_SECRET?.trim()
    || (() => { throw new Error('JWT_SECRET must be configured for OTP hashing'); })();

const digest = (value: string): string => createHmac('sha256', secret()).update(value).digest('hex');
const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const db = prisma as any;

const isStagingDeployment = (): boolean => process.env.DEPLOYMENT_ENV?.trim().toLowerCase() === 'staging';

const enforceStagingRecipientAllowlist = (destination: string): void => {
    if (!isStagingDeployment()) return;
    const allowed = new Set((process.env.STAGING_OTP_ALLOWED_EMAILS || '')
        .split(',')
        .map(normalizeEmail)
        .filter(Boolean));
    if (!allowed.has(destination)) {
        throw new OtpError('OTP_DELIVERY_FAILED', 'Unable to send verification code');
    }
};

const localLocks = new Map<string, Promise<void>>();
const withLocalLock = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = localLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    localLocks.set(key, tail);
    await previous;
    try {
        return await work();
    } finally {
        release();
        if (localLocks.get(key) === tail) localLocks.delete(key);
    }
};

const acquireDatabaseLock = async (tx: any, key: string): Promise<void> => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
};

const cooldownDetails = (cooldownUntil: Date): OtpErrorDetails => ({
    cooldownUntil: cooldownUntil.toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntil.getTime() - Date.now()) / 1000))
});

const issueEmailOtpInternal = async (input: IssueOtpInput): Promise<{ cooldownUntil: Date }> => {
    const destination = normalizeEmail(input.destination);
    enforceStagingRecipientAllowlist(destination);
    const destinationHash = digest(destination);
    const issuanceKey = `${destinationHash}:${input.purpose}`;
    const now = new Date();
    const code = randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(`${input.purpose}:${input.subject}:${code}`, boundedInt('OTP_BCRYPT_ROUNDS', 10, 8, 14));
    const ttlSeconds = boundedInt('OTP_TTL_SECONDS', 600, 120, 1800);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const cooldownUntil = new Date(now.getTime() + boundedInt('OTP_COOLDOWN_SECONDS', 60, 15, 600) * 1000);
    const maxAttempts = boundedInt('OTP_MAX_ATTEMPTS', 5, 3, 10);

    let challenge: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            challenge = await db.$transaction(async (tx: any) => {
                await acquireDatabaseLock(tx, issuanceKey);
                const rateWindowSeconds = boundedInt('OTP_RATE_LIMIT_WINDOW_SECONDS', 3600, 300, 86400);
                const maxSendsPerWindow = boundedInt('OTP_MAX_SENDS_PER_WINDOW', 5, 2, 20);
                const rateWindowStart = new Date(now.getTime() - rateWindowSeconds * 1000);
                const recentCount = await tx.otpChallenge.count({
                    where: { destinationHash, purpose: input.purpose, createdAt: { gte: rateWindowStart } }
                });
                if (recentCount >= maxSendsPerWindow) {
                    const oldestRecent = await tx.otpChallenge.findFirst({
                        where: { destinationHash, purpose: input.purpose, createdAt: { gte: rateWindowStart } },
                        orderBy: { createdAt: 'asc' },
                        select: { createdAt: true }
                    });
                    const retryAt = new Date((oldestRecent?.createdAt || now).getTime() + rateWindowSeconds * 1000);
                    throw new OtpError('OTP_RATE_LIMITED', 'Too many verification codes requested', cooldownDetails(retryAt));
                }
                const active = await tx.otpChallenge.findFirst({
                    where: {
                        destinationHash,
                        purpose: input.purpose,
                        subject: input.subject,
                        deliveryStatus: { in: ['PENDING', 'SENT'] },
                        consumedAt: null,
                        invalidatedAt: null,
                        expiresAt: { gt: now },
                        cooldownUntil: { gt: now }
                    },
                    select: { cooldownUntil: true }
                });
                if (active) return { existing: true, cooldownUntil: active.cooldownUntil };

                if (isStagingDeployment()) {
                    await acquireDatabaseLock(tx, 'otp-staging-real-email-cap');
                    const stagingLimit = boundedInt('STAGING_OTP_REAL_EMAIL_LIMIT', 1, 1, 3);
                    const reservedDeliveries = await tx.otpChallenge.count({
                        where: { deliveryStatus: { in: ['PENDING', 'SENT'] } }
                    });
                    if (reservedDeliveries >= stagingLimit) {
                        throw new OtpError('OTP_RATE_LIMITED', 'Staging email delivery limit reached');
                    }
                }

                const latest = await tx.otpChallenge.findFirst({
                    where: { destinationHash, purpose: input.purpose, subject: input.subject },
                    orderBy: { version: 'desc' },
                    select: { version: true }
                });
                await tx.otpChallenge.updateMany({
                    where: { destinationHash, purpose: input.purpose, subject: input.subject, consumedAt: null, invalidatedAt: null },
                    data: { invalidatedAt: now, deliveryStatus: 'FAILED' }
                });
                return tx.otpChallenge.create({
                    data: {
                        destinationHash,
                        purpose: input.purpose,
                        subject: input.subject,
                        codeHash,
                        deliveryStatus: 'PENDING',
                        attempts: 0,
                        maxAttempts,
                        expiresAt,
                        cooldownUntil,
                        version: (latest?.version || 0) + 1
                    }
                });
            });
            if (challenge.existing) {
                throw new OtpError('OTP_COOLDOWN', 'Please wait before requesting another code', cooldownDetails(challenge.cooldownUntil));
            }
            break;
        } catch (error: any) {
            if (error instanceof OtpError) throw error;
            if (error?.code !== 'P2002' || attempt === 2) throw error;
        }
    }
    if (!challenge) throw new OtpError('OTP_DELIVERY_FAILED', 'Unable to send verification code');

    try {
        await sendAuthEmail({
            to: destination,
            code,
            purpose: input.purpose,
            idempotencyKey: `otp-${challenge.id}-v${challenge.version}`,
            expiresInMinutes: ttlSeconds / 60
        });
        await db.$transaction(async (tx: any) => {
            const updated = await tx.otpChallenge.updateMany({
                where: { id: challenge.id, version: challenge.version, deliveryStatus: 'PENDING', invalidatedAt: null },
                data: { deliveryStatus: 'SENT' }
            });
            if (updated.count !== 1) {
                throw Object.assign(new Error('Challenge was invalidated during delivery'), { code: 'OTP_STATE_CHANGED' });
            }
            if (input.onSent) await input.onSent(tx);
        });
        return { cooldownUntil };
    } catch (_error) {
        await db.otpChallenge.updateMany({
            where: { id: challenge.id, deliveryStatus: 'PENDING' },
            data: { deliveryStatus: 'FAILED', invalidatedAt: new Date() }
        }).catch(() => undefined);
        throw new OtpError('OTP_DELIVERY_FAILED', 'Unable to send verification code');
    }
};

export const issueEmailOtp = async (input: IssueOtpInput): Promise<{ cooldownUntil: Date }> => {
    const key = `issue:${digest(`${normalizeEmail(input.destination)}:${input.purpose}`)}`;
    return withLocalLock(key, () => issueEmailOtpInternal(input));
};

export const consumeEmailOtp = async <T = undefined>(
    input: VerifyOtpInput,
    onConsume?: (tx: any) => Promise<T>
): Promise<{ challengeId: string; value: T | undefined }> => {
    if (!/^\d{6}$/.test(input.code)) throw new OtpError('OTP_INVALID', 'Invalid or expired code');
    const destinationHash = digest(normalizeEmail(input.destination));
    const now = new Date();
    const challenge = await db.otpChallenge.findFirst({
        where: {
            destinationHash,
            purpose: input.purpose,
            subject: input.subject,
            deliveryStatus: 'SENT',
            consumedAt: null,
            invalidatedAt: null,
            expiresAt: { gt: now }
        },
        orderBy: { version: 'desc' }
    });
    if (!challenge || challenge.attempts >= challenge.maxAttempts) throw new OtpError('OTP_INVALID', 'Invalid or expired code');

    const result = await withLocalLock<{ valid: boolean; affected: number; value?: T }>(`verify:${challenge.id}`, () => db.$transaction(async (tx: any) => {
        await acquireDatabaseLock(tx, `otp-verify:${challenge.id}`);
        const current = await tx.otpChallenge.findUnique({ where: { id: challenge.id } });
        const transactionNow = new Date();
        if (!current || current.deliveryStatus !== 'SENT' || current.consumedAt || current.invalidatedAt
            || current.expiresAt <= transactionNow || current.attempts >= current.maxAttempts) {
            return { valid: false, affected: 0 };
        }

        const valid = await bcrypt.compare(`${input.purpose}:${input.subject}:${input.code}`, current.codeHash);
        if (valid) {
            const consumed = await tx.otpChallenge.updateMany({
                where: {
                    id: current.id,
                    deliveryStatus: 'SENT',
                    consumedAt: null,
                    invalidatedAt: null,
                    expiresAt: { gt: transactionNow },
                    attempts: current.attempts
                },
                data: { consumedAt: transactionNow }
            });
            if (consumed.count !== 1) return { valid: false, affected: 0 };
            const value = onConsume ? await onConsume(tx) : undefined;
            return { valid: true, affected: 1, value };
        }

        const attempts = current.attempts + 1;
        const incremented = await tx.otpChallenge.updateMany({
            where: { id: current.id, deliveryStatus: 'SENT', consumedAt: null, invalidatedAt: null, attempts: current.attempts },
            data: {
                attempts,
                ...(attempts >= current.maxAttempts ? { invalidatedAt: transactionNow, deliveryStatus: 'FAILED' } : {})
            }
        });
        return { valid: false, affected: incremented.count };
    }));
    if (!result.valid || result.affected !== 1) throw new OtpError('OTP_INVALID', 'Invalid or expired code');
    return { challengeId: challenge.id, value: result.value };
};
