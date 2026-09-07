import assert from 'node:assert/strict';
import test from 'node:test';
import type {} from '../middleware/authMiddleware';
import type {} from '../middleware/requestContext';
process.env.AUTH_SESSION_HASH_SECRET = 'security-controller-test-fixture-only';
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
const prisma = require('../prisma').default as any;
const controller = require('./accountSecurityController') as typeof import('./accountSecurityController');
const mfa = require('../services/mfaService') as typeof import('../services/mfaService');
const sessions = require('../services/sessionService') as typeof import('../services/sessionService');
const challenges = require('../services/authChallengeService') as typeof import('../services/authChallengeService');
const response = () => { const state: any = {status:200,headers:{}}; const res: any = { status(code: number) {state.status=code;return res;},json(body: any) {state.body=body;return res;},setHeader(n:string,v:any){state.headers[n]=v;},getHeader(n:string){return state.headers[n];} };return {state,res}; };
const request = (body: any = {}, params: any = {}): any => ({body,params,headers:{},user:{userId:'user-a',authMode:'session'},authSession:{id:'session-a',userId:'user-a',recentAuthenticatedAt:new Date()}});
const guarded = (tx: any) => ({ otpChallenge: {updateMany: async () => ({count: 1})}, ...tx, authSession: { findFirst: async () => ({ id: 'session-a', recentAuthenticatedAt: new Date() }), ...tx.authSession } });
const originals = {transaction:prisma.$transaction, sessionUpdate:prisma.authSession.updateMany, sessionFind:prisma.authSession.findMany, challengeRead:challenges.readAuthChallenge, sessionResolve:sessions.resolveSession, sessionCreate:sessions.createSession};
test.afterEach(()=> { prisma.$transaction=originals.transaction;prisma.authSession.updateMany=originals.sessionUpdate;prisma.authSession.findMany=originals.sessionFind;(challenges as any).readAuthChallenge=originals.challengeRead;(sessions as any).resolveSession=originals.sessionResolve;(sessions as any).createSession=originals.sessionCreate; });

