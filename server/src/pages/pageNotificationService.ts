import prisma from '../prisma';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { parseNotificationPayload } from '../utils/notificationTarget';
import { isPageTestUser, pagesEnabled } from './pageFeature';
import { eligiblePageActivityIds, expandPageActivity, pageActivityNotification } from './pageActivityNotifications';
export { notifyPagePostInteraction } from './pageActivityNotifications';

/** Batch, recipient-scoped notification presentation. Human actors never stand in for Page publishers. */
export async function presentPageNotifications(records:any[],viewerId:string) {
  // Recheck durable activity at each inbox/Socket/push read, after role or preference changes.
  const eventIdFor=(record:any):string|null=>typeof record.dedupeKey==='string'&&record.dedupeKey.startsWith('page-event:')?record.dedupeKey.slice(11):null;
  const eventIds=[...new Set(records.map(eventIdFor).filter(Boolean))] as string[];
  const events=eventIds.length?await prisma.pageEvent.findMany({where:{id:{in:eventIds},recipientId:viewerId}}):[];
  const eventsById=new Map(events.map(event=>[event.id,event]));
  const allowedActivity=await eligiblePageActivityIds(prisma,events,viewerId);
  records=records.filter(record=>{const id=eventIdFor(record);if(!id)return true;const event=eventsById.get(id);return !!event&&(event.kind!=='PAGE_ACTIVITY_DELIVERY'||allowedActivity.has(id));});
  const postIds=[...new Set(records.filter(n=>['post','survey'].includes(n.targetType)).map(n=>n.targetId).filter(Boolean))] as string[];
  const posts=postIds.length ? await prisma.post.findMany({where:{id:{in:postIds}},select:{id:true,pageId:true,sharedFrom:{select:{pageId:true}}}}) : [];
  const pagePosts=posts.filter(post=>post.pageId||post.sharedFrom?.pageId);
  const visiblePosts=pagePosts.length ? await prisma.post.findMany({where:{id:{in:pagePosts.map(post=>post.id)},...buildVisiblePublishedPostWhere(viewerId)},select:{id:true}}) : [];
  const visible=new Set(visiblePosts.map(post=>post.id));
  const postsById=new Map(pagePosts.map(post=>[post.id,post]));
  const commentIds=[...new Set(records.map(n=>{const payload=parseNotificationPayload(n.payload);return payload.replyId||payload.commentId;}).filter(Boolean))] as string[];
  const comments=commentIds.length ? await prisma.comment.findMany({where:{id:{in:commentIds}},select:{id:true,pageId:true}}) : [];
  const commentsById=new Map(comments.map(comment=>[comment.id,comment]));
  const pageIds=[...new Set([...pagePosts.flatMap(post=>[post.pageId,post.sharedFrom?.pageId]),...comments.map(comment=>comment.pageId),...records.filter(n=>n.targetType==='page').map(n=>n.targetId)].filter(Boolean))] as string[];
  const pages=pageIds.length ? await prisma.page.findMany({where:{id:{in:pageIds}},select:{id:true,name:true,handle:true,avatarMediaId:true,isTestFixture:true,purgedAt:true}}) : [];
  const pagesById=new Map(pages.map(page=>[page.id,page]));
  return records.flatMap(record=>{
    const post=postsById.get(record.targetId),payload=parseNotificationPayload(record.payload);
    const associated=[post?.pageId,post?.sharedFrom?.pageId,record.targetType==='page'?record.targetId:null].filter(Boolean) as string[];
    if(associated.length&&(!pagesEnabled(viewerId)||associated.some(id=>pagesById.get(id)?.purgedAt)||(!isPageTestUser(viewerId)&&associated.some(id=>pagesById.get(id)?.isTestFixture))))return [];
    if(post && !visible.has(post.id)) return [];
    const commentId=payload.replyId||payload.commentId;
    if(post && commentId && !commentsById.has(commentId))return [];
    const officialPageId=record.targetType==='page' ? record.targetId
      : commentId ? commentsById.get(commentId)?.pageId
      : ['mention','people_tag'].includes(record.type) ? post?.pageId : null;
    const page=officialPageId ? pagesById.get(officialPageId) : null;
    if(officialPageId&&!page)return [];
    return [{...record,...(page?{actorId:undefined,actor:{id:page.id,kind:'PAGE',name:page.name,handle:page.handle,avatar:'',avatarMediaId:page.avatarMediaId,verifiedBadge:false}}:{})}];
  });
}

const eventLabels: Record<string,[string,string]> = {
  PAGE_INVITATION:['You have a Page team invitation.','لديك دعوة للانضمام إلى فريق صفحة.'],
  PAGE_INVITATION_ACCEPTED:['Your Page team invitation was accepted.','قُبلت دعوة الانضمام إلى فريق الصفحة.'],
  PAGE_INVITATION_REJECTED:['Your Page team invitation was declined.','رُفضت دعوة الانضمام إلى فريق الصفحة.'],
  PAGE_INVITATION_WITHDRAWN:['A Page team invitation was withdrawn.','سُحبت دعوة الانضمام إلى فريق الصفحة.'],
  PAGE_ROLE_CHANGED:['Your Page role has changed.','تغير دورك في الصفحة.'],
  PAGE_ROLE_REVOKED:['Your Page team access has ended.','انتهت صلاحية وصولك إلى فريق الصفحة.'],
  PAGE_TRANSFER:['You have a Page ownership transfer request.','لديك طلب لاستلام ملكية صفحة.'],
  PAGE_TRANSFER_ACCEPTED:['Page ownership was transferred.','نُقلت ملكية الصفحة.'],
  PAGE_TRANSFER_REJECTED:['Page ownership transfer was declined.','رُفض طلب نقل ملكية الصفحة.'],
  PAGE_TRANSFER_WITHDRAWN:['Page ownership transfer was withdrawn.','سُحب طلب نقل ملكية الصفحة.'],
};

