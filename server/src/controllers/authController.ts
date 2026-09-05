import { Request, Response } from 'express';
import prisma from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/authMiddleware';
import { z } from 'zod';
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
    buildPendingRegistrationReference,
    createRegistrationCapability,
    parsePendingRegistrationReference,
    verifyRegistrationSecret
} from '../services/registrationCapability';

const GENERIC_LOGIN_ERROR = 'Invalid login credentials';
const LEGACY_REGISTER_DISABLED_ERROR = 'Use the multi-step registration flow';

const registerSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    handle: z.string().min(3, 'Handle must be at least 3 characters').regex(/^[a-z0-9_.]+$/, 'Invalid handle format'),
    email: z.string().email('Invalid email address').optional().nullable(),
    phone: z.string().optional().nullable(),
    password: z.string().min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/\d/, 'Password must contain at least one number')
        .regex(/[!@#$%^&*]/, 'Password must contain at least one special character'),
    birthday: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    avatar: z.string().optional().nullable(),
    authProvider: z.string().optional().nullable()
});

const loginSchema = z.object({
    identifier: z.string().min(1, 'Identifier is required'),
    password: z.string().min(1, 'Password is required'),
    authProvider: z.string().optional()
});

const initRegistrationSchema = z.object({
    fullName: z.string().min(1, 'Full name is required'),
    email: z.string().email('Invalid email address'),
    dob: z.string()
});

const passwordValidationSchema = z.object({
    password: z.string().min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/\d/, 'Password must contain at least one number')
        .regex(/[!@#$%^&*]/, 'Password must contain at least one special character'),
});


const SAFE_USER_SELECT = {
    id: true,
    name: true,
    handle: true,
    avatar: true,
    ...PUBLIC_AVATAR_MEDIA_SELECT,
    country: true,
    bio: true,
    location: true,
    website: true,
    language: true,
    isPrivate: true,
    verifiedBadge: true,
    followersCount: true,
    followingCount: true,
    birthday: true,
    demographics: true,
    createdAt: true,
    updatedAt: true
};

export const register = async (req: Request, res: Response) => {
    res.status(410).json({ error: LEGACY_REGISTER_DISABLED_ERROR });
};

export const login = async (req: Request, res: Response) => {
    // Validate inputs using Zod
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ error: validation.error.errors[0].message });
        return;
    }

    const { identifier, password } = req.body;

    try {
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: { equals: identifier, mode: 'insensitive' } },
                    { handle: { equals: identifier, mode: 'insensitive' } }
                ]
            } as any,
            include: { avatarMedia: { include: { variants: true } } }
        });

        if (!user) {
            res.status(401).json({ error: GENERIC_LOGIN_ERROR });
            return;
        }

        // Verify Password
        let isPasswordValid = false;
        const storedProvider = (user.authProvider || 'Email').toLowerCase();
        const hasPasswordCredential = Boolean(user.passwordHash || user.password);
        const requiresPassword = storedProvider === 'email' || hasPasswordCredential;

        if (!requiresPassword) {
            res.status(401).json({ error: GENERIC_LOGIN_ERROR });
            return;
        }

        if (password) {
            if (user.passwordHash) {
                isPasswordValid = await bcrypt.compare(password, user.passwordHash);
            } else if (user.password && user.password === password) {
                // FALLBACK: Migrate old plain text password
                isPasswordValid = true;
                const salt = await bcrypt.genSalt(10);
                const hash = await bcrypt.hash(password, salt);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { passwordHash: hash, password: null } // Clear plain text
                });
            }
        }

        if (!isPasswordValid) {
            res.status(401).json({ error: GENERIC_LOGIN_ERROR });
            return;
        }

        const { password: _p, passwordHash: _ph, ...userWithoutPassword } = user;
        const serializedUser = serializeUserMediaRecord(userWithoutPassword)!;

        // Fetch user demographics
        const demographics = await prisma.userDemographics.findUnique({
            where: { userId: user.id }
        });

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '90d' });

        res.setHeader('Cache-Control', 'private, no-store');
        res.json({
            ...serializedUser,
            birthday: formatDateOnly(user.birthday),
            demographics: withDerivedAgeGroup(demographics, user.birthday),
            stats: {
                followers: user.followersCount,
                following: user.followingCount,
                responses: 0
            },
            token
        });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: 'Failed to login' });
    }
};

