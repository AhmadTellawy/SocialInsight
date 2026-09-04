import cron from 'node-cron';
import prisma from '../prisma';
import { cleanupExpiredMedia } from './mediaService';
import { resumeMediaPrivacyTransitions } from './mediaPrivacyTransitionService';
import { calculateAgeGroupFromDate } from '../utils/profileValidation';
import { cleanupExpiredAuthArtifacts } from './authRetentionService';

export function calculateAgeGroup(dob: Date | null | undefined): string | undefined {
    return calculateAgeGroupFromDate(dob);
}

export const runAgeGroupComputation = async () => {
    try {
        // One atomic, set-based upsert avoids an N+1 scan and also creates a
        // missing demographics row. Reads still derive from DOB, so this is a
        // query-acceleration cache rather than a second source of truth.
        const updatedCount = await prisma.$executeRaw`
            WITH derived AS (
                SELECT
                    "id" AS "user_id",
                    CASE
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) < 18 THEN 'Under 18'
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) <= 24 THEN '18-24'
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) <= 34 THEN '25-34'
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) <= 44 THEN '35-44'
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, "birthday"::date)) <= 54 THEN '45-54'
                        ELSE '55+'
                    END AS "age_group"
                FROM "users"
                WHERE "birthday" IS NOT NULL
            )
            INSERT INTO "user_demographics" ("user_id", "age_group", "updated_at")
            SELECT "user_id", "age_group", CURRENT_TIMESTAMP
            FROM derived
            ON CONFLICT ("user_id") DO UPDATE
            SET "age_group" = EXCLUDED."age_group",
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "user_demographics"."age_group" IS DISTINCT FROM EXCLUDED."age_group"
        `;
        console.log(`[Cron] Completed Age Group computation. Updated ${updatedCount} users.`);
        return updatedCount;
    } catch (error) {
        const errorCode = typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code || 'UNKNOWN')
            : 'UNKNOWN';
        console.error(JSON.stringify({ event: 'age_group_cache_refresh_failed', errorCode }));
        throw error;
    }
};

export const initCronJobs = () => {
    // Daily at midnight; birthdays can cross an age-band boundary on any day.
    cron.schedule('0 0 * * *', () => {
        void runAgeGroupComputation().catch(() => {
            // The function emits a sanitized event; contain the rejection so
            // the scheduler keeps running on the next day.
        });
    }, { timezone: 'UTC' });

    cron.schedule('*/15 * * * *', async () => {
        const cleaned = await cleanupExpiredMedia();
        await resumeMediaPrivacyTransitions();
        if (cleaned > 0) console.log(`[Cron] Cleaned ${cleaned} expired media assets.`);
    });

    cron.schedule('17 * * * *', () => {
        void cleanupExpiredAuthArtifacts().then((result) => {
            const deleted = Object.values(result).reduce((sum, count) => sum + count, 0);
            if (deleted > 0) console.info(JSON.stringify({ event: 'auth_retention_cleanup_completed', deleted }));
        }).catch(() => {
            console.error(JSON.stringify({ event: 'auth_retention_cleanup_failed' }));
        });
    }, { timezone: 'UTC' });

    console.log('[Cron] Age Group, media, and authentication cleanup jobs initialized.');
};