export function pageEventDeepLink(event: {kind:string;pageId:string;targetId:string}): string {
  if (event.kind === 'PAGE_INVITATION_ACCEPTED' || event.kind === 'PAGE_INVITATION_REJECTED' || event.kind === 'PAGE_TRANSFER_ACCEPTED') {
    return '/pages/manage/' + event.pageId + '?tab=team';
  }
  if (event.kind.startsWith('PAGE_INVITATION') || event.kind.startsWith('PAGE_TRANSFER')) {
    return '/pages/mine?tab=invitations';
  }
  return event.kind === 'PAGE_CASE_DECIDED' ? '/pages/cases/' + event.targetId : '/pages/manage/' + event.pageId;
}

/** Durable inbox delivery is atomic with the outbox receipt. Socket delivery is a best-effort hint. */
export async function processPageOutbox(limit=40) {
  let attemptedIds:string[]=[];
  const notificationIds=await prisma.$transaction(async tx=>{
    const events=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "PageEvent" WHERE "deliveredAt" IS NULL AND "availableAt" <= NOW() ORDER BY "createdAt",id LIMIT ${Math.min(100,Math.max(1,limit))} FOR UPDATE SKIP LOCKED`;
    const ids:string[]=[];
    attemptedIds=events.map(event=>event.id);
    for(const {id} of events){
      const event=await tx.pageEvent.findUniqueOrThrow({where:{id}});
      if(!pagesEnabled(event.recipientId))continue;
      await tx.$queryRaw`SELECT id FROM "Page" WHERE id=${event.pageId} FOR SHARE`;
      const page=await tx.page.findUnique({where:{id:event.pageId},select:{isTestFixture:true,purgedAt:true}});
      const user=await tx.user.findUnique({where:{id:event.recipientId},select:{status:true,language:true}});
      if(event.kind==='PAGE_ACTIVITY'){
        if(!await expandPageActivity(tx,event))continue;
        await tx.pageEvent.update({where:{id},data:{deliveredAt:new Date(),attempts:{increment:1},lastError:null}});continue;
      }
      if(user?.status==='ACTIVE'&&page&&!page.purgedAt&&(!page.isTestFixture||isPageTestUser(event.recipientId))){
        if(event.kind==='PAGE_ACTIVITY_DELIVERY'){
          const data=await pageActivityNotification(tx,event,user.language);
          if(data){const notification=await tx.notification.upsert({where:{dedupeKey:'page-event:'+event.id},update:{},create:{userId:event.recipientId,...data,dedupeKey:'page-event:'+event.id}});ids.push(notification.id);}
          await tx.pageEvent.update({where:{id},data:{deliveredAt:new Date(),attempts:{increment:1},lastError:null}});continue;
        }
        const labels=eventLabels[event.kind]||['There is an update about your Page.','يوجد تحديث متعلق بصفحتك.'];
        const deepLink=pageEventDeepLink(event);
        const notification=await tx.notification.upsert({where:{dedupeKey:'page-event:'+event.id},update:{},create:{userId:event.recipientId,
          actorId:null,type:event.kind,message:labels[user.language?.startsWith('ar')?1:0],targetType:'page',targetId:event.pageId,
          payload:JSON.stringify({pageId:event.pageId,eventId:event.id,deepLink}),dedupeKey:'page-event:'+event.id}});
        ids.push(notification.id);
      }
      await tx.pageEvent.update({where:{id},data:{deliveredAt:new Date(),attempts:{increment:1},lastError:null}});
    }
    return ids;
  },{timeout:15000}).catch(async error=>{
    // Retry state survives the rolled-back delivery transaction; never expose payloads in diagnostics.
    if(attemptedIds.length)await prisma.pageEvent.updateMany({where:{id:{in:attemptedIds},deliveredAt:null},data:{attempts:{increment:1},availableAt:new Date(Date.now()+60000),lastError:error instanceof Error?error.name:'UNKNOWN'}});
    throw error;
  });
  const {dispatchNotificationIds}=await import('../services/notificationService');
  await dispatchNotificationIds(notificationIds);
  return {persisted:notificationIds.length};
}

export function startPageOutboxWorker(){
  let running=false;
  const tick=async()=>{if(running||process.env.PAGES_ENABLED!=='true'&&!process.env.PAGES_TEST_USERS)return;running=true;
    try{await processPageOutbox();}catch(error){console.error(JSON.stringify({event:'page_outbox_retry_pending',code:error instanceof Error?error.name:'UNKNOWN'}));}finally{running=false;}};
  const timer=setInterval(()=>void tick(),15000);timer.unref();void tick();return()=>clearInterval(timer);
}
