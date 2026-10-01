import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { purgeMediaAsset } from '../services/mediaService';
import { PAGE_POLICY } from './pagePolicy';
import { pagesEnabled } from './pageFeature';
import { PageTx, pageAudit, pageTransaction } from './pageService';
import { pageErasureHeld, pageLifecycleLimit, pageRetentionCutoff, processPageRetention } from './pageRetentionService';

const phases = ['NOTIFICATIONS', 'ANSWERS', 'RESPONSES', 'COMMENT_LIKES', 'COMMENT_MENTIONS',
  'COMMENT_HASHTAGS', 'COMMENT_REPORTS', 'COMMENTS', 'OPTIONS', 'QUESTIONS', 'SECTIONS', 'SAVES', 'HIDES', 'LIKES',
  'VIEWS', 'POST_MENTIONS', 'POST_HASHTAGS', 'POST_TAGS', 'POST_MEDIA', 'INTERACTIONS', 'REPORTS', 'CASES', 'EXTERNAL_REPORTS', 'EXTERNAL_SHARES', 'POSTS',
  'MEMBERS', 'FOLLOWS', 'BLOCKS', 'INVITATIONS', 'TRANSFERS', 'EVENTS', 'MEDIA', 'MEDIA_ROWS', 'HANDLES', 'FINALIZE'] as const;
type Phase = typeof phases[number];
type Job = { pageId: string; phase: Phase; attempts: number; availableAt: Date; completedAt: Date | null };
type BatchOptions = { limit?: number; now?: Date; purgeAsset?: (id: string) => Promise<void> };

/** Admit irrevocable erasure under the same Page lock as cancellation. All content stays inaccessible. */
export async function admitPagePurges(limit = 10, now = new Date()): Promise<number> {
  const cutoff = pageRetentionCutoff(PAGE_POLICY.deletionGraceDays, now);
  const caseCutoff = pageRetentionCutoff(PAGE_POLICY.closedCaseRetentionDays, now);
  const due = await prisma.page.findMany({ where: { purgedAt: null, deletionRequestedAt: { lte: cutoff },
    OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lte: now } }], cases: { none: { OR: [
      { legalHoldUntil: { gt: now } }, { status: { not: 'CLOSED' } }, { closedAt: null }, { closedAt: { gt: caseCutoff } }
    ] } } },
    take: pageLifecycleLimit(limit, 25), orderBy: [{ deletionRequestedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  let admitted = 0;
  for (const candidate of due) {
    const changed = await pageTransaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Page" WHERE id = ${candidate.id} FOR UPDATE`;
      const page = await tx.page.findUnique({ where: { id: candidate.id } });
      if (!page || page.purgedAt || !page.deletionRequestedAt || page.deletionRequestedAt > cutoff || await pageErasureHeld(tx, page.id, now) ||
        await tx.pageCase.count({ where: { pageId: page.id, OR: [
          { status: { not: 'CLOSED' } }, { closedAt: null }, { closedAt: { gt: caseCutoff } }
        ] } })) return false;
      await tx.page.update({ where: { id: page.id }, data: { purgedAt: now, publicationState: 'UNPUBLISHED' } });
      await tx.$executeRaw`INSERT INTO "PagePurgeJob" ("pageId", "updatedAt", "availableAt") VALUES (${page.id}, ${now}, ${now}) ON CONFLICT ("pageId") DO NOTHING`;
      await pageAudit(tx, page.id, null, 'PAGE_PURGE_ADMITTED');
      return true;
    });
    if (changed) admitted++;
  }
  return admitted;
}

/** Only code-owned table identifiers enter this helper; all external values stay SQL parameters. */
async function erase(tx: PageTx, table: string, predicate: Prisma.Sql, limit: number) {
  const name = Prisma.raw(`"${table}"`);
  return tx.$executeRaw(Prisma.sql`DELETE FROM ${name} WHERE ctid IN
    (SELECT t.ctid FROM ${name} t WHERE ${predicate} LIMIT ${limit})`);
}

