import { z } from 'zod';
import prisma from '../prisma';
import { PagePolicyError, PAGE_POLICY } from './pagePolicy';
import { activePageActor, assertPagePublic, enqueuePageEvent, lockPage, pageAudit, pageRole, pageTransaction, PageTx } from './pageService';
import { verifyPageReauthentication } from './pageTeamService';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';

const ids=(name:string)=>new Set((process.env[name]||'').split(',').map(value=>value.trim()).filter(Boolean));
export const isPageStaff=(id:string,ownership=false)=>ids(ownership?'PAGES_STAFF_OWNERSHIP':'PAGES_STAFF_REVIEWERS').has(id);
export async function requirePageStaff(tx:PageTx,id:string,ownership=false){
  if(!isPageStaff(id,ownership))throw new PagePolicyError('PAGE_STAFF_PERMISSION_DENIED',403);
  await activePageActor(tx,id,true);
}
const caseInput=z.object({kind:z.enum(['REPORT','OWNERSHIP','APPEAL']),reason:z.string().trim().min(3).max(120),detail:z.string().trim().min(10).max(3000),
  postId:z.string().uuid().optional(),parentId:z.string().uuid().optional()}).strict();
export const reporterCaseDto=(value:any)=>({id:value.id,pageId:value.pageId,kind:value.kind,reason:value.reason,detail:value.detail,
  status:value.status,decision:value.decision,decisionReason:value.decisionReason,parentId:value.parentId,createdAt:value.createdAt,closedAt:value.closedAt});
export const managerCaseDto=(value:any)=>({id:value.id,pageId:value.pageId,postId:value.postId,status:value.status,decision:value.decision,
  decisionReason:value.decisionReason,createdAt:value.createdAt,closedAt:value.closedAt});

export async function openPageCase(pageId:string,actorId:string,raw:unknown){
  const input=caseInput.parse(raw);
  return pageTransaction(async tx=>{
    const page=await lockPage(tx,pageId);await activePageActor(tx,actorId);
    if(input.kind==='REPORT')await assertPagePublic(tx,page,actorId);
    let postId=input.postId;
    if(input.kind==='APPEAL'){
      const original=input.parentId?await tx.pageCase.findUnique({where:{id:input.parentId}}):null;
      if(!original||original.pageId!==pageId||original.status!=='CLOSED'||(page.ownerId!==actorId&&original.reporterId!==actorId))throw new PagePolicyError('PAGE_APPEAL_UNAVAILABLE',403);
      if(input.postId!==undefined&&input.postId!==original.postId)throw new PagePolicyError('PAGE_APPEAL_UNAVAILABLE',403);
      // The authorized decision owns the appeal target, including a moderated hidden post.
      postId=original.postId||undefined;
      if(postId&&!await tx.post.count({where:{id:postId,pageId}}))throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
    }else if(input.parentId)throw new PagePolicyError('PAGE_INVALID_CASE');
    else if(postId&&!await tx.post.count({where:{id:postId,pageId,...buildVisiblePublishedPostWhere(actorId)}}))throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
    const duplicate=await tx.pageCase.findFirst({where:{pageId,reporterId:actorId,postId:postId||null,kind:input.kind,status:{in:['OPEN','IN_REVIEW']}}});
    if(duplicate)return {...reporterCaseDto(duplicate),alreadyReported:true};
    const result=await tx.pageCase.create({data:{...input,postId:postId||null,pageId,reporterId:actorId}});
    await pageAudit(tx,pageId,actorId,'CASE_OPENED',result.id,{kind:input.kind});
    return {...reporterCaseDto(result),alreadyReported:false};
  });
}

const decisionInput=z.object({action:z.enum(['DISMISS','RESTRICT','SUSPEND','RESTORE','HIDE_POST','RESTORE_POST','OWNERSHIP_TRANSFER','CANCEL_DELETION','LEGAL_HOLD']),
  reason:z.string().trim().min(10).max(2000),recipientId:z.string().uuid().optional(),password:z.string().max(1024).optional(),
  verificationConfirmed:z.boolean().optional(),evidence:z.string().trim().max(3000).optional(),holdUntil:z.string().datetime().optional()}).strict();

