import assert from 'node:assert/strict';
import test, { before, after, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

for (const name of ['DATABASE_URL','DIRECT_URL']) {
  const url = new URL(process.env[name] || 'http://invalid');
  assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'55447'); assert.equal(url.pathname,'/settings_test');
}
process.env.NODE_ENV = 'test'; process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.AUTH_SESSION_HASH_SECRET = 'isolated-settings-integration-session-key';
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32,42).toString('base64');
process.env.AUTH_COOKIE_SECURE = 'false'; process.env.AUTH_LEGACY_BEARER_COMPAT = 'false';
const prisma = require('../prisma').default as typeof import('../prisma').default;
const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
const { totpAtStep } = require('../services/mfaService') as typeof import('../services/mfaService');
const cron = require('../services/cronService'); mock.method(cron,'initCronJobs',()=>{});
// Keep durable writes real, but run this fixture's transitions explicitly below.
// A global asynchronous retry would race manual processing and other fixtures.
mock.method(require('../services/mediaPrivacyTransitionService'),'resumeMediaPrivacyTransitions',async()=>{});
mock.method(require('../services/accountCleanupService'),'resumeAccountCleanupJobs',async()=>{});
// This suite exercises the real HTTP stack; Socket.IO has its own transport suite.
const sockets = require('../services/socketService'); mock.method(sockets,'initSocket',()=>undefined);
const app = require('../app').default;
const prefix = `settings_${randomUUID().replace(/-/g,'').slice(0,10)}`;
const ids = { owner:randomUUID(), other:randomUUID(), mfa:randomUUID(), deletion:randomUUID(), deactivation:randomUUID() };
const password = 'FixturePass1!'; let server:Server, base:string;
class Browser {
  cookies = new Map<string,string>(); csrf = '';
  async request(path:string, method='GET', body?:unknown, csrf=true) {
    const headers: Record<string,string> = { Origin:'http://localhost:3000', Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ') };
    if (csrf && this.csrf) headers['X-CSRF-Token']=this.csrf;
    if (body !== undefined) headers['Content-Type']='application/json';
    const response=await fetch(`${base}/api${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    for (const cookie of response.headers.getSetCookie()) { const pair=cookie.split(';')[0]; const eq=pair.indexOf('='); const key=pair.slice(0,eq),value=pair.slice(eq+1); if(value)this.cookies.set(key,value);else this.cookies.delete(key); }
    const payload=await response.json().catch(()=>null);
    if(payload?.csrfToken)this.csrf=payload.csrfToken;
    return {status:response.status,body:payload,headers:response.headers};
  }
  async login(kind:keyof typeof ids) {return this.request('/auth/login','POST',{identifier:`${prefix}_${kind}@example.invalid`,password});}
}
before(async()=>{
  const hash=await bcrypt.hash(password,4);
  await prisma.user.createMany({data:Object.entries(ids).map(([kind,id])=>({id,name:'Synthetic settings user',handle:`${prefix}_${kind}`,email:`${prefix}_${kind}@example.invalid`,emailVerifiedAt:new Date(),passwordHash:hash,status:'ACTIVE'}))});
  server=await new Promise<Server>(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});
  base=`http://127.0.0.1:${(server.address() as any).port}`;
});
after(async()=>{await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();}); await prisma.$disconnect(); mock.restoreAll();});

