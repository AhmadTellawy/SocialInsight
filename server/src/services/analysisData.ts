import { Prisma } from '@prisma/client';

// Only bounded batches of compact profiles cross into the application. PostgreSQL
// scans the post once, sorts/spills under its work_mem limit, and retains the
// statement snapshot for cursor fetches. The caller owns the authorized transaction.
export const ANALYSIS_FETCH_SIZE = 500;
type Row = { weight: number; birthday: Date | null; country: string | null;
  demographics: Record<string, string | null> | null; answers: Array<[string, string | null, string | null]> };
export function analysisProfilesQuery(postId: string) {
  return Prisma.sql`
WITH batch AS MATERIALIZED (SELECT id,"userId" FROM "Response" WHERE "postId"=${postId}),
answer_profiles AS (
 SELECT a."responseId",array_agg(ARRAY[a."questionId",a."optionId",CASE WHEN COALESCE(a."textValue",'')<>'' THEN '1' ELSE NULL END]
 ORDER BY a."questionId",a."optionId",CASE WHEN COALESCE(a."textValue",'')<>'' THEN '1' ELSE NULL END) AS answers
 FROM "Answer" a JOIN batch b ON b.id=a."responseId" GROUP BY a."responseId"
)
SELECT u.birthday,u.country,
 jsonb_build_object('gender',d.gender,'maritalStatus',d.marital_status,'educationLevel',d.education_level,
 'employmentType',d.employment_type,'industry',d.industry,'employmentSector',d.employment_sector,'nationality',d.nationality) AS demographics,
 to_jsonb(COALESCE(a.answers,ARRAY[]::text[])) AS answers,count(*)::int AS weight
 FROM batch b LEFT JOIN users u ON u.id=b."userId" LEFT JOIN user_demographics d ON d.user_id=u.id
 LEFT JOIN answer_profiles a ON a."responseId"=b.id
 GROUP BY u.birthday,u.country,d.gender,d.marital_status,d.education_level,d.employment_type,d.industry,d.employment_sector,d.nationality,a.answers
`;
}

export async function* readAnalysisBatches(client: Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>, postId: string) {
  // This transaction performs at most one aggregate build. No holdable cursor or
  // elevated database connection is used; actor RLS applies to the source query.
  // The single admitted builder gets a fixed per-operator budget. At 100k rows
  // the default 2MB setting spills the batch and joins to disk; 16MB avoids those
  // spills in the measured plan. SET LOCAL ends with this authorized transaction.
  await client.$executeRaw(Prisma.sql`SET LOCAL work_mem = '16MB'`);
  await client.$executeRaw(Prisma.sql`DECLARE analysis_profiles NO SCROLL CURSOR FOR ${analysisProfilesQuery(postId)}`);
  let failed = false;
  try {
    while (true) {
      const rows = await client.$queryRaw<Row[]>(Prisma.sql`FETCH FORWARD 500 FROM analysis_profiles`);
      if (rows.length) yield rows.map(({ birthday, country, demographics, answers, ...row }) => ({
        ...row, user: { birthday, country, demographics },
        answers: answers.map(([questionId, optionId, textValue]) => ({ questionId, optionId, textValue }))
      }));
      if (rows.length < ANALYSIS_FETCH_SIZE) break;
    }
  } catch (error) {
    failed = true;
    throw error; // A failed database statement aborts the transaction and cursor.
  } finally {
    if (!failed) await client.$executeRaw(Prisma.sql`CLOSE analysis_profiles`);
  }
}
