import { Router } from 'express';
import { subscribeToPush, unsubscribeFromPush } from '../controllers/pushController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Endpoint to get the VAPID public key
router.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post('/subscribe', requireAuth, subscribeToPush);
router.post('/unsubscribe', requireAuth, unsubscribeFromPush);

export default router;
