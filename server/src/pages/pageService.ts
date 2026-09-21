import { Page, Prisma, User } from '@prisma/client';
import prisma from '../prisma';
import { hasPageCapability, isPagePublic, PAGE_POLICY, PageCapability, PagePolicyError,
  PageRole, pagePublicWhere } from './pagePolicy';
import { pageCreateSchema, pagePatchSchema, validatePageCta } from './pageValidation';
import { assertPagesEnabled, pagesEnabled } from './pageFeature';

export type PageTx = Prisma.TransactionClient;
export const pageDaysFrom = (days: number, now = new Date()) => new Date(now.getTime() + days * 86400000);

/** Retry only serialization/deadlock conflicts; callbacks may perform database operations only. */
export async function pageTransaction<T>(action: (tx: PageTx) => Promise<T>,
  isolationLevel: 'Serializable' | 'ReadCommitted' = 'Serializable'): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(action, { isolationLevel, maxWait: 5000, timeout: 15000 });
    } catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)));
      if (attempt < 2 && conflict) continue;
      throw error;
    }
  }
}

export async function activePageActor(tx: PageTx, userId: string, confirmed = false) {
  // Share-lock the account so suspension cannot commit between validation and mutation.
  const [user] = await tx.$queryRaw<Array<Pick<User, 'id' | 'status' | 'emailVerifiedAt'>>>`
    SELECT "id", "status", "email_verified_at" AS "emailVerifiedAt" FROM users WHERE "id" = ${userId} FOR SHARE`;
  if (!user || user.status !== 'ACTIVE') throw new PagePolicyError('PAGE_ACTIVE_ACCOUNT_REQUIRED', 401);
  if (confirmed && !user.emailVerifiedAt) throw new PagePolicyError('PAGE_CONFIRMED_EMAIL_REQUIRED', 403);
  return user;
}

export async function lockPage(tx: PageTx, pageId: string): Promise<Page> {
  const [page] = await tx.$queryRaw<Page[]>`SELECT "Page".* FROM "Page" WHERE "id" = ${pageId} FOR UPDATE`;
  if (!page || page.purgedAt) throw new PagePolicyError('PAGE_NOT_FOUND', 404);
  return page;
}

/** Public interactions share this lock; lifecycle/team mutations retain lockPage's exclusive lock. */
export async function lockPageForInteraction(tx: PageTx, pageId: string): Promise<Page> {
  const [page] = await tx.$queryRaw<Page[]>`SELECT "Page".* FROM "Page" WHERE "id" = ${pageId} FOR SHARE`;
  if (!page || page.purgedAt) throw new PagePolicyError('PAGE_NOT_FOUND', 404);
  return page;
}

export async function pageRole(tx: PageTx, page: Pick<Page, 'id' | 'ownerId'>, userId?: string | null): Promise<PageRole | null> {
  if (!userId) return null;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (user?.status !== 'ACTIVE') return null;
  return pageRoleForActiveActor(tx, page, userId);
}

// Private: callers must validate the actor in this transaction. No role is cached;
// membership is read fresh, including after an exclusive Page lock wait.
async function pageRoleForActiveActor(tx: PageTx, page: Pick<Page, 'id' | 'ownerId'>, userId: string): Promise<PageRole | null> {
  if (page.ownerId === userId) return 'OWNER';
  const membership = await tx.pageMembership.findUnique({ where: { pageId_userId: { pageId: page.id, userId } } });
  return membership && ['ADMIN', 'EDITOR', 'ANALYST'].includes(membership.role) ? membership.role as PageRole : null;
}

export async function requirePageCapability(tx: PageTx, page: Page, userId: string,
  capability: PageCapability): Promise<PageRole> {
  const role = await pageRole(tx, page, userId);
  if (!hasPageCapability(role, capability)) throw new PagePolicyError('PAGE_PERMISSION_DENIED', 403);
  return role!;
}

export async function pageIsBlocked(tx: PageTx, pageId: string, userId?: string | null): Promise<boolean> {
  return !!userId && !!await tx.pageBlock.findFirst({ where: { pageId, userId }, select: { userId: true } });
}

