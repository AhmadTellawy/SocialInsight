import { Request, Response } from 'express';
import prisma from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/authMiddleware';
import { z } from 'zod';
import { PUBLIC_AVATAR_MEDIA_SELECT, serializeUserMediaRecord } from '../services/mediaService';

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


function calculateAgeGroup(dob: Date | null | undefined): string | undefined {
    if (!dob) return undefined;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
        age--;
    }
    if (age < 18) return 'Under 18';
    if (age <= 24) return '18-24';
    if (age <= 34) return '25-34';
    if (age <= 44) return '35-44';
    if (age <= 54) return '45-54';
    return '55+';
}

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
    demographics: true,
    createdAt: true
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

        res.json({
            ...serializedUser,
            demographics: demographics || {},
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
        const existing = await prisma.user.findFirst({ where: { email: { equals: lowerEmail } } });
        if (existing) {
            res.status(400).json({ error: 'Email already registered' });
            return;
        }
        const pending = await prisma.pendingRegistration.upsert({
            where: { email: lowerEmail },
            update: { fullName, dob: new Date(dob), currentStep: 2 },
            create: { email: lowerEmail, fullName, dob: new Date(dob), currentStep: 2 }
        });
        res.json({ success: true, pendingId: pending.id });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
};

export const completeRegistration = async (req: Request, res: Response) => {
    const { email, pendingId, otp } = req.body;
    const lowerEmail = email?.toLowerCase();
    try {
        const where = pendingId ? { id: pendingId } : { email: lowerEmail };
        const pending = await prisma.pendingRegistration.findUnique({ where });
        if (!pending) return res.status(404).json({ error: 'Session not found' });

        if (!pending.email || !pending.fullName || !pending.dob || !pending.password || !pending.handle || pending.currentStep < 5) {
            res.status(400).json({ error: 'Registration is incomplete' });
            return;
        }

        // 1. Verify OTP code if not bypassed in development mode
        const skipOtp = otp === 'SKIP_OTP' && process.env.NODE_ENV === 'development';
        if (!skipOtp) {
            if (!pending.otpCode || !pending.otpExpiresAt) {
                res.status(400).json({ error: 'No OTP code generated' });
                return;
            }
            if (new Date() > pending.otpExpiresAt) {
                res.status(400).json({ error: 'OTP code has expired' });
                return;
            }
            const isMatch = await bcrypt.compare(otp, pending.otpCode);
            if (!isMatch) {
                res.status(400).json({ error: 'Invalid OTP code' });
                return;
            }
        }

        // 2. Perform DB operations inside a single transaction (Prisma Transaction)
        const user = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    email: pending.email,
                    name: pending.fullName,
                    birthday: pending.dob,
                    handle: pending.handle || 'user_' + Date.now(),
                    passwordHash: pending.password, // Store hashed password from pendingRegistration
                    authProvider: 'Email',
                    avatar: null,
                    demographics: { create: { ageGroup: calculateAgeGroup(pending.dob) } }
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

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '90d' });
        res.json({ user, token });
    } catch (error: any) {
        console.error('completeRegistration error:', error);
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
        res.status(500).json({ error: 'Completion failed: ' + (error.message || 'Unknown error') });
    }
};

export const setRegistrationPassword = async (req: Request, res: Response) => {
    // Validate inputs using Zod
    const validation = passwordValidationSchema.safeParse(req.body);
    if (!validation.success) {
        res.status(400).json({ error: validation.error.errors[0].message });
        return;
    }

    const { email, pendingId, password } = req.body;
    const lowerEmail = email?.toLowerCase();
    try {
        const where = pendingId ? { id: pendingId } : { email: lowerEmail };
        
        // Hash password before saving to pendingRegistration for security
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await prisma.pendingRegistration.update({
            where,
            data: {
                password: hashedPassword, // Store hash directly
                currentStep: 3
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
    const { email, pendingId, handle } = req.body;
    const lowerEmail = email?.toLowerCase();
    const lowerHandle = handle?.toLowerCase();
    try {
        const where = pendingId ? { id: pendingId } : { email: lowerEmail };
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
        const pending = await prisma.pendingRegistration.findUnique({
            where: { id: pendingId }
        });
        if (!pending) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        // Generate a random 6-digit OTP code or fallback to '123456' if flag set
        let otp = '123456';
        if (process.env.NODE_ENV === 'production' || process.env.USE_RANDOM_OTP === 'true') {
            otp = Math.floor(100000 + Math.random() * 900000).toString();
        }

        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.pendingRegistration.update({
            where: { id: pendingId },
            data: {
                otpCode: otpHash,
                otpExpiresAt: expiresAt,
                currentStep: 5
            }
        });

        // Mock delivery: log it to console
        console.log(`\n🔐 REGISTRATION OTP CODE FOR ${pending.email}:`);
        console.log(`📱 CODE: ${otp}`);
        console.log(`⏰ Expires at: ${expiresAt.toLocaleString()}\n`);

        res.json({
            success: true,
            message: 'OTP sent successfully',
            // Return code in development/test environment only if allowed
            ...(process.env.NODE_ENV === 'development' ? { devCode: otp } : {})
        });
    } catch (error) {
        console.error('sendRegistrationOTP error:', error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};
