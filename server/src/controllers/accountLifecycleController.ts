import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { once } from 'events';
import { randomUUID } from 'node:crypto';
import { purgeAccount } from '../services/accountErasureService';
import prisma from '../prisma';
import { clearSessionCookies, notifyUserSessionsRevoked } from '../services/sessionService';
import { resumeMediaPrivacyTransitions } from '../services/mediaPrivacyTransitionService';
import { resumeAccountCleanupJobs } from '../services/accountCleanupService';
import { GROUP_ROLES } from '../utils/constants';
import { AccountSecurityError, lockAccountSecurity } from '../services/mfaService';
import { assertActiveAccountSession } from '../services/accountSecurityPolicy';
import { readNotificationSettings } from '../services/notificationPolicy';
import { assertOtherActiveOwner, GroupOwnershipError, lockGroupRow } from '../services/groupOwnershipService';

class LifecycleError extends Error { constructor(public code: string, public status = 409) { super(code); } }
async function lockAccount(tx: Prisma.TransactionClient, req: Request) {
  const id = req.user!.userId;
  await lockAccountSecurity(tx, id);
  await assertActiveAccountSession(tx, req);
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id } });
  const session = req.authSession && await tx.authSession.findFirst({ where: { id: req.authSession.id, userId: id, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (!user || user.status !== 'ACTIVE' || !session) throw new LifecycleError('AUTH_REQUIRED', 401);
  // Keep every group operable. Group owners can explicitly transfer or delete
  // their group before leaving; this action never silently appoints an owner.
  const groups = await tx.groupMember.findMany({ where: { userId: id, role: GROUP_ROLES.OWNER, status: 'JOINED', group: { isDeleted: false } }, select: { groupId: true } });
  for (const group of groups.sort((a,b) => a.groupId.localeCompare(b.groupId))) {
    await lockGroupRow(tx, group.groupId);
    const currentGroup = await tx.group.findUnique({ where: { id: group.groupId }, select: { isDeleted: true } });
    if (currentGroup && !currentGroup.isDeleted) await assertOtherActiveOwner(tx, group.groupId, id);
  }
  return user;
}
function failure(res: Response, error: unknown) {
  if (error instanceof AccountSecurityError) return res.status(error.status).json({code:error.code,error:'Sign in again to continue.'});
  if (error instanceof GroupOwnershipError) return res.status(error.status).json({code:error.code,error:'Transfer ownership or delete groups where you are the only active owner first.'});
  if (error instanceof LifecycleError) return res.status(error.status).json({ code: error.code, error: error.code === 'GROUP_OWNERSHIP_REQUIRED' ? 'Transfer ownership or delete groups where you are the only active owner first.' : 'Sign in again to continue.' });
  if ((error as any)?.code === 'P2034' || ((error as any)?.code === 'P2010' && ['40P01', '40001'].includes((error as any)?.meta?.code))) return res.status(409).json({ code: 'ACCOUNT_CONFLICT', error: 'Your account changed. Refresh and retry.' });
  console.error(JSON.stringify({ event: 'account_lifecycle_failed', error: error instanceof Error ? error.name : 'unknown' }));
  return res.status(503).json({ code: 'ACCOUNT_UNAVAILABLE', error: 'Account action could not be completed. Try again.' });
}

export async function deactivateAccount(req: Request, res: Response) {
  try {
    await prisma.$transaction(async tx => {
      const user = await lockAccount(tx, req), now = new Date();
      if (user.mediaPrivacyTarget !== null) throw new LifecycleError('PRIVACY_TRANSITION_PENDING');
      await tx.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED', deactivatedAt: now, authInvalidatedAt: now, mediaPrivacyTarget: true } });
      await tx.mediaPrivacyTransition.create({ data: { userId: user.id, targetIsPrivate: true } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.authChallenge.deleteMany({ where: { userId: user.id } });
      await tx.oAuthState.deleteMany({ where: { linkingUserId: user.id } });
      await tx.pushSubscription.deleteMany({ where: { userId: user.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
    notifyUserSessionsRevoked(req.user!.userId); clearSessionCookies(res);
    // Durable transition remains retryable even if storage is temporarily down.
    void resumeMediaPrivacyTransitions().catch(() => {});
    res.set('Cache-Control', 'private, no-store').json({ success: true, mediaCleanupPending: true });
  } catch (error) { failure(res, error); }
}

export async function deleteAccount(req: Request, res: Response) {
  const decisionId = randomUUID();
  try {
    await prisma.$transaction(async tx => {
      const user = await lockAccount(tx, req);
      await purgeAccount(tx, user.id, { decisionId });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    notifyUserSessionsRevoked(req.user!.userId); clearSessionCookies(res);
    void resumeAccountCleanupJobs().catch(() => {});
    res.set('Cache-Control', 'private, no-store').json({ success: true, mediaCleanupPending: true });
  } catch (error) { failure(res, error); }
}

// Stream only explicitly selected owner records, in bounded pages. No session
// secrets, provider identifiers, IPs or other participants' answers are exported.
export async function exportAccount(req: Request, res: Response) {
  const id = req.user!.userId;
  try {
    const profile = await prisma.user.findUnique({ where: { id }, select: { name: true, handle: true, email: true, phone: true, birthday: true, bio: true, country: true, location: true, website: true, language: true, theme: true, isPrivate: true, groupPrivacy: true, searchVisibility: true, allowSharing: true, groupInvites: true, createdAt: true, demographics: true, profileLinks: { select: { title: true, url: true, sortOrder: true } } } });
    if (!profile) return res.status(404).json({ error: 'Account not found' });
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="opiniup-account.json"', 'X-Content-Type-Options': 'nosniff' });
    const write = async (value: string) => { if (res.destroyed) throw new Error('Client closed'); if (!res.write(value)) await once(res, 'drain'); };
    await write(JSON.stringify({ formatVersion: 1, exportedAt: new Date().toISOString(), profile }).slice(0,-1));
    const ownedQuestion = { OR: [{ post: { authorId: id } }, { section: { post: { authorId: id } } }] };
    const datasets: Array<[string, any, any, string?]> = [
      ['handleHistory', prisma.handleAlias, { where: { userId: id }, select: { handle: true, createdAt: true } }, 'handle'],
      ['pendingSecurityNotifications', prisma.securityEmailOutbox, { where: { userId: id }, select: { id: true, recipient: true, kind: true, createdAt: true } }],
      ['posts', prisma.post, { where: { authorId: id }, select: {
        id: true, title: true, description: true, type: true, status: true, createdAt: true, updatedAt: true, expiresAt: true,
        category: true, targetAudience: true, groupId: true, targetedGroups: { select: { id: true } },
        pollChoiceType: true, optionPresentation: true, showOptionNames: true, sharedFromId: true, sharedCaption: true,
        demographics: true, allowAnonymous: true, forceAnonymous: true, allowComments: true, allowMultipleSelection: true,
        allowUserOptions: true, randomPairing: true, resultsWho: true, resultsDetail: true, resultsTiming: true, isDeleted: true
      } }],
      // Export the authored questionnaire as separate bounded datasets; never
      // include other participants' response rows, device IDs or vote records.
      ['sections', prisma.section, { where: { post: { authorId: id } }, select: { id: true, postId: true, title: true, order: true } }],
      ['questions', prisma.question, { where: ownedQuestion, select: { id: true, postId: true, sectionId: true, text: true, type: true, order: true, isRequired: true, imageMediaId: true, optionPresentation: true, showOptionNames: true } }],
      ['options', prisma.option, { where: { question: ownedQuestion }, select: { id: true, questionId: true, text: true, order: true, isCorrect: true, isRating: true, ratingValue: true, imageMediaId: true, withFollowUp: true, followUpLabel: true, isUserAdded: true } }],
      ['contributedOptions', prisma.option, { where: { addedByUserId: id, isUserAdded: true }, select: { id: true, questionId: true, text: true, order: true, imageMediaId: true } }],
      ['postMedia', prisma.postMedia, { where: { post: { authorId: id } }, select: { id: true, postId: true, mediaAssetId: true, sortOrder: true } }],
      ['media', prisma.mediaAsset, { where: { ownerId: id }, select: { id: true, purpose: true, status: true, sourceMime: true, sourceWidth: true, sourceHeight: true, aspectRatio: true, altText: true, createdAt: true } }],
      ['comments', prisma.comment, { where: { userId: id }, select: { id: true, postId: true, text: true, createdAt: true } }],
      ['responses', prisma.response, { where: { userId: id }, select: { id: true, postId: true, timestamp: true, isAnonymous: true, answers: { select: { questionId: true, optionId: true, textValue: true } } } }],
      ['follows', prisma.follow, { where: { followerId: id }, select: { id: true, followingId: true, status: true, createdAt: true } }],
      ['groups', prisma.groupMember, { where: { userId: id }, select: { id: true, groupId: true, role: true, status: true } }],
      ['blocks', prisma.userBlock, { where: { blockerId: id }, select: { id: true, blockedId: true, createdAt: true } }]
    ];
    for (const [key, model, query, cursorKey = 'id'] of datasets) {
      await write(`,${JSON.stringify(key)}:[`); let cursor: string | undefined, first = true;
      do {
        const rows = await model.findMany({ ...query, take: 250, orderBy: { [cursorKey]: 'asc' }, ...(cursor ? { cursor: { [cursorKey]: cursor }, skip: 1 } : {}) });
        for (const row of rows) { await write(`${first ? '' : ','}${JSON.stringify(row)}`); first = false; }
        cursor = rows.length === 250 ? rows[rows.length-1][cursorKey] : undefined;
      } while (cursor && !res.destroyed);
      await write(']');
    }
    const notificationSettings = await prisma.notificationSettings.findUnique({ where: { userId: id }, select: { settings: true } });
    await write(`,"notificationSettings":${JSON.stringify(readNotificationSettings(notificationSettings?.settings))}}`); res.end();
  } catch (error) { if (res.headersSent) res.destroy(); else failure(res, error); }
}
