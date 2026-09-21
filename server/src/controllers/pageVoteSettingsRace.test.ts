import assert from 'node:assert/strict';
import test, { after } from 'node:test';
process.env.JWT_SECRET ||= 'page-vote-lock-regression-only';
const prisma=require('../prisma').default as typeof import('../prisma').default;
const {votePost}=require('./postController') as typeof import('./postController');
after(async()=>prisma.$disconnect());

for(const scenario of ['forced-anonymous','multiple-disabled','user-options-disabled','existing-response-anonymous','personal-source-forced','personal-source-expired'] as const) {
  test(`Page vote uses settings committed while waiting: ${scenario}`,async()=>{
    const wrapped=scenario.startsWith('personal-source-');
    const initial={id:'post',pageId:wrapped?null:'page',authorId:'author',sharedFromId:null,sharedFrom:null,allowAnonymous:true,forceAnonymous:false,allowMultipleSelection:true,allowUserOptions:true,type:'Poll',targetAudience:'Public',targetedGroups:[],status:'PUBLISHED',isDeleted:false,expiresAt:null};
    const current={...initial,expiresAt:null as Date|null};
    const wrapper={...initial,id:'wrapper',pageId:'page',sharedFromId:'post',sharedFrom:{id:'post',pageId:null}};
    const page={id:'page',ownerId:'owner',publicationState:'PUBLISHED',platformState:'NONE',safetyHiddenAt:null,deletionRequestedAt:null,purgedAt:null};
    const originals={find:prisma.post.findUnique,page:prisma.page.findUnique,user:prisma.user.findUnique,membership:prisma.pageMembership.findUnique,transaction:prisma.$transaction,enabled:process.env.PAGES_ENABLED};
    let postLocked=false;
    let refreshed=false;
    let pendingResponses:any[]=[];
    let committedResponses:any[]=[];
    let committedEvents=0;
    let pendingEvents=0;
    let anonymousUpdate=false;
    const tx:any={
      $queryRaw:async(query:any)=>{
        const sql=Array.isArray(query)?query.join(''):query.strings.join('');
        if(sql.startsWith('SELECT NOT EXISTS')){assert.equal(postLocked,true);return [{visible:true}];}
        if(sql.includes('AS "visible"'))return [{visible:true}];
        if(sql.includes('FROM "Page"')){
          // Simulate an editor winning the lock after the HTTP preflight read.
          if(scenario==='personal-source-expired')current.expiresAt=new Date(Date.now()-1000);
          else if(scenario==='multiple-disabled')current.allowMultipleSelection=false;
          else if(scenario==='user-options-disabled')current.allowUserOptions=false;
          else current.forceAnonymous=true;
          return [page];
        }
        if(sql.includes('FROM "Post"')){postLocked=true;return query.values.map((id:string)=>id==='wrapper'?{...wrapper}:{...current});}
        if(sql.includes('FROM users')&&sql.endsWith('FOR SHARE'))return [{id:'voter',status:'ACTIVE',emailVerifiedAt:null}];
        return [];
      },
      page:{findUnique:async()=>page,count:async()=>1},
      user:{findUnique:async()=>({id:'voter',status:'ACTIVE'})},
      pageBlock:{findFirst:async()=>null},
      post:{
        findUnique:async({where,select}:any)=>{
          if(select.allowAnonymous){assert.equal(postLocked,true);refreshed=true;}
          return where.id==='wrapper'?wrapper:{...current};
        },
        count:async()=>1,
        update:async()=>current,
      },
      response:{
        findFirst:async()=>scenario==='existing-response-anonymous'?{id:'response',isAnonymous:false}:null,
        create:async({data}:any)=>{assert.equal(refreshed,true);pendingResponses.push({...data});return {id:'response',...data};},
        update:async({data}:any)=>{assert.equal(data.isAnonymous,true);anonymousUpdate=true;return {id:'response',isAnonymous:true};},
      },
      option:{findMany:async({where}:any)=>where.id.in.map((id:string)=>({id,question:{id:'question',postId:'post'},withFollowUp:false})),update:async()=>({}),create:async()=>{throw new Error('Disabled custom option must not be created');}},
      answer:{findFirst:async()=>null,create:async()=>({})},
      pageEvent:{create:async()=>{pendingEvents++;return {};}}
    };
    try{
      process.env.PAGES_ENABLED='true';
      (prisma.post as any).findUnique=async({where}:any)=>where.id==='wrapper'?wrapper:{...initial};
      (prisma.page as any).findUnique=async()=>page;
      (prisma.user as any).findUnique=async()=>({status:'ACTIVE'});
      (prisma.pageMembership as any).findUnique=async()=>null;
      (prisma as any).$transaction=async(work:any)=>{const value=await work(tx);committedResponses=pendingResponses;committedEvents=pendingEvents;return value;};
      let status=200;let body:any;
      const res:any={status(code:number){status=code;return this;},json(value:any){body=value;return this;}};
      const payload:any=scenario==='multiple-disabled'?{optionIds:['one','two']}:scenario==='user-options-disabled'?{optionId:'custom',newOption:{id:'custom',text:'new'}}:{optionId:'one'};
      await votePost({params:{id:wrapped?'wrapper':'post'},user:{userId:'voter'},body:{...payload,isAnonymous:false},ip:'127.0.0.1'} as any,res);
      assert.equal(refreshed,true,'A successful guard must be followed by a locked settings read');
      assert.equal(postLocked,true);
      assert.equal(committedEvents,0,'Current forced anonymity must never emit an identifiable event');
      if(scenario==='multiple-disabled'||scenario==='user-options-disabled'||scenario==='personal-source-expired'){
        assert.equal(status,400);assert.equal(committedResponses.length,0);
      }else{
        assert.equal(status,200,JSON.stringify(body));
        if(scenario==='existing-response-anonymous')assert.equal(anonymousUpdate,true);
        else assert.equal(committedResponses[0].isAnonymous,true);
      }
    }finally{
      (prisma.post as any).findUnique=originals.find;(prisma.page as any).findUnique=originals.page;(prisma.user as any).findUnique=originals.user;(prisma.pageMembership as any).findUnique=originals.membership;(prisma as any).$transaction=originals.transaction;
      if(originals.enabled===undefined)delete process.env.PAGES_ENABLED;else process.env.PAGES_ENABLED=originals.enabled;
    }
  });
}
