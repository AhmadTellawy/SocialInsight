import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { getPublicPage, assertPagePublic, pagePublicDto } from './pageService';

const row:any={id:'page',ownerId:'private-owner',name:'Page',handle:'current',category:'company',bio:'Bio',description:'Description',country:'JO',city:'Amman',website:null,links:[{title:'Site',url:'https://example.test'}],publicEmail:null,publicPhone:null,cta:null,avatarMediaId:null,coverMediaId:null,createdAt:new Date('2026-09-01T01:02:03.004Z'),publicationState:'PUBLISHED',platformState:'RESTRICTED',safetyHiddenAt:null,deletionRequestedAt:null,purgedAt:null,_aliasHandle:'old',_visible:true,_followersCount:BigInt(3),_following:true,_muted:true,_managesPage:true};
async function withFixture(run:(state:{queries:any[];setRows:(rows:any[])=>void})=>Promise<void>){
  const raw=prisma.$queryRaw,enabled=process.env.PAGES_ENABLED,allowlist=process.env.PAGES_TEST_USERS;
  let rows:any[]=[{...row}];const queries:any[]=[];process.env.PAGES_ENABLED='true';delete process.env.PAGES_TEST_USERS;
  (prisma as any).$queryRaw=async(query:any)=>{queries.push(query);return rows;};
  try{await run({queries,setRows:value=>{rows=value;}});}finally{prisma.$queryRaw=raw;if(enabled===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=enabled;if(allowlist===undefined)delete process.env.PAGES_TEST_USERS;else process.env.PAGES_TEST_USERS=allowlist;}
}

test('Public Page uses one parameterized read and only existing public fields',async()=>withFixture(async f=>{
  const value=await getPublicPage("OLD' OR 1=1 --",'viewer');assert.equal(f.queries.length,1);
  assert.ok(f.queries[0].values.includes("old' or 1=1 --"));assert.ok(!f.queries[0].sql.includes("old' or 1=1 --"));
  assert.deepEqual(value,{...pagePublicDto(row),followersCount:3,following:true,muted:true,managesPage:true,canonicalHandle:'current',redirected:true});
  assert.equal(value.createdAt,row.createdAt);assert.equal(JSON.parse(JSON.stringify(value)).createdAt,'2026-09-01T01:02:03.004Z');
  for(const key of ['ownerId','publicationState','platformState','_visible','_aliasHandle','_followersCount'])assert.equal(key in value,false);
}));

test('Missing alias keeps precedence over feature gate; existing alias honors allowlist',async()=>withFixture(async f=>{
  process.env.PAGES_ENABLED='false';f.setRows([]);await assert.rejects(getPublicPage('missing','viewer'),{code:'PAGE_NOT_FOUND',status:404});
  f.setRows([row]);await assert.rejects(getPublicPage('old','viewer'),{code:'PAGES_UNAVAILABLE',status:404});
  process.env.PAGES_TEST_USERS='viewer';await getPublicPage('old','viewer');await assert.rejects(getPublicPage('old'),{code:'PAGES_UNAVAILABLE'});
}));

test('Ineligible or independently hidden Page never exposes the selected row',async()=>withFixture(async f=>{
  for(const patch of [{_visible:false},{publicationState:'DRAFT'},{platformState:'SUSPENDED'},{safetyHiddenAt:new Date()},{deletionRequestedAt:new Date()},{purgedAt:new Date()}]){
    f.setRows([{...row,...patch}]);await assert.rejects(getPublicPage('old','viewer'),{code:'PAGE_NOT_FOUND',status:404});
  }
}));

test('Follower count conversion preserves number contract and refuses unsafe integers',async()=>withFixture(async f=>{
  for(const count of [BigInt(0),BigInt(42),BigInt(Number.MAX_SAFE_INTEGER)]){f.setRows([{...row,_followersCount:count}]);assert.equal((await getPublicPage('old')).followersCount,Number(count));}
  for(const count of [BigInt(-1),BigInt(Number.MAX_SAFE_INTEGER)+BigInt(1)]){f.setRows([{...row,_followersCount:count}]);await assert.rejects(getPublicPage('old'),{code:'PAGE_FOLLOWER_COUNT_INVALID',status:500});}
}));

test('Shared public guard uses one current existence query for visibility and either block direction',async()=>withFixture(async f=>{
  f.setRows([{visible:true}]);await assertPagePublic(prisma,row,'viewer');assert.equal(f.queries.length,1);
  const sql=f.queries[0].sql;assert.match(sql,/SELECT EXISTS/);assert.match(sql,/"PageBlock"/);assert.match(sql,/editorial_user\."status" = 'ACTIVE'/);assert.match(sql,/editorial_member\."role" IN \('ADMIN', 'EDITOR'\)/);assert.ok(!sql.includes('"direction"'));
  assert.ok(f.queries[0].values.includes('viewer'));assert.ok(f.queries[0].values.includes('page'));
  f.setRows([{visible:false}]);await assert.rejects(assertPagePublic(prisma,row,'viewer'),{code:'PAGE_NOT_FOUND',status:404});
  f.setRows([]);await assert.rejects(assertPagePublic(prisma,row,'viewer'),{code:'PAGE_NOT_FOUND',status:404});
}));

test('Shared public guard rejects feature-off or locally hidden state before any query',async()=>withFixture(async f=>{
  process.env.PAGES_ENABLED='false';await assert.rejects(assertPagePublic(prisma,row,'viewer'),{code:'PAGES_UNAVAILABLE'});assert.equal(f.queries.length,0);
  process.env.PAGES_ENABLED='true';await assert.rejects(assertPagePublic(prisma,{...row,purgedAt:new Date()},'viewer'),{code:'PAGE_NOT_FOUND'});assert.equal(f.queries.length,0);
}));
