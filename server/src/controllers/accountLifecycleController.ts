import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { once } from 'events';
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
  try {
    await prisma.$transaction(async tx => {
      const user = await lockAccount(tx, req), id = user.id, now = new Date();
      const media = await tx.mediaAsset.findMany({ where: { ownerId: id, status: { not: 'DELETED' } }, select: { id: true } });
      await tx.accountCleanupJob.upsert({ where: { userId: id }, create: { userId: id, mediaIds: media.map(m => m.id) }, update: { mediaIds: media.map(m => m.id), completedAt: null } });
      await tx.mediaAsset.updateMany({ where: { ownerId: id }, data: { altText: null, checksum: null, moderationMetadata: Prisma.DbNull, errorCode: null } });
      await tx.mediaAsset.updateMany({ where: { ownerId: id, status: { not: 'DELETED' } }, data: { status: 'PENDING_DELETE' } });
      // Only published contributions are retained. Remove the complete private
      // questionnaire graph, including rows protected by restrictive foreign keys.
      const unpublished = await tx.post.findMany({ where: { authorId: id, status: { not: 'PUBLISHED' } }, select: { id: true } });
      const unpublishedIds = unpublished.map(post => post.id);
      if (unpublishedIds.length) {
        const ownedQuestion = { OR: [{ postId: { in: unpublishedIds } }, { section: { postId: { in: unpublishedIds } } }] };
        const privateComments = await tx.comment.findMany({ where: { postId: { in: unpublishedIds } }, select: { id: true } });
        await tx.answer.deleteMany({ where: { OR: [{ response: { postId: { in: unpublishedIds } } }, { question: ownedQuestion }] } });
        await tx.response.deleteMany({ where: { postId: { in: unpublishedIds } } });
        await tx.option.deleteMany({ where: { question: ownedQuestion } });
        await tx.question.deleteMany({ where: ownedQuestion });
        await tx.section.deleteMany({ where: { postId: { in: unpublishedIds } } });
        await tx.commentLike.deleteMany({ where: { comment: { postId: { in: unpublishedIds } } } });
        await tx.comment.updateMany({ where: { parentId: { in: privateComments.map(comment => comment.id) }, postId: { notIn: unpublishedIds } }, data: { parentId: null } });
        await tx.comment.deleteMany({ where: { postId: { in: unpublishedIds } } });
        await tx.userLike.deleteMany({ where: { postId: { in: unpublishedIds } } });
        await tx.savedPost.deleteMany({ where: { postId: { in: unpublishedIds } } });
        await tx.hiddenPost.deleteMany({ where: { postId: { in: unpublishedIds } } });
        await tx.post.updateMany({ where: { sharedFromId: { in: unpublishedIds } }, data: { sharedFromId: null } });
        await tx.post.deleteMany({ where: { id: { in: unpublishedIds } } });
      }
      // Clearing the profile itself also removes the parsed copies of its text.
      await tx.mention.deleteMany({ where: { profileUserId: id } });
      await tx.mediaPrivacyTransition.deleteMany({ where: { userId: id } });
      await tx.authSession.deleteMany({ where: { userId: id } });
      await tx.authChallenge.deleteMany({ where: { userId: id } });
      await tx.userMfa.deleteMany({ where: { userId: id } });
      await tx.oAuthAccount.deleteMany({ where: { userId: id } });
      await tx.oAuthState.deleteMany({ where: { linkingUserId: id } });
      await tx.otpChallenge.deleteMany({ where: { OR: [{ subject: id }, ...(user.email ? [{ destination: user.email }] : [])] } });
      const identifiers = [user.email, user.phone].filter((value): value is string => !!value);
      if (identifiers.length) await tx.oTPCode.deleteMany({ where: { identifier: { in: identifiers } } });
      if (user.email) await tx.pendingRegistration.deleteMany({ where: { email: user.email } });
      await tx.pushSubscription.deleteMany({ where: { userId: id } });
      await tx.userDemographics.deleteMany({ where: { userId: id } });
      await tx.profileLink.deleteMany({ where: { userId: id } });
      const follows = await tx.follow.findMany({ where: { OR: [{ followerId: id }, { followingId: id }] } });
      await tx.follow.deleteMany({ where: { OR: [{ followerId: id }, { followingId: id }] } });
      for (const follow of follows.filter(f => f.status === 'ACTIVE')) {
        if (follow.followerId !== id) await tx.user.updateMany({ where: { id: follow.followerId, followingCount: { gt: 0 } }, data: { followingCount: { decrement: 1 } } });
        if (follow.followingId !== id) await tx.user.updateMany({ where: { id: follow.followingId, followersCount: { gt: 0 } }, data: { followersCount: { decrement: 1 } } });
      }
      const likes = await tx.userLike.findMany({ where: { userId: id }, select: { postId: true } });
      const commentLikes = await tx.commentLike.findMany({ where: { userId: id }, select: { commentId: true } });
      await tx.userLike.deleteMany({ where: { userId: id } });
      await tx.commentLike.deleteMany({ where: { userId: id } });
      for (const like of likes) await tx.post.updateMany({ where: { id: like.postId, likesCount: { gt: 0 } }, data: { likesCount: { decrement: 1 } } });
      for (const like of commentLikes) await tx.comment.updateMany({ where: { id: like.commentId, likes: { gt: 0 } }, data: { likes: { decrement: 1 } } });
      await tx.savedPost.deleteMany({ where: { userId: id } });
      await tx.hiddenPost.deleteMany({ where: { userId: id } });
      await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: id }, { blockedId: id }] } });
      await tx.notification.deleteMany({ where: { OR: [{ userId: id }, { actorId: id }] } });
      await tx.notificationSettings.deleteMany({ where: { userId: id } });
      const memberships = await tx.groupMember.findMany({ where: { userId: id }, select: { groupId: true } });
      await tx.groupMember.deleteMany({ where: { userId: id } });
      for (const member of memberships) await tx.group.update({ where: { id: member.groupId }, data: { memberCount: await tx.groupMember.count({ where: { groupId: member.groupId, status: 'JOINED' } }) } });
      await tx.response.updateMany({ where: { userId: id }, data: { userId: null, guestId: null, guestProofHash: null, guestProofExpiresAt: null, ipAddress: null, isAnonymous: true } });
      await tx.interactionEvent.deleteMany({ where: { OR: [{ actor_user_id: id }, { target_user_id: id }] } });
      await tx.postView.deleteMany({ where: { viewerKey: `user:${id}` } });
      await tx.user.update({ where: { id }, data: {
        status: 'DELETED', deletedAt: now, deactivatedAt: null, authInvalidatedAt: now, name: 'Deleted account', handle: `deleted_${id}`,
        email: null, phone: null, password: null, passwordHash: null, passwordUpdatedAt: null, emailVerifiedAt: null,
        avatar: null, avatarMediaId: null, coverMediaId: null, bio: null, location: null, website: null, birthday: null,
        language: null, country: null, authProvider: null, verifiedBadge: false, followersCount: 0, followingCount: 0,
        searchVisibility: false, allowSharing: false, groupInvites: false, groupPrivacy: 'Off', mediaPrivacyTarget: true
      } });
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
    const datasets: Array<[string, any, any]> = [
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
    for (const [key, model, query] of datasets) {
      await write(`,${JSON.stringify(key)}:[`); let cursor: string | undefined, first = true;
      do {
        const rows = await model.findMany({ ...query, take: 250, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        for (const row of rows) { await write(`${first ? '' : ','}${JSON.stringify(row)}`); first = false; }
        cursor = rows.length === 250 ? rows[rows.length-1].id : undefined;
      } while (cursor && !res.destroyed);
      await write(']');
    }
    const notificationSettings = await prisma.notificationSettings.findUnique({ where: { userId: id }, select: { settings: true } });
    await write(`,"notificationSettings":${JSON.stringify(readNotificationSettings(notificationSettings?.settings))}}`); res.end();
  } catch (error) { if (res.headersSent) res.destroy(); else failure(res, error); }
}
