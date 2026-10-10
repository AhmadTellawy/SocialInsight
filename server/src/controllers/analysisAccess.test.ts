import test, { after } from 'node:test';
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'synthetic-analysis-test-key';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const { getPostResults } = require('./postController') as typeof import('./postController');
after(async () => { await prisma.$disconnect(); });

for (const scenario of [
  { name: 'public', who: 'Public', timing: 'AnyTime', expected: 200 },
  { name: 'only author', who: 'OnlyMe', timing: 'AnyTime', expected: 403 },
  { name: 'author bypass', who: 'OnlyMe', timing: 'AfterEnd', owner: true, expected: 200 },
  { name: 'followers rejected', who: 'Followers', timing: 'AnyTime', expected: 403 },
  { name: 'active follower', who: 'Followers', timing: 'AnyTime', follows: true, expected: 200 },
  { name: 'participant rejected', who: 'Participants', timing: 'AnyTime', expected: 403 },
  { name: 'participant accepted', who: 'Participants', timing: 'AnyTime', participated: true, expected: 200 },
  { name: 'immediate requires participation', who: 'Public', timing: 'Immediately', expected: 403 },
  { name: 'future expiry', who: 'Public', timing: 'AfterEnd', expected: 403 },
  { name: 'invisible wrapper', who: 'Public', timing: 'AnyTime', hidden: true, expected: 404 },
  { name: 'invisible shared source', who: 'Public', timing: 'AnyTime', hiddenSource: true, expected: 404 },
]) test(`analysis v3 authorization: ${scenario.name}`, async () => {
  const original = prisma.$transaction;
  let reads = 0, status = 200, body: any, queries = 0;
  const headers: Record<string, string> = {};
  const tx: any = {
    post: { findFirst: async (args: any) => {
      queries++; assert.ok(Object.keys(args.where).length > 1, 'visibility conditions must remain server-side');
      if (queries === 1) return scenario.hidden ? null : { id: 'post', sharedFromId: scenario.hiddenSource ? 'source' : null, authorId: 'owner', pageId: null, resultsWho: scenario.who, resultsTiming: scenario.timing, expiresAt: new Date('2099-01-01') };
      if (scenario.hiddenSource) return null;
      return { id: 'post', authorId: 'owner', pageId: null, resultsWho: scenario.who, resultsTiming: scenario.timing, expiresAt: new Date('2099-01-01') };
    } },
    $queryRaw: async () => { reads++; return Array.from({ length: 5 }, (_, index) => ({ id: 'private-' + index, timestamp: new Date(), answers: [{ questionId: 'q', optionId: 'a' }], country: 'Jordan', demographics: { gender: 'Male' } })); },
    follow: { findUnique: async () => scenario.follows ? { status: 'ACTIVE' } : null },
    question: { findMany: async () => [{ id: 'q', options: [] }] },
    response: { findFirst: async () => scenario.participated ? { id: 'participation' } : null, findMany: async () => { reads++; return Array.from({ length: 5 }, (_, index) => ({ id: `private-${index}`, answers: [{ questionId: 'q', optionId: 'a' }], user: { country: 'Jordan', demographics: { gender: 'Male' } } })); } }
  };
  const res: any = { status(value: number) { status = value; return res; }, setHeader(key: string, value: string) { headers[key] = value; }, json(value: any) { body = value; return res; } };
  try {
    (prisma as any).$transaction = async (work: any, options: any) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return work(tx); };
    await getPostResults({ params: { id: 'post' }, query: { analysis: '1', compareBy: 'gender' }, headers: {}, user: { userId: scenario.owner ? 'owner' : 'viewer' } } as any, res);
    assert.equal(status, scenario.expected); assert.equal(reads, status === 200 ? 1 : 0);
    assert.equal(headers['Cache-Control'], 'private, no-store');
    if (status === 200) { assert.equal(body.version, 3); assert.equal(body.comparison.groups[0].responseCount, 5); assert.equal(JSON.stringify(body).includes('private-'), false); }
  } finally { (prisma as any).$transaction = original; }
});
