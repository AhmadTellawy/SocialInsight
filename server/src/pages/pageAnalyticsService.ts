import { PagePolicyError } from './pagePolicy';
import { pageCsvCell } from './pageValidation';
import { activePageActor, lockPageForInteraction, pageTransaction, requirePageCapability } from './pageService';

export async function getPageAnalytics(pageId: string, userId: string, days: 7 | 30, exporting = false) {
  // Reuse the route's signed transaction. Calling the singleton $transaction
  // inside an active Page transaction resolves to an absent tx method.
  return pageTransaction(async tx => {
    // Shared canonical coordination excludes role/lifecycle writers without
    // requiring UPDATE permission for editor/analyst read-only journeys.
    const page = await lockPageForInteraction(tx, pageId);
    if (!page || page.purgedAt) throw new PagePolicyError('PAGE_NOT_FOUND',404);
    await activePageActor(tx,userId);
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
      // Analytics grants aggregates, never another actor's private audit rows.
      tx.$queryRaw<Array<{ delta:bigint }>>`SELECT public.socialinsight_page_follower_change(${pageId},${days}::integer) AS delta`,
    ]);
    return { days, from:from.toISOString(), generatedAt:new Date().toISOString(), followers, followerChange:Number(growth[0].delta),
      posts, responses:Number(participation[0].responses), uniqueParticipants:Number(participation[0].uniqueParticipants) };
  },'ReadCommitted');
}

export function pageAnalyticsCsv(stats: Awaited<ReturnType<typeof getPageAnalytics>>, language:'ar'|'en') {
  const labels = language === 'ar' ? ['المؤشر','القيمة','بداية الفترة','نهاية الفترة','المتابعون','صافي تغير المتابعين','المنشورات الجديدة','المشاركات','المشاركون المختلفون'] :
    ['Metric','Value','Period start','Period end','Followers','Net follower change','New posts','Responses','Distinct participants'];
  const rows: Array<Array<string|number>> = [[labels[0],labels[1]],[labels[2],stats.from],[labels[3],stats.generatedAt],
    [labels[4],stats.followers],[labels[5],stats.followerChange],[labels[6],stats.posts],[labels[7],stats.responses],[labels[8],stats.uniqueParticipants]];
  return '\ufeff' + rows.map(row=>row.map(pageCsvCell).join(',')).join('\r\n') + '\r\n';
}
