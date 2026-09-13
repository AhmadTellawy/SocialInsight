import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { buildVisiblePublishedPostWhere } from './postVisibilityService';

export const PROFILE_ANALYTICS_BATCH_SIZE = 500;

// Match getPostResults: authors bypass result settings, but never post visibility.
// Profile analytics has no guest response identity; only authenticated participation counts.
export const buildProfileAnalyticsPostWhere = (
    ownerId: string,
    viewerId?: string,
    now = new Date()
): Prisma.PostWhereInput => ({
    AND: [
        buildVisiblePublishedPostWhere(viewerId),
        { authorId: ownerId, sharedFromId: null },
        ...(viewerId === ownerId ? [] : [{
            AND: [
                { OR: [
                    { resultsWho: null },
                    { resultsWho: '' },
                    { resultsWho: 'Public' },
                    ...(viewerId ? [
                        { resultsWho: 'Followers', author: { following: { some: { followerId: viewerId, status: 'ACTIVE' } } } },
                        { resultsWho: 'Participants', responses: { some: { userId: viewerId } } }
                    ] : [])
                ] },
                { OR: [
                    { resultsTiming: null },
                    { resultsTiming: '' },
                    { resultsTiming: 'AnyTime' },
                    { resultsTiming: 'AfterEnd', expiresAt: { lte: now } },
                    ...(viewerId ? [{ resultsTiming: 'Immediately', responses: { some: { userId: viewerId } } }] : [])
                ] }
            ]
        }])
    ]
});

const profileOwnerWhere = (ownerId: string, viewerId?: string): Prisma.UserWhereInput => ({
    id: ownerId,
    ...(viewerId === ownerId ? {} : {
        AND: [
            { OR: [
                { isPrivate: false, OR: [{ mediaPrivacyTarget: false }, { mediaPrivacyTarget: null }] },
                ...(viewerId ? [{ following: { some: { followerId: viewerId, status: 'ACTIVE' } } }] : [])
            ] },
            ...(viewerId ? [
                { blockedBy: { none: { blockerId: viewerId } } },
                { blocking: { none: { blockedId: viewerId } } }
            ] : [])
        ]
    })
});

type AnalyticsRow = {
    type: string | null;
    country: string | null;
    gender: string | null;
    ageGroup: string | null;
    count: bigint;
};

export const getProfileAnalytics = async (ownerId: string, viewerId?: string) =>
    prisma.$transaction(async tx => {
        // The profile gate, post/result permissions and aggregates share one DB snapshot.
        // PrivacyService.canViewUserContent uses the global client, so use its equivalent
        // relational owner policy here instead of checking outside this transaction.
        const owner = await tx.user.findFirst({
            where: profileOwnerWhere(ownerId, viewerId),
            select: { id: true }
        });
        if (!owner) return null;

        const analytics = {
            totalResponses: 0,
            byType: { Poll: 0, Survey: 0, Quiz: 0, Challenge: 0 } as Record<string, number>,
            byCountry: {} as Record<string, number>,
            byGender: { Male: 0, Female: 0 } as Record<string, number>,
            byAge: {} as Record<string, number>
        };
        const where = buildProfileAnalyticsPostWhere(ownerId, viewerId);
        let afterId: string | undefined;
        while (true) {
            const posts = await tx.post.findMany({
                where: { AND: [where, ...(afterId ? [{ id: { gt: afterId } }] : [])] },
                select: { id: true },
                orderBy: { id: 'asc' },
                take: PROFILE_ANALYTICS_BATCH_SIZE
            });
            if (!posts.length) break;

            // Bound both transferred IDs and SQL bind parameters; response rows stay in SQL.
            const rows = await tx.$queryRaw<AnalyticsRow[]>(Prisma.sql`
                SELECT
                    post."type",
                    viewer."country",
                    demographics."gender",
                    CASE
                        WHEN viewer."birthday" IS NULL THEN NULL
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) < 18 THEN 'Under 18'
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) <= 24 THEN '18-24'
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) <= 34 THEN '25-34'
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) <= 44 THEN '35-44'
                        WHEN EXTRACT(YEAR FROM age((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, viewer."birthday"::date)) <= 54 THEN '45-54'
                        ELSE '55+'
                    END AS "ageGroup",
                    COUNT(*)::bigint AS "count"
                FROM "Response" response
                INNER JOIN "Post" post ON post."id" = response."postId"
                LEFT JOIN "users" viewer ON viewer."id" = response."userId"
                LEFT JOIN "user_demographics" demographics ON demographics."user_id" = viewer."id"
                WHERE post."id" IN (${Prisma.join(posts.map(post => post.id))})
                GROUP BY 1, 2, 3, 4
            `);
            for (const row of rows) {
                const count = Number(row.count);
                const type = row.type || 'Survey';
                analytics.totalResponses += count;
                analytics.byType[type] = (analytics.byType[type] || 0) + count;
                if (row.country) analytics.byCountry[row.country] = (analytics.byCountry[row.country] || 0) + count;
                if (row.gender) analytics.byGender[row.gender] = (analytics.byGender[row.gender] || 0) + count;
                if (row.ageGroup) analytics.byAge[row.ageGroup] = (analytics.byAge[row.ageGroup] || 0) + count;
            }
            if (posts.length < PROFILE_ANALYTICS_BATCH_SIZE) break;
            afterId = posts[posts.length - 1].id;
        }
        return analytics;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