const postIds = (pageId: string) => Prisma.sql`SELECT id FROM "Post" WHERE "pageId" = ${pageId}`;
const questionIds = (pageId: string) => Prisma.sql`SELECT q.id FROM "Question" q LEFT JOIN "Section" s ON s.id = q."sectionId" WHERE q."postId" IN (${postIds(pageId)}) OR s."postId" IN (${postIds(pageId)})`;
const commentIds = (pageId: string) => Prisma.sql`SELECT id FROM "Comment" WHERE "postId" IN (${postIds(pageId)})`;
const tombstoneAuthorId = (pageId: string) => {
  const hash = createHash('sha256').update('page-purge-author:' + pageId).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20)}`;
};

async function erasePhase(tx: PageTx, job: Job, size: number, now: Date): Promise<number> {
  const p = postIds(job.pageId), q = questionIds(job.pageId), c = commentIds(job.pageId);
  switch (job.phase) {
    case 'NOTIFICATIONS': return erase(tx, 'notifications', Prisma.sql`(t."targetType" IN ('post','survey') AND t."targetId" IN (${p})) OR (t."targetType" = 'comment' AND t."targetId" IN (${c})) OR t.dedupe_key IN (SELECT 'page-event:' || id FROM "PageEvent" WHERE "pageId" = ${job.pageId})`, size);
    case 'ANSWERS': return erase(tx, 'Answer', Prisma.sql`t."responseId" IN (SELECT id FROM "Response" WHERE "postId" IN (${p})) OR t."questionId" IN (${q})`, size);
    case 'RESPONSES': return erase(tx, 'Response', Prisma.sql`t."postId" IN (${p})`, size);
    case 'COMMENT_LIKES': return erase(tx, 'CommentLike', Prisma.sql`t."commentId" IN (${c})`, size);
    case 'COMMENT_MENTIONS': return erase(tx, 'Mention', Prisma.sql`t."commentId" IN (${c})`, size);
    case 'COMMENT_HASHTAGS': return erase(tx, 'CommentHashtag', Prisma.sql`t."commentId" IN (${c})`, size);
    case 'COMMENT_REPORTS': return erase(tx, 'reports', Prisma.sql`t.target_type = 'COMMENT' AND t.target_id IN (${c})`, size);
    case 'COMMENTS': return erase(tx, 'Comment', Prisma.sql`t."postId" IN (${p}) AND NOT EXISTS (SELECT 1 FROM "Comment" child WHERE child."parentId" = t.id)`, size);
    case 'OPTIONS': return erase(tx, 'Option', Prisma.sql`t."questionId" IN (${q})`, size);
    case 'QUESTIONS': return erase(tx, 'Question', Prisma.sql`t.id IN (${q})`, size);
    case 'SECTIONS': return erase(tx, 'Section', Prisma.sql`t."postId" IN (${p})`, size);
    case 'SAVES': return erase(tx, 'user_saved_posts', Prisma.sql`t.post_id IN (${p})`, size);
    case 'HIDES': return erase(tx, 'user_hidden_posts', Prisma.sql`t.post_id IN (${p})`, size);
    case 'LIKES': return erase(tx, 'UserLike', Prisma.sql`t."postId" IN (${p})`, size);
    case 'VIEWS': return erase(tx, 'post_views', Prisma.sql`t."postId" IN (${p})`, size);
    case 'POST_MENTIONS': return erase(tx, 'Mention', Prisma.sql`t."postId" IN (${p})`, size);
    case 'POST_HASHTAGS': return erase(tx, 'PostHashtag', Prisma.sql`t."postId" IN (${p})`, size);
    case 'POST_TAGS': return erase(tx, 'PostTaggedUser', Prisma.sql`t."postId" IN (${p})`, size);
    case 'POST_MEDIA': return erase(tx, 'PostMedia', Prisma.sql`t."postId" IN (${p})`, size);
    case 'INTERACTIONS': return erase(tx, 'InteractionEvent', Prisma.sql`t.post_id IN (${p})`, size);
    // Report snapshots contain the Page post text and publisher identity. A legal
    // hold pauses this worker; after release, erase reports before their targets.
    case 'REPORTS': return erase(tx, 'reports', Prisma.sql`t.target_type = 'POST' AND t.target_id IN (${p})`, size);
    case 'CASES': {
      const deleted = await erase(tx, 'PageCase', Prisma.sql`t."pageId" = ${job.pageId} AND NOT EXISTS
        (SELECT 1 FROM "PageCase" child WHERE child."parentId" = t.id)`, size);
      if (deleted) return deleted;
      // Historical/corrupt cycles (or cross-Page references) cannot strand case
      // evidence after the job moves on. Detach a bounded set of remaining edges.
      return tx.$executeRaw(Prisma.sql`UPDATE "PageCase" SET "parentId" = NULL WHERE id IN
        (SELECT child.id FROM "PageCase" child JOIN "PageCase" parent ON parent.id = child."parentId"
         WHERE parent."pageId" = ${job.pageId} ORDER BY child.id LIMIT ${size})`);
    }
    case 'EXTERNAL_REPORTS': return tx.$executeRaw(Prisma.sql`
      UPDATE reports SET target_snapshot = NULL WHERE id IN (
        SELECT report.id FROM reports report JOIN "Post" shared ON shared.id = report.target_id
        WHERE report.target_type = 'POST' AND report.target_snapshot IS NOT NULL
          AND shared."sharedRootPageId" = ${job.pageId}
        ORDER BY report.id LIMIT ${size})`);
    case 'EXTERNAL_SHARES': {
      // Shares copy the source title/description into their own Post rows.
      // Traverse the full share chain before deleting Page roots; preserve the
      // share author's independent caption and media while erasing copied text.
      // New shares carry an indexed root Page ID, so each normal batch is bounded.
      const copied = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT post.id FROM "Post" post WHERE post."sharedRootPageId" = ${job.pageId}
          AND (post."sharedCopiedTitle" IS NOT NULL OR post."sharedCopiedDescription" IS NOT NULL
            OR post."sharedCopiedCategory" IS NOT NULL)
        ORDER BY post.id LIMIT ${size}`);
      if (!copied.length) {
        // A pre-provenance Page share cannot safely be distinguished from an
        // independently edited share. Fail closed for a reviewed forward-fix.
        const legacy = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT child.id FROM "Post" child JOIN "Post" root ON root.id = child."sharedFromId"
          WHERE root."pageId" = ${job.pageId} AND child."sharedRootPageId" IS NULL LIMIT 1`);
        if (legacy.length) throw new Error('PAGE_LEGACY_SHARE_PROVENANCE_MISSING');
        return 0;
      }
      const ids = copied.map(post => post.id);
      // Repost mentions and hashtags are indexed from sharedCaption alone;
      // retain the author's independent caption and its social references.
      await tx.$executeRaw(Prisma.sql`UPDATE "Post" SET
        title = CASE WHEN title = "sharedCopiedTitle" THEN '' ELSE title END,
        description = CASE WHEN description = "sharedCopiedDescription" THEN '' ELSE description END,
        category = CASE WHEN category = "sharedCopiedCategory" THEN NULL ELSE category END,
        "sharedCopiedTitle" = NULL, "sharedCopiedDescription" = NULL, "sharedCopiedCategory" = NULL
        WHERE id IN (${Prisma.join(ids)})`);
      return ids.length;
    }
    case 'POSTS': {
      // Remove internal share edges in bounded batches before deleting roots. External shares are untouched.
      const detached = await tx.$executeRaw(Prisma.sql`UPDATE "Post" SET "sharedFromId" = NULL WHERE id IN
        (SELECT id FROM "Post" WHERE "pageId" = ${job.pageId} AND "sharedFromId" IS NOT NULL LIMIT ${size})`);
      if (detached) return detached;
      const deleted = await erase(tx, 'Post', Prisma.sql`t."pageId" = ${job.pageId} AND NOT EXISTS (SELECT 1 FROM "Post" child WHERE child."sharedFromId" = t.id)`, size);
      if (deleted) return deleted;
      // An invisible, content-free tombstone protects external share FKs. Its
      // author points to a synthetic deleted account, never the human publisher.
      if (!await tx.post.count({ where: { pageId: job.pageId } })) return 0;
      const anonymousAuthorId = tombstoneAuthorId(job.pageId);
      const existingAuthor = await tx.user.findUnique({ where: { id: anonymousAuthorId }, select: { status: true, name: true } });
      if (existingAuthor && (existingAuthor.status !== 'DELETED' || existingAuthor.name !== 'Deleted Page author'))
        throw new Error('PAGE_PURGE_ANON_ID_CONFLICT');
      if (!existingAuthor) await tx.user.create({ data: { id: anonymousAuthorId, name: 'Deleted Page author',
        handle: 'deleted_page_' + randomBytes(8).toString('hex'), status: 'DELETED', deletedAt: now,
        searchVisibility: false, isPrivate: true } });
      return tx.$executeRaw(Prisma.sql`UPDATE "Post" SET title = '', description = '', image = NULL,
        "sharedCaption" = NULL, "isDeleted" = true, "deletedAt" = ${now}, demographics = NULL,
        "authorId" = ${anonymousAuthorId}, category = NULL, "targetAudience" = NULL, "targetGroups" = NULL,
        "resultsWho" = NULL, "resultsDetail" = NULL, "resultsTiming" = NULL,
        "approvedById" = NULL, "rejectedById" = NULL, "rejectionReason" = NULL,
        "likesCount" = 0, "commentsCount" = 0, "responseCount" = 0, "sharesCount" = 0,
        "viewCount" = 0, "uniqueViewCount" = 0 WHERE id IN (SELECT id FROM "Post"
          WHERE "pageId" = ${job.pageId} AND ("authorId" <> ${anonymousAuthorId} OR NOT "isDeleted" OR title <> '' OR description <> ''
            OR image IS NOT NULL OR "sharedCaption" IS NOT NULL OR demographics IS NOT NULL OR category IS NOT NULL
            OR "targetAudience" IS NOT NULL OR "targetGroups" IS NOT NULL OR "resultsWho" IS NOT NULL
            OR "resultsDetail" IS NOT NULL OR "resultsTiming" IS NOT NULL) LIMIT ${size})`);
    }
    case 'MEMBERS': return erase(tx, 'PageMembership', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'FOLLOWS': return erase(tx, 'PageFollow', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'BLOCKS': return erase(tx, 'PageBlock', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'INVITATIONS': return erase(tx, 'PageInvitation', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'TRANSFERS': return erase(tx, 'PageOwnershipTransfer', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'EVENTS': return erase(tx, 'PageEvent', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'MEDIA_ROWS': return erase(tx, 'MediaAsset', Prisma.sql`t."pageId" = ${job.pageId} AND t.status = 'DELETED'`, size);
    case 'HANDLES': return erase(tx, 'PageHandle', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    default: throw new Error('PAGE_PURGE_UNKNOWN_PHASE');
  }
}

export async function processPagePurgeBatch(pageId: string, options: BatchOptions = {}) {
  const now = options.now ?? new Date(), size = pageLifecycleLimit(options.limit ?? 100);
  const token = randomUUID();
  try {
    const result = await pageTransaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Page" WHERE id = ${pageId} FOR UPDATE`;
      const page = await tx.page.findUnique({ where: { id: pageId } });
      const jobs = await tx.$queryRaw<Job[]>`SELECT * FROM "PagePurgeJob" WHERE "pageId" = ${pageId} FOR UPDATE`;
      const job = jobs[0];
      if (!page?.purgedAt || !job || job.completedAt || job.availableAt > now) return { state: 'idle' as const };
      if (await pageErasureHeld(tx, pageId, now)) {
        await tx.$executeRaw`UPDATE "PagePurgeJob" SET "availableAt" = ${new Date(now.getTime() + 60000)}, "lastErrorCode" = 'LEGAL_HOLD', "updatedAt" = ${now} WHERE "pageId" = ${pageId}`;
        return { state: 'held' as const };
      }
      if (await tx.pageCase.count({ where: { pageId, OR: [
        { status: { not: 'CLOSED' } }, { closedAt: null },
        { closedAt: { gt: pageRetentionCutoff(PAGE_POLICY.closedCaseRetentionDays, now) } }
      ] } })) {
        await tx.$executeRaw`UPDATE "PagePurgeJob" SET "availableAt" = ${new Date(now.getTime() + 60000)}, "lastErrorCode" = 'CASE_RETENTION', "updatedAt" = ${now} WHERE "pageId" = ${pageId}`;
        return { state: 'held' as const };
      }
      if (job.phase === 'FINALIZE') {
        // Never derive the tombstone handle from the public Page ID: another
        // account could reserve that value and prevent erasure from finishing.
        const anonymousHandle = 'deleted_' + randomBytes(11).toString('hex');
        await tx.page.update({ where: { id: pageId }, data: { name: '', bio: '', description: '', category: 'other',
          country: '', city: '', website: null, links: [], publicEmail: null, publicPhone: null, cta: null,
          avatarMediaId: null, coverMediaId: null, ownerId: null, handle: anonymousHandle,
          legalHoldUntil: null, legalHoldReason: null } });
        await pageAudit(tx, pageId, null, 'PAGE_PURGE_COMPLETED');
        await tx.$executeRaw`UPDATE "PagePurgeJob" SET "completedAt" = ${now}, "updatedAt" = ${now}, "leaseToken" = NULL, "lastErrorCode" = NULL WHERE "pageId" = ${pageId}`;
        return { state: 'completed' as const };
      }
      if (job.phase === 'MEDIA') {
        const assets = await tx.mediaAsset.findMany({ where: { pageId, status: { not: 'DELETED' } }, take: Math.min(size, 25), orderBy: { id: 'asc' }, select: { id: true } });
        if (assets.length) {
          // Refuse cross-entity media aliasing rather than destroying another entity's object.
          const ids = assets.map(asset => asset.id);
          const conflicts = await tx.mediaAsset.count({ where: { id: { in: ids }, OR: [
            { postAttachment: { is: { post: { OR: [{ pageId: null }, { pageId: { not: pageId } }] } } } },
            { avatarFor: { isNot: null } }, { coverFor: { isNot: null } }, { groupFor: { isNot: null } },
            { questionFor: { isNot: null } }, { optionFor: { isNot: null } },
            { avatarForPage: { is: { id: { not: pageId } } } }, { coverForPage: { is: { id: { not: pageId } } } },
          ] } });
          if (conflicts) throw new Error('PAGE_PURGE_MEDIA_REFERENCED_ELSEWHERE');
          await tx.mediaAsset.updateMany({ where: { id: { in: ids }, pageId }, data: { status: 'PENDING_DELETE' } });
          await tx.$executeRaw`UPDATE "PagePurgeJob" SET "leaseToken" = ${token}, "availableAt" = ${new Date(now.getTime() + 60000)}, "updatedAt" = ${now} WHERE "pageId" = ${pageId}`;
          return { state: 'media' as const, ids };
        }
      } else {
        const erased = await erasePhase(tx, job, size, now);
        if (erased) {
          await tx.$executeRaw`UPDATE "PagePurgeJob" SET "updatedAt" = ${now}, "lastErrorCode" = NULL WHERE "pageId" = ${pageId}`;
          return { state: 'progress' as const, erased };
        }
      }
      const next = phases[phases.indexOf(job.phase) + 1];
      if (!next) throw new Error('PAGE_PURGE_UNKNOWN_PHASE');
      await tx.$executeRaw`UPDATE "PagePurgeJob" SET phase = ${next}, "updatedAt" = ${now}, "lastErrorCode" = NULL WHERE "pageId" = ${pageId}`;
      return { state: 'progress' as const, erased: 0 };
    });
    if (result.state === 'media') {
      for (const id of result.ids) await (options.purgeAsset ?? purgeMediaAsset)(id);
      await prisma.$executeRaw`UPDATE "PagePurgeJob" SET "availableAt" = ${now}, "leaseToken" = NULL, "lastErrorCode" = NULL, "updatedAt" = ${now} WHERE "pageId" = ${pageId} AND "leaseToken" = ${token}`;
    }
    return result;
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.PAGES_EPHEMERAL_ERASURE_TEST === 'true') {
      const safeName = error instanceof Error && /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'UnknownError';
      const safeCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'NO_PRISMA_CODE';
      process.stderr.write(`PAGE_PURGE_EPHEMERAL_DIAGNOSTIC:${safeName}:${safeCode}\n`);
    }
    // Persist safe codes only: provider messages can contain object paths or credentials.
    const code = error instanceof Error && /^PAGE_PURGE_[A-Z_]+$/.test(error.message) ? error.message
      : error instanceof Prisma.PrismaClientKnownRequestError ? `PAGE_PURGE_DB_${error.code}` : 'PAGE_PURGE_RETRY_REQUIRED';
    await prisma.$executeRaw`UPDATE "PagePurgeJob" SET attempts = attempts + 1, "lastErrorCode" = ${code},
      "availableAt" = ${new Date(now.getTime() + 60000)}, "leaseToken" = NULL, "updatedAt" = ${now}
      WHERE "pageId" = ${pageId} AND "completedAt" IS NULL AND ("leaseToken" IS NULL OR "leaseToken" = ${token})`;
    return { state: 'retry' as const, code };
  }
}

