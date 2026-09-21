import { z } from 'zod';
import prisma from '../prisma';
import { PagePolicyError, hasPageCapability } from './pagePolicy';
import { assertPagesEnabled } from './pageFeature';
import { activePageActor, assertPagePublic, lockPage, pageIsBlocked, pageManagementDto, pageRole, pageTransaction, requirePageCapability } from './pageService';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { commitPreparedMedia, getStoredMediaPresentation, prepareMediaAttachments, scheduleMediaDeletion } from '../services/mediaService';
import { getMediaStorage } from '../services/mediaStorage';

export async function updatePageMedia(pageId:string,actorId:string,raw:unknown) {
  assertPagesEnabled(actorId);
  const input=z.object({avatarMediaId:z.string().uuid().nullable(),coverMediaId:z.string().uuid().nullable()}).strict().parse(raw);
  const initial=await prisma.page.findUnique({where:{id:pageId}});
  if(!initial)throw new PagePolicyError('PAGE_NOT_FOUND',404);
  await requirePageCapability(prisma,initial,actorId,'editInfo');
  const requirements=[...(input.avatarMediaId&&input.avatarMediaId!==initial.avatarMediaId?[{id:input.avatarMediaId,purpose:'PROFILE_AVATAR' as const}]:[]),
    ...(input.coverMediaId&&input.coverMediaId!==initial.coverMediaId?[{id:input.coverMediaId,purpose:'PROFILE_COVER' as const}]:[])];
  const prepared=await prepareMediaAttachments(actorId,requirements,'RESTRICTED');
  const result=await pageTransaction(async tx=>{
    assertPagesEnabled(actorId);
    const page=await lockPage(tx,pageId);await activePageActor(tx,actorId);const role=await requirePageCapability(tx,page,actorId,'editInfo');
    if(page.deletionRequestedAt)throw new PagePolicyError('PAGE_DELETING',409);
    if(page.avatarMediaId!==initial.avatarMediaId||page.coverMediaId!==initial.coverMediaId)throw new PagePolicyError('PAGE_RETRY_CONFLICT',409);
    await commitPreparedMedia(tx,prepared);
    if(prepared.assetIds.length)await tx.mediaAsset.updateMany({where:{id:{in:prepared.assetIds}},data:{pageId}});
    const updated=await tx.page.update({where:{id:pageId},data:input});
    return {page:pageManagementDto(updated,role),removed:[page.avatarMediaId,page.coverMediaId].filter(id=>id&&id!==input.avatarMediaId&&id!==input.coverMediaId)};
  });
  await scheduleMediaDeletion(result.removed);
  return result.page;
}

async function permittedPageMedia(assetId:string,viewerId?:string) {
  assertPagesEnabled(viewerId);
  const asset=await prisma.mediaAsset.findUnique({where:{id:assetId},include:{page:true,variants:true,
    postAttachment:{select:{postId:true}},questionFor:{select:{postId:true,section:{select:{postId:true}}}},
    optionFor:{select:{question:{select:{postId:true,optionPresentation:true,showOptionNames:true,section:{select:{postId:true}}}}}}}});
  if(!asset?.page||asset.status!=='ATTACHED'||asset.deletedAt||!asset.aspectRatio||asset.page.purgedAt)throw new PagePolicyError('PAGE_MEDIA_UNAVAILABLE',404);
  if(await pageIsBlocked(prisma,asset.page.id,viewerId))throw new PagePolicyError('PAGE_MEDIA_UNAVAILABLE',404);
  const postId=asset.postAttachment?.postId||asset.questionFor?.postId||asset.questionFor?.section?.postId
    ||asset.optionFor?.question.postId||asset.optionFor?.question.section?.postId;
  const role=await pageRole(prisma,asset.page,viewerId);
  if(postId){
    const post=await prisma.post.findUnique({where:{id:postId},select:{pageId:true,isDeleted:true,status:true,optionPresentation:true,showOptionNames:true}});
    // An upload's former human owner is never an authorization path. The current Page
    // relation and role must agree, including section-only survey questions/options.
    if(!post||post.pageId!==asset.page.id||post.isDeleted)throw new PagePolicyError('PAGE_MEDIA_UNAVAILABLE',404);
    const privateContent=hasPageCapability(role,'manageContent')
      ||(post.status==='PUBLISHED'&&hasPageCapability(role,'analytics'));
    const publicPost=privateContent?0:await prisma.post.count({where:{id:postId,...buildVisiblePublishedPostWhere(viewerId)}});
    if(!publicPost&&!privateContent)throw new PagePolicyError('PAGE_MEDIA_UNAVAILABLE',404);
    if(asset.optionFor&&!hasPageCapability(role,'analytics')&&(
      (post.optionPresentation==='image'&&post.showOptionNames===false)
      ||(asset.optionFor.question.optionPresentation==='image'&&asset.optionFor.question.showOptionNames===false)))asset.altText=null;
  }else{
    if(asset.id!==asset.page.avatarMediaId&&asset.id!==asset.page.coverMediaId)throw new PagePolicyError('PAGE_MEDIA_UNAVAILABLE',404);
    if(!role)await assertPagePublic(prisma,asset.page,viewerId);
  }
  return asset;
}

export async function pageMediaPresentation(assetId:string,viewerId?:string) {
  const asset=await permittedPageMedia(assetId,viewerId);
  const meta=await getStoredMediaPresentation(asset.id);
  if(!meta)throw new PagePolicyError('PAGE_MEDIA_UNAVAILABLE',404);
  return {id:asset.id,access:'RESTRICTED' as const,aspectRatio:meta.aspectRatio,focalX:meta.focalX,focalY:meta.focalY,
    altText:asset.altText,width:meta.width,height:meta.height,src:'/api/media/'+encodeURIComponent(asset.id)+'/content',requiresAuth:true};
}

export async function pageMediaBytes(assetId:string,viewerId?:string) {
  const asset=await permittedPageMedia(assetId,viewerId);
  const variant=asset.variants.filter(value=>!value.isPublic&&value.kind!=='MASTER').sort((a,b)=>b.width-a.width)[0];
  if(!variant)throw new PagePolicyError('PAGE_MEDIA_UNAVAILABLE',404);
  const bytes=await getMediaStorage().download(variant.storageBucket,variant.storageKey);
  // Recheck after storage I/O so a suspension during a slow download cannot release new bytes.
  await permittedPageMedia(assetId,viewerId);
  return {bytes,mime:variant.mime};
}
