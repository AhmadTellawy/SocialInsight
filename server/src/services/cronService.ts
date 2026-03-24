import cron from 'node-cron';
import prisma from '../prisma';

export function calculateAgeGroup(dob: Date | null | undefined): string | undefined {
    if (!dob) return undefined;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
        age--;
    }
    if (age < 18) return 'Under 18';
    if (age <= 24) return '18-24';
    if (age <= 34) return '25-34';
    if (age <= 44) return '35-44';
    if (age <= 54) return '45-54';
    return '55+';
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

    console.log('[Cron] Monthly Age Group computation job initialized.');
};
