import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { pagePublicDto } from './pageService';

/** Exact handle occupies one first-page slot and is excluded from all cursor pages. */
export async function searchPageDirectory(where: Prisma.PageWhereInput, q: string, limit: number,
  cursor: { cursor?: { id: string }; skip?: number } = {}, client = prisma) {
  const exact = q && limit > 1 ? await client.page.findFirst({ where: { ...where, handle: q.toLowerCase() },
    include: { _count: { select: { follows: true } } } }) : null;
  const firstExact = exact && !cursor.cursor;
  const chronologicalLimit = firstExact ? limit - 1 : limit;
  const rows = await client.page.findMany({ where: exact ? { ...where, id: { not: exact.id } } : where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursor,
    take: chronologicalLimit + 1, include: { _count: { select: { follows: true } } } });
  const items = rows.slice(0, chronologicalLimit).map(page => ({ ...pagePublicDto(page), followersCount: page._count.follows }));
  if (firstExact) items.unshift({ ...pagePublicDto(exact), followersCount: exact._count.follows });
  return { items, nextCursor: rows.length > chronologicalLimit ? rows[chronologicalLimit - 1].id : null };
}
