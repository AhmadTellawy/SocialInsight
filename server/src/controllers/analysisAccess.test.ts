import test, { after } from 'node:test';
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'synthetic-analysis-test-key';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const { getPostResults } = require('./postController') as typeof import('./postController');
after(async () => { await prisma.$disconnect(); });

for (const analysis of [false,true]) for (const scenario of [
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
]) test(`analysis ${analysis ? "v3" : "v2"} authorization: ${scenario.name}`, async () => {
  const original = prisma.$transaction;
  let reads = 0, status = 200, body: any, queries = 0;
  const headers: Record<string, string> = {};
  const tx: any = {
    $executeRaw: async () => 0,
    $queryRaw: async (query: any) => {
      if (query.text.startsWith('SELECT "p"."id"')) {
        queries++; assert.match(query.text, /isDeleted/); assert.match(query.text, /sharedFromId/);
        assert.ok(query.values.includes(scenario.owner ? 'owner' : 'viewer'));
        if (scenario.hidden || (queries > 1 && scenario.hiddenSource)) return [];
        return [{ id: 'post', sharedFromId: scenario.hiddenSource ? 'source' : null, authorId: 'owner', pageId: null, resultsWho: scenario.who, resultsTiming: scenario.timing, expiresAt: new Date('2099-01-01') }];
      }
      assert.match(query.text, /^FETCH FORWARD/); reads++;
      return Array.from({ length: 5 }, (_, index) => ({ id: 'private-' + index, timestamp: new Date(), weight: 1, pageSize: 5, answers: [['q', 'a', null]], country: 'Jordan', demographics: { gender: 'Male' } }));
    },
    follow: { findUnique: async () => scenario.follows ? { status: 'ACTIVE' } : null },
    question: { findMany: async () => [{ id: 'q', options: [] }] },
    response: { findFirst: async () => scenario.participated ? { id: 'participation' } : null, findMany: async () => { reads++; return Array.from({ length: 5 }, (_, index) => ({ id: `private-${index}`, answers: [{ questionId: 'q', optionId: 'a' }], user: { country: 'Jordan', demographics: { gender: 'Male' } } })); } }
  };
  const res: any = { status(value: number) { status = value; return res; }, setHeader(key: string, value: string) { headers[key] = value; }, json(value: any) { body = value; return res; } };
  try {
    (prisma as any).$transaction = async (work: any, options: any) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return work(tx); };
    await getPostResults({ params: { id: 'post' }, query: analysis ? { analysis: '1', compareBy: 'gender' } : {}, headers: {}, user: { userId: scenario.owner ? 'owner' : 'viewer' } } as any, res);
    assert.equal(status, scenario.expected); assert.equal(reads, status === 200 ? 1 : 0);
    assert.equal(headers['Cache-Control'], 'private, no-store');
    if (status === 200) { assert.equal(body.version, analysis ? 3 : 2); if(analysis)assert.equal(body.comparison.groups[0].responseCount, 5); assert.equal(JSON.stringify(body).includes('private-'), false); }
  } finally { (prisma as any).$transaction = original; }
});

