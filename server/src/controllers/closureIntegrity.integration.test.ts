import assert from 'node:assert/strict';
import test, { before, after, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
for (const key of ['DATABASE_URL', 'DIRECT_URL']) { const u=new URL(process.env[key]||'http://invalid'); assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55447');assert.equal(u.pathname,'/settings_test'); }
process.env.NODE_ENV='test';process.env.AUTH_ALLOWED_ORIGINS='http://localhost:3000';process.env.AUTH_SESSION_HASH_SECRET='isolated-closure-fixture-key';process.env.AUTH_COOKIE_SECURE='false';process.env.AUTH_LEGACY_BEARER_COMPAT='false';
const prisma=require('../prisma').default as typeof import('../prisma').default;
const bcrypt=require('bcryptjs');
mock.method(require('../services/cronService'),'initCronJobs',()=>{});
mock.method(require('../services/socketService'),'initSocket',()=>{});
mock.method(require('../services/mediaPrivacyTransitionService'),'resumeMediaPrivacyTransitions',async()=>0);
mock.method(require('../services/accountCleanupService'),'resumeAccountCleanupJobs',async()=>0);
const app=require('../app').default;
const users=[randomUUID(),randomUUID()], posts:string[]=[], groups:string[]=[];const prefix='ci_'+randomUUID().replace(/-/g,'').slice(0,12), password='SyntheticPass123!';let server:Server,base:string;
class Browser {
 cookies=new Map<string,string>();csrf='';actor:string|null=null;
 async request(path:string,method='GET',body?:unknown,discardCookies=false){
  if(path==='/analytics/interactions/batch' && Array.isArray(body)) body={events:body,expectedActorId:this.actor};
  const headers:Record<string,string>={Origin:'http://localhost:3000',Cookie:[...this.cookies].map(([k,v])=>k+'='+v).join('; ')};if(this.csrf)headers['X-CSRF-Token']=this.csrf;if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(base+'/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(!discardCookies)for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');if(pair.slice(i+1))this.cookies.set(pair.slice(0,i),pair.slice(i+1));else this.cookies.delete(pair.slice(0,i));}
  const data=await r.json().catch(()=>null);if(data?.csrfToken)this.csrf=data.csrfToken;return {status:r.status,body:data};
 }
 async login(index=0){const r=await this.request('/auth/login','POST',{identifier:prefix+index+'@example.invalid',password});assert.equal(r.status,200,JSON.stringify(r.body));this.actor=users[index];}
}
before(async()=>{const hash=await bcrypt.hash(password,4);await prisma.user.createMany({data:users.map((id,i)=>({id,handle:prefix+i,name:'Synthetic closure',email:prefix+i+'@example.invalid',emailVerifiedAt:new Date(),passwordHash:hash,status:'ACTIVE'}))});server=await new Promise<Server>(resolve=>{const h=app.listen(0,'127.0.0.1',()=>resolve(h));});base='http://127.0.0.1:'+(server.address() as any).port;});
after(async()=>{
 if(server)await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});
 await prisma.$transaction(async tx=>{await tx.answer.deleteMany({where:{response:{postId:{in:posts}}}});await tx.response.deleteMany({where:{postId:{in:posts}}});await tx.interactionEvent.deleteMany({where:{actor_user_id:{in:users}}});await tx.notification.deleteMany({where:{OR:[{userId:{in:users}},{actorId:{in:users}}]}});await tx.option.deleteMany({where:{question:{postId:{in:posts}}}});await tx.question.deleteMany({where:{postId:{in:posts}}});await tx.post.deleteMany({where:{id:{in:posts}}});await tx.groupMember.deleteMany({where:{groupId:{in:groups}}});await tx.group.deleteMany({where:{id:{in:groups}}});await tx.handleAlias.deleteMany({where:{OR:[{userId:{in:users}},{handle:{startsWith:prefix}}]}});await tx.deletionDecision.deleteMany({where:{subjectKind:'ACCOUNT',subjectId:{in:users}}});await tx.user.deleteMany({where:{id:{in:users}}});});await prisma.$disconnect();mock.restoreAll();
});
async function fixture(multi=false){const p=await prisma.post.create({data:{authorId:users[0],title:'Synthetic poll',description:'Fixture',type:'Poll',status:'PUBLISHED',targetAudience:'Public',allowAnonymous:true,allowMultipleSelection:multi,expiresAt:new Date(Date.now()+86400000),questions:{create:{text:'Choose',type:'multiple_choice',order:0,options:{create:[{text:'A',order:0},{text:'B',order:1}]}}}},include:{questions:{include:{options:{orderBy:{order:'asc'}}}}}});posts.push(p.id);return p;}
async function counts(postId:string){const rs=await prisma.response.findMany({where:{postId},include:{answers:true}});const p=await prisma.post.findUniqueOrThrow({where:{id:postId}});const os=await prisma.option.findMany({where:{question:{postId}},orderBy:{order:'asc'}});return {responses:rs.length,answers:rs.reduce((n,r)=>n+r.answers.length,0),counter:p.responseCount,votes:os.map(o=>o.votes)};}
test('structured single-choice overflow and cross-post option IDs reject atomically',async()=>{
 const p=await fixture(),other=await fixture(),b=new Browser(),q=p.questions[0];const r=await b.request('/posts/'+p.id+'/vote','POST',{guestId:randomUUID(),answers:q.options.map(o=>({questionId:q.id,optionId:o.id}))});assert.equal(r.status,400);assert.deepEqual(await counts(p.id),{responses:0,answers:0,counter:0,votes:[0,0]});
 const wrong=await b.request('/posts/'+p.id+'/vote','POST',{guestId:randomUUID(),answers:[{questionId:q.id,optionId:other.questions[0].options[0].id}]});assert.equal(wrong.status,400);assert.equal((await counts(p.id)).answers,0);
});
test('registered repeated concurrent votes use server actor and one source event',async()=>{
 const p=await fixture(),b=new Browser();await b.login(1);const payload={userId:users[0],optionIds:[p.questions[0].options[0].id]};const result=await Promise.all(Array.from({length:20},()=>b.request('/posts/'+p.id+'/vote','POST',payload)));assert.deepEqual(result.map(r=>r.status),Array(20).fill(200));assert.deepEqual(await counts(p.id),{responses:1,answers:1,counter:1,votes:[1,0]});const row=await prisma.response.findFirstOrThrow({where:{postId:p.id}});assert.equal(row.userId,users[1]);assert.equal(await prisma.interactionEvent.count({where:{post_id:p.id,event_type:'VOTE'}}),1);
 await assert.rejects(prisma.response.create({data:{postId:p.id,userId:users[1]}}), (e:any)=>e.code==='P2002');
 await assert.rejects(prisma.answer.create({data:{responseId:row.id,questionId:p.questions[0].id,optionId:p.questions[0].options[0].id}}),(e:any)=>e.code==='P2002');
});
test('guest pre-established capability recovers first response loss, replay and spoof denial',async()=>{
 const p=await fixture(),b=new Browser(),guestId=randomUUID(),path='/posts/'+p.id;
 assert.equal((await b.request(path+'/participation-session','POST')).status,200);const cookie=[...b.cookies.values()][0];assert.ok(cookie);
 const payload={guestId,optionIds:[p.questions[0].options[0].id]};assert.equal((await b.request(path+'/vote','POST',payload,true)).status,200);
 const rs=await Promise.all(Array.from({length:8},()=>b.request(path+'/vote','POST',payload)));assert.ok(rs.every(r=>r.status===200));assert.deepEqual(await counts(p.id),{responses:1,answers:1,counter:1,votes:[1,0]});
 const attacker=new Browser();await attacker.request(path+'/participation-session','POST');assert.equal((await attacker.request(path+'/vote','POST',payload)).status,403);
});
test('multi-choice set is idempotent and single-choice cannot add a second answer later',async()=>{
 const p=await fixture(true),single=await fixture(),b=new Browser();await b.login(1);const q=p.questions[0];const payload={answers:q.options.map(o=>({questionId:q.id,optionId:o.id}))};assert.equal((await b.request('/posts/'+p.id+'/vote','POST',payload)).status,200);assert.equal((await b.request('/posts/'+p.id+'/vote','POST',payload)).status,200);assert.deepEqual(await counts(p.id),{responses:1,answers:2,counter:1,votes:[1,1]});
 const sq=single.questions[0];assert.equal((await b.request('/posts/'+single.id+'/vote','POST',{optionId:sq.options[0].id})).status,200);assert.equal((await b.request('/posts/'+single.id+'/vote','POST',{answers:[{questionId:sq.id,optionId:sq.options[1].id}]})).status,409);assert.deepEqual((await counts(single.id)).votes,[1,0]);
});
test('expiry changed while vote waits for post lock prevents write',async()=>{
 const p=await fixture(),b=new Browser();await b.login(1);let unlock:()=>void=()=>{},ready:()=>void=()=>{};const locked=new Promise<void>(r=>ready=r),release=new Promise<void>(r=>unlock=r);
 const holder=prisma.$transaction(async tx=>{await tx.$queryRawUnsafe('SELECT id FROM "Post" WHERE id=$1 FOR UPDATE',p.id);ready();await release;await tx.post.update({where:{id:p.id},data:{expiresAt:new Date(Date.now()-1000)}});});await locked;const request=b.request('/posts/'+p.id+'/vote','POST',{optionId:p.questions[0].options[0].id});await new Promise(r=>setTimeout(r,150));unlock();await holder;assert.equal((await request).status,400);assert.equal((await counts(p.id)).answers,0);
});
function event(postId:string,overrides:Record<string,unknown>={}){return {id:randomUUID(),event_type:'POST_VIEW_START',post_id:postId,source_surface:'FEED',position_in_feed:0,sessionId:randomUUID(),deviceType:'WEB',timestamp:new Date().toISOString(),...overrides};}
test('analytics acknowledges replay and mixed batch without transaction poisoning; blocks forged mutations',async()=>{
 const p=await fixture(),b=new Browser();await b.login(1);const e=event(p.id),next=event(p.id),forged=event(p.id,{event_type:'VOTE'}),invalid=event(p.id,{position_in_feed:'0'});
 const first=await b.request('/analytics/interactions/batch','POST',[e]);assert.deepEqual(first.body.acceptedIds,[e.id]);
 const retry=await b.request('/analytics/interactions/batch','POST',[e,forged,null,invalid,next]);assert.equal(retry.status,200);assert.deepEqual(retry.body.acceptedIds,[e.id,next.id]);assert.equal(retry.body.rejected.length,3);assert.equal(await prisma.interactionEvent.count({where:{post_id:p.id}}),2);
 const owner=new Browser();await owner.login();const collision=await owner.request('/analytics/interactions/batch','POST',[e]);assert.equal(collision.body.rejected[0].code,'EVENT_ID_CONFLICT');
});
test('analytics denies private targets and invalid duration, allows reversed delivery without fabricating source counts',async()=>{
 const p=await fixture(),b=new Browser();await b.login(1);await prisma.post.update({where:{id:p.id},data:{targetAudience:'Followers'}});const denied=await b.request('/analytics/interactions/batch','POST',[event(p.id)]);assert.equal(denied.body.rejected[0].code,'TARGET_UNAVAILABLE');await prisma.post.update({where:{id:p.id},data:{targetAudience:'Public'}});
 const sessionId=randomUUID(),end=event(p.id,{event_type:'POST_VIEW_END',dwell_time_ms:25,sessionId}),start=event(p.id,{sessionId});const result=await b.request('/analytics/interactions/batch','POST',[end,start,event(p.id,{event_type:'POST_VIEW_END',dwell_time_ms:-1})]);assert.deepEqual(result.body.acceptedIds,[end.id,start.id]);assert.equal(result.body.rejected[0].code,'INVALID_DURATION');assert.equal((await counts(p.id)).counter,0);assert.equal(await prisma.postView.count({where:{postId:p.id}}),0);
});
test('username rename preserves alias/stable identity and rejects namespace conflicts',async()=>{
 const b=new Browser();await b.login();const me=await b.request('/users/me'),handle=prefix+'_new';const saved=await b.request('/users/'+users[0],'PUT',{handle,expectedUpdatedAt:me.body.updatedAt});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.id,users[0]);assert.equal(saved.body.handle,handle);
 const old=await b.request('/users/handle/'+prefix+'0');assert.equal(old.status,200,JSON.stringify(old.body));assert.equal(old.body.id,users[0]);
 const other=new Browser();await other.login(1);const current=await other.request('/users/me');const conflict=await other.request('/users/'+users[1],'PUT',{handle:prefix+'0',expectedUpdatedAt:current.body.updatedAt});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'HANDLE_UNAVAILABLE');const reserved=await other.request('/users/'+users[1],'PUT',{handle:'admin',expectedUpdatedAt:current.body.updatedAt});assert.equal(reserved.status,400);assert.equal(reserved.body.code,'HANDLE_RESERVED');
 assert.equal(await prisma.securityEmailOutbox.count({where:{userId:users[0],kind:'USERNAME_CHANGED'}}),1);
});

