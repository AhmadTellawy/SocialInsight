import { Router } from 'express';
import { sendOTP, verifyOTP } from '../controllers/otpController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/send', requireAuth, sendOTP);
router.post('/verify', requireAuth, verifyOTP);

export default router;
