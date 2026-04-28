import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const subscribeToPush = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id; // Assuming requireAuth middleware
        const { subscription } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!subscription || !subscription.endpoint) {
            res.status(400).json({ error: 'Invalid subscription object' });
            return;
        }

        const keys = subscription.keys || {};

        // Upsert subscription based on endpoint to avoid duplicates
        await prisma.pushSubscription.upsert({
            where: { endpoint: subscription.endpoint },
            update: {
                userId,
                p256dh: keys.p256dh || '',
                auth: keys.auth || ''
            },
            create: {
                userId,
                endpoint: subscription.endpoint,
                p256dh: keys.p256dh || '',
                auth: keys.auth || ''
            }
        });

        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Error subscribing to push:', error);
        res.status(500).json({ error: 'Failed to subscribe to push notifications' });
    }
};

export const unsubscribeFromPush = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.id;
        const { endpoint } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (endpoint) {
            // Delete specific endpoint
            await prisma.pushSubscription.deleteMany({
                where: { userId, endpoint }
            });
        } else {
            // Delete all subscriptions for the user (e.g. they turned off all push)
            await prisma.pushSubscription.deleteMany({
                where: { userId }
            });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error unsubscribing from push:', error);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
};
