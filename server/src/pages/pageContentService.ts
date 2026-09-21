import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { PagePolicyError } from './pagePolicy';
import { getManagedPage } from './pageService';
import { attachPagePublishers } from './pagePostService';
import { POST_MEDIA_INCLUDE } from '../services/mediaService';
import { mapPostForClient, SAFE_USER_SELECT } from '../controllers/postController';
import { ACTIVE_MENTION_REFERENCE_INCLUDE } from '../services/mentionLifecycleService';
import { getVisiblePeopleTagsInclude } from '../services/peopleTagService';

export async function pageContent(pageId:string,viewerId:string,options:{postId?:string;cursor?:string;status?:string;limit:number}){
  const managed=await getManagedPage(pageId,viewerId);
  if(!managed.capabilities.includes('analytics'))throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  if(managed.role==='ANALYST'&&options.status==='DRAFT')throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  if(managed.role==='ANALYST')options={...options,status:'PUBLISHED'};
  const posts=await prisma.post.findMany({where:{pageId,isDeleted:false,...(options.postId?{id:options.postId}:{}),...(options.status?{status:options.status}:{})},
    orderBy:[{createdAt:'desc'},{id:'desc'}],take:options.postId?1:options.limit+1,...(options.cursor?{cursor:{id:options.cursor},skip:1}:{}),
    include:{author:{select:SAFE_USER_SELECT},questions:{include:{options:{orderBy:{order:'asc'}}}},
      sections:{include:{questions:{include:{options:{orderBy:{order:'asc'}}}}}},media:POST_MEDIA_INCLUDE,targetedGroups:true,
      mentions:ACTIVE_MENTION_REFERENCE_INCLUDE,taggedUsers:getVisiblePeopleTagsInclude(viewerId)}});
  const nextCursor=posts.length>options.limit?posts[options.limit-1].id:null;
  const selected=posts.slice(0,options.limit);
  await attachPagePublishers(selected,viewerId);
  const items=selected.map(post=>mapPostForClient(post,viewerId));
  if(managed.capabilities.includes('manageContent')&&items.length){
    const activity=await prisma.$queryRaw<Array<{targetId:string;actorId:string|null;name:string|null;createdAt:Date}>>(Prisma.sql`
      SELECT DISTINCT ON (event."targetId") event."targetId",event."actorId",users.name,event."createdAt"
      FROM "PageAuditEvent" event LEFT JOIN users ON users.id=event."actorId"
      WHERE event."pageId"=${pageId} AND event.action IN ('CONTENT_CREATED','CONTENT_UPDATED')
      AND event."targetId" IN (${Prisma.join(items.map(post=>post.id))})
      ORDER BY event."targetId",event."createdAt" DESC,event.id DESC`);
    for(const item of items){const last=activity.find(event=>event.targetId===item.id);if(last)(item as any).managementLastActor={id:last.actorId,name:last.name,at:last.createdAt};}
  }
  return {items,nextCursor};
}
