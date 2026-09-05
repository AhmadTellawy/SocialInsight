import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const hashRegistrationSecret = (secret: string): string =>
    createHash('sha256').update(secret, 'utf8').digest('hex');

export const createRegistrationCapability = (): { secret: string; secretHash: string } => {
    const secret = randomBytes(32).toString('base64url');
    return { secret, secretHash: hashRegistrationSecret(secret) };
};

export const verifyRegistrationSecret = (storedHash: string | null | undefined, candidate: unknown): boolean => {
    if (!storedHash || typeof candidate !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;
    const candidateHash = hashRegistrationSecret(candidate);
    const stored = Buffer.from(storedHash, 'hex');
    const supplied = Buffer.from(candidateHash, 'hex');
    return stored.length === supplied.length && timingSafeEqual(stored, supplied);
};

export const buildPendingRegistrationReference = (id: string, secret: string): string => `${id}.${secret}`;

export const parsePendingRegistrationReference = (value: unknown): { id: string; secret: string } | null => {
    if (typeof value !== 'string' || value.length > 512) return null;
    const separator = value.lastIndexOf('.');
    if (separator < 1) return null;
    const id = value.slice(0, separator);
    const secret = value.slice(separator + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(secret) ? { id, secret } : null;
};