export async function runPageLifecycleCycle(options: { pages?: number; batchSize?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const admitted = await admitPagePurges(options.pages ?? 10, now);
  const jobs = await prisma.$queryRaw<Job[]>(Prisma.sql`SELECT * FROM "PagePurgeJob" WHERE "completedAt" IS NULL
    AND "availableAt" <= ${now} ORDER BY "availableAt", "pageId" LIMIT ${pageLifecycleLimit(options.pages ?? 10, 25)}`);
  const batches = [];
  for (const job of jobs) batches.push({ pageId: job.pageId, ...await processPagePurgeBatch(job.pageId, { limit: options.batchSize, now }) });
  return { admitted, batches, retention: await processPageRetention(options.batchSize ?? 100, now) };
}

/** Root integrates this after DB migration. No immediate job/side effect at module import. */
export function startPageLifecycleWorker(intervalMs = 15000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    // A pilot allowlist must not start deletion/retention across all Pages.
    // Flag-off rollback pauses admission of new cycles; an in-flight cycle
    // finishes its current work. Direct recovery calls remain explicitly available.
    if (running || !pagesEnabled() || process.env.PAGES_LIFECYCLE_PAUSED === 'true') return;
    running = true;
    try { await runPageLifecycleCycle(); }
    catch { console.error('Page lifecycle cycle failed; durable jobs will retry.'); }
    finally { running = false; }
  }, Math.max(1000, intervalMs));
  timer.unref();
  return () => clearInterval(timer);
}