test('analytics rejects a stale account batch without accepting or attributing any event',async()=>{
 const p=await fixture(),b=new Browser();await b.login(1);const e=event(p.id);
 const mismatch=await b.request('/analytics/interactions/batch','POST',{events:[e],expectedActorId:users[0]});
 assert.equal(mismatch.status,409);assert.equal(mismatch.body.code,'ANALYTICS_ACTOR_CHANGED');assert.equal(await prisma.interactionEvent.count({where:{id:e.id}}),0);
 const missing=await b.request('/analytics/interactions/batch','POST',{events:[e]});assert.equal(missing.status,409);
});

test('question types reject forged text/option answers and text replays remain stable',async()=>{
 const p=await fixture(),b=new Browser();await b.login(1);const text=await prisma.question.create({data:{postId:p.id,type:'text',text:'Explain',order:1}});
 const path='/posts/'+p.id+'/vote';
 assert.equal((await b.request(path,'POST',{answers:[{questionId:p.questions[0].id,textValue:'forged choice'}]})).status,400);
 assert.equal((await b.request(path,'POST',{answers:[{questionId:text.id,optionId:p.questions[0].options[0].id}]})).status,400);
 assert.equal((await counts(p.id)).answers,0);
 const payload={answers:[{questionId:text.id,textValue:'Synthetic text'}]};
 assert.equal((await b.request(path,'POST',payload)).status,200);assert.equal((await b.request(path,'POST',payload)).status,200);
 assert.equal((await counts(p.id)).answers,1);assert.equal((await b.request(path,'POST',{answers:[{questionId:text.id,textValue:'Different'}]})).status,409);
});

