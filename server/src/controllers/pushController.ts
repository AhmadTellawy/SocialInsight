import { Request, Response } from 'express';
import prisma from '../prisma';
import { z } from 'zod';
import { AccountSecurityError, lockAccountSecurity } from '../services/mfaService';
import { assertActiveAccountSession } from '../services/accountSecurityPolicy';

const pushSchema = z.object({
    endpoint: z.string().url().max(2048).refine(value => {
        const url = new URL(value);
        // Subscription endpoints are outbound network destinations, never arbitrary URLs.
        return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
            ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    }),
    keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,120}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}$/) })
});


export const subscribeToPush = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.userId; // Assuming requireAuth middleware
        const { subscription } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const parsed = pushSchema.safeParse(subscription);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid subscription object' });
            return;
        }

        const keys = subscription.keys || {};

        // Upsert subscription based on endpoint to avoid duplicates
        await prisma.$transaction(async tx => {
          await lockAccountSecurity(tx, userId);
          await assertActiveAccountSession(tx, req, false);
          return tx.pushSubscription.upsert({
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
        });

        res.status(201).json({ success: true });
    } catch (error) {
        if (error instanceof AccountSecurityError) { res.status(error.status).json({code:error.code,error:'Sign in again to continue'}); return; }
        console.error(JSON.stringify({event:'push_subscription_save_failed'}));
        res.status(500).json({ error: 'Failed to subscribe to push notifications' });
    }
};

export const unsubscribeFromPush = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.userId;
        const { endpoint } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (typeof endpoint === 'string' && endpoint.length > 0 && endpoint.length <= 2048) {
            // Delete specific endpoint
            await prisma.$transaction(async tx => {
                await lockAccountSecurity(tx, userId);
                await assertActiveAccountSession(tx, req, false);
                return tx.pushSubscription.deleteMany({ where: { userId, endpoint } });
            });
        } else {
            res.status(400).json({ error: 'A device endpoint is required' });
            return;
        }

        res.status(200).json({ success: true });
    } catch (error) {
        if (error instanceof AccountSecurityError) { res.status(error.status).json({code:error.code,error:'Sign in again to continue'}); return; }
        console.error(JSON.stringify({event:'push_subscription_remove_failed'}));
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
};
