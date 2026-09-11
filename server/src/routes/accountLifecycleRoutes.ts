import { Router } from 'express';
import { requireAuth, requireRecentAuth } from '../middleware/authMiddleware';
import { deactivateAccount, deleteAccount, exportAccount } from '../controllers/accountLifecycleController';
const router = Router();
router.use(requireAuth, requireRecentAuth);
router.get('/export', exportAccount);
router.post('/deactivate', deactivateAccount);
router.delete('/', deleteAccount);
export default router;