test('canonical primary-group posts require joined membership and recheck revocation after lock wait',async()=>{
 const p=await fixture(),g=await prisma.group.create({data:{name:'Synthetic group',description:'fixture',category:'test',isPublic:true}});groups.push(g.id);
 await prisma.post.update({where:{id:p.id},data:{groupId:g.id,targetAudience:'Groups'}});
 const b=new Browser(),guest=new Browser(),path='/posts/'+p.id+'/vote',payload={optionId:p.questions[0].options[0].id};await b.login(1);
 assert.equal((await guest.request(path,'POST',{...payload,guestId:randomUUID()})).status,403);assert.equal((await b.request(path,'POST',payload)).status,403);
 await prisma.groupMember.create({data:{groupId:g.id,userId:users[1],status:'PENDING'}});assert.equal((await b.request(path,'POST',payload)).status,403);
 await prisma.groupMember.update({where:{userId_groupId:{userId:users[1],groupId:g.id}},data:{status:'JOINED'}});
 let unlock:()=>void=()=>{},ready:()=>void=()=>{};const locked=new Promise<void>(r=>ready=r),release=new Promise<void>(r=>unlock=r);
 const holder=prisma.$transaction(async tx=>{await tx.$queryRawUnsafe('SELECT id FROM "Post" WHERE id=$1 FOR UPDATE',p.id);ready();await release;await tx.groupMember.update({where:{userId_groupId:{userId:users[1],groupId:g.id}},data:{status:'PENDING'}});});
 await locked;const request=b.request(path,'POST',payload);await new Promise(r=>setTimeout(r,150));unlock();await holder;assert.equal((await request).status,403);assert.equal((await counts(p.id)).answers,0);
 await prisma.groupMember.update({where:{userId_groupId:{userId:users[1],groupId:g.id}},data:{status:'JOINED'}});assert.equal((await b.request(path,'POST',payload)).status,200);assert.equal((await counts(p.id)).answers,1);
});


