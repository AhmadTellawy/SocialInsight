import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { openPageCase, decidePageCase } from './pageCaseService';

const pageId='00000000-0000-4000-8000-000000000001',postId='00000000-0000-4000-8000-000000000002';
const parentId='00000000-0000-4000-8000-000000000003',otherId='00000000-0000-4000-8000-000000000004';
const payload={kind:'APPEAL',parentId,reason:'Review decision',detail:'Please review the original moderation decision.'};

function fixture(options:{parent?:Record<string,unknown>|null;postMissing?:boolean;postOtherPage?:boolean;auditFails?:boolean;visiblePost?:boolean}={}) {
  const page={id:pageId,ownerId:'owner',publicationState:'PUBLISHED',platformState:'NONE',purgedAt:null,deletionRequestedAt:null,safetyHiddenAt:null};
  const parent=options.parent===null?null:{id:parentId,pageId,reporterId:'reporter',kind:'REPORT',status:'CLOSED',postId,...options.parent};
  let stored={cases:[] as any[],audits:0,events:[] as string[],isDeleted:!options.visiblePost};
  const postQueries:any[]=[];const operations:string[]=[];
  const transaction=async(work:any)=>{
    const pending=structuredClone(stored);
    const getCase=(id:string)=>id===parentId?parent:pending.cases.find(row=>row.id===id);
    const tx:any={
      $queryRaw:async(query:any,...values:any[])=>{
        const sql=Array.isArray(query)?query.join('?'):query.sql;
        if(sql.includes('AS "visible"'))return [{visible:true}];
        if(sql.includes('FROM "Page"')){assert.ok(sql.endsWith('FOR UPDATE'));operations.push('page-lock');return [page];}
        assert.ok(sql.includes('FROM users')&&sql.endsWith('FOR SHARE'));operations.push('actor-lock');
        return [{id:values[0],status:'ACTIVE',emailVerifiedAt:new Date('2026-09-01')}];
      },
      page:{count:async()=>1},pageBlock:{findFirst:async()=>null},
      pageCase:{
        findUnique:async({where}:any)=>{operations.push('parent-read');return getCase(where.id);},
        findUniqueOrThrow:async({where}:any)=>{const row=getCase(where.id);assert.ok(row);return row;},
        findFirst:async({where}:any)=>{
          operations.push('duplicate-read');return pending.cases.find(row=>row.pageId===where.pageId&&row.reporterId===where.reporterId&&row.postId===where.postId&&row.kind===where.kind&&where.status.in.includes(row.status))||null;
        },
        create:async({data}:any)=>{operations.push('case-create');const row={id:otherId,status:'OPEN',createdAt:new Date(),...data};pending.cases.push(row);return row;},
        update:async({where,data}:any)=>{operations.push('case-update');const row=getCase(where.id);assert.ok(row);Object.assign(row,data);return row;},
      },
      post:{
        count:async({where}:any)=>{
          operations.push('post-read');postQueries.push(where);
          if(options.postMissing||options.postOtherPage||where.id!==postId||where.pageId!==pageId)return 0;
          if(Object.keys(where).length>2&&pending.isDeleted)return 0;
          return 1;
        },
        update:async({where,data}:any)=>{assert.equal(where.id,postId);pending.isDeleted=data.isDeleted;return {id:postId,...data};},
      },
      pageAuditEvent:{create:async()=>{operations.push('audit');if(options.auditFails)throw new Error('audit unavailable');pending.audits++;return {id:'audit'};}},
      pageEvent:{upsert:async({where}:any)=>{if(!pending.events.includes(where.dedupeKey))pending.events.push(where.dedupeKey);return {};}},
    };
    const result=await work(tx);stored=pending;return result;
  };
  return {transaction,postQueries,operations,state:()=>structuredClone(stored)};
}

