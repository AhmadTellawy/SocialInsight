import { Page, Post, Prisma } from '@prisma/client';
import prisma from '../prisma';
import { assertPageDestination, hasPageCapability, isPagePublic, PageCapability, PagePolicyError, PageRole, pagePublicWhere } from './pagePolicy';
import { activePageActor, assertPagePublic, lockPage, lockPageForInteraction, pageIsBlocked, pageRole, PageTx, requirePageCapability } from './pageService';
import { arePublishedPostsVisible } from '../services/postVisibilitySql';
import { assertPagesEnabled, pagesEnabled } from './pageFeature';

// Structural lock context only: visibility must still be queried when consumed.
// Only a successful guard can populate it; no request object can mint a context.
const interactionPages = new WeakMap<PageTx, Map<string, { actorId: string | null; page: Page }>>();

/** Consume once on the exact transaction/post/actor. No eligibility decision is cached. */
export function consumePageInteractionLock(tx: PageTx, postId: string, actorId?: string | null): Page | undefined {
  const entries = interactionPages.get(tx);
  const entry = entries?.get(postId);
  if (!entry || entry.actorId !== (actorId ?? null)) return undefined;
  entries!.delete(postId);
  if (!entries!.size) interactionPages.delete(tx);
  return entry.page;
}

export async function authorizePagePublisher(tx: PageTx, pageId: string, actorId: string,
  input: { status?:unknown; groupId?:unknown; targetGroups?:unknown; targetedGroups?:unknown; targetAudience?:unknown }, publicationRequired=true) {
  assertPagesEnabled(actorId);
  assertPageDestination(input);
  const page = await lockPage(tx,pageId);
  await activePageActor(tx,actorId);
  await requirePageCapability(tx,page,actorId,'manageContent');
  if(await pageIsBlocked(tx,page.id,actorId))throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  if(page.deletionRequestedAt || page.platformState==='SUSPENDED') throw new PagePolicyError('PAGE_PUBLICATION_RESTRICTED',409);
  if(publicationRequired && input.status!=='DRAFT') {
    await assertPagePublic(tx,page,actorId);
    if(page.platformState!=='NONE')throw new PagePolicyError('PAGE_PUBLICATION_RESTRICTED',409);
  }
  return page;
}

export async function hasPostPageCapability(pageId:string|null|undefined,viewerId:string|null|undefined,capability:PageCapability,tx:PageTx=prisma):Promise<boolean> {
  if(!pageId||!viewerId||!pagesEnabled(viewerId))return false;
  const page=await tx.page.findUnique({where:{id:pageId}});
  return !!page&&!page.purgedAt&&hasPageCapability(await pageRole(tx,page,viewerId),capability);
}

export async function isPageFollower(pageId:string,viewerId?:string|null):Promise<boolean> {
  return !!viewerId&&!!await prisma.pageFollow.findUnique({where:{pageId_userId:{pageId,userId:viewerId}},select:{userId:true}});
}

export function pagePostAudienceWhere(viewerId?:string|null):Prisma.PostWhereInput {
  if(!pagesEnabled(viewerId))return {id:{in:[]}};
  const managementAudience:Prisma.PostWhereInput[] = viewerId ? [{page:{is:{OR:[
    {ownerId:viewerId,owner:{status:'ACTIVE'}},
    {members:{some:{userId:viewerId,role:{in:['ADMIN','EDITOR']},user:{status:'ACTIVE'}}}},
  ]}}}] : [];
  return {pageId:{not:null},page:{is:{...pagePublicWhere(),...(viewerId?{blocks:{none:{userId:viewerId}}}:{})}},
    groupId:null,targetedGroups:{none:{}},OR:[
      {targetAudience:null},{targetAudience:{equals:'Public',mode:'insensitive'}},
      ...(viewerId?[{targetAudience:{equals:'Followers',mode:'insensitive' as const},page:{is:{follows:{some:{userId:viewerId}}}}}]:[]),
      ...managementAudience,
    ]};
}

