import { createHmac, randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '../prisma';
import { AuthEmailPurpose, sendAuthEmail } from './emailService';
import { lockAccountSecurity } from './mfaService';

export type OtpPurpose = AuthEmailPurpose;

interface IssueOtpInput {
    destination: string;
    purpose: OtpPurpose;
    subject: string;
    requestIp?: string;
    userAgent?: string;
    sourceDestination?: string;
    supersedeBySubjectPurpose?: boolean;
}

interface VerifyOtpInput {
    destination: string;
    purpose: OtpPurpose;
    subject: string;
    code: string;
    requireLatestIntent?: boolean;
}

export class OtpError extends Error {
    constructor(public readonly code: 'OTP_COOLDOWN' | 'OTP_RATE_LIMITED' | 'OTP_INVALID' | 'OTP_DELIVERY_FAILED', message: string) {
        super(message);
    }
}

const boundedInt = (name: string, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const secret = (): string => process.env.OTP_HASH_SECRET?.trim()
    || process.env.AUTH_SESSION_HASH_SECRET?.trim()
    || process.env.JWT_SECRET?.trim()
    || (() => { throw new Error('OTP_HASH_SECRET or AUTH_SESSION_HASH_SECRET must be configured'); })();

const digest = (value: string): string => createHmac('sha256', secret()).update(value).digest('hex');
const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const codePepper = (): string => process.env.OTP_CODE_PEPPER?.trim()
    || (() => { throw new Error('OTP_CODE_PEPPER must be configured independently'); })();
const v2CodeMaterial = (input: Pick<VerifyOtpInput, 'destination' | 'purpose' | 'subject' | 'code'>): string => createHmac('sha256', codePepper())
    .update(`v2:${input.purpose}:${input.subject}:${normalizeEmail(input.destination)}:${input.code}`)
    .digest('hex');
export const otpServiceDestinationHash = (value: string): string => digest(normalizeEmail(value));
const db = prisma as any;

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

const incrementOtpBudget = async (tx: any, scope: string, dimension: string, nowMs: number, windowMs: number): Promise<number> => {
    const windowStartedAt = new Date(Math.floor(nowMs / windowMs) * windowMs);
    const expiresAt = new Date(windowStartedAt.getTime() + windowMs * 2);
    const keyHash = digest(`otp-budget:${scope}:${windowStartedAt.toISOString()}:${dimension}`);
    const row = await tx.authRateLimit.upsert({
        where: { keyHash },
        create: { keyHash, count: 1, windowStartedAt, expiresAt },
        update: { count: { increment: 1 }, expiresAt },
        select: { count: true }
    });
    return row.count;
};

const consumeOtpIssuanceBudget = async (destination: string): Promise<void> => {
    const now = Date.now();
    const destinationHash = otpServiceDestinationHash(destination);
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const perDestinationHourlyLimit = boundedInt('OTP_DESTINATION_HOURLY_LIMIT', 5, 1, 100);
    const perDestinationDailyLimit = boundedInt('OTP_DESTINATION_DAILY_LIMIT', 12, 1, 500);
    const globalDailyLimit = boundedInt('OTP_GLOBAL_DAILY_LIMIT', 10_000, 100, 1_000_000);
    const counts = await db.$transaction(async (tx: any) => Promise.all([
        incrementOtpBudget(tx, 'destination-hour', destinationHash, now, hourMs),
        incrementOtpBudget(tx, 'destination-day', destinationHash, now, dayMs),
        incrementOtpBudget(tx, 'global-day', 'all-destinations', now, dayMs)
    ]));
    if (counts[0] > perDestinationHourlyLimit || counts[1] > perDestinationDailyLimit || counts[2] > globalDailyLimit) {
        throw new OtpError('OTP_RATE_LIMITED', 'Please wait before requesting another code');
    }
};

const issueEmailOtpInternal = async (input: IssueOtpInput): Promise<{ cooldownUntil: Date }> => {
    const destination = normalizeEmail(input.destination);
    const destinationHash = otpServiceDestinationHash(destination);
    const issuanceKey = input.supersedeBySubjectPurpose
        ? `intent:${input.purpose}:${input.subject}`
        : `${destinationHash}:${input.purpose}:${input.subject}`;
    const now = new Date();
    const code = randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(v2CodeMaterial({ ...input, destination, code }), boundedInt('OTP_BCRYPT_ROUNDS', 10, 8, 14));
    const ttlSeconds = boundedInt('OTP_TTL_SECONDS', 600, 120, 1800);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const cooldownUntil = new Date(now.getTime() + boundedInt('OTP_COOLDOWN_SECONDS', 60, 15, 600) * 1000);
    const maxAttempts = boundedInt('OTP_MAX_ATTEMPTS', 5, 3, 10);

    let challenge: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            challenge = await db.$transaction(async (tx: any) => {
                await acquireDatabaseLock(tx, issuanceKey);
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
                const latest = await tx.otpChallenge.findFirst({
                    where: { destinationHash, purpose: input.purpose, subject: input.subject },
                    orderBy: { version: 'desc' },
                    select: { version: true }
                });
                const latestIntent = await tx.otpChallenge.findFirst({
                    where: { purpose: input.purpose, subject: input.subject },
                    orderBy: { intentVersion: 'desc' },
                    select: { intentVersion: true }
                });
                await tx.otpChallenge.updateMany({
                    where: {
                        ...(input.supersedeBySubjectPurpose ? {} : { destinationHash }),
                        purpose: input.purpose,
                        subject: input.subject,
                        consumedAt: null,
                        invalidatedAt: null
                    },
                    data: { invalidatedAt: now, deliveryStatus: 'FAILED' }
                });
                return tx.otpChallenge.create({
                    data: {
                        destination,
                        destinationHash,
                        purpose: input.purpose,
                        subject: input.subject,
                        codeHash,
                        hashVersion: 2,
                        intentVersion: (latestIntent?.intentVersion || 0) + 1,
                        sourceDestinationHash: input.sourceDestination ? otpServiceDestinationHash(input.sourceDestination) : null,
                        deliveryStatus: 'PENDING',
                        attempts: 0,
                        maxAttempts,
                        expiresAt,
                        cooldownUntil,
                        version: (latest?.version || 0) + 1,
                        ipHash: input.requestIp ? digest(input.requestIp) : null,
                        userAgentHash: input.userAgent ? digest(input.userAgent.slice(0, 512)) : null
                    }
                });
            });
            if (challenge.existing) throw new OtpError('OTP_COOLDOWN', 'Please wait before requesting another code');
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
        const updated = await db.otpChallenge.updateMany({
            where: { id: challenge.id, version: challenge.version, deliveryStatus: 'PENDING', invalidatedAt: null },
            data: { deliveryStatus: 'SENT' }
        });
        if (updated.count !== 1) throw Object.assign(new Error('Challenge was invalidated during delivery'), { code: 'OTP_STATE_CHANGED' });
        return { cooldownUntil };
    } catch (error) {
        await db.otpChallenge.updateMany({
            where: { id: challenge.id, deliveryStatus: 'PENDING' },
            data: { deliveryStatus: 'FAILED', invalidatedAt: new Date() }
        }).catch(() => undefined);
        throw new OtpError('OTP_DELIVERY_FAILED', 'Unable to send verification code');
    }
};

export const issueEmailOtp = async (input: IssueOtpInput): Promise<{ cooldownUntil: Date }> => {
    const destination = normalizeEmail(input.destination);
    const key = `issue:${digest(`${destination}:${input.purpose}:${input.subject}`)}`;
    return withLocalLock(key, async () => {
        await consumeOtpIssuanceBudget(destination);
        return issueEmailOtpInternal({ ...input, destination });
    });
};

export const consumeEmailOtp = async <T = undefined>(
    input: VerifyOtpInput,
    onConsume?: (tx: any, challenge: { createdAt: Date; intentVersion: number; sourceDestinationHash?: string | null }) => Promise<T>
): Promise<{ challengeId: string; value: T | undefined }> => {
    if (!/^\d{6}$/.test(input.code)) throw new OtpError('OTP_INVALID', 'Invalid or expired code');
    const destinationHash = otpServiceDestinationHash(input.destination);
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
        orderBy: { createdAt: 'desc' }
    });
    if (!challenge || challenge.attempts >= challenge.maxAttempts) throw new OtpError('OTP_INVALID', 'Invalid or expired code');

    const result = await withLocalLock<{ valid: boolean; affected: number; value?: T }>(`verify:${challenge.id}`, () => db.$transaction(async (tx: any) => {
        if (['PASSWORD_RESET', 'EMAIL_CHANGE', 'EMAIL_VERIFICATION'].includes(input.purpose)) await lockAccountSecurity(tx, input.subject);
        await acquireDatabaseLock(tx, `otp-verify:${challenge.id}`);
        const current = await tx.otpChallenge.findUnique({ where: { id: challenge.id } });
        const transactionNow = new Date();
        if (!current || current.deliveryStatus !== 'SENT' || current.consumedAt || current.invalidatedAt
            || current.expiresAt <= transactionNow || current.attempts >= current.maxAttempts) {
            return { valid: false, affected: 0 };
        }

        if (input.requireLatestIntent) {
            const latestIntent = await tx.otpChallenge.findFirst({
                where: { purpose: input.purpose, subject: input.subject },
                orderBy: { intentVersion: 'desc' },
                select: { id: true }
            });
            if (latestIntent?.id !== current.id) return { valid: false, affected: 0 };
        }

        const valid = current.hashVersion === 2
            ? await bcrypt.compare(v2CodeMaterial(input), current.codeHash)
            : current.hashVersion === 1
                ? await bcrypt.compare(`${input.purpose}:${input.subject}:${input.code}`, current.codeHash)
                : false;
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
            const value = onConsume ? await onConsume(tx, {
                createdAt: current.createdAt,
                intentVersion: current.intentVersion,
                sourceDestinationHash: current.sourceDestinationHash
            }) : undefined;
            return { valid: true, affected: 1, value };
        }

        const attempts = current.attempts + 1;
        const incremented = await tx.otpChallenge.updateMany({
            where: {
                id: current.id,
                deliveryStatus: 'SENT',
                consumedAt: null,
                invalidatedAt: null,
                attempts: current.attempts
            },
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