/** SQL equivalent of pagePublicWhere plus the existing bidirectional viewer block check; alias p only. */
const pagePublicReadPredicate = (viewerId?: string | null) => Prisma.sql`
  p."publicationState" = 'PUBLISHED' AND p."platformState" <> 'SUSPENDED'
  AND p."safetyHiddenAt" IS NULL AND p."deletionRequestedAt" IS NULL AND p."purgedAt" IS NULL
  AND (
    EXISTS (SELECT 1 FROM users owner_user WHERE owner_user."id" = p."ownerId" AND owner_user."status" = 'ACTIVE')
    OR EXISTS (SELECT 1 FROM "PageMembership" editorial_member
      JOIN users editorial_user ON editorial_user."id" = editorial_member."userId"
      WHERE editorial_member."pageId" = p."id" AND editorial_member."role" IN ('ADMIN', 'EDITOR')
      AND editorial_user."status" = 'ACTIVE')
  )
  AND NOT EXISTS (SELECT 1 FROM "PageBlock" viewer_block
    WHERE viewer_block."pageId" = p."id" AND viewer_block."userId" = ${viewerId || null})`;

export async function assertPagePublic(tx: PageTx, page: Page, viewerId?: string | null): Promise<void> {
  assertPagesEnabled(viewerId);
  if (!isPagePublic(page)) throw new PagePolicyError('PAGE_NOT_FOUND', 404);
  const [result] = await tx.$queryRaw<Array<{ visible: boolean }>>(Prisma.sql`
    SELECT EXISTS (SELECT 1 FROM "Page" p WHERE p."id" = ${page.id}
      AND ${pagePublicReadPredicate(viewerId)}) AS "visible"`);
  if (!result?.visible) throw new PagePolicyError('PAGE_NOT_FOUND',404);
}

export const pagePublicDto = (page: Page) => ({
  id: page.id, kind: 'PAGE' as const, name: page.name, handle: page.handle, category: page.category,
  bio: page.bio, description: page.description, country: page.country, city: page.city,
  website: page.website, links: page.links, publicEmail: page.publicEmail, publicPhone: page.publicPhone,
  cta: page.cta, avatarMediaId: page.avatarMediaId, coverMediaId: page.coverMediaId,
  createdAt: page.createdAt, url: `/pages/${page.handle}`,
});

export const pageManagementDto = (page: Page, role: PageRole) => ({
  ...pagePublicDto(page), role,
  publicationState: page.publicationState, platformState: page.platformState,
  safetyHidden: !!page.safetyHiddenAt, deletionRequestedAt: page.deletionRequestedAt,
  deletionDueAt: page.deletionRequestedAt ? pageDaysFrom(PAGE_POLICY.deletionGraceDays, page.deletionRequestedAt) : null,
  lastHandleChangedAt: page.lastHandleChangedAt,
  capabilities: (['readManagement', 'editInfo', 'changeHandle', 'manageContent', 'reply', 'moderateComments',
    'block', 'analytics', 'export', 'manageTeam', 'audit', 'publication', 'ownership', 'deletion'] as PageCapability[])
    .filter(capability => hasPageCapability(role, capability)),
});

export async function pageAudit(tx: PageTx, pageId: string, actorId: string | null, action: string,
  targetId?: string, data: Prisma.InputJsonValue = {}) {
  return tx.pageAuditEvent.create({ data: { pageId, actorId, action, targetId, data } });
}

export async function enqueuePageEvent(tx: PageTx, pageId: string, recipientId: string,
  kind: string, targetId: string, dedupeKey: string) {
  return tx.pageEvent.upsert({ where: { dedupeKey }, update: {}, create: { pageId, recipientId, kind, targetId, dedupeKey } });
}

export async function createPage(userId: string, raw: unknown) {
  const input = pageCreateSchema.parse(raw);
  return pageTransaction(async tx => {
    // Serialize owner quota and duplicate create requests across all of this owner's Pages.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await activePageActor(tx, userId, true);
    const prior = await tx.page.findUnique({ where: { createRequestId: input.requestId } });
    if (prior) {
      if (prior.ownerId !== userId || prior.purgedAt) throw new PagePolicyError('PAGE_REQUEST_CONFLICT', 409);
      return pageManagementDto(prior, 'OWNER');
    }
    if (await tx.page.count({ where: { ownerId: userId, purgedAt: null } }) >= PAGE_POLICY.ownedPageLimit) {
      throw new PagePolicyError('PAGE_OWNER_LIMIT', 409);
    }
    if (await tx.pageHandle.findUnique({ where: { handle: input.handle } })) throw new PagePolicyError('PAGE_HANDLE_TAKEN', 409);
    const { requestId, representationConfirmed: _confirmed, ...info } = input;
    const page = await tx.page.create({ data: { ...info, ownerId: userId, createRequestId: requestId,
      isTestFixture:(process.env.PAGES_TEST_USERS || '').split(',').map(value=>value.trim()).includes(userId),
      representationAt: new Date(), handles: { create: { handle: input.handle } } } });
    await pageAudit(tx, page.id, userId, 'PAGE_CREATED');
    return pageManagementDto(page, 'OWNER');
  });
}

