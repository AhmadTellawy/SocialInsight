import { Prisma } from '@prisma/client';

// Only bounded batches of compact profiles cross into the application. PostgreSQL
// reads profiles maintained atomically with votes, and retains the statement
// snapshot for cursor fetches. The caller owns the authorized transaction.
export const ANALYSIS_FETCH_SIZE = 500;
type Row = { weight: number; birthday: Date | null; country: string | null;
  demographics: Record<string, string | null> | null; answers: Array<[string, string | null, string | null]> };
export function analysisProfilesQuery(postId: string) {
  return Prisma.sql`
SELECT u.birthday,u.country,
 jsonb_build_object('gender',d.gender,'maritalStatus',d.marital_status,'educationLevel',d.education_level,
 'employmentType',d.employment_type,'industry',d.industry,'employmentSector',d.employment_sector,'nationality',d.nationality) AS demographics,
 p.answers,p.weight
 FROM public."AnalysisAnswerProfile" p
 LEFT JOIN public.users u ON u.id=p."userId" LEFT JOIN public.user_demographics d ON d.user_id=u.id
 WHERE p."postId"=${postId} AND p.weight>0
`;
}

export async function* readAnalysisBatches(client: Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>, postId: string) {
  // This transaction performs at most one aggregate build. No holdable cursor or
  // elevated database connection is used; actor RLS applies to the source query.
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
