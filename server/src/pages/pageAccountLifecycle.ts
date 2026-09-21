import { z } from 'zod';
import prisma from '../prisma';
import { PagePolicyError } from './pagePolicy';
import { lockPage, pageAudit, PageTx } from './pageService';
import { refreshPageSafety } from './pageTeamService';

export async function pageAccountDeletionImpact(userId: string) {
  return prisma.page.findMany({where:{ownerId:userId,purgedAt:null,deletionRequestedAt:null},
    orderBy:{id:'asc'},select:{id:true,name:true,handle:true}});
}

/** Called inside account deletion; the minimal anonymized User reference remains for ownership. */
export async function preparePageAccountDeletion(tx: PageTx, userId: string, confirmation: unknown) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const owned = await tx.page.findMany({where:{ownerId:userId,purgedAt:null,deletionRequestedAt:null},orderBy:{id:'asc'},select:{id:true}});
  const confirmed = z.array(z.string().uuid()).max(100).optional().parse(confirmation) || [];
  if (owned.some(page => !confirmed.includes(page.id))) throw new PagePolicyError('PAGE_ACCOUNT_DELETION_CHOICE_REQUIRED',409);
  for (const {id} of owned) {
    const page = await lockPage(tx,id);
    if(page.ownerId !== userId) throw new PagePolicyError('PAGE_ACCOUNT_DELETION_CHANGED',409);
    await tx.page.update({where:{id},data:{publicationState:'UNPUBLISHED',deletionRequestedAt:new Date()}});
    await pageAudit(tx,id,userId,'PAGE_ACCOUNT_DELETION_REQUESTED');
  }
  await tx.pageInvitation.updateMany({where:{status:'PENDING',OR:[{senderId:userId},{recipientId:userId}]},data:{status:'WITHDRAWN',decidedAt:new Date()}});
  await tx.pageOwnershipTransfer.updateMany({where:{status:'PENDING',OR:[{senderId:userId},{recipientId:userId}]},data:{status:'WITHDRAWN',decidedAt:new Date()}});
  const memberships=await tx.pageMembership.findMany({where:{userId},select:{pageId:true}});
  await tx.pageMembership.deleteMany({where:{userId}});
  const follows=await tx.pageFollow.findMany({where:{userId},select:{pageId:true}});
  await tx.pageFollow.deleteMany({where:{userId}});
  for(const follow of follows) await pageAudit(tx,follow.pageId,null,'FOLLOW_CHANGED',undefined,{delta:-1});
  await tx.pageBlock.deleteMany({where:{userId,direction:'USER_TO_PAGE'}});
  return memberships.map(member=>member.pageId);
}

export async function finishPageAccountDeletion(tx:PageTx,pageIds:string[]) {
  for (const pageId of [...new Set(pageIds)].sort()) {
    await lockPage(tx,pageId);
    await refreshPageSafety(tx,pageId);
  }
}
