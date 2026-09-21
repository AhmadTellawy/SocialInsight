import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import prisma from '../prisma';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware';
import { PAGE_POLICY, PagePolicyError } from './pagePolicy';
import { assertPagePublic, changePageLifecycle, createPage, getManagedPage, getPublicPage, pageBlockAction,
  pageDiscoveryWhere, pageFollowAction, pageManagementDto, pagePublicDto, updatePageInfo } from './pageService';
import { changePageHandle, changePageMember, invitePageMember, leavePageTeam,
  respondPageInvitation, respondPageTransfer, startPageTransfer } from './pageTeamService';
import { getPageAnalytics, pageAnalyticsCsv } from './pageAnalyticsService';
import { updatePageMedia } from './pageMediaService';
import { decidePageCase, isPageStaff, managerCaseDto, openPageCase, reporterCaseDto, requirePageStaff } from './pageCaseService';
import { pageTransaction } from './pageService';
import { pageContent } from './pageContentService';
import { pagesEnabled } from './pageFeature';
import { buildVisiblePublishedPostWhere } from '../services/postVisibilityService';
import { hasPageCapability, mayManagePageRole, PageRole } from './pagePolicy';
import { getPageManagedPostResults } from '../controllers/postController';
import { pageRole } from './pageService';
import { MediaValidationError } from '../services/mediaProcessor';

const router = Router();
const uuid = z.string().uuid();
const id = (req: Request) => uuid.parse(req.params.id);
const user = (req: Request) => req.user!.userId;
const queryText = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 160) : '';
const pageLimit = (value: unknown) => Math.min(PAGE_POLICY.maxPageSize, Math.max(1, Number.parseInt(queryText(value), 10) || PAGE_POLICY.pageSize));
const nextCursor = (rows: Array<{id: string}>, limit: number) => rows.length > limit ? rows[limit - 1].id : null;
const cursorArgs = (value: unknown): { cursor?: { id: string }; skip?: number } =>
  typeof value === 'string' && value ? { cursor: { id: uuid.parse(value) }, skip: 1 } : {};
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };

router.use(optionalAuth);
router.use((_req, res, next) => {
  // Public data is personalised by follow/block state; no shared cache or service-worker persistence.
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get('/availability',(req,res)=>res.json({available:pagesEnabled(req.user?.userId)}));
router.use((req, res, next) => {
  if (pagesEnabled(req.user?.userId)) return next();
  res.status(404).json({ code: 'PAGES_UNAVAILABLE', error: 'Pages are unavailable' });
});

const creationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10,
  keyGenerator: req => user(req), standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ code: 'PAGE_CREATE_RATE_LIMIT', error: 'Try again after the indicated waiting period.' }) });
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
  keyGenerator: req => user(req), standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ code: 'PAGE_SENSITIVE_RATE_LIMIT', error: 'Try again after the indicated waiting period.' }) });

router.post('/content-access',handle(async(req,res)=>{
  const input=z.object({items:z.array(z.object({id:uuid,management:z.boolean().optional()}).strict()).max(50)}).strict().parse(req.body);
  const visible=await prisma.post.findMany({where:{id:{in:input.items.map(item=>item.id)},...buildVisiblePublishedPostWhere(req.user?.userId)},select:{id:true}});
  const publicIds=new Set(visible.map(post=>post.id));
  const allowed=new Set(input.items.filter(item=>publicIds.has(item.id)).map(item=>item.id+':'+(item.management?'management':'public')));
  if(req.user){
    const privatePosts=await prisma.post.findMany({where:{id:{in:input.items.filter(item=>item.management).map(item=>item.id)},pageId:{not:null},isDeleted:false,status:'PUBLISHED'},include:{page:true}});
    const roleCache=new Map<string,boolean>();
    for(const post of privatePosts){if(!post.page||post.page.purgedAt)continue;
      if(!roleCache.has(post.page.id))roleCache.set(post.page.id,hasPageCapability(await pageRole(prisma,post.page,user(req)),'analytics')&&!await prisma.pageBlock.count({where:{pageId:post.page.id,userId:user(req)}}));
      if(roleCache.get(post.page.id))allowed.add(post.id+':management');
    }
  }
  return res.json({allowed:[...allowed]});
}));

