import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { hashSessionSecret } from './sessionService';

export class AccountSecurityError extends Error {
    constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

export const normalizeSecurityCode = (input: string): string => input
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[\s-]/g, '').toUpperCase();

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const base32Encode = (bytes: Buffer): string => {
    let value = 0, bits = 0, output = '';
    for (const byte of bytes) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { bits -= 5; output += alphabet[(value >>> bits) & 31]; }
    }
    if (bits) output += alphabet[(value << (5 - bits)) & 31];
    return output;
};
export const base32Decode = (value: string): Buffer => {
    let bits = 0, accumulator = 0;
    const bytes: number[] = [];
    for (const letter of value.toUpperCase().replace(/=+$/, '')) {
        const index = alphabet.indexOf(letter);
        if (index < 0) throw new AccountSecurityError('MFA_SECRET_INVALID');
        accumulator = (accumulator << 5) | index; bits += 5;
        if (bits >= 8) { bits -= 8; bytes.push((accumulator >>> bits) & 255); }
    }
    return Buffer.from(bytes);
};

// RFC 6238 / RFC 4226, 30-second periods; SHA-1 and six digits for authenticator interoperability.
export const totpAtStep = (secret: string, step: bigint, digits = 6): string => {
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(step);
    const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
    const offset = digest[digest.length - 1] & 15;
    const number = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
    return String(number).padStart(digits, '0');
};

export const findTotpStep = (secret: string, code: string, now = Date.now(), lastStep?: bigint | null): bigint | null => {
    const normalized = normalizeSecurityCode(code);
    if (!/^\d{6}$/.test(normalized)) return null;
    const current = BigInt(Math.floor(now / 30_000));
    for (const offset of [BigInt(0), BigInt(-1), BigInt(1)]) {
        const step = current + offset;
        if (step < BigInt(0) || (lastStep != null && step <= BigInt(lastStep))) continue;
        if (timingSafeEqual(Buffer.from(totpAtStep(secret, step)), Buffer.from(normalized))) return step;
    }
    return null;
};

const encryptionKey = (): Buffer => {
    const configured = process.env.MFA_ENCRYPTION_KEY?.trim() || '';
    const key = Buffer.from(configured, 'base64');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(configured) || key.length !== 32) throw new AccountSecurityError('MFA_NOT_CONFIGURED', 503);
    return key;
};
export const isMfaConfigured = (): boolean => { try { encryptionKey(); return true; } catch { return false; } };
export const encryptMfaSecret = (secret: string, userId: string): string => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`opiniup:mfa:v1:${userId}`));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
};
export const decryptMfaSecret = (encoded: string, userId: string): string => {
    const [version, iv, tag, ciphertext] = encoded.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new AccountSecurityError('MFA_UNAVAILABLE', 503);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`opiniup:mfa:v1:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
};
export const generateMfaSecret = (): string => base32Encode(randomBytes(20));
export const recoveryCodeHash = (userId: string, code: string): string => hashSessionSecret(`mfa-recovery:${userId}:${normalizeSecurityCode(code)}`);
export const generateRecoveryCodes = (userId: string): { codes: string[]; hashes: string[] } => {
    const codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'));
    return { codes, hashes: codes.map((code) => recoveryCodeHash(userId, code)) };
};
export const lockAccountSecurity = async (tx: any, userId: string): Promise<void> => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account-security:${userId}`}, 0))`);
};

// Caller holds the per-user transaction lock. A used step/code is persisted in the same transaction as its protected action.
export const consumeMfaProof = async (tx: any, userId: string, code: string): Promise<boolean> => {
    const mfa = await tx.userMfa.findUnique({ where: { userId } });
    if (!mfa?.enabledAt || !mfa.encryptedSecret) return false;
    const normalized = normalizeSecurityCode(code);
    if (/^[0-9A-F]{20}$/.test(normalized)) {
        const hash = recoveryCodeHash(userId, normalized);
        if (!(mfa.recoveryCodeHashes as string[]).includes(hash)) return false;
        await tx.userMfa.update({ where: { userId }, data: { recoveryCodeHashes: mfa.recoveryCodeHashes.filter((entry: string) => entry !== hash) } });
        return true;
    }
    const step = findTotpStep(decryptMfaSecret(mfa.encryptedSecret, userId), normalized, Date.now(), mfa.lastAcceptedStep);
    if (step === null) return false;
    await tx.userMfa.update({ where: { userId }, data: { lastAcceptedStep: step } });
    return true;
};