export async function decidePageCase(caseId:string,actorId:string,raw:unknown){
  const input=decisionInput.parse(raw);
  return pageTransaction(async tx=>{
    await requirePageStaff(tx,actorId);
    const initial=await tx.pageCase.findUnique({where:{id:caseId}});if(!initial)throw new PagePolicyError('PAGE_CASE_NOT_FOUND',404);
    const page=await lockPage(tx,initial.pageId);
    const current=await tx.pageCase.findUniqueOrThrow({where:{id:caseId}});
    if(current.status==='CLOSED')throw new PagePolicyError('PAGE_CASE_ALREADY_CLOSED',409);
    if(current.assigneeId&&current.assigneeId!==actorId)throw new PagePolicyError('PAGE_CASE_ASSIGNED_ELSEWHERE',409);
    if(input.action==='OWNERSHIP_TRANSFER'||input.action==='CANCEL_DELETION'){
      await requirePageStaff(tx,actorId,true);
      await verifyPageReauthentication(tx,actorId,input.password||'');
      if(!input.verificationConfirmed||!input.evidence||input.evidence.length<20)throw new PagePolicyError('PAGE_OWNERSHIP_EVIDENCE_REQUIRED',400);
      if(input.action==='OWNERSHIP_TRANSFER'){
        const recipient=input.recipientId;if(!recipient)throw new PagePolicyError('PAGE_INVALID_RECIPIENT');
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${recipient} FOR UPDATE`;
        await activePageActor(tx,recipient,true);
        if(await tx.pageBlock.count({where:{pageId:page.id,userId:recipient}}))throw new PagePolicyError('PAGE_INVITATION_UNAVAILABLE',409);
        if(recipient!==page.ownerId&&await tx.page.count({where:{ownerId:recipient,purgedAt:null}})>=PAGE_POLICY.ownedPageLimit)throw new PagePolicyError('PAGE_OWNED_LIMIT',409);
        await tx.pageMembership.deleteMany({where:{pageId:page.id,userId:recipient}});
        await tx.page.update({where:{id:page.id},data:{ownerId:recipient,safetyHiddenAt:null}});
        if(recipient!==page.ownerId){
          const previous=await tx.user.findUnique({where:{id:page.ownerId},select:{status:true}});
          if(previous?.status==='ACTIVE')await tx.pageMembership.upsert({where:{pageId_userId:{pageId:page.id,userId:page.ownerId}},update:{role:'ADMIN'},create:{pageId:page.id,userId:page.ownerId,role:'ADMIN'}});
        }
        await tx.pageOwnershipTransfer.updateMany({where:{pageId:page.id,status:'PENDING'},data:{status:'WITHDRAWN',decidedAt:new Date()}});
        await enqueuePageEvent(tx,page.id,recipient,'PAGE_TRANSFER_ACCEPTED',page.id,caseId+':owner:'+recipient);
      }else{
        if(!page.deletionRequestedAt||Date.now()-page.deletionRequestedAt.getTime()>=PAGE_POLICY.deletionGraceDays*86400000)throw new PagePolicyError('PAGE_DELETION_GRACE_ENDED',409);
        await tx.page.update({where:{id:page.id},data:{deletionRequestedAt:null,publicationState:'UNPUBLISHED'}});
      }
    }else if(['RESTRICT','SUSPEND','RESTORE'].includes(input.action)){
      await tx.page.update({where:{id:page.id},data:{platformState:input.action==='RESTRICT'?'RESTRICTED':input.action==='SUSPEND'?'SUSPENDED':'NONE'}});
    }else if(input.action==='HIDE_POST'||input.action==='RESTORE_POST'){
      if(!current.postId||!await tx.post.count({where:{id:current.postId,pageId:page.id}}))throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);
      await tx.post.update({where:{id:current.postId},data:{isDeleted:input.action==='HIDE_POST'}});
    }else if(input.action==='LEGAL_HOLD'){
      await requirePageStaff(tx,actorId,true);
      const until=input.holdUntil?new Date(input.holdUntil):null;
      if(!until||until<=new Date()||until.getTime()>Date.now()+365*86400000)throw new PagePolicyError('PAGE_INVALID_HOLD');
      await tx.page.update({where:{id:page.id},data:{legalHoldUntil:until,legalHoldReason:input.reason}});
      await tx.pageCase.update({where:{id:caseId},data:{legalHoldUntil:until,legalHoldReason:input.reason}});
    }
    const decided=await tx.pageCase.update({where:{id:caseId},data:{status:'CLOSED',assigneeId:actorId,decision:input.action,
      decisionReason:input.reason,closedAt:new Date(),...(input.evidence?{evidence:[{text:input.evidence,actorId,at:new Date().toISOString()}]}:{})}});
    await pageAudit(tx,page.id,actorId,'STAFF_CASE_DECIDED',caseId,{action:input.action,reason:input.reason});
    for(const recipient of new Set([current.reporterId,page.ownerId]))await enqueuePageEvent(tx,page.id,recipient,'PAGE_CASE_DECIDED',caseId,caseId+':decision:'+recipient);
    return decided;
  });
}
