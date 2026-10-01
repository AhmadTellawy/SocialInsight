import { Prisma } from '@prisma/client';
import { hasPageCapability, PagePolicyError, pagePublicWhere } from './pagePolicy';
import { activePageActor, lockPage, pageTransaction, requirePageCapability } from './pageService';
import { attachPagePublishers } from './pagePostService';
import { POST_MEDIA_INCLUDE } from '../services/mediaService';
import { mapPostForClient, SAFE_USER_SELECT } from '../controllers/postController';
import { ACTIVE_MENTION_REFERENCE_INCLUDE } from '../services/mentionLifecycleService';
import { getVisiblePeopleTagsInclude } from '../services/peopleTagService';

export async function pageContent(pageId:string,viewerId:string,options:{postId?:string;cursor?:string;status?:string;limit:number}){
  return pageTransaction(async tx=>{
  // Keep the fresh role and private content read behind the same Page lock.
  // Revocation and suspension writers cannot commit between them.
  const page=await lockPage(tx,pageId);
  await activePageActor(tx,viewerId);
  const role=await requirePageCapability(tx,page,viewerId,'analytics');
  if(role==='ANALYST'&&options.status==='DRAFT')throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  if(role==='ANALYST')options={...options,status:'PUBLISHED'};
  const posts=await tx.post.findMany({where:{pageId,isDeleted:false,...(options.postId?{id:options.postId}:{}),...(options.status?{status:options.status}:{})},
    orderBy:[{createdAt:'desc'},{id:'desc'}],take:options.postId?1:options.limit+1,...(options.cursor?{cursor:{id:options.cursor},skip:1}:{}),
    include:{author:{select:SAFE_USER_SELECT},questions:{include:{options:{orderBy:{order:'asc'}}}},
      sections:{include:{questions:{include:{options:{orderBy:{order:'asc'}}}}}},media:POST_MEDIA_INCLUDE,targetedGroups:true,
      mentions:ACTIVE_MENTION_REFERENCE_INCLUDE,taggedUsers:getVisiblePeopleTagsInclude(viewerId)}});
  const nextCursor=posts.length>options.limit?posts[options.limit-1].id:null;
  const selected=posts.slice(0,options.limit);
  const rootIds=[...new Set(selected.map(post=>post.sharedRootPageId).filter((value):value is string=>Boolean(value)))];
  const visibleRoots=rootIds.length?await tx.page.findMany({
    where:{AND:[{id:{in:rootIds}},pagePublicWhere(true)]},select:{id:true}
  }):[];
  const visibleRootIds=new Set(visibleRoots.map(root=>root.id));
  for(const post of selected){
    if(!post.sharedRootPageId||visibleRootIds.has(post.sharedRootPageId))continue;
    if(post.title===post.sharedCopiedTitle)post.title='';
    if(post.description===post.sharedCopiedDescription)post.description='';
    if(post.category===post.sharedCopiedCategory)post.category=null;
  }
  await attachPagePublishers(selected,viewerId,tx);
  const items=selected.map(post=>mapPostForClient(post,viewerId));
  if(hasPageCapability(role,'manageContent')&&items.length){
    const activity=await tx.$queryRaw<Array<{targetId:string;actorId:string|null;name:string|null;createdAt:Date}>>(Prisma.sql`
      SELECT DISTINCT ON (event."targetId") event."targetId",event."actorId",users.name,event."createdAt"
      FROM "PageAuditEvent" event LEFT JOIN users ON users.id=event."actorId"
      WHERE event."pageId"=${pageId} AND event.action IN ('CONTENT_CREATED','CONTENT_UPDATED')
      AND event."targetId" IN (${Prisma.join(items.map(post=>post.id))})
      ORDER BY event."targetId",event."createdAt" DESC,event.id DESC`);
    for(const item of items){const last=activity.find(event=>event.targetId===item.id);if(last)(item as any).managementLastActor={id:last.actorId,name:last.name,at:last.createdAt};}
  }
  return {items,nextCursor};
  },'ReadCommitted');
}