test('managed analysis route queues before its transaction and rechecks a queued role',async()=>{
 const service=require('../pages/pageService') as typeof import('../pages/pageService');
 const router=require('../pages/pageRoutes').default;
 const handler=router.stack.find((layer:any)=>layer.route?.path==='/manage/:id/content/:postId/results').route.stack.at(-1).handle;
 const {PagePolicyError}=require('../pages/pagePolicy') as typeof import('../pages/pagePolicy');
 const names=['pageTransaction','lockPageForAnalytics','activePageActor','requirePageCapability','pageIsBlocked'] as const;
 const saved=names.map(name=>[name,service[name]] as const),enabled=process.env.PAGES_ENABLED,cache=process.env.ANALYSIS_CACHE_ENABLED;
 let open=0,peak=0,reads=0,allowed=true;const releases:Array<()=>void>=[],statuses=[200,200,200],errors:unknown[]=[];
 const tx:any={post:{findFirst:async()=>({id:'00000000-0000-4000-8000-000000000002'})},question:{findMany:async()=>[]},response:{findMany:async()=>{reads++;await new Promise<void>(resolve=>releases.push(resolve));return [];}}};
 let requests:Promise<void>[]=[];
 try{
  process.env.PAGES_ENABLED='true';process.env.ANALYSIS_CACHE_ENABLED='false';
  (service as any).pageTransaction=async(work:any)=>{open++;peak=Math.max(peak,open);try{return await work(tx);}finally{open--;}};
  (service as any).lockPageForAnalytics=async()=>({id:'00000000-0000-4000-8000-000000000001'});
  (service as any).activePageActor=async()=>({id:'viewer'});
  (service as any).requirePageCapability=async()=>{if(!allowed)throw new PagePolicyError('PAGE_PERMISSION_DENIED',403);return 'ANALYST';};
  (service as any).pageIsBlocked=async()=>false;
  requests=Array.from({length:3},(_,i)=>handler({params:{id:'00000000-0000-4000-8000-000000000001',postId:'00000000-0000-4000-8000-000000000002'},query:{},user:{userId:'viewer'}},{setHeader(){},status(v:number){statuses[i]=v;return this;},json(){}},(error:unknown)=>errors.push(error)));
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(open,1);assert.equal(reads,1);allowed=false;
  releases.forEach(release=>release());await Promise.all(requests);
  assert.equal(peak,1);assert.equal(open,0);assert.equal(reads,1);assert.deepEqual(statuses,[200,403,403]);assert.deepEqual(errors,[]);
 }finally{
  releases.forEach(release=>release());await Promise.all(requests);
  for(const [name,value]of saved)(service as any)[name]=value;
  if(enabled===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=enabled;
  if(cache===undefined)delete process.env.ANALYSIS_CACHE_ENABLED;else process.env.ANALYSIS_CACHE_ENABLED=cache;
 }
});


test('authorized viewers share aggregates but cached results never bypass fresh visibility or result permissions', async () => {
  const original = prisma.$transaction, cache = process.env.ANALYSIS_CACHE_ENABLED;
  let hidden = false, who = 'Public', follows = false, revision = '1:1', reads = 0, questions = 0;
  const postId = 'shared-authorized-aggregate-' + Date.now();
  const tx: any = {
    $executeRaw: async () => 0,
    $queryRaw: async (query: any) => {
      if (Array.isArray(query)) { assert.match(query.join(''), /AnalysisRevision/); return [{revision}]; }
      if (query.text.startsWith('SELECT "p"."id"')) return hidden ? [] : [{ id: postId, authorId: 'owner', pageId: null, sharedFromId: null, resultsWho: who, resultsTiming: 'AnyTime', expiresAt: new Date('2099-01-01') }];
      assert.match(query.text, /^FETCH FORWARD/); reads++;
      return [{ weight: revision === '1:1' ? 5 : 6, answers: [['q','a',null]], birthday: null, country: 'JO', demographics: null }];
    },
    question: { findMany: async () => { questions++; return [{id:'q',order:0,section:null,options:[]}]; } },
    follow: { findUnique: async () => follows ? {status:'ACTIVE'} : null },
    response: { findFirst: async () => null }
  };
  const invoke = async (viewer: string, analysis = true) => {
    const result: any = {status:200,headers:{}};
    const res: any = {status(v:number){result.status=v;return res;},setHeader(k:string,v:string){result.headers[k]=v;},json(v:any){result.body=v;return res;}};
    await getPostResults({params:{id:postId},query:analysis?{analysis:'1'}:{},user:{userId:viewer},headers:{}} as any,res);
    return result;
  };
  try {
    process.env.ANALYSIS_CACHE_ENABLED='true';
    (prisma as any).$transaction=async(work:any)=>work(tx);
    const owner=await invoke('owner'),other=await invoke('other');
    assert.equal(owner.status,200);assert.deepEqual(other.body,owner.body);assert.equal(reads,1);assert.equal(questions,1);
    hidden=true;for(const v3 of [false,true])assert.equal((await invoke('other',v3)).status,404);
    hidden=false;who='OnlyMe';assert.equal((await invoke('other')).status,403);
    who='Followers';assert.equal((await invoke('other')).status,403);
    follows=true;assert.equal((await invoke('other')).status,200);assert.equal(reads,1);
    follows=false;assert.equal((await invoke('other')).status,403);assert.equal(reads,1);
    who='Public';revision='2:1';const changed=await invoke('third');assert.equal(changed.status,200);assert.equal(changed.body.sampleSize,6);assert.equal(reads,2);
    assert.equal(changed.headers['Cache-Control'],'private, no-store');
    assert.equal(JSON.stringify(changed.body).includes('owner'),false);
  } finally { (prisma as any).$transaction=original;if(cache===undefined)delete process.env.ANALYSIS_CACHE_ENABLED;else process.env.ANALYSIS_CACHE_ENABLED=cache; }
});