export const initiateRegistration = async (req: Request, res: Response) => {
    // Validate inputs using Zod
    const validation = initRegistrationSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ error: validation.error.errors[0].message });
        return;
    }

    const { fullName, email, dob } = req.body;
    const lowerEmail = email?.toLowerCase();
    try {
        const capability = createRegistrationCapability();
        const parsedDob = parseAndValidateDateOfBirth(dob);
        const existing = await prisma.user.findFirst({ where: { email: { equals: lowerEmail } } });
        if (existing) {
            res.status(400).json({ error: 'Email already registered' });
            return;
        }
        const pending = await prisma.pendingRegistration.upsert({
            where: { email: lowerEmail },
            update: {
                fullName,
                dob: parsedDob,
                currentStep: 2,
                password: null,
                handle: null,
                otpCode: null,
                otpExpiresAt: null,
                registrationSecretHash: capability.secretHash
            },
            create: {
                email: lowerEmail,
                fullName,
                dob: parsedDob,
                currentStep: 2,
                registrationSecretHash: capability.secretHash
            }
        });
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({
            success: true,
            pendingId: buildPendingRegistrationReference(pending.id, capability.secret)
        });
    } catch (error) {
        if (error instanceof ProfileValidationError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
};

export const completeRegistration = async (req: Request, res: Response) => {
    const { pendingId } = req.body;
    const otp = req.body.code ?? req.body.otp;
    try {
        const reference = parsePendingRegistrationReference(pendingId);
        if (!reference) return res.status(404).json({ error: 'Session not found' });
        const where = { id: reference.id };
        const pending = await prisma.pendingRegistration.findUnique({ where });
        if (!pending || !verifyRegistrationSecret(pending.registrationSecretHash, reference.secret)) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!pending.email || !pending.fullName || !pending.dob || !pending.password || !pending.handle || pending.currentStep < 5) {
            res.status(400).json({ error: 'Registration is incomplete' });
            return;
        }
        const validatedDob = parseAndValidateDateOfBirth(formatDateOnly(pending.dob));

        const consumed = await consumeEmailOtp({
            destination: pending.email,
            purpose: 'REGISTRATION',
            subject: pending.id,
            code: typeof otp === 'string' ? otp : ''
        }, async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    email: pending.email,
                    name: pending.fullName,
                    birthday: validatedDob,
                    handle: pending.handle || 'user_' + Date.now(),
                    passwordHash: pending.password, // Store hashed password from pendingRegistration
                    authProvider: 'Email',
                    emailVerifiedAt: new Date(),
                    avatar: null,
                    demographics: { create: { ageGroup: calculateAgeGroupFromDate(validatedDob) } }
                },
                select: SAFE_USER_SELECT
            });

            await tx.notificationSettings.create({
                data: {
                    userId: newUser.id,
                    settings: JSON.stringify({
                        myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' },
                        sharedPosts: { likes: 'following', comments: 'following', shares: 'off' },
                        toggles: { activityFollowed: true, invitations: true, commentInteractions: true, newFollowers: true, emailNotifications: false }
                    })
                }
            });

            await tx.pendingRegistration.delete({ where });

            return newUser;
        });
        const user = consumed.value!;

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '90d' });
        const serializedUser = serializeUserMediaRecord(user)!;
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({
            user: {
                ...serializedUser,
                birthday: formatDateOnly(user.birthday),
                demographics: withDerivedAgeGroup(user.demographics, user.birthday)
            },
            token
        });
    } catch (error: any) {
        if (error instanceof OtpError) {
            return res.status(400).json({ error: 'Invalid or expired OTP code', code: error.code });
        }
        if (error instanceof ProfileValidationError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        if (error.code === 'P2002') {
            const target = error.meta?.target;
            if (Array.isArray(target)) {
                if (target.includes('handle')) return res.status(400).json({ error: 'Handle is already taken' });
                if (target.includes('email')) return res.status(400).json({ error: 'Email is already registered' });
                if (target.includes('phone')) return res.status(400).json({ error: 'Phone is already registered' });
            } else if (typeof target === 'string') { // SQLite may return string
                if (target.includes('handle')) return res.status(400).json({ error: 'Handle is already taken' });
            }
        }
        console.error(JSON.stringify({ event: 'registration_completion_failed', errorCode: error?.code || 'UNKNOWN' }));
        res.status(500).json({ error: 'Registration completion failed' });
    }
};

