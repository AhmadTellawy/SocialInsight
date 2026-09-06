import webpush from 'web-push';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const publicVapidKey = process.env.VAPID_PUBLIC_KEY || '';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || '';
const subject = process.env.VAPID_SUBJECT || 'mailto:privacy@opiniup.com';

if (publicVapidKey && privateVapidKey) {
    webpush.setVapidDetails(subject, publicVapidKey, privateVapidKey);
} else {
    console.warn("VAPID keys not set. Push notifications will not work.");
}

export interface PushNotificationPayload {
    title: string;
    body: string;
    icon?: string;
    url?: string;
    type?: string;
}

export const sendPushNotification = async (userId: string, payload: PushNotificationPayload) => {
    try {
        const subscriptions = await prisma.pushSubscription.findMany({
            where: { userId }
        });

        if (subscriptions.length === 0) return;

        const stringPayload = JSON.stringify(payload);

        const sendPromises = subscriptions.map(async (sub) => {
            try {
                const pushSub = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                };
                await webpush.sendNotification(pushSub, stringPayload);
            } catch (error: any) {
                // If the subscription is invalid/expired (status 410 or 404), delete it
                if (error.statusCode === 410 || error.statusCode === 404) {
                    console.info(JSON.stringify({ event: 'push_subscription_expired' }));
                    await prisma.pushSubscription.delete({ where: { id: sub.id } });
                } else {
                    console.error(JSON.stringify({
                        event: payload.type === 'mention' ? 'mention_push_failed' : 'push_delivery_failed',
                        statusCode: typeof error.statusCode === 'number' ? error.statusCode : undefined
                    }));
                }
            }
        });

        await Promise.allSettled(sendPromises);
    } catch (error) {
        console.error(JSON.stringify({
            event: payload.type === 'mention' ? 'mention_push_failed' : 'push_dispatch_failed',
            error: error instanceof Error ? error.name : 'unknown'
        }));
    }
};
