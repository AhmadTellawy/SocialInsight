import prisma from '../prisma';
import { PagePolicyError } from './pagePolicy';
import { pageCsvCell } from './pageValidation';
import { requirePageCapability } from './pageService';

export async function getPageAnalytics(pageId: string, userId: string, days: 7 | 30, exporting = false) {
  return prisma.$transaction(async tx => {
    const page = await tx.page.findUnique({ where: { id: pageId } });
    if (!page || page.purgedAt) throw new PagePolicyError('PAGE_NOT_FOUND',404);
    await requirePageCapability(tx,page,userId,exporting ? 'export' : 'analytics');
    const from = new Date(Date.now() - days * 86400000);
    const [followers, posts, participation, growth] = await Promise.all([
      tx.pageFollow.count({ where: { pageId } }),
      tx.post.count({ where: { pageId, isDeleted:false, status:'PUBLISHED', createdAt:{ gte:from } } }),
      tx.$queryRaw<Array<{ responses:bigint; uniqueParticipants:bigint }>>`
        SELECT count(*)::bigint AS responses,
          count(DISTINCT coalesce('user:' || r."userId",'guest:' || r."guestId",'response:' || r.id))::bigint AS "uniqueParticipants"
        FROM "Response" r JOIN "Post" p ON p.id=r."postId"
        WHERE p."pageId"=${pageId} AND p."isDeleted"=false AND p.status='PUBLISHED' AND r.timestamp>=${from}`,
      tx.$queryRaw<Array<{ delta:bigint }>>`SELECT coalesce(sum((data->>'delta')::integer),0)::bigint AS delta
        FROM "PageAuditEvent" WHERE "pageId"=${pageId} AND action='FOLLOW_CHANGED' AND "createdAt">=${from}`,
    ]);
    return { days, from:from.toISOString(), generatedAt:new Date().toISOString(), followers, followerChange:Number(growth[0].delta),
      posts, responses:Number(participation[0].responses), uniqueParticipants:Number(participation[0].uniqueParticipants) };
  });
}

export function pageAnalyticsCsv(stats: Awaited<ReturnType<typeof getPageAnalytics>>, language:'ar'|'en') {
  const labels = language === 'ar' ? ['المؤشر','القيمة','بداية الفترة','نهاية الفترة','المتابعون','صافي تغير المتابعين','المنشورات الجديدة','المشاركات','المشاركون المختلفون'] :
    ['Metric','Value','Period start','Period end','Followers','Net follower change','New posts','Responses','Distinct participants'];
  const rows: Array<Array<string|number>> = [[labels[0],labels[1]],[labels[2],stats.from],[labels[3],stats.generatedAt],
    [labels[4],stats.followers],[labels[5],stats.followerChange],[labels[6],stats.posts],[labels[7],stats.responses],[labels[8],stats.uniqueParticipants]];
  return '\ufeff' + rows.map(row=>row.map(pageCsvCell).join(',')).join('\r\n') + '\r\n';
}
