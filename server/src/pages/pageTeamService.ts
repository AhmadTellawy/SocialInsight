import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PAGE_POLICY, PagePolicyError, PageRole, mayManagePageRole } from './pagePolicy';
import { pageHandleSchema } from './pageValidation';
import { activePageActor, enqueuePageEvent, lockPage, pageAudit, pageDaysFrom, pageIsBlocked,
  pageManagementDto, pageRole, pageTransaction, PageTx, requirePageCapability } from './pageService';

const inviteSchema = z.object({ recipientId: z.string().uuid(), role: z.enum(['ADMIN', 'EDITOR', 'ANALYST']) }).strict();
const reauthSchema = z.object({ password: z.string().min(1).max(1024), confirmHandle: z.string() });

async function revokeIneligibleInvitations(tx: PageTx, pageId: string, senderId: string, role: PageRole | null) {
  const roles = (['ADMIN','EDITOR','ANALYST'] as PageRole[]).filter(target => !role || !mayManagePageRole(role,target));
  await tx.pageInvitation.updateMany({where:{pageId,senderId,status:'PENDING',role:{in:roles}},data:{status:'WITHDRAWN',decidedAt:new Date()}});
}

export async function verifyPageReauthentication(tx: PageTx, userId: string, password: string): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true, password: true, status: true } });
  if (!user || user.status !== 'ACTIVE') throw new PagePolicyError('PAGE_REAUTH_REQUIRED', 401);
  const hash = user.passwordHash || user.password;
  if (!hash || !/^\$2[aby]\$/.test(hash)) throw new PagePolicyError('PAGE_PASSWORD_REAUTH_UNAVAILABLE', 409);
  if (!await bcrypt.compare(password, hash)) throw new PagePolicyError('PAGE_REAUTH_FAILED', 403);
}

async function assertTeamUnblocked(tx: PageTx, pageId: string, senderId: string, recipientId: string) {
  if (await pageIsBlocked(tx, pageId, senderId) || await pageIsBlocked(tx, pageId, recipientId) ||
      await tx.userBlock.findFirst({ where: { OR: [
        { blockerId: senderId, blockedId: recipientId }, { blockerId: recipientId, blockedId: senderId },
      ] }, select: { blockerId: true } })) throw new PagePolicyError('PAGE_INVITATION_UNAVAILABLE', 409);
}

export async function invitePageMember(pageId: string, actorId: string, raw: unknown) {
  const input = inviteSchema.parse(raw);
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, actorId);
    const actorRole = await requirePageCapability(tx, page, actorId, 'manageTeam');
    if (!mayManagePageRole(actorRole, input.role)) throw new PagePolicyError('PAGE_PERMISSION_DENIED', 403);
    if (page.deletionRequestedAt) throw new PagePolicyError('PAGE_DELETING', 409);
    await activePageActor(tx, input.recipientId);
    await assertTeamUnblocked(tx, pageId, actorId, input.recipientId);
    if (await pageRole(tx, page, input.recipientId)) throw new PagePolicyError('PAGE_ALREADY_ON_TEAM', 409);
    await tx.pageInvitation.updateMany({ where: { pageId, recipientId: input.recipientId, status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED', decidedAt: new Date() } });
    const existing = await tx.pageInvitation.findFirst({ where: { pageId, recipientId: input.recipientId, status: 'PENDING' } });
    if (existing) throw new PagePolicyError('PAGE_INVITATION_ALREADY_PENDING', 409);
    const invitation = await tx.pageInvitation.create({ data: { pageId, senderId: actorId, ...input,
      expiresAt: pageDaysFrom(PAGE_POLICY.invitationDays) } });
    await pageAudit(tx, pageId, actorId, 'MEMBER_INVITED', input.recipientId, { role: input.role });
    await enqueuePageEvent(tx, pageId, input.recipientId, 'PAGE_INVITATION', invitation.id, `${invitation.id}:invited`);
    return invitation;
  });
}

