import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { assertPagePublic, lockPageForInteraction, pageTransaction, PageTx } from './pageService';
import { isPageTestUser, pagesEnabled } from './pageFeature';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { PagePolicyError } from './pagePolicy';
import { consumePageInteractionLock } from './pagePostService';

export type PageInteraction={postId:string;actorId:string|null;kind:'vote'|'like'|'comment'|'reply'|'comment_like';commentId?:string;parentCommentId?:string;optionId?:string;excludedRecipientIds?:string[]};

/** Call within the content transaction where possible; the durable fanout is processed in bounded batches. */
export async function notifyPagePostInteraction(input:PageInteraction,transaction?:PageTx):Promise<boolean>{
  const work=async(tx:PageTx)=>{
    const lockedPage=consumePageInteractionLock(tx,input.postId,input.actorId);
    const pageId=lockedPage?.id||(await tx.post.findUnique({where:{id:input.postId},select:{pageId:true}}))?.pageId;
    if(!pageId)return false;
    if(input.kind==='comment_like'&&input.commentId){const comment=await tx.comment.findUnique({where:{id:input.commentId},select:{pageId:true}});if(!comment?.pageId)return false;}
    const page=lockedPage||await lockPageForInteraction(tx,pageId);
    if(!pagesEnabled(input.actorId)||page.purgedAt)return true;
    // Notification suppression never redirects a Page interaction to the historical publishing employee.
    try{await assertPagePublic(tx,page,input.actorId);}catch(error){if(error instanceof PagePolicyError)return true;throw error;}
    await tx.pageEvent.create({data:{pageId:page.id,recipientId:page.ownerId,kind:'PAGE_ACTIVITY',targetId:input.postId,
      context:input as unknown as Prisma.InputJsonValue,dedupeKey:'page-activity:'+randomUUID()}});
    return true;
  };
  return transaction?work(transaction):pageTransaction(work);
}

export async function expandPageActivity(tx:PageTx,event:any):Promise<boolean>{
  const context=event.context as PageInteraction&{cursor?:string};
  const page=await tx.page.findUnique({where:{id:event.pageId},select:{ownerId:true,purgedAt:true}});
  if(!page||page.purgedAt)return true;
  const roles=context.kind==='vote'?['ADMIN','EDITOR','ANALYST']:['ADMIN','EDITOR'];
  const parent=context.parentCommentId?await tx.comment.findUnique({where:{id:context.parentCommentId},select:{userId:true,pageId:true}}):null;
  const people=await tx.user.findMany({where:{status:'ACTIVE',...(context.cursor?{id:{gt:context.cursor}}:{}),OR:[{id:page.ownerId},{pageMemberships:{some:{pageId:event.pageId,role:{in:roles}}}},...(parent&&!parent.pageId?[{id:parent.userId}]:[])]},select:{id:true},orderBy:{id:'asc'},take:50});
  for(const person of people){if(person.id===context.actorId||context.excludedRecipientIds?.includes(person.id))continue;
    await tx.pageEvent.upsert({where:{dedupeKey:event.id+':'+person.id},update:{},create:{pageId:event.pageId,recipientId:person.id,kind:'PAGE_ACTIVITY_DELIVERY',targetId:event.targetId,context:event.context,dedupeKey:event.id+':'+person.id}});
  }
  if(people.length===50){await tx.pageEvent.update({where:{id:event.id},data:{context:{...context,cursor:people[49].id} as unknown as Prisma.InputJsonValue,attempts:{increment:1}}});return false;}
  return true;
}

export async function pageActivityNotification(tx:PageTx,event:any,language?:string|null){
  const context=event.context as PageInteraction;
  if(!context||!['vote','like','comment','reply','comment_like'].includes(context.kind)||context.actorId===event.recipientId||context.excludedRecipientIds?.includes(event.recipientId))return null;
  if((await tx.user.findUnique({where:{id:event.recipientId},select:{status:true}}))?.status!=='ACTIVE')return null;
  const page=await tx.page.findUnique({where:{id:event.pageId},select:{ownerId:true,isTestFixture:true,purgedAt:true}});
  if(!page||page.purgedAt||!pagesEnabled(event.recipientId)||(page.isTestFixture&&!isPageTestUser(event.recipientId)))return null;
  if(!await tx.post.count({where:{id:event.targetId,...buildVisiblePublishedPostWhere(event.recipientId)}}))return null;
  const membership=await tx.pageMembership.findUnique({where:{pageId_userId:{pageId:event.pageId,userId:event.recipientId}}});
  const parent=context.parentCommentId?await tx.comment.findUnique({where:{id:context.parentCommentId},select:{userId:true,pageId:true}}):null;
  const roleAllowed=page.ownerId===event.recipientId||membership&&((context.kind==='vote'?['ADMIN','EDITOR','ANALYST']:['ADMIN','EDITOR']).includes(membership.role));
  if(!roleAllowed&&!(parent&&!parent.pageId&&parent.userId===event.recipientId))return null;
  if((await tx.pageFollow.findUnique({where:{pageId_userId:{pageId:event.pageId,userId:event.recipientId}}}))?.muted)return null;
  const record=await tx.notificationSettings.findUnique({where:{userId:event.recipientId}});
  if(record){try{const settings=JSON.parse(record.settings);const option=['like','comment_like'].includes(context.kind)?settings.myPosts?.likes:settings.myPosts?.comments;
    if(option==='off'||settings.toggles?.pushNotifications===false)return null;
    if(option==='following'&&(!context.actorId||!await tx.follow.count({where:{followerId:event.recipientId,followingId:context.actorId,status:'ACTIVE'}})))return null;
  }catch{/* Existing malformed settings fall back to delivery. */}}
  const ar=language?.startsWith('ar');const labels={vote:ar?'مشاركة جديدة في استطلاع الصفحة':'New participation in a Page poll',like:ar?'إعجاب جديد بمنشور الصفحة':'A Page post received a like',comment:ar?'تعليق جديد على منشور الصفحة':'New comment on a Page post',reply:ar?'رد جديد على تعليق':'New reply to a comment',comment_like:ar?'إعجاب جديد برد الصفحة':'A Page reply received a like'};
  const params=new URLSearchParams();if(context.parentCommentId)params.set('comment',context.parentCommentId);else if(context.commentId)params.set('comment',context.commentId);if(context.parentCommentId&&context.commentId)params.set('reply',context.commentId);
  return {actorId:context.actorId,type:context.kind==='comment_like'?'like':context.kind==='reply'?'comment':context.kind,message:labels[context.kind],targetType:'post',targetId:event.targetId,
    payload:JSON.stringify({pageId:event.pageId,eventId:event.id,postId:event.targetId,commentId:context.parentCommentId||context.commentId,replyId:context.parentCommentId?context.commentId:undefined,deepLink:'/post/'+event.targetId+(params.size?'?'+params:'')})};
}

