import { Prisma } from '@prisma/client';
import { pagesEnabled } from '../pages/pageFeature';
import { buildFeedPostScalarSelect, FeedCursor, MAX_FEED_LIMIT } from './postFeedService';

// Only these internal aliases and scalar names enter SQL text. Every viewer,
// filter and cursor value is a bound parameter, never an SQL identifier.
type PostAlias = 'p' | 's';
const column = (alias: PostAlias, name: string) => Prisma.raw(`"${alias}"."${name}"`);
const scalarProjection = Prisma.join(Object.keys(buildFeedPostScalarSelect()).map(name => column('p', name)));

function baseVisibility(alias: PostAlias, viewerId?: string | null): Prisma.Sql {
  const c = (name: string) => column(alias, name);
  const noTargets = Prisma.sql`NOT EXISTS (SELECT 1 FROM "_PostTargetGroups" tg WHERE tg."B" = ${c('id')})`;
  const followsAuthor = viewerId ? Prisma.sql`EXISTS (SELECT 1 FROM "follows" f WHERE f.following_id = ${c('authorId')} AND f.follower_id = ${viewerId} AND f.status = 'ACTIVE')` : Prisma.sql`FALSE`;
  const own = viewerId ? Prisma.sql`${c('authorId')} = ${viewerId}` : Prisma.sql`FALSE`;
  const unblocked = viewerId ? Prisma.sql`NOT EXISTS (SELECT 1 FROM "user_blocks" b WHERE
    (b.blocker_id = ${viewerId} AND b.blocked_id = ${c('authorId')}) OR
    (b.blocked_id = ${viewerId} AND b.blocker_id = ${c('authorId')}))` : Prisma.sql`TRUE`;
  // The legacy non-group predicate deliberately excludes a NULL transition
  // flag. ProfileAndGroups allows NULL. Keep that existing distinction.
  const privacy = (includeUnset: boolean) => Prisma.sql`(${own} OR ${followsAuthor} OR EXISTS (
    SELECT 1 FROM "users" u WHERE u.id = ${c('authorId')} AND u.is_private = FALSE
    AND ${includeUnset ? Prisma.sql`u.media_privacy_target IS NOT TRUE` : Prisma.sql`u.media_privacy_target = FALSE`}))`;
  const publicAudience = Prisma.sql`(${c('targetAudience')} IS NULL OR ${c('targetAudience')} ILIKE 'Public')`;
  const memberOfGroup = viewerId ? Prisma.sql`EXISTS (SELECT 1 FROM "GroupMember" gm WHERE gm."groupId" = g.id AND gm."userId" = ${viewerId} AND gm.status = 'JOINED')` : Prisma.sql`FALSE`;
  const groups = Prisma.sql`EXISTS (SELECT 1 FROM "Group" g WHERE g."isDeleted" = FALSE
    AND (g."isPublic" = TRUE OR ${memberOfGroup})
    AND (g.id = ${c('groupId')} OR EXISTS (SELECT 1 FROM "_PostTargetGroups" tg WHERE tg."B" = ${c('id')} AND tg."A" = g.id)))`;
  const personal = Prisma.sql`(${c('pageId')} IS NULL AND ${unblocked} AND (
    (${c('groupId')} IS NULL AND ${noTargets} AND
      (${publicAudience} OR ${own} OR (${c('targetAudience')} ILIKE 'Followers' AND ${followsAuthor})) AND ${privacy(false)})
    OR ${groups}
    OR (${c('targetAudience')} = 'ProfileAndGroups' AND ${privacy(true)})
  ))`;
  const activeManager = Prisma.sql`EXISTS (SELECT 1 FROM "PageMembership" pm JOIN "users" mu ON mu.id = pm."userId"
    WHERE pm."pageId" = pg.id AND pm.role IN ('ADMIN', 'EDITOR') AND mu.status = 'ACTIVE')`;
  const activeOwner = Prisma.sql`EXISTS (SELECT 1 FROM "users" ou WHERE ou.id = pg."ownerId" AND ou.status = 'ACTIVE')`;
  const managementAudience = viewerId ? Prisma.sql`((pg."ownerId" = ${viewerId} AND ${activeOwner}) OR EXISTS (
    SELECT 1 FROM "PageMembership" vm JOIN "users" vu ON vu.id = vm."userId"
    WHERE vm."pageId" = pg.id AND vm."userId" = ${viewerId} AND vm.role IN ('ADMIN', 'EDITOR') AND vu.status = 'ACTIVE'))` : Prisma.sql`FALSE`;
  const pageFollower = viewerId ? Prisma.sql`EXISTS (SELECT 1 FROM "PageFollow" pf WHERE pf."pageId" = pg.id AND pf."userId" = ${viewerId})` : Prisma.sql`FALSE`;
  const pageUnblocked = viewerId ? Prisma.sql`NOT EXISTS (SELECT 1 FROM "PageBlock" pb WHERE pb."pageId" = pg.id AND pb."userId" = ${viewerId})` : Prisma.sql`TRUE`;
  const page = pagesEnabled(viewerId) ? Prisma.sql`(${c('pageId')} IS NOT NULL AND ${c('groupId')} IS NULL AND ${noTargets}
    AND EXISTS (SELECT 1 FROM "Page" pg WHERE pg.id = ${c('pageId')}
      AND pg."publicationState" = 'PUBLISHED' AND pg."platformState" <> 'SUSPENDED'
      AND pg."safetyHiddenAt" IS NULL AND pg."deletionRequestedAt" IS NULL AND pg."purgedAt" IS NULL
      AND (${activeOwner} OR ${activeManager}) AND ${pageUnblocked}
      AND (${publicAudience} OR (${c('targetAudience')} ILIKE 'Followers' AND ${pageFollower}) OR ${managementAudience})))` : Prisma.sql`FALSE`;
  const notHidden = viewerId ? Prisma.sql`NOT EXISTS (SELECT 1 FROM "user_hidden_posts" h WHERE h.post_id = ${c('id')} AND h.user_id = ${viewerId})` : Prisma.sql`TRUE`;
  return Prisma.sql`(${c('isDeleted')} = FALSE AND ${c('status')} = 'PUBLISHED' AND ${notHidden} AND (${personal} OR ${page}))`;
}