export async function respondPageInvitation(invitationId: string, actorId: string, action: 'accept' | 'reject' | 'withdraw') {
  return pageTransaction(async tx => {
    const initial = await tx.pageInvitation.findUnique({ where: { id: invitationId } });
    if (!initial) throw new PagePolicyError('PAGE_INVITATION_NOT_FOUND', 404);
    const page = await lockPage(tx, initial.pageId);
    await activePageActor(tx, actorId);
    const invitation = await tx.pageInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    if (action === 'withdraw') {
      const role = await requirePageCapability(tx, page, actorId, 'manageTeam');
      if (!mayManagePageRole(role, invitation.role as PageRole)) throw new PagePolicyError('PAGE_PERMISSION_DENIED', 403);
    } else if (invitation.recipientId !== actorId) throw new PagePolicyError('PAGE_INVITATION_NOT_FOUND', 404);
    if (invitation.status === 'WITHDRAWN') throw new PagePolicyError('PAGE_INVITATION_REVOKED',409);
    if (invitation.status !== 'PENDING' || invitation.expiresAt <= new Date()) throw new PagePolicyError('PAGE_INVITATION_EXPIRED', 409);
    if (action === 'accept') {
      if (page.deletionRequestedAt) throw new PagePolicyError('PAGE_DELETING', 409);
      const senderRole = await pageRole(tx, page, invitation.senderId);
      if (!senderRole || !mayManagePageRole(senderRole, invitation.role as PageRole)) throw new PagePolicyError('PAGE_INVITATION_REVOKED', 409);
      await activePageActor(tx, invitation.senderId);
      await assertTeamUnblocked(tx, page.id, invitation.senderId, actorId);
      if (await pageRole(tx, page, actorId)) throw new PagePolicyError('PAGE_ALREADY_ON_TEAM', 409);
      await tx.pageMembership.create({ data: { pageId: page.id, userId: actorId, role: invitation.role } });
      await refreshPageSafety(tx, page.id);
    }
    const status = { accept: 'ACCEPTED', reject: 'REJECTED', withdraw: 'WITHDRAWN' }[action];
    await tx.pageInvitation.update({ where: { id: invitationId }, data: { status, decidedAt: new Date() } });
    await pageAudit(tx, page.id, actorId, `INVITATION_${status}`, invitationId);
    await enqueuePageEvent(tx, page.id, action === 'withdraw' ? invitation.recipientId : invitation.senderId,
      `PAGE_INVITATION_${status}`, invitationId, `${invitationId}:${status}`);
    return { status, pageId: page.id };
  });
}

export async function changePageMember(pageId: string, actorId: string, userId: string, role: 'ADMIN' | 'EDITOR' | 'ANALYST' | null) {
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, actorId);
    const actorRole = await requirePageCapability(tx, page, actorId, 'manageTeam');
    const targetRole = await pageRole(tx, page, userId);
    // Use persisted role for inactive members as well; suspension does not make an admin demotable by another admin.
    const membership = await tx.pageMembership.findUnique({ where: { pageId_userId: { pageId, userId } } });
    const existingRole = page.ownerId === userId ? 'OWNER' : targetRole || membership?.role as PageRole | undefined;
    if (!existingRole || !mayManagePageRole(actorRole, existingRole) || (role && !mayManagePageRole(actorRole, role))) {
      throw new PagePolicyError('PAGE_PERMISSION_DENIED', 403);
    }
    if (role) await tx.pageMembership.update({ where: { pageId_userId: { pageId, userId } }, data: { role } });
    else await tx.pageMembership.delete({ where: { pageId_userId: { pageId, userId } } });
    await revokeIneligibleInvitations(tx,pageId,userId,role);
    await tx.pageOwnershipTransfer.updateMany({ where: { pageId, recipientId: userId, status: 'PENDING' }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
    const audit = await pageAudit(tx, pageId, actorId, role ? 'MEMBER_ROLE_CHANGED' : 'MEMBER_REMOVED', userId, { role });
    await enqueuePageEvent(tx, pageId, userId, role ? 'PAGE_ROLE_CHANGED' : 'PAGE_ROLE_REVOKED', pageId, audit.id);
    await refreshPageSafety(tx, pageId);
    return { userId, role };
  });
}

