import { Prisma } from '@prisma/client';

export const ANALYSIS_BATCH_SIZE = 10_000;
type Cursor = { id: string; timestamp: Date };
type Row = Cursor & { weight: number; pageSize: number; birthday: Date | null; country: string | null;
  demographics: Record<string, string | null> | null; answers: Array<[string, string | null, string | null]> };

// Compact identical raw profiles within a bounded response batch before transfer.
// Weights are exact response counts, not sampled or rounded estimates. Existing
// aggregation still derives age groups, deduplicates selections and suppresses
// small complete cells across batches. Only text presence is read, never text.
// The authorized caller's transaction retains its RLS and isolation guarantees.
// Continuation follows the last RESPONSE in the batch, not the compact row count.
// Explicit timestamp avoids timezone shifts when Prisma binds a JS Date.
export function analysisPageQuery(postId: string, cursor?: Cursor) {
  return Prisma.sql`
WITH batch AS MATERIALIZED (
 SELECT id,timestamp,"userId",row_number() OVER (ORDER BY timestamp DESC,id DESC) AS ordinal FROM "Response" WHERE "postId"=${postId}
 ${cursor?Prisma.sql`AND (timestamp,id)<(${cursor.timestamp.toISOString()}::timestamp,${cursor.id})`:Prisma.empty}
 ORDER BY timestamp DESC,id DESC LIMIT ${ANALYSIS_BATCH_SIZE}
)
SELECT u.birthday,u.country,
 jsonb_build_object('gender',d.gender,'maritalStatus',d.marital_status,'educationLevel',d.education_level,
 'employmentType',d.employment_type,'industry',d.industry,'employmentSector',d.employment_sector,'nationality',d.nationality) AS demographics,
 COALESCE(a.answers,'[]'::jsonb) AS answers,count(*)::int AS weight,
 (SELECT id FROM batch ORDER BY timestamp ASC,id ASC LIMIT 1) AS id,
 (SELECT timestamp FROM batch ORDER BY timestamp ASC,id ASC LIMIT 1) AS timestamp,
 (SELECT count(*)::int FROM batch) AS "pageSize"
 FROM batch b LEFT JOIN users u ON u.id=b."userId" LEFT JOIN user_demographics d ON d.user_id=u.id
 LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_array("questionId","optionId",CASE WHEN COALESCE("textValue",'')<>'' THEN '1' ELSE NULL END)
 ORDER BY "questionId","optionId",CASE WHEN COALESCE("textValue",'')<>'' THEN '1' ELSE NULL END) AS answers
 FROM "Answer" WHERE "responseId"=b.id) a ON true
 GROUP BY u.birthday,u.country,d.gender,d.marital_status,d.education_level,d.employment_type,d.industry,d.employment_sector,d.nationality,a.answers
 ORDER BY min(b.ordinal)
`;
}

export async function readAnalysisPage(client: Pick<Prisma.TransactionClient, '$queryRaw'>, postId: string, cursor?: Cursor) {
  const rows = await client.$queryRaw<Row[]>(analysisPageQuery(postId, cursor));
  return rows.map(({ birthday, country, demographics, answers, ...row }) => ({
    ...row, user: { birthday, country, demographics },
    answers: answers.map(([questionId, optionId, textValue]) => ({ questionId, optionId, textValue }))
  }));
}