/** Equivalent to buildVisiblePublishedPostWhere, including the immediate
 * source's base policy. Call again when loading the source, as the model path
 * does, to enforce its own shared source too. No cached authorization result. */
export function visiblePublishedPostSql(viewerId?: string | null): Prisma.Sql {
  return Prisma.sql`${baseVisibility('p', viewerId)} AND (p."sharedFromId" IS NULL OR EXISTS (
    SELECT 1 FROM "Post" s WHERE s.id = p."sharedFromId" AND ${baseVisibility('s', viewerId)}))`;
}

export type VisiblePostSqlOptions = {
  viewerId?: string | null;
  ids?: string[];
  pageId?: string;
  authorId?: string;
  authorHandle?: string;
  groupId?: string;
  type?: string;
  discovery?: boolean;
  cursor?: FeedCursor | null;
  limit: number;
};

export function buildVisiblePostSql(options: VisiblePostSqlOptions): Prisma.Sql {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_FEED_LIMIT + 1) throw new Error('Invalid visible post query limit');
  const conditions: Prisma.Sql[] = [visiblePublishedPostSql(options.viewerId)];
  if (options.ids) conditions.push(options.ids.length ? Prisma.sql`p.id IN (${Prisma.join(options.ids)})` : Prisma.sql`FALSE`);
  if (options.pageId) conditions.push(Prisma.sql`p."pageId" = ${options.pageId}`);
  if (options.authorId) conditions.push(Prisma.sql`p."authorId" = ${options.authorId} AND p."pageId" IS NULL`);
  if (options.authorHandle) conditions.push(Prisma.sql`p."pageId" IS NULL AND EXISTS (SELECT 1 FROM "users" a WHERE a.id = p."authorId" AND a.handle = ${options.authorHandle})`);
  if (options.groupId) conditions.push(Prisma.sql`(p."groupId" = ${options.groupId} OR EXISTS (SELECT 1 FROM "_PostTargetGroups" tg WHERE tg."B" = p.id AND tg."A" = ${options.groupId}))`);
  if (options.type) conditions.push(Prisma.sql`p.type = ${options.type}`);
  if (options.discovery) conditions.push(Prisma.sql`(p."pageId" IS NULL OR EXISTS (SELECT 1 FROM "Page" d WHERE d.id = p."pageId" AND d."isTestFixture" = FALSE))
    AND (p."sharedFromId" IS NULL OR EXISTS (SELECT 1 FROM "Post" ds WHERE ds.id = p."sharedFromId" AND (ds."pageId" IS NULL OR EXISTS (SELECT 1 FROM "Page" dp WHERE dp.id = ds."pageId" AND dp."isTestFixture" = FALSE))))`);
  if (options.cursor) conditions.push(Prisma.sql`(p."createdAt" < ${options.cursor.createdAt} OR (p."createdAt" = ${options.cursor.createdAt} AND p.id < ${options.cursor.id}))`);
  return Prisma.sql`SELECT ${scalarProjection} FROM "Post" p WHERE ${Prisma.join(conditions.map(condition => Prisma.sql`(${condition})`), ' AND ')} ORDER BY p."createdAt" DESC, p.id DESC LIMIT ${options.limit}`;
}

export function loadVisiblePostScalars(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, options: VisiblePostSqlOptions): Promise<any[]> {
  return tx.$queryRaw<any[]>(buildVisiblePostSql(options));
}

/** Every requested post must exist and satisfy the same immediate-source policy.
 * Use the caller's transaction after its locks; never reuse an earlier result. */
export function buildVisiblePublishedPostsExistSql(ids: string[], viewerId?: string | null,
  publisher?: 'PAGE'): Prisma.Sql {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return Prisma.sql`SELECT FALSE AS visible`;
  return Prisma.sql`SELECT NOT EXISTS (
    SELECT 1 FROM (VALUES ${Prisma.join(uniqueIds.map(id => Prisma.sql`(${id}::text)`))}) requested(id)
    WHERE NOT EXISTS (SELECT 1 FROM "Post" p WHERE p.id = requested.id
      AND ${publisher === 'PAGE' ? Prisma.sql`p."pageId" IS NOT NULL` : Prisma.sql`TRUE`}
      AND ${visiblePublishedPostSql(viewerId)})
  ) AS visible`;
}

export async function arePublishedPostsVisible(tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  ids: string[], viewerId?: string | null, publisher?: 'PAGE'): Promise<boolean> {
  if (!ids.length) return false;
  const rows = await tx.$queryRaw<Array<{ visible: boolean }>>(buildVisiblePublishedPostsExistSql(ids, viewerId, publisher));
  return rows[0]?.visible === true;
}