export async function leavePageTeam(pageId: string, actorId: string) {
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, actorId);
    if (page.ownerId === actorId) throw new PagePolicyError('PAGE_OWNER_MUST_TRANSFER', 409);
    const membershipKey = { pageId_userId: { pageId, userId: actorId } };
    // The Page lock serializes departure with team changes; only a current member may leave.
    const membership = await tx.pageMembership.findUnique({ where: membershipKey, select: { userId: true } });
    if (!membership) throw new PagePolicyError('PAGE_PERMISSION_DENIED', 403);
    await tx.pageMembership.delete({ where: membershipKey });
    await revokeIneligibleInvitations(tx,pageId,actorId,null);
    await tx.pageOwnershipTransfer.updateMany({ where: { pageId, recipientId: actorId, status: 'PENDING' }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
    await pageAudit(tx, pageId, actorId, 'MEMBER_LEFT');
    await refreshPageSafety(tx, pageId);
    return { left: true };
  });
}

export async function refreshPageSafety(tx: PageTx, pageId: string) {
  const page = await tx.page.findUniqueOrThrow({ where: { id: pageId }, include: { owner: { select: { status: true } } } });
  const eligible = page.owner.status === 'ACTIVE' || !!await tx.pageMembership.findFirst({
    where: { pageId, role: { in: ['ADMIN', 'EDITOR'] }, user: { status: 'ACTIVE' } }, select: { userId: true },
  });
  if (!eligible && !page.safetyHiddenAt) {
    await tx.page.update({ where: { id: pageId }, data: { safetyHiddenAt: new Date() } });
    await pageAudit(tx, pageId, null, 'PAGE_SAFETY_HIDDEN');
  }
  if (eligible && page.safetyHiddenAt) {
    // Clear only the independent lack-of-team constraint, never publication/platform/deletion state.
    await tx.page.update({where:{id:pageId},data:{safetyHiddenAt:null}});
    await pageAudit(tx,pageId,null,'PAGE_SAFETY_RESTORED');
  }
}

export async function startPageTransfer(pageId: string, actorId: string, raw: unknown) {
  const input = reauthSchema.extend({ recipientId: z.string().uuid() }).strict().parse(raw);
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, actorId, true);
    await requirePageCapability(tx, page, actorId, 'ownership');
    if (input.confirmHandle !== page.handle) throw new PagePolicyError('PAGE_CONFIRMATION_MISMATCH');
    await verifyPageReauthentication(tx, actorId, input.password);
    await activePageActor(tx, input.recipientId, true);
    if (input.recipientId === actorId || !await pageRole(tx, page, input.recipientId)) throw new PagePolicyError('PAGE_TRANSFER_TEAM_MEMBER_REQUIRED', 409);
    await assertTeamUnblocked(tx, pageId, actorId, input.recipientId);
    if (page.deletionRequestedAt) throw new PagePolicyError('PAGE_DELETING', 409);
    await tx.pageOwnershipTransfer.updateMany({ where: { pageId, status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED', decidedAt: new Date() } });
    if (await tx.pageOwnershipTransfer.findFirst({ where: { pageId, status: 'PENDING' } })) throw new PagePolicyError('PAGE_TRANSFER_ALREADY_PENDING', 409);
    const transfer = await tx.pageOwnershipTransfer.create({ data: { pageId, senderId: actorId,
      recipientId: input.recipientId, expiresAt: pageDaysFrom(PAGE_POLICY.transferDays) } });
    await pageAudit(tx, pageId, actorId, 'OWNERSHIP_TRANSFER_REQUESTED', input.recipientId);
    await enqueuePageEvent(tx, pageId, input.recipientId, 'PAGE_TRANSFER', transfer.id, `${transfer.id}:requested`);
    return { id: transfer.id, expiresAt: transfer.expiresAt, recipientId: transfer.recipientId };
  });
}

