import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { guardPagePostInteractions, consumePageInteractionLock } from './pagePostService';
import { notifyPagePostInteraction } from './pageActivityNotifications';

const published={status:'PUBLISHED',isDeleted:false,expiresAt:null};
function fixture(){
  const page={id:'page',ownerId:'owner',publicationState:'PUBLISHED',platformState:'NONE',safetyHiddenAt:null,deletionRequestedAt:null,purgedAt:null};
  const posts=new Map<string,any>([
    ['post',{id:'post',pageId:'page',sharedFrom:null,sharedFromId:null,...published}],
    ['personal',{id:'personal',pageId:null,sharedFrom:null,sharedFromId:null,...published}],
    ['wrapper',{id:'wrapper',pageId:'page',sharedFrom:{id:'personal',pageId:null},sharedFromId:'personal',...published}],
  ]);
  const state={postReads:0,pageLocks:0,publicChecks:0,postChecks:0,commentReads:0,commentPage:true,visible:true,postVisible:true,events:[] as any[],missingLock:false,afterLock:null as null|(()=>void)};
  const tx:any={
    $queryRaw:async(query:any,...values:any[])=>{
      const sql=Array.isArray(query)?query.join('?'):query.sql;
      if(sql.includes('AS "visible"')){state.publicChecks++;return [{visible:state.visible}];}
      if(sql.includes('SELECT NOT EXISTS')){state.postChecks++;return [{visible:state.postVisible}];}
      if(sql.includes('FROM "Page"')&&sql.endsWith('FOR SHARE')){state.pageLocks++;return [{...page}];}
      if(sql.includes('FROM users'))return [{id:values[0],status:'ACTIVE',emailVerifiedAt:null}];
      assert.match(sql,/FROM "Post"/);assert.match(sql,/ORDER BY "id" FOR UPDATE$/);
      if(state.afterLock)state.afterLock();
      return state.missingLock?[]:query.values.map((id:string)=>posts.get(id)).filter(Boolean).map((post:any)=>({...post}));
    },
    post:{findUnique:async({where}:any)=>{state.postReads++;const post=posts.get(where.id);return post?{...post,sharedFrom:post.sharedFrom?{...post.sharedFrom}:null}:null;}},
    comment:{findUnique:async()=>{state.commentReads++;return {pageId:state.commentPage?'page':null};}},
    pageEvent:{create:async({data}:any)=>{state.events.push(data);return {id:'event',...data};}},
  };
  return {tx,state,posts,page};
}
async function enabled(work:()=>Promise<void>){const previous=process.env.PAGES_ENABLED;process.env.PAGES_ENABLED='true';try{await work();}finally{if(previous===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=previous;}}
const input={postId:'post',actorId:'actor',kind:'like' as const};

test('Successful guard reuses exact transaction lock once and retains fresh notification eligibility',async()=>enabled(async()=>{
  const f=fixture();await guardPagePostInteractions(f.tx,['post'],'actor');
  assert.equal(f.state.postReads,1,'No separate post-state read after FOR UPDATE');
  await notifyPagePostInteraction(input,f.tx);
  assert.equal(f.state.postReads,1);assert.equal(f.state.pageLocks,1);assert.equal(f.state.publicChecks,2);assert.equal(f.state.postChecks,1);
  assert.equal(f.state.events[0].recipientId,'owner');assert.equal(f.state.events[0].pageId,'page');
  await notifyPagePostInteraction(input,f.tx);
  assert.equal(f.state.postReads,2);assert.equal(f.state.pageLocks,2,'Consumed context must use normal fallback on replay');
}));

test('Different transaction, actor or post cannot reuse a structural context',async()=>enabled(async()=>{
  for(const mismatch of ['transaction','actor','post']){
    const f=fixture();await guardPagePostInteractions(f.tx,['post'],'actor');
    await notifyPagePostInteraction({...input,...(mismatch==='actor'?{actorId:'other'}:mismatch==='post'?{postId:'wrapper'}:{})},mismatch==='transaction'?{...f.tx}:f.tx);
    assert.equal(f.state.postReads,2,mismatch);assert.equal(f.state.pageLocks,2,mismatch);
  }
  assert.equal(consumePageInteractionLock({} as any,'post','actor'),undefined);
}));

test('Fresh visibility loss suppresses Page events without personal fallback after context reuse',async()=>enabled(async()=>{
  const f=fixture();await guardPagePostInteractions(f.tx,['post'],'actor');f.state.visible=false;
  assert.equal(await notifyPagePostInteraction(input,f.tx),true);assert.equal(f.state.events.length,0);
  assert.equal(f.state.postReads,1);assert.equal(f.state.pageLocks,1);assert.equal(f.state.publicChecks,2);
}));

test('Feature disabled after guard suppresses notification and consumes context',async()=>enabled(async()=>{
  const f=fixture();await guardPagePostInteractions(f.tx,['post'],'actor');process.env.PAGES_ENABLED='false';
  assert.equal(await notifyPagePostInteraction(input,f.tx),true);assert.equal(f.state.events.length,0);
  assert.equal(consumePageInteractionLock(f.tx,'post','actor'),undefined);
}));

test('Current official comment-like target is still read; personal comments keep personal fallback',async()=>enabled(async()=>{
  for(const official of [true,false]){
    const f=fixture();await guardPagePostInteractions(f.tx,['post'],'actor');f.state.commentPage=official;
    assert.equal(await notifyPagePostInteraction({...input,kind:'comment_like',commentId:'comment'},f.tx),official);
    assert.equal(f.state.commentReads,1);assert.equal(f.state.events.length,official?1:0);assert.equal(f.state.postReads,1);
  }
}));

test('Page wrapper cannot give its personal source a Page notification context',async()=>enabled(async()=>{
  const f=fixture();await guardPagePostInteractions(f.tx,['wrapper','personal'],'actor');
  assert.equal(await notifyPagePostInteraction({...input,postId:'personal'},f.tx),false);assert.equal(f.state.events.length,0);
  assert.equal(f.state.postReads,3);assert.equal(f.state.pageLocks,1);
  assert.equal(await notifyPagePostInteraction({...input,postId:'wrapper'},f.tx),true);assert.equal(f.state.events[0].targetId,'wrapper');
}));

test('Only post identities matching the fresh locked rows receive reusable context',async()=>enabled(async()=>{
  for(const change of [{pageId:null},{sharedFromId:'personal',sharedFrom:{id:'personal',pageId:null}}]){
    const f=fixture();f.state.afterLock=()=>Object.assign(f.posts.get('post'),change);
    await guardPagePostInteractions(f.tx,['post'],'actor');assert.equal(consumePageInteractionLock(f.tx,'post','actor'),undefined);
    await notifyPagePostInteraction(input,f.tx);assert.equal(f.state.postReads,2);
  }
}));

test('Failed or personal-only re-guard invalidates earlier context on that transaction',async()=>enabled(async()=>{
  for(const failed of [true,false]){
    const f=fixture();await guardPagePostInteractions(f.tx,['post'],'actor');
    if(failed){f.state.postVisible=false;await assert.rejects(guardPagePostInteractions(f.tx,['post'],'actor'),{code:'PAGE_POST_UNAVAILABLE'});}
    else assert.equal(await guardPagePostInteractions(f.tx,['personal'],'actor'),false);
    assert.equal(consumePageInteractionLock(f.tx,'post','actor'),undefined);
  }
}));

test('Post lock result governs missing/deleted/draft/expired rejection before context creation',async()=>enabled(async()=>{
  for(const change of ['missing','deleted','draft','expired']){
    const f=fixture();f.state.afterLock=()=>{
      if(change==='missing')f.state.missingLock=true;
      else Object.assign(f.posts.get('post'),change==='deleted'?{isDeleted:true}:change==='draft'?{status:'DRAFT'}:{expiresAt:new Date(0)});
    };
    await assert.rejects(guardPagePostInteractions(f.tx,['post'],'actor','post'),{code:change==='expired'?'PAGE_POST_ENDED':'PAGE_POST_UNAVAILABLE'});
    assert.equal(consumePageInteractionLock(f.tx,'post','actor'),undefined);assert.equal(f.state.events.length,0);
  }
}));

test('Standalone notification retains its own transaction, fresh Page lock and atomic event rollback',async()=>enabled(async()=>{
  const f=fixture(),transaction=prisma.$transaction;
  (prisma as any).$transaction=async(work:any)=>{const before=[...f.state.events];try{await work(f.tx);throw new Error('synthetic rollback');}catch(e){f.state.events=before;throw e;}};
  try{await assert.rejects(notifyPagePostInteraction(input),/synthetic rollback/);assert.equal(f.state.events.length,0);assert.equal(f.state.postReads,1);assert.equal(f.state.pageLocks,1);assert.equal(f.state.publicChecks,1);}
  finally{prisma.$transaction=transaction;}
}));
