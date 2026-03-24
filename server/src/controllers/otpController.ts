import { Request, Response } from 'express';
import prisma from '../prisma';

// Generate 6-digit OTP
const generateOTP = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP (mock implementation for demo)
export const sendOTP = async (req: Request, res: Response) => {
    const { identifier, type } = req.body; // identifier is email or phone, type is 'email' or 'phone'

    try {
        // Delete any existing OTP for this identifier
        await prisma.oTPCode.deleteMany({
            where: { identifier }
        });

        // Generate new OTP
        const code = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Save to database
        await prisma.oTPCode.create({
            data: {
                identifier,
                code,
                expiresAt
            }
        });

        // Mock delivery - log to console for demo
        console.log(`\n🔐 OTP CODE FOR ${type.toUpperCase()}: ${identifier}`);
        console.log(`📱 CODE: ${code}`);
        console.log(`⏰ Expires at: ${expiresAt.toLocaleString()}\n`);

        res.json({
            message: `OTP sent to ${identifier}`,
            // Return code in development only (remove in production)
            devCode: process.env.NODE_ENV === 'development' ? code : undefined
        });
    } catch (error) {
        console.error("Send OTP Error:", error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};

// Verify OTP
export const verifyOTP = async (req: Request, res: Response) => {
    const { identifier, code } = req.body;

    try {
        // Find OTP
        const otpRecord = await prisma.oTPCode.findFirst({
            where: {
                identifier,
                code
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!otpRecord) {
            res.status(400).json({ error: 'Invalid OTP code' });
            return;
        }

        // Check expiry
        if (new Date() > otpRecord.expiresAt) {
            await prisma.oTPCode.delete({ where: { id: otpRecord.id } });
            res.status(400).json({ error: 'OTP code has expired' });
            return;
        }

        // Delete used OTP
        await prisma.oTPCode.delete({ where: { id: otpRecord.id } });

        // Mark user as verified
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: identifier },
                    { phone: identifier }
                ]
            }
        });

        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: { verifiedBadge: true }
            });
        }

        res.json({
            success: true,
            message: 'OTP verified successfully'
        });
    } catch (error) {
        console.error("Verify OTP Error:", error);
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
};