/** Current eligibility for one recipient's inbox page, with at most eight queries regardless of its size. */
export async function eligiblePageActivityIds(tx:PageTx,events:any[],recipientId:string):Promise<Set<string>>{
  const allowed=new Set<string>();
  const candidates=events.filter(event=>event.kind==='PAGE_ACTIVITY_DELIVERY'&&event.recipientId===recipientId
    &&event.context&&['vote','like','comment','reply','comment_like'].includes(event.context.kind)
    &&event.context.actorId!==recipientId&&!event.context.excludedRecipientIds?.includes(recipientId));
  if(!candidates.length||!pagesEnabled(recipientId))return allowed;
  if((await tx.user.findUnique({where:{id:recipientId},select:{status:true}}))?.status!=='ACTIVE')return allowed;
  const pageIds=[...new Set<string>(candidates.map(event=>event.pageId))];
  const postIds=[...new Set<string>(candidates.map(event=>event.targetId))];
  const parentIds=[...new Set<string>(candidates.map(event=>event.context.parentCommentId).filter(Boolean))];
  // Sequential bulk reads also bound connection usage when the inbox is read outside a transaction.
  const pages=await tx.page.findMany({where:{id:{in:pageIds}},select:{id:true,ownerId:true,isTestFixture:true,purgedAt:true}});
  const posts=await tx.post.findMany({where:{id:{in:postIds},...buildVisiblePublishedPostWhere(recipientId)},select:{id:true}});
  const memberships=await tx.pageMembership.findMany({where:{pageId:{in:pageIds},userId:recipientId},select:{pageId:true,role:true}});
  const parents=parentIds.length?await tx.comment.findMany({where:{id:{in:parentIds}},select:{id:true,userId:true,pageId:true}}):[];
  const muted=await tx.pageFollow.findMany({where:{pageId:{in:pageIds},userId:recipientId,muted:true},select:{pageId:true}});
  const record=await tx.notificationSettings.findUnique({where:{userId:recipientId}});
  let settings:any;
  if(record){try{settings=JSON.parse(record.settings);}catch{/* Preserve the existing malformed-settings fallback. */}}
  if(settings?.toggles?.pushNotifications===false)return allowed;
  const optionFor=(event:any)=>['like','comment_like'].includes(event.context.kind)?settings?.myPosts?.likes:settings?.myPosts?.comments;
  const actorIds=[...new Set<string>(candidates.filter(event=>optionFor(event)==='following').map(event=>event.context.actorId).filter(Boolean))];
  const follows=actorIds.length?await tx.follow.findMany({where:{followerId:recipientId,followingId:{in:actorIds},status:'ACTIVE'},select:{followingId:true}}):[];
  const pagesById=new Map(pages.map(page=>[page.id,page]));
  const visible=new Set(posts.map(post=>post.id));
  const roles=new Map(memberships.map(membership=>[membership.pageId,membership.role]));
  const parentsById=new Map(parents.map(parent=>[parent.id,parent]));
  const mutedPages=new Set(muted.map(follow=>follow.pageId));
  const followedActors=new Set(follows.map(follow=>follow.followingId));
  for(const event of candidates){
    const page=pagesById.get(event.pageId),context=event.context as PageInteraction;
    if(!page||page.purgedAt||(page.isTestFixture&&!isPageTestUser(recipientId))||!visible.has(event.targetId)||mutedPages.has(page.id))continue;
    const role=roles.get(page.id),parent=context.parentCommentId?parentsById.get(context.parentCommentId):null;
    const roleAllowed=page.ownerId===recipientId||!!role&&(context.kind==='vote'?['ADMIN','EDITOR','ANALYST']:['ADMIN','EDITOR']).includes(role);
    if(!roleAllowed&&!(parent&&!parent.pageId&&parent.userId===recipientId))continue;
    const option=optionFor(event);
    if(option==='off'||option==='following'&&(!context.actorId||!followedActors.has(context.actorId)))continue;
    allowed.add(event.id);
  }
  return allowed;
}
