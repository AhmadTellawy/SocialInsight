import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { pageFollowerCounts, pagePublicDto, PageTx } from './pageService';

/** Exact handle occupies one first-page slot and is excluded from all cursor pages. */
export async function searchPageDirectory(where: Prisma.PageWhereInput, q: string, limit: number,
  cursor: { cursor?: { id: string }; skip?: number } = {}, client: PageTx = prisma) {
  const exact = q && limit > 1 ? await client.page.findFirst({ where: { ...where, handle: q.toLowerCase() },
  }) : null;
  const firstExact = exact && !cursor.cursor;
  const chronologicalLimit = firstExact ? limit - 1 : limit;
  const rows = await client.page.findMany({ where: exact ? { ...where, id: { not: exact.id } } : where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursor,
    take: chronologicalLimit + 1 });
  const visibleRows = rows.slice(0, chronologicalLimit), counts = await pageFollowerCounts(client,
    [...visibleRows.map(page => page.id), ...(firstExact ? [exact.id] : [])]);
  const items = visibleRows.map(page => ({ ...pagePublicDto(page), followersCount: counts.get(page.id) || 0 }));
  if (firstExact) items.unshift({ ...pagePublicDto(exact), followersCount: counts.get(exact.id) || 0 });
  return { items, nextCursor: rows.length > chronologicalLimit ? rows[chronologicalLimit - 1].id : null };
}