/** Batch Page identities once per bounded feed, including shared source posts. Never expose the internal actor. */
export async function attachPagePublishers(posts:any[],viewerId?:string|null):Promise<void> {
  const targets:any[]=[];
  const visit=(post:any)=>{if(!post)return;if(post.pageId)targets.push(post);if(post.sharedFrom)visit(post.sharedFrom);};
  posts.forEach(visit);
  if(!targets.length)return;
  // A single statement keeps publisher identity and viewer presentation together
  // without separate reads for Page, membership and follow.
  // This only attaches presentation; endpoint authorization remains server-side.
  const pageIds = [...new Set(targets.map(post => post.pageId))] as string[];
  const viewer = viewerId || '';
  const pages = await prisma.$queryRaw<Array<{
    id: string; ownerId: string; name: string; handle: string; avatarMediaId: string | null;
    _viewerRole: string | null; _isFollowing: boolean;
  }>>(Prisma.sql`
    SELECT p."id", p."ownerId", p."name", p."handle", p."avatarMediaId",
      membership."role" AS "_viewerRole", (following."userId" IS NOT NULL) AS "_isFollowing"
    FROM "Page" p
    LEFT JOIN "PageMembership" membership
      ON membership."pageId" = p."id" AND membership."userId" = ${viewer}
    LEFT JOIN "PageFollow" following
      ON following."pageId" = p."id" AND following."userId" = ${viewer}
    WHERE p."id" IN (${Prisma.join(pageIds)})
  `);
  const pagesById=new Map(pages.map(page=>[page.id,page]));
  for(const post of targets){
    const page=pagesById.get(post.pageId);
    if(!page)throw new PagePolicyError('PAGE_NOT_FOUND',404);
    const role:PageRole|null=viewerId===page.ownerId?'OWNER':page._viewerRole as PageRole||null;
    post.authorId=page.id;
    post.author={id:page.id,kind:'PAGE',name:page.name,handle:page.handle,avatar:'',avatarMediaId:page.avatarMediaId,
      verifiedBadge:false,isPrivate:false,isFollowing:page._isFollowing};
    post.pageCapabilities=(['manageContent','reply','moderateComments','analytics'] as PageCapability[]).filter(capability=>hasPageCapability(role,capability));
    delete post.lastPageActorId;
    delete post.pageCreateKey;
    delete post.approvedById;
    delete post.rejectedById;
    for (const tag of post.taggedUsers || []) delete tag.taggedByUserId;
  }
}

export async function guardPagePostPersistence(tx:PageTx,postId:string,actorId?:string|null, requireOpen=false):Promise<void> {
  const post=await tx.post.findUnique({where:{id:postId},select:{pageId:true,sharedFrom:{select:{pageId:true}},status:true,isDeleted:true,expiresAt:true}});
  const pageIds=[...new Set([post?.pageId,post?.sharedFrom?.pageId].filter((id):id is string=>!!id))].sort();
  if(!pageIds.length)return;
  const pages=[];
  for(const pageId of pageIds)pages.push(await lockPage(tx,pageId));
  if(actorId)await activePageActor(tx,actorId);
  for(const page of pages)await assertPagePublic(tx,page,actorId);
  const current = await tx.post.findUnique({where:{id:postId},select:{isDeleted:true,status:true,expiresAt:true,targetAudience:true}});
  if(!current||current.isDeleted||current.status!=='PUBLISHED')throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
  if(requireOpen && current.expiresAt && current.expiresAt.getTime() <= Date.now()) throw new PagePolicyError('PAGE_POST_ENDED',400);
  if (!await arePublishedPostsVisible(tx,[postId],actorId)) throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
}

/**
 * Public votes/likes/comments may run on different posts of one Page concurrently.
 * Acquire ALL Page locks before ALL Post locks, including a clicked wrapper and
 * its source. Same-post counters/toggles remain serialized; management continues
 * to use the exclusive guard above. Never upgrade these Page locks later in the tx.
 */
