import { Request, Response } from 'express';
import prisma from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/authMiddleware';

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
    const { name, handle, email, phone, password, birthday, country, avatar, authProvider } = req.body;

    const lowerEmail = email?.toLowerCase();
    const lowerHandle = handle?.toLowerCase();

    try {
        const existing = await prisma.user.findFirst({
            where: {
                OR: [
                    { handle: { equals: handle, mode: 'insensitive' } },
                    email ? { email: { equals: email, mode: 'insensitive' } } : undefined,
                    phone ? { phone } : undefined
                ].filter(Boolean) as any
            }
        });

        if (existing) {
            res.status(400).json({ error: 'Username, Email or Phone already exists' });
            return;
        }

        const parsedBirthday = birthday ? new Date(birthday) : null;
        const newUser = await prisma.user.create({
            data: {
                name,
                handle: lowerHandle,
                email: lowerEmail,
                phone,
                password,
                birthday: parsedBirthday,
                country,
                avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || handle)}&background=6366f1&color=fff&bold=true&size=200`,
                authProvider: authProvider || 'Email',
                demographics: { create: { ageGroup: calculateAgeGroup(parsedBirthday) } }
            } as any,
            select: SAFE_USER_SELECT
        });

        await prisma.notificationSettings.create({
            data: {
                userId: newUser.id,
                settings: JSON.stringify({
                    myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' },
                    sharedPosts: { likes: 'following', comments: 'following', shares: 'off' },
                    toggles: { activityFollowed: true, invitations: true, commentInteractions: true, newFollowers: true, emailNotifications: false }
                })
            }
        });

        res.json({
            ...newUser,
            demographics: {},
            stats: { followers: newUser.followersCount, following: newUser.followingCount, responses: 0, posts: 0 }
        });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ error: 'Failed to register' });
    }
};

export const login = async (req: Request, res: Response) => {
    const { identifier, password, authProvider } = req.body;

    try {
        const lowerIdentifier = identifier?.toLowerCase();
        
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: { equals: identifier, mode: 'insensitive' } },
                    { handle: { equals: identifier, mode: 'insensitive' } }
                ],
                authProvider: authProvider || 'Email'
            } as any
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Verify Password
        let isPasswordValid = false;
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

        if (!isPasswordValid && authProvider === 'Email') {
            res.status(401).json({ error: 'Invalid password' });
            return;
        }

        const { password: _p, passwordHash: _ph, ...userWithoutPassword } = user;

        // Fetch user demographics
        const demographics = await prisma.userDemographics.findUnique({
            where: { userId: user.id }
        });

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '90d' });

        res.json({
            ...userWithoutPassword,
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

        // Use stored data from pendingRegistration
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(pending.password || 'temp123', salt);

        const user = await prisma.user.create({
            data: {
                email: pending.email,
                name: pending.fullName,
                birthday: pending.dob,
                handle: pending.handle || 'user_' + Date.now(),
                passwordHash: hashedPassword,
                // password: null, // Don't save plain text
                authProvider: 'Email',
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(pending.fullName)}&background=6366f1&color=fff&bold=true&size=200`,
                demographics: { create: { ageGroup: calculateAgeGroup(pending.dob) } }
            },
            select: SAFE_USER_SELECT
        });

        await prisma.notificationSettings.create({
            data: {
                userId: user.id,
                settings: JSON.stringify({
                    myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' },
                    sharedPosts: { likes: 'following', comments: 'following', shares: 'off' },
                    toggles: { activityFollowed: true, invitations: true, commentInteractions: true, newFollowers: true, emailNotifications: false }
                })
            }
        });

        await prisma.pendingRegistration.delete({ where });
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
    const { email, pendingId, password } = req.body;
    const lowerEmail = email?.toLowerCase();
    try {
        const where = pendingId ? { id: pendingId } : { email: lowerEmail };
        await prisma.pendingRegistration.update({
            where,
            data: {
                password,
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
        const existing = await prisma.user.findFirst({ where: { handle: { equals: lowerHandle } } });
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
    const { email } = req.body;
    try {
        // In a real app, send OTP via email
        res.json({ success: true, otp: '123456' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};
