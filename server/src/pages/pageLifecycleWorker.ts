import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { purgeMediaAsset } from '../services/mediaService';
import { PAGE_POLICY } from './pagePolicy';
import { pagesEnabled } from './pageFeature';
import { PageTx, pageAudit, pageTransaction } from './pageService';
import { pageErasureHeld, pageLifecycleLimit, pageRetentionCutoff, processPageRetention } from './pageRetentionService';

const phases = ['NOTIFICATIONS', 'ANSWERS', 'RESPONSES', 'COMMENT_LIKES', 'COMMENT_MENTIONS',
  'COMMENT_HASHTAGS', 'COMMENTS', 'OPTIONS', 'QUESTIONS', 'SECTIONS', 'SAVES', 'HIDES', 'LIKES',
  'VIEWS', 'POST_MENTIONS', 'POST_HASHTAGS', 'POST_TAGS', 'POST_MEDIA', 'INTERACTIONS', 'POSTS',
  'MEMBERS', 'FOLLOWS', 'BLOCKS', 'INVITATIONS', 'TRANSFERS', 'EVENTS', 'MEDIA', 'MEDIA_ROWS', 'FINALIZE'] as const;
type Phase = typeof phases[number];
type Job = { pageId: string; phase: Phase; attempts: number; availableAt: Date; completedAt: Date | null };
type BatchOptions = { limit?: number; now?: Date; purgeAsset?: (id: string) => Promise<void> };

/** Admit irrevocable erasure under the same Page lock as cancellation. All content stays inaccessible. */
export async function admitPagePurges(limit = 10, now = new Date()): Promise<number> {
  const cutoff = pageRetentionCutoff(PAGE_POLICY.deletionGraceDays, now);
  const due = await prisma.page.findMany({ where: { purgedAt: null, deletionRequestedAt: { lte: cutoff },
    OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lte: now } }], cases: { none: { legalHoldUntil: { gt: now } } } },
    take: pageLifecycleLimit(limit, 25), orderBy: [{ deletionRequestedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  let admitted = 0;
  for (const candidate of due) {
    const changed = await pageTransaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Page" WHERE id = ${candidate.id} FOR UPDATE`;
      const page = await tx.page.findUnique({ where: { id: candidate.id } });
      if (!page || page.purgedAt || !page.deletionRequestedAt || page.deletionRequestedAt > cutoff || await pageErasureHeld(tx, page.id, now)) return false;
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

async function erasePhase(tx: PageTx, job: Job, size: number, now: Date): Promise<number> {
  const p = postIds(job.pageId), q = questionIds(job.pageId), c = commentIds(job.pageId);
  switch (job.phase) {
    case 'NOTIFICATIONS': return erase(tx, 'notifications', Prisma.sql`(t."targetType" IN ('post','survey') AND t."targetId" IN (${p})) OR (t."targetType" = 'comment' AND t."targetId" IN (${c})) OR t.dedupe_key IN (SELECT 'page-event:' || id FROM "PageEvent" WHERE "pageId" = ${job.pageId})`, size);
    case 'ANSWERS': return erase(tx, 'Answer', Prisma.sql`t."responseId" IN (SELECT id FROM "Response" WHERE "postId" IN (${p})) OR t."questionId" IN (${q})`, size);
    case 'RESPONSES': return erase(tx, 'Response', Prisma.sql`t."postId" IN (${p})`, size);
    case 'COMMENT_LIKES': return erase(tx, 'CommentLike', Prisma.sql`t."commentId" IN (${c})`, size);
    case 'COMMENT_MENTIONS': return erase(tx, 'Mention', Prisma.sql`t."commentId" IN (${c})`, size);
    case 'COMMENT_HASHTAGS': return erase(tx, 'CommentHashtag', Prisma.sql`t."commentId" IN (${c})`, size);
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
    case 'POSTS': {
      // Remove internal share edges in bounded batches before deleting roots. External shares are untouched.
      const detached = await tx.$executeRaw(Prisma.sql`UPDATE "Post" SET "sharedFromId" = NULL WHERE id IN
        (SELECT id FROM "Post" WHERE "pageId" = ${job.pageId} AND "sharedFromId" IS NOT NULL LIMIT ${size})`);
      if (detached) return detached;
      const deleted = await erase(tx, 'Post', Prisma.sql`t."pageId" = ${job.pageId} AND NOT EXISTS (SELECT 1 FROM "Post" child WHERE child."sharedFromId" = t.id)`, size);
      if (deleted) return deleted;
      // A minimal invisible tombstone protects external share FKs without rewriting their authors/content.
      return tx.$executeRaw(Prisma.sql`UPDATE "Post" SET title = '', description = '', image = NULL,
        "sharedCaption" = NULL, "isDeleted" = true, "deletedAt" = ${now}, demographics = NULL,
        "approvedById" = NULL, "rejectedById" = NULL, "rejectionReason" = NULL,
        "likesCount" = 0, "commentsCount" = 0, "responseCount" = 0, "sharesCount" = 0,
        "viewCount" = 0, "uniqueViewCount" = 0 WHERE id IN (SELECT id FROM "Post"
          WHERE "pageId" = ${job.pageId} AND (NOT "isDeleted" OR title <> '' OR description <> '' OR image IS NOT NULL OR "sharedCaption" IS NOT NULL) LIMIT ${size})`);
    }
    case 'MEMBERS': return erase(tx, 'PageMembership', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'FOLLOWS': return erase(tx, 'PageFollow', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'BLOCKS': return erase(tx, 'PageBlock', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'INVITATIONS': return erase(tx, 'PageInvitation', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'TRANSFERS': return erase(tx, 'PageOwnershipTransfer', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'EVENTS': return erase(tx, 'PageEvent', Prisma.sql`t."pageId" = ${job.pageId}`, size);
    case 'MEDIA_ROWS': return erase(tx, 'MediaAsset', Prisma.sql`t."pageId" = ${job.pageId} AND t.status = 'DELETED'`, size);
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
      if (job.phase === 'FINALIZE') {
        await tx.page.update({ where: { id: pageId }, data: { name: '', bio: '', description: '', category: 'other',
          country: '', city: '', website: null, links: [], publicEmail: null, publicPhone: null, cta: null,
          avatarMediaId: null, coverMediaId: null, legalHoldUntil: null, legalHoldReason: null } });
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