export async function respondPageTransfer(transferId: string, actorId: string, action: 'accept' | 'reject' | 'withdraw') {
  return pageTransaction(async tx => {
    const initial = await tx.pageOwnershipTransfer.findUnique({ where: { id: transferId } });
    if (!initial) throw new PagePolicyError('PAGE_TRANSFER_NOT_FOUND', 404);
    const page = await lockPage(tx, initial.pageId);
    await activePageActor(tx, actorId, true);
    const transfer = await tx.pageOwnershipTransfer.findUniqueOrThrow({ where: { id: transferId } });
    if ((action === 'withdraw' && actorId !== page.ownerId) ||
        (action !== 'withdraw' && transfer.recipientId !== actorId)) throw new PagePolicyError('PAGE_TRANSFER_NOT_FOUND', 404);
    if (transfer.status !== 'PENDING' || transfer.expiresAt <= new Date()) throw new PagePolicyError('PAGE_TRANSFER_EXPIRED', 409);
    if (action === 'accept') {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
      if (await tx.page.count({where:{ownerId:actorId,purgedAt:null}}) >= PAGE_POLICY.ownedPageLimit) throw new PagePolicyError('PAGE_OWNED_LIMIT',409);
      if (page.ownerId !== transfer.senderId || page.deletionRequestedAt) throw new PagePolicyError('PAGE_TRANSFER_REVOKED', 409);
      await activePageActor(tx, transfer.senderId, true);
      await assertTeamUnblocked(tx, page.id, transfer.senderId, actorId);
      if (!await pageRole(tx, page, actorId)) throw new PagePolicyError('PAGE_TRANSFER_TEAM_MEMBER_REQUIRED', 409);
      // A single owner reference changes atomically; no OWNER membership exists.
      await tx.pageMembership.delete({ where: { pageId_userId: { pageId: page.id, userId: actorId } } });
      await tx.page.update({ where: { id: page.id }, data: { ownerId: actorId } });
      await tx.pageMembership.upsert({ where: { pageId_userId: { pageId: page.id, userId: transfer.senderId } },
        update: { role: 'ADMIN' }, create: { pageId: page.id, userId: transfer.senderId, role: 'ADMIN' } });
      await revokeIneligibleInvitations(tx,page.id,transfer.senderId,'ADMIN');
    }
    const status = { accept: 'ACCEPTED', reject: 'REJECTED', withdraw: 'WITHDRAWN' }[action];
    await tx.pageOwnershipTransfer.update({ where: { id: transferId }, data: { status, decidedAt: new Date() } });
    await pageAudit(tx, page.id, actorId, `OWNERSHIP_TRANSFER_${status}`, transferId);
    for (const recipientId of new Set([transfer.senderId, transfer.recipientId])) {
      await enqueuePageEvent(tx, page.id, recipientId, `PAGE_TRANSFER_${status}`, page.id, `${transferId}:${status}:${recipientId}`);
    }
    return { status, pageId: page.id };
  });
}

export async function changePageHandle(pageId: string, actorId: string, raw: unknown) {
  const input = reauthSchema.extend({ handle: pageHandleSchema }).strict().parse(raw);
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, actorId);
    await requirePageCapability(tx, page, actorId, 'changeHandle');
    if (input.confirmHandle !== page.handle) throw new PagePolicyError('PAGE_CONFIRMATION_MISMATCH');
    await verifyPageReauthentication(tx, actorId, input.password);
    if (input.handle === page.handle) return pageManagementDto(page, 'OWNER');
    if (page.lastHandleChangedAt && pageDaysFrom(PAGE_POLICY.handleChangeDays, page.lastHandleChangedAt) > new Date()) {
      throw new PagePolicyError('PAGE_HANDLE_CHANGE_TOO_SOON', 409);
    }
    const reserved = await tx.pageHandle.findUnique({ where: { handle: input.handle } });
    if (reserved && reserved.pageId !== pageId) throw new PagePolicyError('PAGE_HANDLE_TAKEN', 409);
    if (!reserved) await tx.pageHandle.create({ data: { handle: input.handle, pageId } });
    const updated = await tx.page.update({ where: { id: pageId }, data: { handle: input.handle, lastHandleChangedAt: new Date() } });
    await pageAudit(tx, pageId, actorId, 'PAGE_HANDLE_CHANGED', undefined, { previous: page.handle, current: input.handle });
    return pageManagementDto(updated, 'OWNER');
  });
}