test('owner export and deletion cover alias, pending security notice and confirmed-vote identity',async()=>{
 const b=new Browser(),other=new Browser();await b.login();await other.login(1);
 const p=await fixture(),oldHandle=prefix+'0',newHandle=prefix+'_new';
 assert.equal((await b.request('/posts/'+p.id+'/vote','POST',{optionId:p.questions[0].options[0].id})).status,200);
 const response=await prisma.response.findFirstOrThrow({where:{postId:p.id,userId:users[0]}});
 const targetEvent=await prisma.interactionEvent.create({data:{id:randomUUID(),event_type:'PROFILE_VIEW',actor_user_id:users[1],target_user_id:users[0],source_surface:'PROFILE',session_id:randomUUID(),device_type:'WEB'}});
 const exported=await b.request('/account/export');assert.equal(exported.status,200);
 assert.ok(exported.body.handleHistory.some((r:any)=>r.handle===oldHandle));assert.ok(exported.body.handleHistory.some((r:any)=>r.handle===newHandle));
 assert.ok(exported.body.pendingSecurityNotifications.some((r:any)=>r.kind==='USERNAME_CHANGED' && r.recipient===prefix+'0@example.invalid'));
 for(const row of exported.body.handleHistory)assert.deepEqual(Object.keys(row).sort(),['createdAt','handle']);
 for(const row of exported.body.pendingSecurityNotifications)assert.deepEqual(Object.keys(row).sort(),['createdAt','id','kind','recipient']);
 const otherExport=await other.request('/account/export');assert.equal(otherExport.status,200);assert.equal(otherExport.body.handleHistory.some((r:any)=>r.handle===oldHandle),false);assert.equal(otherExport.body.pendingSecurityNotifications.some((r:any)=>r.recipient===prefix+'0@example.invalid'),false);
 assert.equal((await b.request('/account','DELETE')).status,200);
 assert.equal(await prisma.securityEmailOutbox.count({where:{userId:users[0]}}),0);
 for(const handle of [oldHandle,newHandle]){assert.equal((await prisma.handleAlias.findUniqueOrThrow({where:{handle}})).userId,null);assert.equal((await other.request('/users/handle/'+handle)).status,404);}
 const current=await other.request('/users/me');const claim=await other.request('/users/'+users[1],'PUT',{handle:oldHandle,expectedUpdatedAt:current.body.updatedAt});assert.equal(claim.status,409);assert.equal(claim.body.code,'HANDLE_UNAVAILABLE');
 const retained=await prisma.response.findUniqueOrThrow({where:{id:response.id}});for(const field of ['userId','guestId','guestProofHash','guestProofExpiresAt','ipAddress'] as const)assert.equal(retained[field],null);assert.equal(retained.isAnonymous,true);
 assert.equal(await prisma.interactionEvent.count({where:{OR:[{actor_user_id:users[0]},{target_user_id:users[0]},{id:targetEvent.id}]}}),0);
});
