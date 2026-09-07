import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { cleanupExpiredMedia } from './mediaService';
import { resumeMediaPrivacyTransitions } from './mediaPrivacyTransitionService';
import { calculateAgeGroupFromDate } from '../utils/profileValidation';
import { cleanupExpiredAuthArtifacts } from './authRetentionService';
import { resumeAccountCleanupJobs } from './accountCleanupService';

export function calculateAgeGroup(dob: Date | null | undefined): string | undefined {
    return calculateAgeGroupFromDate(dob);
}

export const runAgeGroupComputation = async () => {
    try {
        // Lock each bounded batch before deriving the cache. Deletion locks
        // the same user row, so an earlier DOB snapshot cannot recreate data
        // after the account has been tombstoned. Busy rows retry next run.
        let cursor = '';
        let updatedCount = 0;
        while (true) {
            const batch = await prisma.$transaction(async (tx) => {
                const users = await tx.$queryRaw<Array<{ id: string }>>`
                    SELECT "id" FROM "users"
                    WHERE "birthday" IS NOT NULL AND "status" = 'ACTIVE' AND "id" > ${cursor}
                    ORDER BY "id" LIMIT 500 FOR UPDATE SKIP LOCKED
                `;
                if (users.length === 0) return null;
                const count = await tx.$executeRaw`
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
                WHERE "birthday" IS NOT NULL AND "status" = 'ACTIVE'
                  AND "id" IN (${Prisma.join(users.map((user) => user.id))})
            )
            INSERT INTO "user_demographics" ("user_id", "age_group", "updated_at")
            SELECT "user_id", "age_group", CURRENT_TIMESTAMP
            FROM derived
            ON CONFLICT ("user_id") DO UPDATE
            SET "age_group" = EXCLUDED."age_group",
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "user_demographics"."age_group" IS DISTINCT FROM EXCLUDED."age_group"
                `;
                return { count, lastId: users[users.length - 1].id };
            });
            if (!batch) break;
            updatedCount += batch.count;
            cursor = batch.lastId;
        }
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
        // A storage outage must not prevent expired access proofs or account
        // artifacts from being removed. Each job keeps its own retry state.
        const jobs = [
            ['media', cleanupExpiredMedia],
            ['media_privacy', resumeMediaPrivacyTransitions],
            ['account_cleanup', resumeAccountCleanupJobs],
            ['auth_retention', cleanupExpiredAuthArtifacts]
        ] as const;
        const results = await Promise.allSettled(jobs.map(([, run]) => run()));
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(JSON.stringify({ event: 'scheduled_cleanup_failed', job: jobs[index][0] }));
            }
        });
    });

    console.log('[Cron] Age Group and media cleanup jobs initialized.');
};
