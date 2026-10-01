import { z } from 'zod';
import { PageTx } from './pageService';
import { PagePolicyError } from './pagePolicy';
import { POST_MEDIA_INCLUDE } from '../services/mediaService';

export const pagePostRequestKey=(raw:unknown)=>{
  const value=z.string().uuid().safeParse(raw);
  if(!value.success)throw new PagePolicyError('PAGE_REQUEST_KEY_REQUIRED',400);
  return value.data;
};
export async function pagePostReplay(tx:PageTx,pageId:string,actorId:string,key:string) {
  const receipt=await tx.pageAuditEvent.findUnique({where:{id:key}});
  if(!receipt)return null;
  if(receipt.pageId!==pageId||receipt.actorId!==actorId||receipt.action!=='CONTENT_CREATED'||!receipt.targetId)throw new PagePolicyError('PAGE_REQUEST_KEY_CONFLICT',409);
  const post=await tx.post.findUnique({where:{id:receipt.targetId},include:{author:{select:{id:true,name:true,handle:true}},
    questions:{include:{options:{orderBy:{order:'asc'}}}},sections:{include:{questions:{include:{options:{orderBy:{order:'asc'}}}}}},
    media:POST_MEDIA_INCLUDE,targetedGroups:true}});
  if(!post||post.isDeleted||post.pageId!==pageId)throw new PagePolicyError('PAGE_REQUEST_ALREADY_COMPLETED',409);
  return post;
}

export async function recordPagePostCreation(tx:PageTx,pageId:string,actorId:string,key:string,postId:string) {
  await tx.pageAuditEvent.create({data:{id:key,pageId,actorId,action:'CONTENT_CREATED',targetId:postId}});
}