export const setRegistrationPassword = async (req: Request, res: Response) => {
    // Validate inputs using Zod
    const validation = passwordValidationSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ error: validation.error.errors[0].message });
        return;
    }

    const { pendingId, password } = req.body;
    try {
        const reference = parsePendingRegistrationReference(pendingId);
        if (!reference) return res.status(404).json({ error: 'Session not found' });
        const where = { id: reference.id };
        const pending = await prisma.pendingRegistration.findUnique({ where });
        if (!pending || !verifyRegistrationSecret(pending.registrationSecretHash, reference.secret)) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (pending.currentStep >= 5) return res.status(409).json({ error: 'Registration details are locked after OTP issuance' });
        
        // Hash password before saving to pendingRegistration for security
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await prisma.pendingRegistration.update({
            where,
            data: {
                password: hashedPassword, // Store hash directly
                currentStep: Math.max(3, pending.currentStep)
            }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('setRegistrationPassword error:', error);
        res.status(500).json({ error: 'Failed to set password' });
    }
};

export const checkHandleAvailability = async (req: Request, res: Response) => {
    const { handle } = req.query;
    const lowerHandle = (handle as string)?.toLowerCase();
    try {
        const existing = await prisma.user.findFirst({ where: { handle: { equals: lowerHandle, mode: 'insensitive' } } });
        res.json({ available: !existing });
    } catch (error) {
        res.status(500).json({ error: 'Check failed' });
    }
};

export const reserveHandle = async (req: Request, res: Response) => {
    const { pendingId, handle } = req.body;
    const lowerHandle = handle?.toLowerCase();
    try {
        const reference = parsePendingRegistrationReference(pendingId);
        if (!reference) return res.status(404).json({ error: 'Session not found' });
        const where = { id: reference.id };
        const pending = await prisma.pendingRegistration.findUnique({ where });
        if (!pending || !verifyRegistrationSecret(pending.registrationSecretHash, reference.secret)) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (pending.currentStep < 3 || pending.currentStep >= 5) {
            return res.status(409).json({ error: 'Registration step is not available' });
        }
        await prisma.pendingRegistration.update({
            where,
            data: {
                handle: lowerHandle,
                currentStep: 4
            }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('reserveHandle error:', error);
        res.status(500).json({ error: 'Failed to reserve handle' });
    }
};

export const sendRegistrationOTP = async (req: Request, res: Response) => {
    const { pendingId } = req.body;
    try {
        const reference = parsePendingRegistrationReference(pendingId);
        if (!reference) return res.status(404).json({ error: 'Session not found' });
        const pending = await prisma.pendingRegistration.findUnique({
            where: { id: reference.id }
        });
        if (!pending || !verifyRegistrationSecret(pending.registrationSecretHash, reference.secret)) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        if (pending.currentStep < 4) return res.status(409).json({ error: 'Registration is incomplete' });

        const { cooldownUntil } = await issueEmailOtp({
            destination: pending.email,
            purpose: 'REGISTRATION',
            subject: pending.id,
            onSent: async (tx) => {
                await tx.pendingRegistration.update({
                    where: { id: reference.id },
                    data: { currentStep: 5 }
                });
            }
        });

        res.json({
            success: true,
            message: 'OTP sent successfully',
            cooldownUntil: cooldownUntil.toISOString()
        });
    } catch (error: any) {
        if (error instanceof OtpError) {
            const status = error.code === 'OTP_COOLDOWN' || error.code === 'OTP_RATE_LIMITED' ? 429 : 503;
            if (error.details?.retryAfterSeconds) res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
            return res.status(status).json({ error: error.message, code: error.code, ...(error.details || {}) });
        }
        console.error(JSON.stringify({ event: 'registration_otp_send_failed', errorCode: error?.code || 'UNKNOWN' }));
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};