test('real HTTP session cookies enforce CSRF, owner-only access and atomic settings versions',async()=>{
  const client=new Browser(); const login=await client.login('owner'); assert.equal(login.status,200); assert.equal(login.body.user.id,ids.owner);
  const cookies=login.headers.getSetCookie(); assert.ok(cookies.some(c=>c.startsWith('si_session=')&&c.includes('HttpOnly')));
  const me=await client.request('/users/me'); assert.equal(me.status,200);
  assert.equal((await client.request('/users/me/settings','PATCH',{changes:{searchVisibility:false},expectedUpdatedAt:me.body.updatedAt},false)).status,403);
  const updates=await Promise.all([false,true].map(allowSharing=>client.request('/users/me/settings','PATCH',{changes:{searchVisibility:false,allowSharing},expectedUpdatedAt:me.body.updatedAt})));
  assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
  const fresh=await client.request('/users/me'); assert.equal(fresh.body.searchVisibility,false);
  const visitor=await client.request(`/users/${ids.owner}?viewAs=visitor`); assert.equal(visitor.status,200);
  for(const key of ['email','phone','birthday','demographics','searchVisibility','theme','passwordHash'])assert.equal(key in visitor.body,false);
  assert.equal((await client.request('/users/me/settings','PATCH',{changes:{status:'DELETED'},expectedUpdatedAt:fresh.body.updatedAt})).status,400);
});
test('full demographic editor payload persists all fields without erasing prior canonical values or changing public country',async()=>{
  const client=new Browser(); await client.login('owner');
  await prisma.userDemographics.upsert({where:{userId:ids.owner},create:{userId:ids.owner,educationLevel:'Diploma',employmentType:'Employed',industry:'Government',employmentSector:'Services'},update:{educationLevel:'Diploma',employmentType:'Employed',industry:'Government',employmentSector:'Services'}});
  await prisma.user.update({where:{id:ids.owner},data:{country:'Canada'}});
  const me=await client.request('/users/me'); assert.equal(me.body.demographics.educationLevel,'Diploma');
  assert.equal('userId' in me.body.demographics,false);
  const saved=await client.request(`/users/${ids.owner}`,'PUT',{expectedUpdatedAt:me.body.updatedAt,demographics:{gender:'Female',maritalStatus:'',education:'Diploma',employment:'Employed',industry:'Government',sector:'Services',nationality:'Jordan'}});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  const fresh=await client.request('/users/me');
  assert.equal(fresh.body.demographics.nationality,'Jordan'); assert.equal(fresh.body.demographics.educationLevel,'Diploma');
  assert.equal(fresh.body.demographics.employmentType,'Employed'); assert.equal(fresh.body.demographics.employmentSector,'Services'); assert.equal(fresh.body.country,'Canada');
  const visitor=await client.request(`/users/${ids.owner}?viewAs=visitor`); assert.equal('demographics' in visitor.body,false);
  assert.equal((await client.request(`/users/${ids.owner}`,'PUT',{expectedUpdatedAt:fresh.body.updatedAt,demographics:{nationality:'Unknown nation'}})).status,400);
});

