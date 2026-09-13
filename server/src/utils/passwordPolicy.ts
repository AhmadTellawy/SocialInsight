import { z } from 'zod';

export const BCRYPT_PASSWORD_MAX_BYTES = 72;

export const passwordUtf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

export const fitsBcryptPasswordLimit = (value: string): boolean => passwordUtf8Bytes(value) <= BCRYPT_PASSWORD_MAX_BYTES;

export const credentialPasswordSchema = z.string()
    .min(1)
    .max(128)
    .refine(fitsBcryptPasswordLimit, { message: 'Password exceeds the supported UTF-8 byte length' });

export const newPasswordSchema = z.string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/\d/)
    .regex(/[!@#$%^&*]/)
    .refine(fitsBcryptPasswordLimit, { message: 'Password exceeds the supported UTF-8 byte length' });
