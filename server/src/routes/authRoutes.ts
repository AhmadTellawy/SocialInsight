import { Router } from 'express';
import {
    register,
    login,
    initiateRegistration,
    setRegistrationPassword,
    checkHandleAvailability,
    reserveHandle,
    sendRegistrationOTP,
    completeRegistration
} from '../controllers/authController';

const router = Router();

router.post('/register', register);
router.post('/login', login);

// Multi-step flow
router.post('/register/init', initiateRegistration);
router.post('/register/password', setRegistrationPassword);
router.get('/handle/check', checkHandleAvailability);
router.post('/handle/reserve', reserveHandle);
router.post('/register/otp/send', sendRegistrationOTP);
router.post('/register/complete', completeRegistration);

export default router;
