import assert from 'node:assert/strict';
import test from 'node:test';
process.env.JWT_SECRET = 'test-only-legacy-key-never-production';
process.env.AUTH_SESSION_HASH_SECRET = 'test-only-session-key-never-production';
process.env.AUTH_LEGACY_BEARER_COMPAT = 'true';
const jwt = require('jsonwebtoken');
const prisma = require('../prisma').default;
const sessions = require('../services/sessionService');
const {requireAuth, requireRecentAuth, optionalAuth} = require('./authMiddleware');
const {currentPageDatabaseContext} = require('../pages/pageDatabaseContext');
const response = () => { const state: any = {}; const res: any = { status(code: number) {state.status = code; return res;}, json(body: any) {state.body = body; return res;} }; return {state,res}; };

test('a valid bearer for A cannot borrow the cookie or recent-auth proof belonging to B', async () => {
  const originals = [prisma.user.findUnique, sessions.resolveSession];
  try {
    prisma.user.findUnique = async () => ({status:'ACTIVE'});
    sessions.resolveSession = async () => ({id:'session-b',userId:'b',createdAt:new Date(),user:{status:'ACTIVE'}});
    const req: any = {method:'GET',headers:{authorization:`Bearer ${jwt.sign({userId:'a'},process.env.JWT_SECRET)}`}};
    const {res,state}=response(); let next=0;
    await requireAuth(req,res,()=>next++);
    assert.equal(next,0); assert.equal(state.body.code,'AUTH_IDENTITY_MISMATCH'); assert.equal(req.authSession,undefined);
  } finally { [prisma.user.findUnique,sessions.resolveSession]=originals; }
});
test('even matching bearer and cookie cannot become recent session authentication', async () => {
  const originals=[prisma.user.findUnique,sessions.resolveSession];
  try {
    prisma.user.findUnique=async()=>({status:'ACTIVE'});
    sessions.resolveSession=async()=>({id:'session-a',userId:'a',createdAt:new Date(),user:{status:'ACTIVE'}});
    const req:any={method:'GET',headers:{authorization:`Bearer ${jwt.sign({userId:'a'},process.env.JWT_SECRET)}`}};
    const {res,state}=response(); await requireAuth(req,res,()=>{});
    assert.equal(req.authSession,undefined); requireRecentAuth(req,res,()=>assert.fail('bearer accepted'));
    assert.equal(state.body.code,'REAUTHENTICATION_REQUIRED');
  } finally { [prisma.user.findUnique,sessions.resolveSession]=originals; }
});
test('recent-auth uses refreshed same-user session proof; stale or mismatched proof is denied',()=>{
  const old=new Date(Date.now()-86400000), fresh=new Date();
  const req:any={user:{userId:'a',authMode:'session'},authSession:{userId:'a',createdAt:old,recentAuthenticatedAt:fresh}};
  let next=0; requireRecentAuth(req,response().res,()=>next++); assert.equal(next,1);
  for(const session of [{...req.authSession,recentAuthenticatedAt:old},{...req.authSession,userId:'b'}]) {
    const {res,state}=response(); requireRecentAuth({...req,authSession:session},res,()=>assert.fail('invalid proof accepted')); assert.equal(state.body.code,'REAUTHENTICATION_REQUIRED');
  }
});

test('optional authentication scopes Page database identity and does not leak it after next', async () => {
  const original=sessions.resolveSession;
  try {
    sessions.resolveSession=async()=>({id:'session-a',userId:'a',createdAt:new Date(),user:{status:'ACTIVE'}});
    const req:any={method:'GET',headers:{}};
    await optionalAuth(req,response().res,()=>assert.deepEqual(currentPageDatabaseContext(),{
      actorId:'a',staff:false,system:false,testUser:false,
    }));
    assert.equal(currentPageDatabaseContext(),undefined);
    sessions.resolveSession=async()=>null;
    await optionalAuth({method:'GET',headers:{}} as any,response().res,()=>assert.deepEqual(currentPageDatabaseContext(),{
      actorId:null,staff:false,system:false,testUser:false,
    }));
    assert.equal(currentPageDatabaseContext(),undefined);
  } finally { sessions.resolveSession=original; }
});

test('requireAuth reuses only the module-private session result verified by optionalAuth', async () => {
  const original=sessions.resolveSession;
  try {
    let resolutions=0;
    sessions.resolveSession=async()=>{resolutions++;return {id:'session-a',userId:'a',createdAt:new Date(),user:{status:'ACTIVE'}};};
    const req:any={method:'GET',headers:{}};
    const {res}=response(); let next=0;
    await optionalAuth(req,res,()=>next++);
    await requireAuth(req,res,()=>next++);
    assert.equal(resolutions,1);
    assert.equal(next,2);
    assert.deepEqual(req.user,{userId:'a',authMode:'session'});

    const forged:any={method:'GET',headers:{},user:{userId:'attacker',authMode:'session'},authSession:req.authSession};
    await requireAuth(forged,res,()=>next++);
    assert.equal(resolutions,2,'a copied request property must not count as verified request-local proof');
    assert.deepEqual(forged.user,{userId:'a',authMode:'session'});
  } finally { sessions.resolveSession=original; }
});
