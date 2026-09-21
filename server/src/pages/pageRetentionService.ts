import prisma from '../prisma';
import { PAGE_POLICY } from './pagePolicy';
import { PageTx, pageTransaction } from './pageService';

export const pageRetentionCutoff = (days: number, now: Date) => new Date(now.getTime() - days * 86400000);
export const pageLifecycleLimit = (value: number, maximum = 100) =>
  Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : Math.min(25, maximum);

/** Caller holds the Page row lock used by staff legal-hold decisions. */
export async function pageErasureHeld(tx: PageTx, pageId: string, now: Date): Promise<boolean> {
  return !!await tx.page.count({ where: { id: pageId, legalHoldUntil: { gt: now } } }) ||
    !!await tx.pageCase.count({ where: { pageId, legalHoldUntil: { gt: now } } });
}

/** Bounded exact-row retention; never changes old Post/Comment/Response retention. */
export async function processPageRetention(limit = 100, now = new Date()) {
  const size = pageLifecycleLimit(limit);
  const auditCutoff = pageRetentionCutoff(PAGE_POLICY.auditRetentionDays, now);
  const caseCutoff = pageRetentionCutoff(PAGE_POLICY.closedCaseRetentionDays, now);
  const totals = { invitationsExpired: 0, transfersExpired: 0, auditsDeleted: 0, casesDeleted: 0 };
  for (const kind of ['invitation', 'transfer', 'audit', 'case'] as const) {
    const candidates = kind === 'invitation'
      ? await prisma.pageInvitation.findMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, take: size, orderBy: { expiresAt: 'asc' }, select: { id: true, pageId: true } })
      : kind === 'transfer'
        ? await prisma.pageOwnershipTransfer.findMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, take: size, orderBy: { expiresAt: 'asc' }, select: { id: true, pageId: true } })
        : kind === 'audit'
          ? await prisma.pageAuditEvent.findMany({ where: { createdAt: { lte: auditCutoff }, page: { OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lte: now } }], cases: { none: { legalHoldUntil: { gt: now } } } } }, take: size, orderBy: { createdAt: 'asc' }, select: { id: true, pageId: true } })
          : await prisma.$queryRaw<Array<{ id: string; pageId: string }>>(Prisma.sql`
            SELECT c.id, c."pageId" FROM "PageCase" c JOIN "Page" p ON p.id = c."pageId"
            WHERE c.status = 'CLOSED' AND c."closedAt" <= ${caseCutoff}
              AND (c."legalHoldUntil" IS NULL OR c."legalHoldUntil" <= ${now})
              AND (p."legalHoldUntil" IS NULL OR p."legalHoldUntil" <= ${now})
              AND NOT EXISTS (SELECT 1 FROM "PageCase" a WHERE a."parentId" = c.id AND a.status <> 'CLOSED')
            ORDER BY c."closedAt", c.id LIMIT ${size}`);
    for (const candidate of candidates) {
      const changed = await pageTransaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Page" WHERE id = ${candidate.pageId} FOR UPDATE`;
        if (kind === 'invitation') {
          return (await tx.pageInvitation.updateMany({ where: { id: candidate.id, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED', decidedAt: now } })).count;
        } else if (kind === 'transfer') {
          return (await tx.pageOwnershipTransfer.updateMany({ where: { id: candidate.id, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED', decidedAt: now } })).count;
        } else if (kind === 'audit') {
          if (!await pageErasureHeld(tx, candidate.pageId, now)) {
            return (await tx.pageAuditEvent.deleteMany({ where: { id: candidate.id, createdAt: { lte: auditCutoff } } })).count;
          }
        } else {
          const legalPageHold = await tx.page.count({ where: { id: candidate.pageId, legalHoldUntil: { gt: now } } });
          // An unresolved appeal still needs its original decision, even when that decision is old.
          const activeAppeal = await tx.pageCase.count({ where: { parentId: candidate.id, status: { not: 'CLOSED' } } });
          if (!legalPageHold && !activeAppeal) {
            return (await tx.pageCase.deleteMany({ where: { id: candidate.id, status: 'CLOSED', closedAt: { lte: caseCutoff }, OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lte: now } }] } })).count;
          }
        }
        return 0;
      });
      const counter = { invitation: 'invitationsExpired', transfer: 'transfersExpired', audit: 'auditsDeleted', case: 'casesDeleted' } as const;
      totals[counter[kind]] += changed;
    }
  }
  // Expired review dates no longer prevent erasure; never clear a concurrent renewed hold.
  return totals;
}
import { Prisma } from '@prisma/client';