router.get('/blocks',requireAuth,handle(async(req,res)=>{
  const rows=await prisma.pageBlock.findMany({where:{userId:user(req),direction:'USER_TO_PAGE',page:{purgedAt:null}},select:{pageId:true,page:{select:{id:true,name:true,handle:true}}},orderBy:{pageId:'asc'},take:51,
    ...(req.query.cursor?{cursor:{pageId_userId_direction:{pageId:uuid.parse(req.query.cursor),userId:user(req),direction:'USER_TO_PAGE'}},skip:1}:{})});
  return res.json({items:rows.slice(0,50).map(row=>row.page),nextCursor:rows.length>50?rows[49].pageId:null});
}));

router.get('/', handle(async (req, res) => {
  const limit = pageLimit(req.query.limit), q = queryText(req.query.q), following = req.query.tab === 'following';
  if (following && !req.user) return res.status(401).json({ code: 'AUTH_TOKEN_REQUIRED' });
  const where: Prisma.PageWhereInput = { ...pageDiscoveryWhere(req.user?.userId),
    ...(following ? { follows: { some: { userId: user(req) } } } : {}),
    ...(q ? { OR: [{ handle: { contains: q.toLowerCase() } }, { name: { contains: q, mode: 'insensitive' } }, { bio: { contains: q, mode: 'insensitive' } }] } : {}) };
  const rows = await prisma.page.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(req.query.cursor), take: limit + 1, include: { _count: { select: { follows: true } } } });
  const items = rows.slice(0, limit).map(page => ({ ...pagePublicDto(page), followersCount: page._count.follows }));
  // An exact current handle gets the leading slot only on the first search page.
  if (q && !req.query.cursor) {
    const exact = await prisma.page.findFirst({ where: { ...where, handle: q.toLowerCase() }, include: { _count: { select: { follows: true } } } });
    if (exact) {
      const existing = items.findIndex(item => item.id === exact.id);
      if (existing >= 0) items.splice(existing, 1);
      items.unshift({ ...pagePublicDto(exact), followersCount: exact._count.follows });
    }
  }
  return res.json({ items, nextCursor: nextCursor(rows, limit) });
}));