test('notification settings persist exactly once, conflict on stale version and push-off keeps in-app events',async()=>{
  const client=new Browser(); await client.login('other');
  const initial=await client.request('/notification-settings'); assert.equal(initial.status,200);
  const preferences=initial.body.settings; preferences.myPosts.likes='following'; preferences.toggles.pushNotifications=false;
  const saved=await client.request('/notification-settings','PUT',{settings:preferences,expectedUpdatedAt:initial.body.updatedAt}); assert.equal(saved.status,200);
  assert.equal((await client.request('/notification-settings','PUT',{settings:preferences,expectedUpdatedAt:initial.body.updatedAt})).status,409);
  await prisma.follow.create({data:{followerId:ids.other,followingId:ids.owner,status:'PENDING'}});
  const {notify}=require('../services/notificationService');
  await notify(ids.owner,ids.other,'like','Synthetic like','profile',ids.owner);
  assert.equal(await prisma.notification.count({where:{userId:ids.other,type:'like'}}),0);
  await prisma.follow.update({where:{followerId_followingId:{followerId:ids.other,followingId:ids.owner}},data:{status:'ACTIVE'}});
  await notify(ids.owner,ids.other,'like','Synthetic like','profile',ids.owner);
  assert.equal(await prisma.notification.count({where:{userId:ids.other,type:'like'}}),1);
  assert.equal((await client.request('/push/unsubscribe','POST',{})).status,400);
});
test('MFA enrollment proves a factor, gates real login, and recovery code is one-use under concurrent requests',async()=>{
  const owner=new Browser(); assert.equal((await owner.login('mfa')).status,200);
  const enrolled=await owner.request('/auth/mfa/enrollment','POST'); assert.equal(enrolled.status,200);
  const code=totpAtStep(enrolled.body.secret,BigInt(Math.floor(Date.now()/30000)));
  const confirmation=await owner.request('/auth/mfa/enrollment/confirm','POST',{code}); assert.equal(confirmation.status,200);
  assert.equal(confirmation.body.recoveryCodes.length,10);
  const stored=await prisma.userMfa.findUniqueOrThrow({where:{userId:ids.mfa}}); assert.notEqual(stored.encryptedSecret,enrolled.body.secret);
  const a=new Browser(),b=new Browser();
  for(const client of [a,b]){const login=await client.login('mfa');assert.equal(login.status,200);assert.equal(login.body.challengeRequired,true);assert.equal(login.body.user,undefined);assert.equal(client.cookies.has('si_session'),false);}
  const attempts=await Promise.all([a,b].map(client=>client.request('/auth/challenge/complete','POST',{code:confirmation.body.recoveryCodes[0]})));
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,401]);
  assert.equal(attempts.filter(r=>r.body?.user?.id===ids.mfa).length,1);
  const methods=await owner.request('/auth/methods'); assert.equal(methods.body.mfa.enabled,true);
});
test('sessions are owner-scoped, selected revocation invalidates HTTP, export omits security material',async()=>{
  const a=new Browser(),b=new Browser(),other=new Browser(); await a.login('owner'); await b.login('owner'); await other.login('other');
  const aSessions=await a.request('/auth/sessions'), bSessions=await b.request('/auth/sessions');
  const currentB=bSessions.body.sessions.find((s:any)=>s.current).id;
  assert.ok(aSessions.body.sessions.every((s:any)=>!('tokenHash' in s)&&!('csrfHash' in s)));
  await other.request(`/auth/sessions/${currentB}`,'DELETE'); assert.equal((await b.request('/auth/session')).status,200);
  assert.equal((await a.request(`/auth/sessions/${currentB}`,'DELETE')).status,200); assert.equal((await b.request('/auth/session')).status,401);
  const authored = await prisma.post.create({data:{authorId:ids.owner,title:'Owned questionnaire',description:'Authored content',type:'Survey',expiresAt:new Date(Date.now()+86400000),sections:{create:{title:'Owned section',order:2,questions:{create:{text:'Owned question',type:'multiple_choice',order:3,options:{create:{text:'Owned option',order:4,isCorrect:true}}}}}}},include:{sections:{include:{questions:{include:{options:true}}}}}});
  const thirdParty = await prisma.post.create({data:{authorId:ids.other,title:'Third party questionnaire sentinel',description:'Not owner content',type:'Survey',expiresAt:new Date(Date.now()+86400000),questions:{create:{text:'Third party question sentinel',type:'text'}}}});
  await prisma.response.create({data:{userId:ids.other,postId:authored.id,answers:{create:{questionId:authored.sections[0].questions[0].id,textValue:'Third party answer sentinel'}}}});
  const exported=await a.request('/account/export'); assert.equal(exported.status,200); assert.equal(exported.body.profile.handle,`${prefix}_owner`);
  assert.equal(exported.body.sections.find((s:any)=>s.postId===authored.id).title,'Owned section');
  assert.equal(exported.body.questions.find((q:any)=>q.sectionId===authored.sections[0].id).text,'Owned question');
  const option=exported.body.options.find((o:any)=>o.questionId===authored.sections[0].questions[0].id);
  assert.equal(option.text,'Owned option'); assert.equal(option.order,4); assert.equal(option.isCorrect,true);
  for(const sentinel of ['Third party questionnaire sentinel','Third party question sentinel','Third party answer sentinel'])assert.equal(JSON.stringify(exported.body).includes(sentinel),false);
  for(const secret of ['passwordHash','tokenHash','encryptedSecret','recoveryCodeHashes','ipAddress']) assert.equal(JSON.stringify(exported.body).includes(secret),false);
  assert.ok(exported.headers.get('cache-control')?.includes('no-store'));
});
test('deactivation revokes access and requires explicit authenticated reactivation',async()=>{
  const client=new Browser(); await client.login('deactivation');
  assert.equal((await client.request('/account/deactivate','POST')).status,200);
  assert.equal((await client.request('/auth/session')).status,401);
  const login=await client.login('deactivation'); assert.equal(login.body.challenge.kind,'reactivation'); assert.equal(login.body.user,undefined);
  assert.equal((await client.request('/auth/challenge/complete','POST',{})).status,400);
  // Empty fixture has no storage objects; run its durable transition deterministically.
  const transitions=await prisma.mediaPrivacyTransition.findMany({where:{userId:ids.deactivation,status:{not:'COMPLETE'}}});
  for(const transition of transitions)await require('../services/mediaPrivacyTransitionService').processMediaPrivacyTransition(transition.id);
  const restored=await client.request('/auth/challenge/complete','POST',{reactivate:true}); assert.equal(restored.status,200); assert.equal(restored.body.user.id,ids.deactivation);
});
test('deletion respects group ownership then removes private residual data durably',async()=>{
  const client=new Browser(); await client.login('deletion');
  const group=await prisma.group.create({data:{name:'Synthetic ownership group',description:'Test',category:'Test',members:{create:{userId:ids.deletion,role:'Owner',status:'JOINED'}}}});
  assert.equal((await client.request('/account','DELETE')).body.code,'GROUP_OWNERSHIP_REQUIRED');
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:ids.deletion}})).status,'ACTIVE');
  await prisma.groupMember.create({data:{groupId:group.id,userId:ids.owner,role:'Owner',status:'JOINED'}});
  await prisma.pushSubscription.create({data:{userId:ids.deletion,endpoint:`https://example.invalid/${prefix}`,p256dh:'fixture',auth:'fixture'}});
  assert.equal((await client.request('/account','DELETE')).status,200);
  const deleted=await prisma.user.findUniqueOrThrow({where:{id:ids.deletion}}); assert.equal(deleted.status,'DELETED'); assert.equal(deleted.email,null); assert.equal(deleted.passwordHash,null);
  assert.equal(await prisma.pushSubscription.count({where:{userId:ids.deletion}}),0); assert.equal(await prisma.authSession.count({where:{userId:ids.deletion}}),0);
  assert.ok(await prisma.accountCleanupJob.findUnique({where:{userId:ids.deletion}}));
  assert.equal((await client.login('deletion')).status,401);
});