export async function updatePageInfo(userId: string, pageId: string, raw: unknown) {
  const patch = pagePatchSchema.parse(raw);
  // The exclusive Page lock serializes info/team/lifecycle writes. ReadCommitted reads
  // the winning state after waiting; the actor SHARE lock also prevents account removal.
  // Every decision and the audit stay in this transaction; no quota/handle changes occur here.
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, userId);
    // activePageActor holds the account SHARE lock until this transaction ends.
    const role = await pageRoleForActiveActor(tx, page, userId);
    if (!hasPageCapability(role, 'editInfo')) throw new PagePolicyError('PAGE_PERMISSION_DENIED', 403);
    if (page.deletionRequestedAt) throw new PagePolicyError('PAGE_DELETING', 409);
    if (!validatePageCta({ ...page, ...patch })) throw new PagePolicyError('PAGE_CTA_CONTACT_REQUIRED');
    const updated = await tx.page.update({ where: { id: pageId }, data: patch });
    await pageAudit(tx, pageId, userId, 'PAGE_INFO_UPDATED', undefined, { fields: Object.keys(patch) });
    return pageManagementDto(updated, role!);
  }, 'ReadCommitted');
}

export async function changePageLifecycle(userId: string, pageId: string,
  action: 'publish' | 'unpublish' | 'delete' | 'cancel-delete') {
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, userId);
    const role = await requirePageCapability(tx, page, userId,
      action === 'delete' || action === 'cancel-delete' ? 'deletion' : 'publication');
    let patch: Prisma.PageUpdateInput;
    if (action === 'publish') {
      if (page.platformState !== 'NONE' || page.deletionRequestedAt) throw new PagePolicyError('PAGE_PUBLICATION_RESTRICTED', 409);
      // Explicit owner republish is the only way to clear an eligible safety hide.
      patch = { publicationState: 'PUBLISHED', safetyHiddenAt: null };
    } else if (action === 'unpublish') patch = { publicationState: 'UNPUBLISHED' };
    else if (action === 'delete') patch = { deletionRequestedAt: page.deletionRequestedAt ?? new Date() };
    else {
      if (!page.deletionRequestedAt || pageDaysFrom(PAGE_POLICY.deletionGraceDays, page.deletionRequestedAt) <= new Date()) {
        throw new PagePolicyError('PAGE_DELETE_CANCELLATION_EXPIRED', 409);
      }
      patch = { deletionRequestedAt: null, publicationState: 'UNPUBLISHED' };
    }
    const updated = await tx.page.update({ where: { id: pageId }, data: patch });
    await pageAudit(tx, pageId, userId, `PAGE_${action.toUpperCase().replace('-', '_')}`);
    return pageManagementDto(updated, role);
  });
}

export async function pageFollowAction(userId: string, pageId: string, action: 'follow' | 'unfollow' | 'mute' | 'unmute') {
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, userId);
    // Unfollow remains possible when the Page has become unavailable.
    if (action !== 'unfollow') await assertPagePublic(tx, page, userId);
    const where = { pageId_userId: { pageId, userId } };
    const wasFollowing = !!await tx.pageFollow.findUnique({ where });
    if (action === 'unfollow') await tx.pageFollow.deleteMany({ where: { pageId, userId } });
    else if (action === 'follow') await tx.pageFollow.upsert({ where, update: {}, create: { pageId, userId } });
    else {
      const following = await tx.pageFollow.findUnique({ where });
      if (!following) throw new PagePolicyError('PAGE_FOLLOW_REQUIRED', 409);
      await tx.pageFollow.update({ where, data: { muted: action === 'mute' } });
    }
    if ((action === 'follow' && !wasFollowing) || (action === 'unfollow' && wasFollowing)) {
      await pageAudit(tx, pageId, null, 'FOLLOW_CHANGED', undefined, { delta: action === 'follow' ? 1 : -1 });
    }
    return { following: action !== 'unfollow', followersCount: await tx.pageFollow.count({ where: { pageId } }) };
  });
}