async function run(options:Parameters<typeof fixture>[0],work:(f:ReturnType<typeof fixture>)=>Promise<void>){
  const original=prisma.$transaction,enabled=process.env.PAGES_ENABLED,reviewers=process.env.PAGES_STAFF_REVIEWERS;
  const f=fixture(options);(prisma as any).$transaction=f.transaction;process.env.PAGES_ENABLED='true';process.env.PAGES_STAFF_REVIEWERS='staff';
  try{await work(f);}finally{prisma.$transaction=original;if(enabled===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=enabled;if(reviewers===undefined)delete process.env.PAGES_STAFF_REVIEWERS;else process.env.PAGES_STAFF_REVIEWERS=reviewers;}
}

test('Parent-only appeal inherits hidden post and staff restores that exact post',async()=>run({},async f=>{
  const appeal=await openPageCase(pageId,'owner',payload);
  assert.equal(f.state().cases[0].postId,postId);assert.equal(f.state().cases[0].parentId,parentId);
  assert.deepEqual(f.postQueries,[{id:postId,pageId}]);assert.ok(f.operations.indexOf('parent-read')<f.operations.indexOf('post-read'));
  const decision=await decidePageCase(appeal.id,'staff',{action:'RESTORE_POST',reason:'Original decision reversed after review.'});
  assert.equal(decision.decision,'RESTORE_POST');assert.equal(decision.status,'CLOSED');assert.equal(f.state().isDeleted,false);
  assert.equal(f.state().audits,2);assert.equal(f.state().events.length,1); // Owner opened the appeal; owner notification is deduplicated.
}));

test('Original reporter may appeal hidden post with matching explicit target',async()=>run({},async f=>{
  await openPageCase(pageId,'reporter',{...payload,postId});
  assert.equal(f.state().cases[0].postId,postId);assert.deepEqual(f.postQueries,[{id:postId,pageId}]);assert.equal(f.state().audits,1);
}));

test('Appeal parent authorization precedes all target reads and writes',async()=>{
  for(const scenario of [
    {options:{},actor:'outsider',input:payload},
    {options:{parent:null},actor:'owner',input:payload},
    {options:{parent:{pageId:otherId}},actor:'owner',input:payload},
    {options:{parent:{status:'OPEN'}},actor:'owner',input:payload},
    {options:{},actor:'owner',input:{...payload,parentId:undefined}},
  ])await run(scenario.options,async f=>{
    const before=f.state();await assert.rejects(openPageCase(pageId,scenario.actor,scenario.input),{code:'PAGE_APPEAL_UNAVAILABLE',status:403});
    assert.deepEqual(f.state(),before);assert.equal(f.postQueries.length,0);assert.ok(!f.operations.includes('duplicate-read'));
  });
});

test('Authorized appellant cannot substitute target or add a post to Page-level appeal',async()=>{
  for(const parent of [{postId},{postId:null}])await run({parent},async f=>{
    const before=f.state();await assert.rejects(openPageCase(pageId,'owner',{...payload,postId:otherId}),{code:'PAGE_APPEAL_UNAVAILABLE',status:403});
    assert.deepEqual(f.state(),before);assert.equal(f.postQueries.length,0);
  });
});

test('Page-level appeal stays Page-level and never reads a post',async()=>run({parent:{postId:null}},async f=>{
  await openPageCase(pageId,'owner',payload);assert.equal(f.state().cases[0].postId,null);assert.equal(f.postQueries.length,0);
}));

test('Inherited target must still exist on the same Page',async()=>{
  for(const options of [{postMissing:true},{postOtherPage:true}])await run(options,async f=>{
    const before=f.state();await assert.rejects(openPageCase(pageId,'owner',payload),{code:'PAGE_POST_UNAVAILABLE',status:404});
    assert.deepEqual(f.state(),before);assert.deepEqual(f.postQueries,[{id:postId,pageId}]);
  });
});

test('Duplicate parent-only appeal deduplicates against inherited post target',async()=>run({},async f=>{
  const first=await openPageCase(pageId,'owner',payload),second=await openPageCase(pageId,'owner',{...payload,postId});
  assert.equal(first.id,second.id);assert.equal(first.alreadyReported,false);assert.equal(second.alreadyReported,true);
  assert.equal(f.state().cases.length,1);assert.equal(f.state().audits,1);assert.equal(f.state().cases[0].postId,postId);
}));

test('Ordinary report cannot bypass public post visibility and non-appeal cannot attach a parent',async()=>run({},async f=>{
  const before=f.state();await assert.rejects(openPageCase(pageId,'owner',{kind:'REPORT',reason:'Report issue',detail:'This is a report of an unavailable post.',postId}),{code:'PAGE_POST_UNAVAILABLE',status:404});
  assert.ok(Object.keys(f.postQueries[0]).length>2);assert.deepEqual(f.state(),before);
  await assert.rejects(openPageCase(pageId,'owner',{...payload,kind:'OWNERSHIP'}),{code:'PAGE_INVALID_CASE'});assert.deepEqual(f.state(),before);
}));

test('Appeal creation and audit remain atomic',async()=>run({auditFails:true},async f=>{
  const before=f.state();await assert.rejects(openPageCase(pageId,'owner',payload),/audit unavailable/);assert.deepEqual(f.state(),before);
}));
