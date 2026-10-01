import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import prisma from '../prisma';
import { guardPagePostInteractions, guardPagePostPersistence } from './pagePostService';
import { notifyPagePostInteraction } from './pageActivityNotifications';
import { pagePostBoundary } from './pagePostBoundary';
import type {} from '../middleware/authMiddleware';

after(async()=>prisma.$disconnect());
const published={isDeleted:false,status:'PUBLISHED',expiresAt:null};
function fixture(requirePostLock=true) {
  const queries:Array<{sql:string;values:any[]}>=[];
  const pages=new Map(['a-page','z-page'].map(id=>[id,{id,ownerId:'owner',publicationState:'PUBLISHED',platformState:'NONE',safetyHiddenAt:null,deletionRequestedAt:null,purgedAt:null}]));
  const posts=new Map<string,any>([
    ['wrapper',{id:'wrapper',pageId:'z-page',sharedFrom:{id:'source',pageId:'a-page'},...published}],
    ['source',{id:'source',pageId:'a-page',sharedFrom:null,...published}],
    ['personal',{id:'personal',pageId:null,sharedFrom:null,...published}],
  ]);
  let locked=false;
  let visibleCount=2;
  let events=0;
  const tx:any={
    $queryRaw:async(query:any,...values:any[])=>{
      const sql=Array.isArray(query)?query.join(''):query.strings.join('');
      queries.push({sql,values:Array.isArray(query)?values:query.values});
      if(sql.startsWith('SELECT NOT EXISTS')) {
        if(requirePostLock)assert.equal(locked,true,'Authorization query must follow Post row lock');
        assert.match(sql,/sharedFromId/);
        return [{visible:visibleCount===2}];
      }
      if(sql.includes('AS "visible"'))return [{visible:true}];
      if(sql.includes('FROM "Post"')&&sql.endsWith('FOR UPDATE')){
        locked=true;
        return query.values.map((id:string)=>posts.get(id)).filter(Boolean).map((post:any)=>({...post,sharedFromId:post.sharedFrom?.id??null}));
      }
      if(sql.includes('FROM "Page"'))return [pages.get(values[0])];
      if(sql.includes('FROM users')&&sql.endsWith('FOR SHARE'))return [{id:'viewer',status:'ACTIVE',emailVerifiedAt:null}];
      return [];
    },
    page:{findUnique:async({where}:any)=>pages.get(where.id),count:async()=>1},
    user:{findUnique:async()=>({id:'viewer',status:'ACTIVE'})},
    pageBlock:{findFirst:async()=>null},
    post:{findUnique:async({where}:any)=>posts.get(where.id),count:async()=>{throw new Error('Model visibility COUNT must not run');}},
    pageEvent:{create:async()=>{events++;return {};}}
  };
  return {tx,queries,posts,setVisible:(n:number)=>{visibleCount=n;},events:()=>events};
}
async function enabled(work:()=>Promise<void>){const old=process.env.PAGES_ENABLED;process.env.PAGES_ENABLED='true';try{await work();}finally{if(old===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=old;}}

test('public interaction locks sorted Pages before sorted Posts, and outbox never upgrades Page lock',async()=>enabled(async()=>{
  const f=fixture();
  await guardPagePostInteractions(f.tx,['wrapper','source','wrapper'],'viewer','source');
  const pageLocks=()=>f.queries.filter(q=>q.sql.includes('FROM "Page"')&&/FOR (SHARE|UPDATE)$/.test(q.sql));
  assert.deepEqual(pageLocks().map(q=>q.values[0]),['a-page','z-page']);
  assert.ok(pageLocks().every(q=>q.sql.endsWith('FOR SHARE')));
  const postLock=f.queries.findIndex(q=>q.sql.includes('FROM "Post"')&&q.sql.endsWith('FOR UPDATE'));
  assert.ok(f.queries.every((q,index)=>!pageLocks().includes(q)||index<postLock));
  assert.match(f.queries[postLock].sql,/ORDER BY "id" FOR UPDATE$/);
  assert.deepEqual(f.queries[postLock].values,['source','wrapper']);
  await notifyPagePostInteraction({postId:'source',actorId:'viewer',kind:'like'},f.tx);
  assert.equal(f.events(),1);
  assert.ok(pageLocks().every(q=>q.sql.endsWith('FOR SHARE')));
}));

test('post/source visibility loss after the lock aborts the public interaction',async()=>enabled(async()=>{
  const f=fixture();f.setVisible(1);
  await assert.rejects(guardPagePostInteractions(f.tx,['source','wrapper'],'viewer'),{code:'PAGE_POST_UNAVAILABLE'});
  assert.equal(f.events(),0);
}));

test('expiry and unpublished state are rechecked after Post locks',async()=>enabled(async()=>{
  for(const change of [{expiresAt:new Date(0)},{status:'DRAFT'},{isDeleted:true}]){
    const f=fixture();
    const query=f.tx.$queryRaw;
    f.tx.$queryRaw=async(...args:any[])=>{
      const sql=Array.isArray(args[0])?args[0].join(''):args[0].strings.join('');
      if(sql.includes('FROM "Post"')&&sql.endsWith('FOR UPDATE'))Object.assign(f.posts.get('source'),change);
      return query(...args);
    };
    await assert.rejects(guardPagePostInteractions(f.tx,['source','wrapper'],'viewer','source'),{code:'expiresAt' in change?'PAGE_POST_ENDED':'PAGE_POST_UNAVAILABLE'});
  }
}));

test('personal-only interactions retain their existing path with no Page or Post locks',async()=>{
  const f=fixture();await guardPagePostInteractions(f.tx,['personal'],'viewer');assert.equal(f.queries.length,0);
});

test('disabled Pages reject through the real locked guards before visibility and outbox work', async () => {
  const previousEnabled = process.env.PAGES_ENABLED;
  const previousTestUsers = process.env.PAGES_TEST_USERS;
  process.env.PAGES_ENABLED = 'false';
  process.env.PAGES_TEST_USERS = '';
  try {
    for (const operation of ['interaction', 'persistence'] as const) {
      const f = fixture(operation === 'interaction');
      await assert.rejects(operation === 'interaction'
        ? guardPagePostInteractions(f.tx, ['source'], 'viewer')
        : guardPagePostPersistence(f.tx, 'source', 'viewer'), { code: 'PAGES_UNAVAILABLE' });
      assert.ok(f.queries.some(query => query.sql.includes('FROM "Page"')));
      assert.equal(f.queries.some(query => query.sql.includes('AS "visible"')), false);
      assert.equal(f.events(), 0);
    }
  } finally {
    if (previousEnabled === undefined) delete process.env.PAGES_ENABLED;
    else process.env.PAGES_ENABLED = previousEnabled;
    if (previousTestUsers === undefined) delete process.env.PAGES_TEST_USERS;
    else process.env.PAGES_TEST_USERS = previousTestUsers;
  }
});

test('role mutation guard retains exclusive Page lock',async()=>enabled(async()=>{
  const f=fixture(false);
  await guardPagePostPersistence(f.tx,'source','viewer');
  assert.ok(f.queries.some(q=>q.sql.includes('FROM "Page"')&&q.sql.endsWith('FOR UPDATE')));
}));

test('Page boundary denies invisible Page/source mutations while preserving management and recovery bypasses',async()=>enabled(async()=>{
  const original={post:prisma.post.findUnique,query:prisma.$queryRaw,page:prisma.page.findUnique,user:prisma.user.findUnique};
  try {
    for(const scenario of ['page-denied','source-denied','page-visible','personal','remove-save','managed-draft','detail'] as const) {
      let queries=0,nextCalls=0,status=200,body:any;
      (prisma.post as any).findUnique=async()=>({pageId:scenario==='personal'||scenario==='source-denied'?null:'page',sharedFrom:scenario==='source-denied'?{pageId:'page'}:null});
      (prisma.page as any).findUnique=async()=>({id:'page',ownerId:'viewer',purgedAt:null,publicationState:'DRAFT'});
      (prisma.user as any).findUnique=async()=>({status:'ACTIVE'});
      (prisma as any).$queryRaw=async(query:any)=>{queries++;assert.match(query.text,/sharedFromId/);return [{visible:scenario==='page-visible'}];};
      const req:any={path:scenario==='remove-save'?'/post/save':scenario==='managed-draft'||scenario==='detail'?'/post':'/post/like',method:scenario==='remove-save'?'DELETE':scenario==='managed-draft'?'PUT':scenario==='detail'?'GET':'POST',user:{userId:'viewer'}};
      const res:any={setHeader(){},status(code:number){status=code;return this;},json(value:any){body=value;return this;}};
      await pagePostBoundary(req,res,(error?:any)=>{assert.equal(error,undefined);nextCalls++;});
      const denied=scenario==='page-denied'||scenario==='source-denied';
      assert.equal(status,denied?404:200);assert.equal(nextCalls,denied?0:1);
      assert.equal(queries,denied||scenario==='page-visible'?1:0,scenario);
      if(denied)assert.equal(body.code,'PAGE_POST_UNAVAILABLE');
    }
  } finally {
    (prisma.post as any).findUnique=original.post;(prisma as any).$queryRaw=original.query;
    (prisma.page as any).findUnique=original.page;(prisma.user as any).findUnique=original.user;
  }
}));
