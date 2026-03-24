import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import postRoutes from './routes/postRoutes';
import userRoutes from './routes/userRoutes';
import groupRoutes from './routes/groupRoutes';
import authRoutes from './routes/authRoutes';
import otpRoutes from './routes/otpRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import { getNotificationSettings, updateNotificationSettings } from './controllers/userController';
import { initCronJobs } from './services/cronService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const corsOptions = {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

app.use('/api/posts', postRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get('/api/notification-settings', getNotificationSettings);
app.put('/api/notification-settings', updateNotificationSettings);

app.get('/', (req, res) => {
    res.send('Social Insight API is running');
});

// Initialize scheduled jobs
initCronJobs();

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

export default app;
