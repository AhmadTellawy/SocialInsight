import { Prisma } from '@prisma/client';
import { pagePublicWhere } from './pagePolicy';
import { buildBaseVisiblePublishedPostWhere } from '../services/postVisibilityService';

type ShareRow = { id: string; sharedFromId: string | null; sharedRootPageId?: string | null };

/** A share's own draft/management access does not grant access to its sources. */
export async function hiddenCopiedShareIds(db: any, rows: ShareRow[], viewerId: string): Promise<Set<string>> {
  const shares = rows.filter(row => row.sharedFromId);
  const hidden = new Set<string>();
  if (!shares.length) return hidden;
  const ancestors = await db.$queryRaw(Prisma.sql`
    WITH RECURSIVE sources("seedId", id, "sharedFromId") AS (
      SELECT p.id, p.id, p."sharedFromId" FROM "Post" p
      WHERE p.id IN (${Prisma.join(shares.map(row => row.id))})
      UNION
      SELECT source."seedId", parent.id, parent."sharedFromId"
      FROM sources source JOIN "Post" parent ON parent.id = source."sharedFromId"
    )
    SELECT DISTINCT "seedId", id FROM sources WHERE id <> "seedId"`) as Array<{ seedId: string; id: string }>;
  const ancestorIds = [...new Set(ancestors.map(row => row.id))];
  const visiblePosts = ancestorIds.length ? await db.post.findMany({
    where: { AND: [{ id: { in: ancestorIds } }, buildBaseVisiblePublishedPostWhere(viewerId)] },
    select: { id: true }
  }) as Array<{ id: string }> : [];
  const visiblePostIds = new Set(visiblePosts.map(post => post.id));
  for (const ancestor of ancestors) if (!visiblePostIds.has(ancestor.id)) hidden.add(ancestor.seedId);
  const rootIds = [...new Set(shares.map(row => row.sharedRootPageId).filter((id): id is string => Boolean(id)))];
  const publicRoots = rootIds.length ? await db.page.findMany({
    where: { AND: [{ id: { in: rootIds } }, pagePublicWhere(true)] }, select: { id: true }
  }) as Array<{ id: string }> : [];
  const publicRootIds = new Set(publicRoots.map(page => page.id));
  for (const share of shares) if (share.sharedRootPageId && !publicRootIds.has(share.sharedRootPageId)) hidden.add(share.id);
  return hidden;
}
