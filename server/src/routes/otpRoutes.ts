import { Router } from 'express';
import { sendOTP, verifyOTP } from '../controllers/otpController';

const router = Router();

router.all('/send', sendOTP);
router.all('/verify', verifyOTP);

export default router;
