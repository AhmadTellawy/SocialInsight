import cron from 'node-cron';
import prisma from '../prisma';
import { cleanupExpiredMedia } from './mediaService';
import { resumeMediaPrivacyTransitions } from './mediaPrivacyTransitionService';
import { calculateAgeGroupFromDate } from '../utils/profileValidation';

export function calculateAgeGroup(dob: Date | null | undefined): string | undefined {
    return calculateAgeGroupFromDate(dob);
}

export const runAgeGroupComputation = async () => {
    console.log('[Cron] Starting Age Group computation process');
    try {
        const users = await prisma.user.findMany({
            where: {
                birthday: { not: null }
            },
            select: { id: true, birthday: true }
        });

        let updatedCount = 0;

        for (const user of users) {
            if (!user.birthday) continue;
            
            const newAgeGroup = calculateAgeGroup(user.birthday);
            
            // Get existing demographics
            const demographics = await prisma.userDemographics.findUnique({
                where: { userId: user.id }
            });

            if (!demographics) {
                // Create if not exists
                if (newAgeGroup) {
                    await prisma.userDemographics.create({
                        data: {
                            userId: user.id,
                            ageGroup: newAgeGroup
                        }
                    });
                    updatedCount++;
                }
            } else if (demographics.ageGroup !== newAgeGroup && newAgeGroup !== undefined) {
                // Update if changed
                await prisma.userDemographics.update({
                    where: { userId: user.id },
                    data: { ageGroup: newAgeGroup }
                });
                updatedCount++;
            }
        }

        console.log(`[Cron] Completed Age Group computation. Updated ${updatedCount} users.`);
        return updatedCount;
    } catch (error) {
        console.error('[CronError] Failed to compute age groups:', error);
        throw error;
    }
};

export const initCronJobs = () => {
    // Schedule to run monthly (e.g., midnight on the 1st of every month)
    cron.schedule('0 0 1 * *', async () => {
        console.log('[Cron] Running monthly Age Group computation job...');
        await runAgeGroupComputation();
    });

    cron.schedule('*/15 * * * *', async () => {
        const cleaned = await cleanupExpiredMedia();
        await resumeMediaPrivacyTransitions();
        if (cleaned > 0) console.log(`[Cron] Cleaned ${cleaned} expired media assets.`);
    });

    console.log('[Cron] Age Group and media cleanup jobs initialized.');
};
