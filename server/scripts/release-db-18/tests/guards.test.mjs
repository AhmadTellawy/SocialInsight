import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { APPLICATION, HASH, ROOT, readRegular, sha256, verifyBundle } from '../core.mjs';
import { CA_SHA256, CLI_SHA256, CONNECTION_OPTIONS, LINUX_ENGINE_SHA256, childEnvironment, connectionUrl, localDatabase, profile, rejectInherited, targetFor, validateApproval } from '../contract.mjs';
import { runRelease } from '../install.mjs';
import { expectedMigrations, preflightSql, preservationSql } from '../sql.mjs';
import { applicationName } from '../backend-cleanup.mjs';

const id=()=>randomUUID();
const h='a'.repeat(64);
const syntheticCleanup=async()=>({status:'UNVERIFIED',queryEndConfirmed:false,rollbackConfirmed:false,failureCode:'SYNTHETIC_NO_BACKEND'});
function fixture() {
  const binding=verifyBundle(), now=Date.now(), target=targetFor('PROD_10');
  const ctx={binding,target,profile:'PROD_10',command:'deploy',runId:id(),now,opsRevision:'b'.repeat(40),serviceId:'srv-synthetic'};
  const instant=ms=>new Date(now+ms).toISOString();
  const a={schemaVersion:1,authority:'F01_INDEPENDENT_RELEASE_REVIEW',application:APPLICATION,sourceBindingSha256:binding.bindingSha256,opsRevision:ctx.opsRevision,command:'deploy',runId:ctx.runId,profile:ctx.profile,...target,serviceId:ctx.serviceId,validFrom:instant(-1000),expiresAt:instant(20*60000),
    gates:['E03','E04','E01','D04','F01'].map(role=>({role,status:'PASSED',evidenceSha256:h,sourceBindingSha256:binding.bindingSha256})),
    prismaTransportProof:{status:'PASSED',evidenceSha256:h,sourceBindingSha256:binding.bindingSha256,contractSha256:sha256(readRegular(resolve(ROOT,'contract.mjs'))),project:target.project,host:target.host,transport:target.transport,nodePlatform:'linux',prismaVersion:'6.19.2',cliSha256:CLI_SHA256,engineSha256:LINUX_ENGINE_SHA256,caSha256:CA_SHA256,validPeer:true,wrongCaRejectedBeforeCredentials:true,wrongHostnameRejectedBeforeCredentials:true,noTlsRejectedBeforeCredentials:true,noPlaintextFallback:true,databaseTls:true,timezone:'UTC',lockTimeoutMs:5000,statementTimeoutMs:120000,observedAt:instant(-1000)},
    applicationDeployment:false,unknownRunPolicy:'STOP_AND_INSPECT_NO_AUTOMATIC_RETRY',fence:{active:true,project:target.project,allApplicationWritersStopped:true,cronStopped:true,socketStopped:true,mediaWritersStopped:true,evidenceSha256:h,observedAt:instant(-1000),expiresAt:instant(20*60000)},
    backup:{project:target.project,verified:true,restoreVerified:true,journalCoverageVerified:true,evidenceSha256:h,completedAt:instant(-1000)},runtimeJournalAclPlanReviewed:true,runtimeJournalAclEvidenceSha256:h,stageAcceptanceEvidenceSha256:h,baselineCaptureApproved:true};
  delete a.local;
  return {a,ctx};
}
test('frozen bundle verifies 18 migrations and deliberate Production-only historical byte overlay',()=>{
  const b=verifyBundle(); assert.equal(b.migrations.length,18);
  assert.equal(expectedMigrations(b,'STAGE_15')[9].checksum,'5b89b5d2e1ad7464ca7fb98849c010c5bd8cc7ebdc826621c588f39c139910b4');
  assert.equal(expectedMigrations(b,'PROD_10')[9].checksum,'6c523622f3a261b11eacdd71a541fca178f0f757c36852f32325d7f486363f21');
});
test('a changed SQL byte fails verification even when the filename is unchanged',()=>{
  const b=verifyBundle(),dir=resolve(ROOT,'evidence',`binding-${id()}`); mkdirSync(dir,{recursive:true});
  for(const f of [...b.files,{path:'release-binding.json'}]) { const p=resolve(dir,f.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,readFileSync(resolve(ROOT,f.path))); }
  const sql=resolve(dir,`prisma/migrations/${b.migrations[17].name}/migration.sql`);writeFileSync(sql,readFileSync(sql)+'\n');
  assert.throws(()=>verifyBundle(dir),/BUNDLE_BYTES_INVALID/);
});
test('only three profiles and confined local database identifiers are accepted',()=>{
  for(const name of ['','__proto__','PROD_15','STAGE_EMPTY\n']) assert.throws(()=>profile(name));
  for(const name of ['settings_test','postgres','si_release18_x\n','si_release18_x/../postgres','si_release18_x;DROP DATABASE x']) assert.throws(()=>localDatabase(name));
  assert.equal(localDatabase('si_release18_unit_123'),'si_release18_unit_123');
});
test('Production pooler is excluded and localhost never accepts a remote endpoint',()=>{
  assert.throws(()=>targetFor('PROD_10','session'),/TRANSPORT_INVALID/);
  assert.equal(targetFor('PROD_10').host,'db.jlanmsxfggpnbwoowejy.supabase.co');
  assert.deepEqual(targetFor('PROD_10','direct','si_release18_unit'),{project:'LOCAL_SYNTHETIC_ONLY',host:'127.0.0.1',port:55447,database:'si_release18_unit',user:'postgres',transport:'local',local:true});
});
test('controlled URL encodes percent/delimiter passwords and always supplies strict TLS and startup bounds',()=>{
  const password='synthetic%:@/#?+ x',url=new URL(connectionUrl(targetFor('PROD_10'),password,resolve(ROOT,'supabase-root-2021.crt')));
  assert.equal(decodeURIComponent(url.password),password);assert.equal(url.searchParams.get('options'),CONNECTION_OPTIONS);
  assert.equal(url.searchParams.get('sslaccept'),'strict');assert.equal(url.searchParams.get('sslmode'),'require');assert.equal(url.searchParams.get('connection_limit'),'1');
});
test('forbidden inherited configuration is rejected without evaluating its value',()=>{
  const env={};Object.defineProperty(env,'DATABASE_URL',{enumerable:true,get(){throw Error('SECRET_WAS_READ');}});
  assert.throws(()=>rejectInherited(env),/INHERITED_CONFIGURATION_FORBIDDEN/);
  const clean=childEnvironment({PATH:'synthetic',SECRET:'do-not-copy',NODE_OPTIONS:'bad'},'controlled');
  assert.equal(clean.SECRET,undefined);assert.equal(clean.NODE_OPTIONS,undefined);assert.equal(clean.DATABASE_URL,clean.DIRECT_URL);
});
test('synthetic positive approval satisfies validation without granting or executing hosted authority',()=>{const {a,ctx}=fixture();assert.equal(validateApproval(a,ctx),a);});
const invalidApprovals=[
  ['wrong source',a=>a.sourceBindingSha256=h],['wrong actor service',a=>a.serviceId='srv-wrong'],['wrong project',a=>a.project='wrong'],['wrong command',a=>a.command='preflight'],['wrong UUID',a=>a.runId=id()],
  ['expired',a=>a.expiresAt=new Date(Date.now()-1).toISOString()],['unbounded',a=>a.expiresAt=new Date(Date.now()+86400000).toISOString()],['gate missing',a=>a.gates.pop()],['gate not independent',a=>a.gates[0].role='D03'],
  ['old transport contract',a=>a.prismaTransportProof.contractSha256=h],['wrong engine',a=>a.prismaTransportProof.engineSha256=h],['missing backend TLS',a=>a.prismaTransportProof.databaseTls=false],['wrong UTC',a=>a.prismaTransportProof.timezone='Asia/Amman'],['wrong timeout',a=>a.prismaTransportProof.lockTimeoutMs=2000],
  ['wrong CA proof',a=>a.prismaTransportProof.caSha256=h],
  ['expired fence',a=>a.fence.expiresAt=new Date(Date.now()-1).toISOString()],['media writer active',a=>a.fence.mediaWritersStopped=false],['unverified backup',a=>a.backup.restoreVerified=false],['journal coverage missing',a=>a.backup.journalCoverageVerified=false],['Stage absent',a=>delete a.stageAcceptanceEvidenceSha256],['runtime ACL plan absent',a=>a.runtimeJournalAclPlanReviewed=false]
];
for(const [name,mutate] of invalidApprovals) test(`approval fails closed: ${name}`,()=>{const {a,ctx}=fixture();mutate(a);assert.throws(()=>validateApproval(a,ctx));});
test('hosted execution without trusted configuration is rejected before password access or a database call',async()=>{
  let accessed=false;const env={};Object.defineProperty(env,'RELEASE18_DB_ADMIN_PASSWORD',{enumerable:true,get(){accessed=true;throw Error('PRIVATE_PASSWORD_ACCESS');}});
  await assert.rejects(()=>runRelease({command:'deploy',name:'PROD_10',runId:id(),env}),/HOSTED_LINUX_REQUIRED|TRUSTED_CONFIG_BINDING_REQUIRED/);
  assert.equal(accessed,false);
});
test('Production 10 SQL never references later guest-proof fields and failures are assertions',()=>{
  const b=verifyBundle(),sql=preflightSql(b,'PROD_10',targetFor('PROD_10','direct','si_release18_unit'));
  assert.doesNotMatch(sql,/WHERE guest_proof_hash/);assert.match(sql,/RAISE EXCEPTION 'IDENTITY_COLLISION'/);assert.match(sql,/HISTORICAL_ROLLBACK_MISMATCH/);assert.doesNotMatch(sql,/SET LOCAL (?:statement_timeout|lock_timeout)|SET LOCAL TIME ZONE/i);
});
test('invalid digest metadata and SQL identifiers fail before SQL execution',()=>{
  assert.throws(()=>preservationSql({tables:[{name:'users;DROP',columns:['id'],count:'0',digest:h}]}));
  assert.throws(()=>preservationSql({tables:[{name:'users',columns:['id'],count:'-1',digest:h}]}));
  assert.equal(HASH.test(h+'\n'),false);
});
test('a write-capable timeout keeps unknown status and blocks another run without leaking child output',async()=>{
  const localName=`si_release18_unknown_${id().replaceAll('-','').slice(0,12)}`;
  let calls=0;
  const result=await runRelease({command:'deploy',name:'STAGE_EMPTY',runId:id(),localName,env:{},localSnapshot:{tables:[],rollbackDigest:sha256('')},localBackendCleanup:syntheticCleanup,localSpawn(){calls++;return calls===1?{status:0}:{status:null,signal:'SIGTERM',error:new Error('PRIVATE_CANARY'),stdout:'PRIVATE_CANARY',stderr:'PRIVATE_CANARY'};}});
  assert.equal(result.status,'FAILED_OR_UNKNOWN');assert.equal(result.failureCode,'MIGRATE_DEPLOY_FAILED');assert.equal(calls,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_CANARY/);
  const again=await runRelease({command:'deploy',name:'STAGE_EMPTY',runId:id(),localName,env:{},localSnapshot:{tables:[],rollbackDigest:sha256('')},localSpawn(){throw Error('SHOULD_NOT_RUN');}});
  assert.equal(again.failureCode,'UNRESOLVED_TARGET_RUN');
});
test('a rejected preflight never runs migrate deploy and duplicate run UUID cannot overwrite its receipt',async()=>{
  const runId=id(),localName=`si_release18_reject_${id().replaceAll('-','').slice(0,12)}`;let calls=0;
  const options={command:'deploy',name:'STAGE_EMPTY',runId,localName,env:{},localSnapshot:{tables:[],rollbackDigest:sha256('')},localBackendCleanup:syntheticCleanup,localSpawn(){calls++;return {status:1,stderr:'PRIVATE_CANARY'};}};
  const result=await runRelease(options);assert.equal(result.status,'PREFLIGHT_REJECTED');assert.equal(calls,1);
  await assert.rejects(()=>runRelease(options),/RUN_ALREADY_EXISTS/);
});
test('cleanup marker requires an exact fresh UUID and cannot select another application',()=>{
  const runId=id();assert.equal(applicationName(runId),`si_release18_${runId}`);
  for(const invalid of ['postgres','',runId+'\n',runId+'%'])assert.throws(()=>applicationName(invalid));
});