export async function guardPagePostInteractions(tx:PageTx,postIds:string[],actorId?:string|null,openPostId?:string):Promise<boolean> {
  // A failed or personal-only re-guard must not leave a prior successful context usable.
  interactionPages.delete(tx);
  const refs=[];
  for(const id of [...new Set(postIds)].sort()) {
    const post=await tx.post.findUnique({where:{id},select:{id:true,pageId:true,sharedFrom:{select:{id:true,pageId:true}}}});
    if(post)refs.push(post);
  }
  const guarded=refs.filter(post=>post.pageId||post.sharedFrom?.pageId);
  if(!guarded.length)return false; // Preserve the existing personal-only interaction path.
  const pageIds=[...new Set(guarded.flatMap(post=>[post.pageId,post.sharedFrom?.pageId]).filter((id):id is string=>!!id))].sort();
  const lockedPostIds=[...new Set(refs.flatMap(post=>[post.id,post.sharedFrom?.id]).filter((id):id is string=>!!id))].sort();
  const pages=[];
  for(const pageId of pageIds)pages.push(await lockPageForInteraction(tx,pageId));
  if(actorId)await activePageActor(tx,actorId);
  const lockedPosts = await tx.$queryRaw<Array<Pick<Post, 'id' | 'pageId' | 'sharedFromId' | 'status' | 'isDeleted' | 'expiresAt'>>>(Prisma.sql`
    SELECT "id", "pageId", "sharedFromId", "status", "isDeleted", "expiresAt"
    FROM "Post" WHERE "id" IN (${Prisma.join(lockedPostIds)}) ORDER BY "id" FOR UPDATE`);
  const lockedPostsById = new Map(lockedPosts.map(post => [post.id, post]));
  for(const page of pages)await assertPagePublic(tx,page,actorId);
  // FOR UPDATE returns the winning row after any wait; never trust pre-lock state.
  for(const post of guarded) {
    const current=lockedPostsById.get(post.id);
    if(!current||current.isDeleted||current.status!=='PUBLISHED')throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
    if(post.id===openPostId&&current.expiresAt&&current.expiresAt.getTime()<=Date.now())throw new PagePolicyError('PAGE_POST_ENDED',400);
  }
  if(!await arePublishedPostsVisible(tx,guarded.map(post=>post.id),actorId,guarded.every(post=>!!post.pageId)?'PAGE':undefined))throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
  const pagesById = new Map(pages.map(page => [page.id, page]));
  const contexts = new Map<string, { actorId: string | null; page: Page }>();
  for (const post of refs) {
    const current = lockedPostsById.get(post.id);
    // A personal source behind a Page wrapper must retain its personal notification path.
    // Identity changes since the pre-lock read also require the ordinary fresh fallback.
    if (!current?.pageId || current.pageId !== post.pageId || current.sharedFromId !== (post.sharedFrom?.id ?? null)) continue;
    const page = pagesById.get(current.pageId);
    if (page) contexts.set(post.id, { actorId: actorId ?? null, page: { ...page } });
  }
  // Between this guard and notification, supported callers mutate only content/counters.
  // Page ownership/lifecycle writes in the same transaction must not use this context.
  if (contexts.size) interactionPages.set(tx, contexts);
  return true;
}

export const respondPagePostError = (error:unknown,res:{status:(code:number)=>{json:(value:unknown)=>unknown}}):boolean => {
  if(!(error instanceof PagePolicyError))return false;
  res.status(error.status).json({error:error.code,code:error.code});
  return true;
};

export async function attachPageCommentPublishers(comments:any[],viewerId?:string|null) {
  const targets:any[]=[];
  const collect=(comment:any)=>{if(comment.pageId)targets.push(comment);for(const reply of comment.replies||[])collect(reply);};
  comments.forEach(collect);
  const wrappers=targets.map(comment=>({pageId:comment.pageId}));
  await attachPagePublishers(wrappers,viewerId);
  targets.forEach((comment,index)=>{
    comment.user=(wrappers[index] as any).author;
    comment.pageCapabilities=(wrappers[index] as any).pageCapabilities;
  });
}