router.post('/', requireAuth, creationLimiter, handle(async (req, res) => res.status(201).json(await createPage(user(req), req.body))));
router.get('/mine', requireAuth, handle(async (req, res) => {
  const limit = pageLimit(req.query.limit);
  const rows = await prisma.page.findMany({ where: { purgedAt: null, OR: [{ ownerId: user(req) }, { members: { some: { userId: user(req) } } }] },
    include: { members: { where: { userId: user(req) }, select: { role: true } }, _count: { select: { follows: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(req.query.cursor), take: limit + 1 });
  return res.json({ items: rows.slice(0, limit).map(page => ({ ...pageManagementDto(page,
    page.ownerId === user(req) ? 'OWNER' : page.members[0].role as 'ADMIN' | 'EDITOR' | 'ANALYST'), followersCount: page._count.follows })), nextCursor: nextCursor(rows, limit) });
}));
const caseLimiter=rateLimit({windowMs:60*60*1000,limit:10,keyGenerator:req=>user(req),standardHeaders:true,legacyHeaders:false});
router.get('/staff/access',requireAuth,handle(async(req,res)=>{
  await requirePageStaff(prisma,user(req));return res.json({review:true,ownership:isPageStaff(user(req),true)});
}));
router.get('/staff/cases',requireAuth,handle(async(req,res)=>{
  await requirePageStaff(prisma,user(req));const limit=pageLimit(req.query.limit);
  const status=z.enum(['OPEN','IN_REVIEW','CLOSED']).optional().parse(req.query.status);
  const rows=await prisma.pageCase.findMany({where:status?{status}:{},orderBy:[{createdAt:'desc'},{id:'desc'}],...cursorArgs(req.query.cursor),take:limit+1,
    include:{page:{select:{name:true,handle:true,platformState:true,safetyHiddenAt:true}}}});
  return res.json({items:rows.slice(0,limit),nextCursor:nextCursor(rows,limit)});
}));
router.get('/cases',requireAuth,handle(async(req,res)=>{
  const limit=pageLimit(req.query.limit);const rows=await prisma.pageCase.findMany({where:{reporterId:user(req)},orderBy:[{createdAt:'desc'},{id:'desc'}],...cursorArgs(req.query.cursor),take:limit+1});
  return res.json({items:rows.slice(0,limit).map(reporterCaseDto),nextCursor:nextCursor(rows,limit)});
}));
router.get('/cases/:id',requireAuth,handle(async(req,res)=>{
  const current=await prisma.pageCase.findUnique({where:{id:id(req)},include:{page:{select:{ownerId:true,name:true,handle:true}}}});
  if(!current)throw new PagePolicyError('PAGE_CASE_NOT_FOUND',404);
  if(isPageStaff(user(req))){await requirePageStaff(prisma,user(req));return res.json(current);}
  if(current.reporterId===user(req))return res.json(reporterCaseDto(current));
  if(current.page.ownerId===user(req))return res.json(managerCaseDto(current));
  throw new PagePolicyError('PAGE_CASE_NOT_FOUND',404);
}));
router.get('/manage/:id/cases',requireAuth,handle(async(req,res)=>{
  const page=await getManagedPage(id(req),user(req));if(page.role!=='OWNER')throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  const limit=pageLimit(req.query.limit);const rows=await prisma.pageCase.findMany({where:{pageId:id(req),status:'CLOSED'},orderBy:[{createdAt:'desc'},{id:'desc'}],...cursorArgs(req.query.cursor),take:limit+1});
  return res.json({items:rows.slice(0,limit).map(managerCaseDto),nextCursor:nextCursor(rows,limit)});
}));
router.post('/:id/cases',requireAuth,caseLimiter,handle(async(req,res)=>res.status(201).json(await openPageCase(id(req),user(req),req.body))));
router.post('/staff/cases/:id/assign',requireAuth,handle(async(req,res)=>{
  const input=z.object({assigneeId:uuid}).strict().parse(req.body);
  return res.json(await pageTransaction(async tx=>{await requirePageStaff(tx,user(req));await requirePageStaff(tx,input.assigneeId);
    const changed=await tx.pageCase.updateMany({where:{id:id(req),status:{not:'CLOSED'}},data:{assigneeId:input.assigneeId,status:'IN_REVIEW'}});
    if(!changed.count)throw new PagePolicyError('PAGE_CASE_UNAVAILABLE',409);return {assigned:true};}));
}));
router.post('/staff/cases/:id/decision',requireAuth,sensitiveLimiter,handle(async(req,res)=>res.json(await decidePageCase(id(req),user(req),req.body))));
router.get('/invitations', requireAuth, handle(async (req, res) => {
  const rows = await prisma.pageInvitation.findMany({ where: { recipientId: user(req), status: 'PENDING', expiresAt: { gt: new Date() }, page: { purgedAt: null } },
    select: { id: true, role: true, expiresAt: true, page: { select: { id: true, name: true, handle: true } } }, take: 51,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(req.query.cursor) });
  return res.json({ items: rows.slice(0,50), nextCursor: nextCursor(rows,50) });
}));
router.post('/invitations/:id/:action', requireAuth, handle(async (req, res) =>
  res.json(await respondPageInvitation(id(req), user(req), z.enum(['accept', 'reject', 'withdraw']).parse(req.params.action)))));
router.get('/transfers', requireAuth, handle(async (req, res) => {
  const rows = await prisma.pageOwnershipTransfer.findMany({ where: { recipientId: user(req), status: 'PENDING', expiresAt: { gt: new Date() } },
    select: { id: true, expiresAt: true, page: { select: { id: true, name: true, handle: true } } }, take: 51,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(req.query.cursor) });
  return res.json({ items: rows.slice(0,50), nextCursor: nextCursor(rows,50) });
}));
router.post('/transfers/:id/:action', requireAuth, handle(async (req, res) =>
  res.json(await respondPageTransfer(id(req), user(req), z.enum(['accept', 'reject', 'withdraw']).parse(req.params.action)))));

router.get('/manage/:id', requireAuth, handle(async (req, res) => res.json(await getManagedPage(id(req), user(req)))));
router.get('/manage/:id/content/:postId/results',requireAuth,getPageManagedPostResults);
router.get('/manage/:id/requests',requireAuth,handle(async(req,res)=>{
  const managed=await getManagedPage(id(req),user(req));const kind=z.enum(['invitation','transfer']).parse(req.query.kind);
  if(kind==='transfer'?managed.role!=='OWNER':!managed.capabilities.includes('manageTeam'))throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  const args={where:{pageId:id(req)},orderBy:[{createdAt:'desc' as const},{id:'desc' as const}],take:51,...cursorArgs(req.query.cursor)};
  const rows=kind==='transfer'?await prisma.pageOwnershipTransfer.findMany(args):await prisma.pageInvitation.findMany(args);
  const people=await prisma.user.findMany({where:{id:{in:rows.map(row=>row.recipientId)}},select:{id:true,name:true,handle:true}});
  return res.json({items:rows.slice(0,50).map(row=>({id:row.id,status:row.status==='PENDING'&&row.expiresAt<=new Date()?'EXPIRED':row.status,role:'role'in row?row.role:undefined,expiresAt:row.expiresAt,recipient:people.find(person=>person.id===row.recipientId)||null,
    canWithdraw:row.status==='PENDING'&&row.expiresAt>new Date()&&(kind==='transfer'||mayManagePageRole(managed.role as PageRole,('role'in row?row.role:'OWNER') as PageRole))})),nextCursor:nextCursor(rows,50)});
}));
router.get('/manage/:id/blocks',requireAuth,handle(async(req,res)=>{
  const managed=await getManagedPage(id(req),user(req));if(!managed.capabilities.includes('block'))throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  const rows=await prisma.pageBlock.findMany({where:{pageId:id(req),direction:'PAGE_TO_USER'},select:{userId:true,user:{select:{id:true,name:true,handle:true}}},orderBy:{userId:'asc'},take:51,
    ...(req.query.cursor?{cursor:{pageId_userId_direction:{pageId:id(req),userId:uuid.parse(req.query.cursor),direction:'PAGE_TO_USER'}},skip:1}:{})});
  return res.json({items:rows.slice(0,50),nextCursor:rows.length>50?rows[49].userId:null});
}));
router.get('/manage/:id/analytics', requireAuth, handle(async (req,res) =>
  res.json(await getPageAnalytics(id(req),user(req),req.query.days === '7' ? 7 : 30))));
router.get('/manage/:id/analytics.csv', requireAuth, handle(async (req,res) => {
  const stats = await getPageAnalytics(id(req),user(req),req.query.days === '7' ? 7 : 30,true);
  res.setHeader('Content-Disposition','attachment; filename="page-analytics.csv"');
  res.type('text/csv; charset=utf-8').send(pageAnalyticsCsv(stats,req.query.lang === 'ar' ? 'ar' : 'en'));
}));
router.patch('/manage/:id', requireAuth, handle(async (req, res) => res.json(await updatePageInfo(user(req), id(req), req.body))));
router.get('/manage/:id/content',requireAuth,handle(async(req,res)=>res.json(await pageContent(id(req),user(req),{
  limit:pageLimit(req.query.limit),cursor:typeof req.query.cursor==='string'?uuid.parse(req.query.cursor):undefined,
  status:z.enum(['DRAFT','PUBLISHED']).optional().parse(req.query.status)}))));
router.get('/manage/:id/content/:postId',requireAuth,handle(async(req,res)=>{
  const result=await pageContent(id(req),user(req),{postId:uuid.parse(req.params.postId),limit:1});
  if(!result.items.length)throw new PagePolicyError('PAGE_POST_UNAVAILABLE',404);return res.json(result.items[0]);
}));
router.put('/manage/:id/media',requireAuth,handle(async(req,res)=>res.json(await updatePageMedia(id(req),user(req),req.body))));
router.post('/manage/:id/lifecycle', requireAuth, handle(async (req, res) => {
  const input = z.object({ action: z.enum(['publish','unpublish','delete','cancel-delete']) }).strict().parse(req.body);
  return res.json(await changePageLifecycle(user(req), id(req), input.action));
}));
router.post('/manage/:id/handle', requireAuth, sensitiveLimiter, handle(async (req, res) => res.json(await changePageHandle(id(req), user(req), req.body))));
router.post('/manage/:id/transfer', requireAuth, sensitiveLimiter, handle(async (req, res) => res.json(await startPageTransfer(id(req), user(req), req.body))));
router.post('/manage/:id/invitations', requireAuth, sensitiveLimiter, handle(async (req, res) => res.status(201).json(await invitePageMember(id(req), user(req), req.body))));
router.patch('/manage/:id/team/:userId', requireAuth, handle(async (req, res) => {
  const input = z.object({ role: z.enum(['ADMIN','EDITOR','ANALYST']).nullable() }).strict().parse(req.body);
  return res.json(await changePageMember(id(req), user(req), uuid.parse(req.params.userId), input.role));
}));
router.post('/manage/:id/leave', requireAuth, handle(async (req, res) => res.json(await leavePageTeam(id(req), user(req)))));
router.get('/manage/:id/team', requireAuth, handle(async (req, res) => {
  const managed = await getManagedPage(id(req), user(req));
  if (!managed.capabilities.includes('manageTeam')) throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  const rows = await prisma.pageMembership.findMany({ where: { pageId: id(req) },
    select: { userId: true, role: true, user: { select: { id: true, name: true, handle: true, status: true,emailVerifiedAt:true } } },
    orderBy: { userId: 'asc' }, take: 51,
    ...(req.query.cursor ? { cursor: { pageId_userId: { pageId: id(req), userId: uuid.parse(req.query.cursor) } }, skip: 1 } : {}) });
  const page = await prisma.page.findUniqueOrThrow({ where: { id: id(req) }, select: { owner: { select: { id: true, name: true, handle: true, status: true } } } });
  return res.json({ owner: page.owner, items: rows.slice(0,50).map(({user:person,...row})=>({...row,user:{id:person.id,name:person.name,handle:person.handle,status:person.status,emailConfirmed:!!person.emailVerifiedAt}})), nextCursor: rows.length > 50 ? rows[49].userId : null });
}));
router.get('/manage/:id/team-candidate', requireAuth, handle(async (req, res) => {
  const managed = await getManagedPage(id(req), user(req));
  if (!managed.capabilities.includes('manageTeam')) throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  const handle = queryText(req.query.handle).replace(/^@/, '').toLowerCase();
  const candidate = await prisma.user.findFirst({ where: { handle, status: 'ACTIVE',
    blocking: { none: { blockedId: user(req) } }, blockedBy: { none: { blockerId: user(req) } },
    pageBlocks: { none: { pageId: id(req) } } }, select: { id: true, name: true, handle: true } });
  return res.json({ candidate });
}));
router.get('/manage/:id/audit', requireAuth, handle(async (req, res) => {
  const managed = await getManagedPage(id(req), user(req));
  if (!managed.capabilities.includes('audit')) throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);
  const limit = pageLimit(req.query.limit);
  const rows = await prisma.pageAuditEvent.findMany({ where: { pageId: id(req), action: { notIn: ['FOLLOW_CHANGED','CASE_OPENED','STAFF_CASE_DECIDED'] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(req.query.cursor), take: limit + 1 });
  return res.json({ items: rows.slice(0,limit), nextCursor: nextCursor(rows,limit) });
}));
router.get('/:id/follow', requireAuth, handle(async (req, res) => {
  const page = await prisma.page.findUnique({ where: { id: id(req) } });
  if (!page) throw new PagePolicyError('PAGE_NOT_FOUND',404);
  await assertPagePublic(prisma,page,user(req));
  const follow = await prisma.pageFollow.findUnique({where:{pageId_userId:{pageId:page.id,userId:user(req)}}});
  return res.json({followStatus:follow?'ACTIVE':'NONE',isFollowing:!!follow});
}));
router.post('/:id/follow', requireAuth, handle(async (req, res) => {
  const input = z.object({ action: z.enum(['follow','unfollow','mute','unmute']) }).strict().parse(req.body);
  return res.json(await pageFollowAction(user(req), id(req), input.action));
}));
router.post('/:id/block', requireAuth, handle(async (req, res) => {
  const input = z.object({ blocked: z.boolean() }).strict().parse(req.body);
  return res.json(await pageBlockAction(user(req), id(req), user(req), 'USER_TO_PAGE', input.blocked));
}));
router.post('/manage/:id/blocks', requireAuth, handle(async (req, res) => {
  const input = z.object({ userId: uuid, blocked: z.boolean() }).strict().parse(req.body);
  return res.json(await pageBlockAction(user(req), id(req), input.userId, 'PAGE_TO_USER', input.blocked));
}));
router.get('/:handle', handle(async (req, res) => res.json(await getPublicPage(z.string().max(30).parse(req.params.handle), req.user?.userId))));

router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof PagePolicyError) return res.status(error.status).json({ code: error.code, error: error.code, requestId: req.requestId });
  if (error instanceof MediaValidationError) return res.status(error.statusCode).json({ code: error.code, error: error.message, requestId: req.requestId });
  if (error instanceof ZodError) return res.status(400).json({ code: 'PAGE_INVALID_INPUT', error: 'Check the supplied fields', fields: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ code: 'PAGE_CONFLICT', error: 'This value or request already exists' });
    if (error.code === 'P2034') return res.status(409).json({ code: 'PAGE_RETRY_CONFLICT', error: 'The data changed. Please try again.' });
    if (error.code === 'P2025') return res.status(404).json({ code: 'PAGE_NOT_FOUND', error: 'Page unavailable' });
  }
  console.error(JSON.stringify({ event: 'page_request_failed', requestId: req.requestId, code: error instanceof Error ? error.name : 'UNKNOWN' }));
  return res.status(500).json({ code: 'PAGE_REQUEST_FAILED', error: 'Unable to complete the request', requestId: req.requestId });
});

export default router;
