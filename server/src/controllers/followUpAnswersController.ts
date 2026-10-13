import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { loadVisiblePostScalars } from '../services/postVisibilitySql';
import { readGuestParticipationHash } from '../services/guestParticipationService';
import { withAnalysisAdmission, AnalysisBusyError } from '../services/analysisCache';
import { activePageActor, lockPageForAnalytics, pageIsBlocked, pageRole, pageTransaction, requirePageCapability, PageTx } from '../pages/pageService';
import { hasPageCapability, PagePolicyError } from '../pages/pagePolicy';
import { assertPagesEnabled } from '../pages/pageFeature';
import { respondPagePostError } from '../pages/pagePostService';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pageSize = 20;
type Target = { id: string; authorId: string; pageId: string | null; forceAnonymous: boolean };

/** Raw answers have their own access contract and never enter the aggregate cache/DTO. */
async function readAnswers(tx: PageTx, post: Target, all: boolean, req: Request) {
  const optionId = req.query.optionId, cursor = req.query.cursor;
  if ((optionId !== undefined && (typeof optionId !== 'string' || !uuid.test(optionId))) ||
      (cursor !== undefined && (typeof cursor !== 'string' || !uuid.test(cursor) || !optionId))) {
    throw new PagePolicyError('INVALID_FOLLOW_UP_QUERY', 400);
  }
  const userId = req.user?.userId;
  const guestHash = !userId && readGuestParticipationHash(req);
  const response: Prisma.ResponseWhereInput = { postId: post.id, ...(!all ? userId ? { userId } : {
    userId: null, guestProofHash: guestHash || '__no_proof__', guestProofExpiresAt: { gt: new Date() },
  } : {}) };
  // Checking participation separately avoids revealing option counts to an unrelated viewer.
  const own = !all && (userId || guestHash) && await tx.response.findFirst({ where: response, select: { id: true } });
  const scope = all ? 'all' : own ? 'own' : 'none';
  if (scope === 'none') {
    if (optionId) throw new PagePolicyError('FOLLOW_UP_ACCESS_DENIED', 403);
    return { version: 1, scope, groups: [], totalAnswers: 0 };
  }
  const options = await tx.option.findMany({
    where: { withFollowUp: true, ...(optionId ? { id: optionId as string } : {}), question: {
      OR: [{ postId: post.id }, { section: { postId: post.id } }],
    } },
    select: { id: true, text: true, followUpLabel: true, questionId: true, question: { select: { text: true } } },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  });
  const where: Prisma.AnswerWhereInput = { response, textValue: { not: '' }, OR: options.map(option => ({ optionId: option.id, questionId: option.questionId })) };
  if (optionId) {
    if (!options.length) throw new PagePolicyError('FOLLOW_UP_NOT_FOUND', 404);
    const rows = await tx.answer.findMany({
      where: { ...where, ...(cursor ? { id: { gt: cursor as string } } : {}) },
      orderBy: { id: 'asc' }, take: pageSize + 1,
      select: { id: true, textValue: true, response: { select: {
        isAnonymous: true, userId: true, user: { select: { name: true, status: true } },
      } } },
    });
    const items = rows.slice(0, pageSize).map(row => {
      const anonymous = post.forceAnonymous || row.response.isAnonymous || !row.response.userId;
      return { id: row.id, text: row.textValue, isAnonymous: anonymous,
        displayName: anonymous ? null : row.response.user?.status === 'ACTIVE' ? row.response.user.name : null };
    });
    return { version: 1, scope, items, nextCursor: rows.length > pageSize ? items.at(-1)!.id : null };
  }
  const counts = options.length ? await tx.answer.groupBy({ by: ['optionId', 'questionId'], where, _count: { _all: true } }) : [];
  const groups = options.map(option => ({ questionId: option.questionId, questionText: option.question.text,
    optionId: option.id, optionText: option.text, followUpLabel: option.followUpLabel || '',
    answerCount: counts.find(count => count.optionId === option.id && count.questionId === option.questionId)?._count._all || 0,
  })).filter(group => all || group.answerCount > 0);
  return { version: 1, scope, groups, totalAnswers: groups.reduce((sum, group) => sum + group.answerCount, 0) };
}

async function handle(req: Request, res: Response, managed: boolean) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization, Cookie');
  try {
    const rawId = (managed ? req.params.postId : req.params.id) as string;
    if (!uuid.test(rawId || '')) throw new PagePolicyError('FOLLOW_UP_NOT_FOUND', 404);
    const body = await withAnalysisAdmission(() => pageTransaction(async tx => {
      const userId = req.user?.userId;
      if (managed) {
        if (!userId) throw new PagePolicyError('AUTH_TOKEN_REQUIRED', 401);
        assertPagesEnabled(userId);
        const pageId = req.params.id as string;
        if (!uuid.test(pageId || '')) throw new PagePolicyError('PAGE_POST_NOT_FOUND', 404);
        const page = await lockPageForAnalytics(tx, pageId);
        await activePageActor(tx, userId);
        await requirePageCapability(tx, page, userId, 'analytics');
        if (await pageIsBlocked(tx, pageId, userId)) throw new PagePolicyError('PAGE_POST_NOT_FOUND', 404);
        const wrapper = await tx.post.findFirst({ where: { id: rawId, pageId, isDeleted: false, status: 'PUBLISHED' } });
        if (!wrapper) throw new PagePolicyError('PAGE_POST_NOT_FOUND', 404);
        const post = wrapper.sharedFromId ? await tx.post.findFirst({ where: {
          id: wrapper.sharedFromId, pageId, isDeleted: false, status: 'PUBLISHED',
        } }) : wrapper;
        if (!post) throw new PagePolicyError('PAGE_SOURCE_RESULTS_REQUIRE_OWN_ACCESS', 403);
        return readAnswers(tx, post, true, req);
      }
      const visible = async (id: string) => (await loadVisiblePostScalars(tx, { ids: [id], viewerId: userId, limit: 1 }))[0];
      let wrapper = await visible(rawId);
      let post = wrapper?.sharedFromId ? await visible(wrapper.sharedFromId) : wrapper;
      if (!post) throw new PagePolicyError('FOLLOW_UP_NOT_FOUND', 404);
      let all = !post.pageId && !!userId && post.authorId === userId;
      if (post.pageId) {
        const page = await lockPageForAnalytics(tx, post.pageId);
        // ReadCommitted rechecks visibility and membership after a queued revocation.
        wrapper = await visible(rawId);
        post = wrapper?.sharedFromId ? await visible(wrapper.sharedFromId) : wrapper;
        if (!post || post.pageId !== page.id) throw new PagePolicyError('FOLLOW_UP_NOT_FOUND', 404);
        all = hasPageCapability(await pageRole(tx, page, userId), 'analytics');
      }
      return readAnswers(tx, post as Target, all, req);
    }, 'ReadCommitted'));
    res.json(body);
  } catch (error) {
    if (error instanceof AnalysisBusyError) { res.setHeader('Retry-After', '1'); res.status(503).json({ error: 'Analysis is busy; please retry shortly' }); return; }
    if (respondPagePostError(error, res)) return;
    // Never log a response body, participant identity, or raw answer.
    console.error('follow_up_answers_failed', { code: (error as { code?: string })?.code || 'UNKNOWN' });
    res.status(500).json({ error: 'Failed to fetch follow-up answers' });
  }
}

export const getPostFollowUpAnswers = (req: Request, res: Response) => handle(req, res, false);
export const getPageManagedFollowUpAnswers = (req: Request, res: Response) => handle(req, res, true);
