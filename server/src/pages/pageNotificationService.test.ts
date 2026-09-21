import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prisma';
import { eligiblePageActivityIds, pageActivityNotification } from './pageActivityNotifications';
import { pageEventDeepLink, presentPageNotifications } from './pageNotificationService';

test('completed invitation notifications send their sender to the Page team, while pending requests retain their action destination',()=>{
  const event={pageId:'page-id',targetId:'request-id'};
  for(const kind of ['PAGE_INVITATION_ACCEPTED','PAGE_INVITATION_REJECTED','PAGE_TRANSFER_ACCEPTED'])
    assert.equal(pageEventDeepLink({...event,kind}),'/pages/manage/page-id?tab=team');
  for(const kind of ['PAGE_INVITATION','PAGE_INVITATION_WITHDRAWN','PAGE_TRANSFER'])
    assert.equal(pageEventDeepLink({...event,kind}),'/pages/mine?tab=invitations');
  assert.equal(pageEventDeepLink({...event,kind:'PAGE_CASE_DECIDED'}),'/pages/cases/request-id');
  assert.equal(pageEventDeepLink({...event,kind:'PAGE_ROLE_CHANGED'}),'/pages/manage/page-id');
});

const event={id:'event',kind:'PAGE_ACTIVITY_DELIVERY',pageId:'page',recipientId:'reader',targetId:'post',context:{kind:'comment',actorId:'visitor',postId:'post'}};
function fixture(){return {
  user:{findUnique:async()=>({status:'ACTIVE'})},
  page:{findUnique:async()=>({ownerId:'owner',isTestFixture:false,purgedAt:null})},
  post:{count:async()=>1},
  pageMembership:{findUnique:async()=>({role:'EDITOR'})},
  comment:{findUnique:async()=>null},
  pageFollow:{findUnique:async()=>({muted:false})},
  notificationSettings:{findUnique:async()=>null as any},
  follow:{count:async()=>0},
};}
function batchFixture(){return {
  user:{findUnique:async()=>({status:'ACTIVE'})},
  page:{findMany:async()=>[{id:'page',ownerId:'owner',isTestFixture:false,purgedAt:null as Date|null}]},
  post:{findMany:async()=>[{id:'post'}]},
  pageMembership:{findMany:async()=>[{pageId:'page',role:'EDITOR'}]},
  comment:{findMany:async()=>[{id:'parent',userId:'reader',pageId:null as string|null}]},
  pageFollow:{findMany:async()=>[] as Array<{pageId:string}>},
  notificationSettings:{findUnique:async()=>null as any},
  follow:{findMany:async()=>[] as Array<{followingId:string}>},
};}
async function enabled(work:()=>Promise<void>){const previous=process.env.PAGES_ENABLED;process.env.PAGES_ENABLED='true';try{await work();}finally{if(previous===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=previous;}}

test('stored Page activity is suppressed after current role, account, visibility, mute or preference changes',()=>enabled(async()=>{
  const allowed=await pageActivityNotification(fixture() as any,event,'ar');
  assert.ok(allowed);assert.equal(JSON.parse(allowed.payload).eventId,'event');
  const changes:Array<[string,(tx:any)=>void]>=[
    ['role revoked',tx=>tx.pageMembership.findUnique=async()=>null],
    ['role downgraded',tx=>tx.pageMembership.findUnique=async()=>({role:'ANALYST'})],
    ['account inactive',tx=>tx.user.findUnique=async()=>({status:'SUSPENDED'})],
    ['post no longer visible',tx=>tx.post.count=async()=>0],
    ['Page muted',tx=>tx.pageFollow.findUnique=async()=>({muted:true})],
    ['comments disabled',tx=>tx.notificationSettings.findUnique=async()=>({settings:JSON.stringify({myPosts:{comments:'off'}})})],
    ['following required',tx=>tx.notificationSettings.findUnique=async()=>({settings:JSON.stringify({myPosts:{comments:'following'}})})],
  ];
  for(const [label,change]of changes){const tx=fixture();change(tx);assert.equal(await pageActivityNotification(tx as any,event),null,label);}
}));

test('personal parent comment recipient remains eligible without Page team rights; analyst receives vote only',()=>enabled(async()=>{
  const tx=fixture();tx.pageMembership.findUnique=async()=>null as any;
  tx.comment.findUnique=async()=>({userId:'reader',pageId:null}) as any;
  assert.ok(await pageActivityNotification(tx as any,{...event,context:{...event.context,kind:'reply',parentCommentId:'parent'}}));
  tx.pageMembership.findUnique=async()=>({role:'ANALYST'});
  assert.ok(await pageActivityNotification(tx as any,{...event,context:{...event.context,kind:'vote'}}));
}));

test('inbox and dispatch presentation recheck durable activity and fail closed when its receipt is missing',()=>enabled(async()=>{
  const replacements=batchFixture() as any;let revoked=false,missing=false;
  replacements.pageMembership.findMany=async()=>revoked?[]:[{pageId:'page',role:'EDITOR'}];
  replacements.pageEvent={findMany:async()=>missing?[]:[event]};
  replacements.post.findMany=async()=>[{id:'post',pageId:'page',sharedFrom:null}];
  replacements.page.findMany=async()=>[{id:'page',ownerId:'owner',name:'Public Page',handle:'public_page',avatarMediaId:null,isTestFixture:false,purgedAt:null}];
  const restore:Array<()=>void>=[];
  for(const [model,methods]of Object.entries(replacements))for(const [method,value]of Object.entries(methods as object)){
    const delegate=(prisma as any)[model],previous=delegate[method];delegate[method]=value;restore.push(()=>delegate[method]=previous);
  }
  const record={id:'notification',userId:'reader',dedupeKey:'page-event:event',type:'comment',targetType:'post',targetId:'post',payload:'{}'};
  try{
    assert.equal((await presentPageNotifications([record],'reader')).length,1);
    revoked=true;assert.deepEqual(await presentPageNotifications([record],'reader'),[]);
    revoked=false;missing=true;assert.deepEqual(await presentPageNotifications([record],'reader'),[]);
  }finally{restore.reverse().forEach(reset=>reset());}
}));

test('batched eligibility preserves current recipient, roles, parent, visibility and preference rules',()=>enabled(async()=>{
  const changes:Array<[string,(tx:any)=>void]>=[
    ['role revoked',tx=>tx.pageMembership.findMany=async()=>[]],
    ['role downgraded',tx=>tx.pageMembership.findMany=async()=>[{pageId:'page',role:'ANALYST'}]],
    ['account inactive',tx=>tx.user.findUnique=async()=>({status:'SUSPENDED'})],
    ['post hidden',tx=>tx.post.findMany=async()=>[]],
    ['Page missing',tx=>tx.page.findMany=async()=>[]],
    ['Page purged',tx=>tx.page.findMany=async()=>[{id:'page',ownerId:'reader',purgedAt:new Date()}]],
    ['Page muted',tx=>tx.pageFollow.findMany=async()=>[{pageId:'page'}]],
    ['comments disabled',tx=>tx.notificationSettings.findUnique=async()=>({settings:'{"myPosts":{"comments":"off"}}'})],
    ['push disabled',tx=>tx.notificationSettings.findUnique=async()=>({settings:'{"toggles":{"pushNotifications":false}}'})],
    ['following required',tx=>tx.notificationSettings.findUnique=async()=>({settings:'{"myPosts":{"comments":"following"}}'})],
  ];
  for(const [label,change]of changes){const tx=batchFixture();change(tx);assert.deepEqual([...await eligiblePageActivityIds(tx as any,[event],'reader')],[],label);}
  const tx=batchFixture();
  assert.deepEqual([...await eligiblePageActivityIds(tx as any,[event,{...event,id:'foreign',recipientId:'other'},{...event,id:'self',context:{...event.context,actorId:'reader'}},{...event,id:'excluded',context:{...event.context,excludedRecipientIds:['reader']}}],'reader')],['event']);
  tx.pageMembership.findMany=async()=>[{pageId:'page',role:'ANALYST'}];
  assert.deepEqual([...await eligiblePageActivityIds(tx as any,[event,{...event,id:'vote',context:{...event.context,kind:'vote'}},{...event,id:'parent',context:{...event.context,kind:'reply',parentCommentId:'parent'}}],'reader')],['vote','parent']);
  tx.pageMembership.findMany=async()=>[{pageId:'page',role:'EDITOR'}];
  tx.notificationSettings.findUnique=async()=>({settings:'{"myPosts":{"comments":"following"}}'});
  tx.follow.findMany=async()=>[{followingId:'visitor'}];
  assert.deepEqual([...await eligiblePageActivityIds(tx as any,[event],'reader')],['event']);
  tx.notificationSettings.findUnique=async()=>({settings:'malformed'});
  assert.deepEqual([...await eligiblePageActivityIds(tx as any,[event],'reader')],['event']);
}));

test('inbox presentation uses constant bulk query count for 1 and 100 activity receipts without exposing context',()=>enabled(async()=>{
  const replacements=batchFixture() as any;
  let size=1,queries=0;
  replacements.pageEvent={findMany:async()=>Array.from({length:size},(_,index)=>({...event,id:'event-'+index,context:{...event.context,parentCommentId:'parent',commentId:'reply'}}))};
  replacements.post.findMany=async()=>[{id:'post',pageId:'page',sharedFrom:null}];
  replacements.page.findMany=async()=>[{id:'page',ownerId:'owner',name:'Public Page',handle:'public_page',avatarMediaId:null,isTestFixture:false,purgedAt:null}];
  replacements.comment.findMany=async()=>[{id:'parent',userId:'reader',pageId:null},{id:'reply',userId:'visitor',pageId:null}];
  replacements.notificationSettings.findUnique=async()=>({settings:'{"myPosts":{"comments":"following"}}'});
  replacements.follow.findMany=async()=>[{followingId:'visitor'}];
  const restore:Array<()=>void>=[];
  for(const [model,methods]of Object.entries(replacements))for(const [method,value]of Object.entries(methods as object)){
    const delegate=(prisma as any)[model],previous=delegate[method];
    delegate[method]=async(args:any)=>{queries++;return (value as any)(args);};restore.push(()=>delegate[method]=previous);
  }
  try{
    for(size of [1,100]){
      queries=0;
      const records=Array.from({length:size},(_,index)=>({id:'notification-'+index,userId:'reader',dedupeKey:'page-event:event-'+index,type:'comment',targetType:'post',targetId:'post',payload:'{"commentId":"parent","replyId":"reply"}'}));
      const result=await presentPageNotifications(records,'reader');
      assert.equal(result.length,size);assert.equal(queries,13,'eight eligibility and five presentation bulk queries');
      assert.ok(result.every(record=>!('context' in record)&&!('excludedRecipientIds' in record)));
    }
  }finally{restore.reverse().forEach(reset=>reset());}
}));

test('batched activity respects the feature and test-fixture recipient allowlist',()=>enabled(async()=>{
  const previous=process.env.PAGES_TEST_USERS;
  try{
    process.env.PAGES_TEST_USERS='other';
    const tx=batchFixture();
    tx.page.findMany=async()=>[{id:'page',ownerId:'owner',isTestFixture:true,purgedAt:null}];
    assert.deepEqual([...await eligiblePageActivityIds(tx as any,[event],'reader')],[]);
    process.env.PAGES_TEST_USERS='reader';
    process.env.PAGES_ENABLED='false';
    assert.deepEqual([...await eligiblePageActivityIds(tx as any,[event],'reader')],['event']);
    process.env.PAGES_TEST_USERS='other';
    assert.deepEqual([...await eligiblePageActivityIds(tx as any,[event],'reader')],[]);
  }finally{if(previous===undefined)delete process.env.PAGES_TEST_USERS;else process.env.PAGES_TEST_USERS=previous;}
}));
