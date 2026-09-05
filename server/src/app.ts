import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import cors from 'cors';
import compression from 'compression';
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
import { requestContext } from './middleware/requestContext';
import { configureStaging } from './utils/stagingConfig';

const app = express();
configureStaging(app);
const httpServer = createServer(app);
initSocket(httpServer);

const PORT = process.env.PORT || 3001;

const corsOptions = {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['X-Next-Cursor', 'X-Request-Id'],
};
app.use(requestContext);
app.use(helmet());
app.use(compression({ threshold: 1024 }));
app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '4mb' }));
app.use(hpp());

const requestRouteTemplate = (req: express.Request): string => {
    const routePath = req.route?.path;
    if (typeof routePath !== 'string') return '/api/unmatched';

    const requestSegments = req.originalUrl.split('?')[0].split('/').filter(Boolean);
    const routeSegments = routePath.split('/').filter(Boolean);
    const mountSegments = requestSegments.slice(0, Math.max(0, requestSegments.length - routeSegments.length));
    const suffix = routePath === '/' ? '' : routePath.startsWith('/') ? routePath : `/${routePath}`;
    return (`/${mountSegments.join('/')}${suffix}`).replace(/\/{2,}/g, '/');
};

// Keep a low-cardinality latency signal in production logs so regressions in
// feed/database performance are visible without logging user data or queries.
app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => {
        if (!req.path.startsWith('/api/')) return;
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        console.info(JSON.stringify({
            event: 'http_request_completed',
            method: req.method,
            path: requestRouteTemplate(req),
            status: res.statusCode,
            requestId: req.requestId,
            durationMs: Math.round(durationMs * 10) / 10
        }));
    });
    next();
});

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
    } catch {
        res.status(503).json({ status: 'error', database: 'unavailable', migrations: 'unknown', mediaStorage });
        return;
    }

    let failedMigrations: number;
    try {
        const [migrationState] = await prisma.$queryRaw<Array<{ failedCount: bigint }>>`
            SELECT COUNT(*)::bigint AS "failedCount"
            FROM "_prisma_migrations"
            WHERE "finished_at" IS NULL
              AND "rolled_back_at" IS NULL
        `;
        failedMigrations = Number(migrationState?.failedCount || 0);
    } catch {
        res.status(503).json({ status: 'error', database: 'connected', migrations: 'unknown', mediaStorage });
        return;
    }

    if (failedMigrations > 0) {
        res.status(503).json({
            status: 'error',
            database: 'connected',
            migrations: 'failed',
            failedMigrations,
            mediaStorage
        });
        return;
    }
    res.json({ status: 'ok', database: 'connected', migrations: 'ok', mediaStorage });
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
