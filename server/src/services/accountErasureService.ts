import { Prisma } from '@prisma/client';
import { lockAccountSecurity } from './mfaService';
import { countOtherActiveOwners, lockGroupRow } from './groupOwnershipService';
import { appendDeletionDecision, captureDeletionMediaPointer, DeletionDecisionInput, DeletionJournalError, normalizeDeletionDecision } from './deletionJournalService';

export type AccountErasureOptions = { decisionId: string; replay?: DeletionDecisionInput };

// Trusted core only. HTTP callers must first check recent authentication,
// active session and group ownership. Offline restore tooling supplies a
// validated captured decision while the restored deployment is quarantined.
// Every logical erasure and its immutable decision share the caller's DB tx.
export async function purgeAccount(tx: Prisma.TransactionClient, id: string, options: AccountErasureOptions) {
  const replay = options.replay ? normalizeDeletionDecision(options.replay) : undefined;
  if (replay && (replay.id !== options.decisionId || replay.subjectKind !== 'ACCOUNT' || replay.subjectId !== id || replay.action !== 'ACCOUNT_ERASE')) throw new DeletionJournalError('DELETION_DECISION_CONFLICT');
  await lockAccountSecurity(tx, id);
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id } });
  if (!user) {
    if (!replay) throw new DeletionJournalError('INVALID_DELETION_DECISION');
    return { decision: await appendDeletionDecision(tx, replay), unresolvedGroupIds: [] as string[] };
  }
  const now = user.deletedAt || new Date();
  const media = await tx.mediaAsset.findMany({ where: { ownerId: id, status: { not: 'DELETED' } }, include: { variants: true } });
  const existing = await tx.deletionDecision.findUnique({ where: { id: options.decisionId } });
  const input = replay || (existing ? normalizeDeletionDecision({ id: existing.id, subjectKind: existing.subjectKind, subjectId: existing.subjectId,
    action: existing.action, actionVersion: existing.actionVersion, resourcePointers: existing.resourcePointers }) : {
    id: options.decisionId, subjectKind: 'ACCOUNT' as const, subjectId: id, action: 'ACCOUNT_ERASE' as const,
    resourcePointers: { media: media.map(captureDeletionMediaPointer) }
  });
  if (input.subjectKind !== 'ACCOUNT' || input.subjectId !== id || input.action !== 'ACCOUNT_ERASE') throw new DeletionJournalError('DELETION_DECISION_CONFLICT');
  const decision = await appendDeletionDecision(tx, input);
  const mediaIds = [...new Set([...media.map(asset => asset.id), ...input.resourcePointers.media.map(pointer => pointer.assetId)])];
  if (await tx.mediaAsset.count({ where: { id: { in: mediaIds }, ownerId: { not: id } } })) throw new DeletionJournalError('DELETION_DECISION_CONFLICT');
  await tx.accountCleanupJob.upsert({ where: { userId: id }, create: { userId: id, mediaIds }, update: { mediaIds, completedAt: null } });
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
  await tx.securityEmailOutbox.deleteMany({ where: { userId: id } });
  await tx.handleAlias.updateMany({ where: { userId: id }, data: { userId: null } });
  const memberships = await tx.groupMember.findMany({ where: { userId: id }, select: { groupId: true } });
  for (const member of memberships.sort((a, b) => a.groupId.localeCompare(b.groupId))) await lockGroupRow(tx, member.groupId);
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
    searchVisibility: false, allowSharing: false, groupInvites: false, groupPrivacy: 'Off', mediaPrivacyTarget: true,
    theme: 'system', isPrivate: true, peopleTagPermission: 'NO_ONE'
  } });
  const unresolvedGroupIds: string[] = [];
  for (const member of memberships) {
    const group = await tx.group.findUnique({ where: { id: member.groupId }, select: { isDeleted: true } });
    if (group && !group.isDeleted && !(await countOtherActiveOwners(tx, member.groupId, id))) unresolvedGroupIds.push(member.groupId);
  }
  return { decision, unresolvedGroupIds };
}
