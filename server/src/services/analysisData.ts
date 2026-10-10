import { Prisma } from '@prisma/client';

type Cursor = { id: string; timestamp: Date };
type Row = Cursor & { birthday: Date | null; country: string | null; demographics: Record<string, string | null> | null;
  answers: Array<{ questionId: string; optionId: string | null; textValue: string | null }> };

// One round trip per batch; keyset matches the existing post/timestamp/id index.
// Bind timestamp-without-time-zone as an explicit ISO string: a JS Date binds
// as timestamptz and otherwise shifts the cursor in non-UTC database sessions.
// Caller supplies the authorized transaction, preserving RLS and its snapshot.
export function analysisPageQuery(postId: string, cursor?: Cursor) {
  return Prisma.sql`
    SELECT r.id, r.timestamp, u.birthday, u.country,
      jsonb_build_object('gender', d.gender, 'maritalStatus', d.marital_status,
        'educationLevel', d.education_level, 'employmentType', d.employment_type,
        'industry', d.industry, 'employmentSector', d.employment_sector, 'nationality', d.nationality) AS demographics,
      COALESCE(a.answers, '[]'::jsonb) AS answers
    FROM (
      SELECT id, timestamp, "userId" FROM "Response"
      WHERE "postId" = ${postId}
      ${cursor ? Prisma.sql`AND (timestamp, id) < (${cursor.timestamp.toISOString()}::timestamp, ${cursor.id})` : Prisma.empty}
      ORDER BY timestamp DESC, id DESC LIMIT 500
    ) r
    LEFT JOIN users u ON u.id = r."userId"
    LEFT JOIN user_demographics d ON d.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('questionId', "questionId", 'optionId', "optionId",
        'textValue', CASE WHEN COALESCE("textValue", '') <> '' THEN '1' ELSE NULL END)) AS answers
      FROM "Answer" WHERE "responseId" = r.id
    ) a ON true
    ORDER BY r.timestamp DESC, r.id DESC
  `;
}

export async function readAnalysisPage(client: Pick<Prisma.TransactionClient, '$queryRaw'>, postId: string, cursor?: Cursor) {
  const rows = await client.$queryRaw<Row[]>(analysisPageQuery(postId, cursor));
  return rows.map(({ birthday, country, demographics, ...row }) => ({
    ...row, user: { birthday, country, demographics }
  }));
}
