import express from 'express';
import { createServer } from 'http';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import postRoutes from './routes/postRoutes';
import userRoutes from './routes/userRoutes';
import groupRoutes from './routes/groupRoutes';
import authRoutes from './routes/authRoutes';
import otpRoutes from './routes/otpRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import pushRoutes from './routes/pushRoutes';
import searchRoutes from './routes/searchRoutes';
import mediaRoutes from './routes/mediaRoutes';
import hashtagRoutes from './routes/hashtagRoutes';
import { requireAuth } from './middleware/authMiddleware';
import { getNotificationSettings, updateNotificationSettings } from './controllers/userController';
import { initCronJobs } from './services/cronService';
import { initSocket } from './services/socketService';
import { isMediaStorageConfigured } from './services/mediaStorage';
import prisma from './prisma';

dotenv.config();

const app = express();
const httpServer = createServer(app);
initSocket(httpServer);

const PORT = process.env.PORT || 3001;

const corsOptions = {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
};
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '4mb' }));
app.use(hpp());

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes'
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many authentication attempts, please try again after 15 minutes'
});

app.use('/api/', apiLimiter);

app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/otp', authLimiter, otpRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/hashtags', hashtagRoutes);

app.get('/api/health', async (_req, res) => {
    const mediaStorage = isMediaStorageConfigured() ? 'configured' : 'not_configured';

    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ok', database: 'connected', mediaStorage });
    } catch {
        res.status(503).json({ status: 'error', database: 'unavailable', mediaStorage });
    }
});

app.get('/api/notification-settings', requireAuth, getNotificationSettings);
app.put('/api/notification-settings', requireAuth, updateNotificationSettings);

app.get('/', (req, res) => {
    res.send('Social Insight API is running');
});

// Initialize scheduled jobs
initCronJobs();

if (require.main === module) {
    httpServer.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

export default app;