test('unlinking the sole OAuth method is rejected under an account transaction lock',async()=>{
  let locked=false,deleted=false;
  prisma.$transaction=async(work:any)=>work(guarded({$executeRaw:async()=>{locked=true;},user:{findUnique:async()=>({passwordHash:null,status:'ACTIVE'})},oAuthAccount:{findMany:async()=>[{provider:'GOOGLE'}],deleteMany:async()=>{deleted=true;}}}));
  const {res,state}=response();await controller.unlinkSignInMethod(request({}, {provider:'google'}),res);
  assert.equal(locked,true);assert.equal(deleted,false);assert.equal(state.status,409);assert.equal(state.body.code,'LAST_SIGN_IN_METHOD');
});
test('a remaining password allows unlinking, and outstanding link states are invalidated atomically',async()=>{
  let deleted:any,invalidated:any;
  prisma.$transaction=async(work:any)=>work(guarded({$executeRaw:async()=>{},user:{findUnique:async()=>({passwordHash:'hash',status:'ACTIVE'}),update:async()=>({})},oAuthAccount:{findMany:async()=>[{provider:'GOOGLE'}],deleteMany:async(args:any)=>{deleted=args;}},oAuthState:{updateMany:async(args:any)=>{invalidated=args;}}}));
  const {res,state}=response();await controller.unlinkSignInMethod(request({}, {provider:'google'}),res);
  assert.equal(state.status,200);assert.deepEqual(deleted.where,{userId:'user-a',provider:'GOOGLE'});assert.equal(invalidated.where.linkingUserId,'user-a');
});
test('session deletion always includes caller ownership and never revokes someone else by ID',async()=>{
  let mutation:any;prisma.$transaction=async(work:any)=>work(guarded({$executeRaw:async()=>{},authSession:{updateMany:async(args:any)=>{mutation=args;return{count:0};}}}));
  const id='00000000-0000-4000-8000-000000000099';const {res,state}=response();await controller.revokeAccountSession(request({}, {id}),res);
  assert.deepEqual(mutation.where,{id,userId:'user-a',revokedAt:null});assert.equal(state.body.currentRevoked,false);
});
test('session listing returns a safe selected DTO and correct current-device marker',async()=>{
  let query:any;prisma.authSession.findMany=async(args:any)=>{query=args;return[{id:'session-a',deviceLabel:'Chrome · Android'}];};
  const {res,state}=response();await controller.listAccountSessions(request(),res);
  assert.equal(query.where.userId,'user-a');assert.equal(query.select.tokenHash,undefined);assert.equal(query.select.csrfHash,undefined);assert.equal(state.body.sessions[0].current,true);assert.equal(state.headers['Cache-Control'],'no-store');
});
test('MFA enrollment proof is bound to the session that requested it',async()=>{
  let writes=0;prisma.$transaction=async(work:any)=>work(guarded({$executeRaw:async()=>{},userMfa:{findUnique:async()=>({pendingSecret:'encrypted',pendingSessionId:'other-session',pendingExpiresAt:new Date(Date.now()+10000)}),update:async()=>{writes++;}}}));
  const {res,state}=response();await controller.confirmMfaEnrollment(request({code:'123456'}),res);
  assert.equal(state.body.code,'MFA_ENROLLMENT_EXPIRED');assert.equal(writes,0);
});
test('wrong MFA proof commits its attempt without issuing a full session',async()=>{
  let attempts=0,created=0;const challenge={id:'challenge-a',userId:'user-a',purpose:'LOGIN_MFA',createdAt:new Date()};
  (challenges as any).readAuthChallenge=async()=>challenge;(sessions as any).resolveSession=async()=>null;(sessions as any).createSession=async()=>{created++;};
  prisma.$transaction=async(work:any)=>work(guarded({$executeRaw:async()=>{},user:{findUnique:async()=>({id:'user-a',status:'ACTIVE'})},authChallenge:{update:async()=>{attempts++;}},userMfa:{findUnique:async()=>({enabledAt:new Date(),encryptedSecret:mfa.encryptMfaSecret(mfa.generateMfaSecret(),'user-a'),recoveryCodeHashes:[]})}}));
  const {res,state}=response();await controller.completeAuthChallenge(request({code:'wrong'}),res);
  assert.equal(state.body.code,'MFA_CODE_INVALID');assert.equal(attempts,1);assert.equal(created,0);
});
test('a deactivated account requires explicit reactivation and cannot be implicitly enabled',async()=>{
  let writes=0;const challenge={id:'challenge-a',userId:'user-a',purpose:'REACTIVATE',createdAt:new Date()};
  (challenges as any).readAuthChallenge=async()=>challenge;(sessions as any).resolveSession=async()=>null;
  prisma.$transaction=async(work:any)=>work(guarded({$executeRaw:async()=>{},user:{findUnique:async()=>({id:'user-a',status:'DEACTIVATED'}),update:async()=>writes++}}));
  const {res,state}=response();await controller.completeAuthChallenge(request({}),res);
  assert.equal(state.body.code,'REACTIVATION_CONFIRMATION_REQUIRED');assert.equal(writes,0);
});
test('a reauthentication MFA challenge cannot upgrade another session',async()=>{
  const challenge={id:'challenge-a',userId:'user-a',purpose:'REAUTH_MFA',sessionId:'original-session',createdAt:new Date()};
  (challenges as any).readAuthChallenge=async()=>challenge;(sessions as any).resolveSession=async()=>({id:'new-session',userId:'user-a'});
  prisma.$transaction=async(work:any)=>work(guarded({$executeRaw:async()=>{},user:{findUnique:async()=>({id:'user-a',status:'ACTIVE'})}}));
  const {res,state}=response();await controller.completeAuthChallenge(request({code:'123456'}),res);
  assert.equal(state.body.code,'AUTH_CHALLENGE_EXPIRED');
});

test('a queued sensitive mutation rechecks session revocation after acquiring the account lock', async () => {
  let mutations = 0;
  prisma.$transaction = async (work: any) => work({$executeRaw:async()=>{}, authSession:{findFirst:async()=>null}, user:{findUnique:async()=>({status:'ACTIVE',passwordHash:'password'}),update:async()=>mutations++},oAuthAccount:{findMany:async()=>[{provider:'GOOGLE'}],deleteMany:async()=>mutations++}});
  const {res,state}=response();await controller.unlinkSignInMethod(request({}, {provider:'google'}),res);
  assert.equal(state.status,401);assert.equal(state.body.code,'AUTH_REQUIRED');assert.equal(mutations,0);
});