export async function pageBlockAction(actorId: string, pageId: string, userId: string,
  direction: 'PAGE_TO_USER' | 'USER_TO_PAGE', blocked: boolean) {
  return pageTransaction(async tx => {
    const page = await lockPage(tx, pageId);
    await activePageActor(tx, actorId);
    if (direction === 'PAGE_TO_USER') await requirePageCapability(tx, page, actorId, 'block');
    else if (userId !== actorId) throw new PagePolicyError('PAGE_PERMISSION_DENIED', 403);
    if (blocked && await pageRole(tx, page, userId)) throw new PagePolicyError('PAGE_TEAM_MEMBER_BLOCK_FORBIDDEN', 409);
    const where = { pageId_userId_direction: { pageId, userId, direction } };
    if (blocked) {
      await tx.pageBlock.upsert({ where, update: {}, create: { pageId, userId, direction } });
      const removed = await tx.pageFollow.deleteMany({ where: { pageId, userId } });
      if (removed.count) await pageAudit(tx, pageId, null, 'FOLLOW_CHANGED', undefined, { delta: -removed.count });
      await tx.pageInvitation.updateMany({ where: { pageId, status: 'PENDING', OR: [{ recipientId: userId }, { senderId: userId }] }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
      await tx.pageOwnershipTransfer.updateMany({ where: { pageId, status: 'PENDING', OR: [{ recipientId: userId }, { senderId: userId }] }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
    } else await tx.pageBlock.deleteMany({ where: { pageId, userId, direction } });
    // Do not reveal personal blocking decisions in team audit.
    if (direction === 'PAGE_TO_USER') await pageAudit(tx, pageId, actorId, blocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED', userId);
    return { blocked };
  });
}

export async function getPublicPage(handle: string, viewerId?: string | null) {
  type PublicReadRow = Page & { _aliasHandle: string; _visible: boolean; _followersCount: bigint;
    _following: boolean; _muted: boolean; _managesPage: boolean };
  const [page] = await prisma.$queryRaw<PublicReadRow[]>(Prisma.sql`
    SELECT p.*, alias."handle" AS "_aliasHandle", (${pagePublicReadPredicate(viewerId)}) AS "_visible",
      (SELECT COUNT(*) FROM "PageFollow" followers WHERE followers."pageId" = p."id") AS "_followersCount",
      viewer_follow."userId" IS NOT NULL AS "_following", COALESCE(viewer_follow."muted", false) AS "_muted",
      COALESCE(viewer_user."status" = 'ACTIVE' AND
        (p."ownerId" = viewer_user."id" OR viewer_member."role" IN ('ADMIN', 'EDITOR', 'ANALYST')), false) AS "_managesPage"
    FROM "PageHandle" alias JOIN "Page" p ON p."id" = alias."pageId"
    LEFT JOIN "PageFollow" viewer_follow ON viewer_follow."pageId" = p."id" AND viewer_follow."userId" = ${viewerId || null}
    LEFT JOIN users viewer_user ON viewer_user."id" = ${viewerId || null}
    LEFT JOIN "PageMembership" viewer_member ON viewer_member."pageId" = p."id" AND viewer_member."userId" = ${viewerId || null}
    WHERE alias."handle" = ${handle.toLowerCase()}`);
  if (!page) throw new PagePolicyError('PAGE_NOT_FOUND', 404);
  // Preserve missing-alias/feature-gate error precedence while returning only the public allowlist.
  assertPagesEnabled(viewerId);
  if (!isPagePublic(page) || !page._visible) throw new PagePolicyError('PAGE_NOT_FOUND', 404);
  const followersCount = Number(page._followersCount);
  if (!Number.isSafeInteger(followersCount) || followersCount < 0) throw new PagePolicyError('PAGE_FOLLOWER_COUNT_INVALID', 500);
  return { ...pagePublicDto(page), followersCount, following: page._following, muted: page._muted,
    managesPage: page._managesPage, canonicalHandle: page.handle, redirected: page._aliasHandle !== page.handle };
}

export async function getManagedPage(pageId: string, userId: string) {
  assertPagesEnabled(userId);
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page || page.purgedAt) throw new PagePolicyError('PAGE_NOT_FOUND', 404);
  const role = await requirePageCapability(prisma, page, userId, 'readManagement');
  return pageManagementDto(page, role);
}

export const pageDiscoveryWhere = (viewerId?: string | null): Prisma.PageWhereInput => ({
  ...(!pagesEnabled(viewerId)?{id:{in:[]}}:{}),
  ...pagePublicWhere(), isTestFixture: false,
  ...(viewerId ? { blocks: { none: { userId: viewerId } } } : {}),
});
