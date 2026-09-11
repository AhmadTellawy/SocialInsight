import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as C from './contract.mjs';
import { runCapture,auditConfiguration,createRun,publicSummary,passedProcess,gitRevision,exclusive } from './capture.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const REPO=process.cwd();
const FROZEN=path.resolve(process.env.RELEASE18_TEST_PACKAGE_ROOT??path.join(REPO,'.worktrees/account-settings-stage-bootstrap/server/scripts/release-db-18'));
const TEST_ROOT=path.resolve(process.env.RELEASE18_TEST_ARTIFACT_ROOT??path.join(HERE,'../../../test-runs'));
fs.mkdirSync(TEST_ROOT,{recursive:true,mode:0o700});
const frozen=C.frozenPackage(FROZEN);
const actualContract=await import(pathToFileURL(path.join(FROZEN,'contract.mjs')));
const actualProcess=await import(pathToFileURL(path.join(FROZEN,'process-runner.mjs')));
const SENTINEL='SYNTHETIC_ONLY_TRANSPORT_PASSWORD_d9c142e_never_real';
const GOOD_COMMIT='a'.repeat(40);
const oldCommit='d'.repeat(40);
function config(runId,runnerRoot,now) {
  const runnerSourceSha256=C.sourceSnapshot(runnerRoot);
  return {schemaVersion:1,authority:'F01_INDEPENDENT_TRANSPORT_REVIEW',command:'CAPTURE_STAGE_READ_ONLY',runId,opsRevision:GOOD_COMMIT,serviceId:C.SERVICE,target:{...C.TARGET},sourceBindingSha256:C.FROZEN_BINDING,runnerSourceSha256,toolchainCacheManifestSha256:'f'.repeat(64),validFrom:new Date(now-1000).toISOString(),expiresAt:new Date(now+1200000).toISOString(),gates:['E03','E04','E01','D04','F01'].map(role=>({role,status:'PASSED',evidenceSha256:'b'.repeat(64),sourceBindingSha256:C.FROZEN_BINDING,runnerSourceSha256})),controlledTlsProof:{status:'PASSED',evidenceSha256:'e'.repeat(64),operationsCommit:oldCommit,serviceId:C.SERVICE,sourceBindingSha256:C.FROZEN_BINDING,contractSha256:frozen.contractSha256,nodePlatform:'linux',prismaVersion:'6.19.2',cliSha256:C.CLI_SHA256,engineSha256:C.ENGINE_SHA256,caSha256:C.CA_SHA256,validPeer:true,wrongCaRejectedBeforeCredentials:true,wrongHostnameRejectedBeforeCredentials:true,noTlsRejectedBeforeCredentials:true,noPlaintextFallback:true,observedAt:new Date(now-60000).toISOString()},projectionMode:'REVIEWED_SANITIZED_PROOF',databaseMutation:false,applicationDeployment:false,unknownRunPolicy:'STOP_AND_REVIEW_NO_AUTOMATIC_RETRY'};
}
function fixture() {
  const dir=fs.mkdtempSync(path.join(TEST_ROOT,'offline-')),runnerRoot=path.join(dir,'ops/release18-transport'),packageRoot=path.join(dir,'server/scripts/release-db-18');
  fs.mkdirSync(runnerRoot,{recursive:true,mode:0o700});fs.mkdirSync(packageRoot,{recursive:true,mode:0o700});
  for(const name of C.RUNTIME_FILES)fs.copyFileSync(path.join(HERE,name),path.join(runnerRoot,name));
  fs.copyFileSync(path.join(FROZEN,'supabase-root-2021.crt'),path.join(packageRoot,'supabase-root-2021.crt'));
  const f={dir,runnerRoot,packageRoot,runId:randomUUID(),now:Date.now(),reads:0,calls:[],events:[]};
  f.config=config(f.runId,runnerRoot,f.now);f.configPath=path.join(dir,'approved.json');
  f.env={PATH:process.env.PATH,RENDER_SERVICE_ID:C.SERVICE,RENDER_GIT_COMMIT:GOOD_COMMIT};
  Object.defineProperty(f.env,'RELEASE18_DB_ADMIN_PASSWORD',{enumerable:true,get(){f.reads++;return SENTINEL;}});
  f.save=()=>{fs.writeFileSync(f.configPath,JSON.stringify(f.config));f.env.RELEASE18_TRANSPORT_APPROVED_CONFIG_SHA256=C.sha256(fs.readFileSync(f.configPath));};
  f.save();
  f.runtime={cli:path.join(packageRoot,'node_modules/prisma/build/index.js'),cliSha256:C.CLI_SHA256,engineSha256:C.ENGINE_SHA256,prismaVersion:'6.19.2',nodeVersion:'v24.21.0',nodePlatform:'linux'};
  f.result={status:0,processCleanup:{verified:true,quiescent:true,remainingLivePids:[]}};
  f.tools={runtime:f.runtime,connectionUrl:actualContract.connectionUrl,childEnvironment:actualContract.childEnvironment,runPrismaProcess:async(...args)=>{f.calls.push(args);return f.result;}};
  f.deps={now:()=>f.now,frozenPackage:()=>frozen,frozenRuntime:async()=>f.tools,gitRevision:()=>GOOD_COMMIT,createRun:(root,id)=>createRun(root,id,process.platform,path.join(root,'evidence')),emit:e=>f.events.push(e)};
  f.options={argv:['capture','--approval-file',f.configPath,'--run-id',f.runId],env:f.env,platform:'linux',runnerRoot,packageRoot};
  return f;
}
async function rejectedBeforePassword(f,expected) {
  const result=await runCapture(f.options,f.deps);
  assert.equal(result.status,'REJECTED');assert.equal(f.reads,0);assert.equal(f.calls.length,0);
  if(expected)assert.equal(result.failureCode,expected);
  assert(!JSON.stringify(f.events).includes(SENTINEL));
}
test('frozen50 source files verified; no provider connection or source mutation',()=>{assert.equal(frozen.sourceBindingSha256,C.FROZEN_BINDING);});
test('valid offline orchestration invokes only pinned CLI fixed read-only SQL and keeps sentinel out of evidence',async()=>{
  const f=fixture();const result=await runCapture(f.options,f.deps);
  assert.equal(result.status,'PASSED');assert.equal(f.reads,1);assert.equal(f.calls.length,1);
  const [program,args,options]=f.calls[0];assert.equal(program,process.execPath);
  assert.deepEqual(args.slice(0,4),[f.runtime.cli,'db','execute','--file']);
  assert.equal(args.length,7);assert.equal(args[5],'--schema');assert.equal(options.timeout,60000);assert.equal(options.maxBuffer,65536);
  assert.equal(options.cwd,path.join(f.runnerRoot,'evidence',f.runId));
  assert(!args.some(a=>a.includes(SENTINEL)||a.includes('migrate')||a==='npm'));
  assert.equal(options.env.RELEASE18_DB_ADMIN_PASSWORD,undefined);assert.equal(options.env.RENDER_GIT_COMMIT,undefined);
  const url=new URL(options.env.DATABASE_URL);assert.equal(url.hostname,C.TARGET.host);assert.equal(url.searchParams.get('connect_timeout'),'10');assert.equal(url.searchParams.get('sslaccept'),'strict');assert.equal(url.searchParams.get('options'),'-c timezone=UTC -c lock_timeout=5000 -c statement_timeout=120000 -c default_transaction_read_only=on');
  const sql=fs.readFileSync(args[4],'utf8');assert(sql.startsWith('-- Fixed metadata'));assert(sql.includes('BEGIN READ ONLY;'));assert(sql.endsWith('ROLLBACK;\n')||sql.endsWith('ROLLBACK;'));assert(sql.includes("current_setting('default_transaction_read_only')"));assert(sql.includes('WHERE pid = pg_backend_pid()'));assert(!sql.includes('__INVOCATION_TAG__'));assert(sql.includes('si_r18_transport_'+f.runId.replaceAll('-','')));
  const serialized=fs.readdirSync(options.cwd).map(n=>fs.readFileSync(path.join(options.cwd,n),'utf8')).join('\n')+JSON.stringify(f.events);
  assert(!serialized.includes(SENTINEL));assert(!serialized.includes('postgresql://'));assert(fs.existsSync(path.join(f.runnerRoot,'evidence/stage-session.lock')));
  assert.equal(result.reviewedProjection.evidence.controlledNegativeEvidence.scope,'PREVIOUS_INDEPENDENTLY_ACCEPTED_CONTROLLED_PEERS_NOT_TARGET_NEGATIVE_TESTS');
  assert.equal(result.reviewedProjection.prismaTransportProof.observedAt,f.config.controlledTlsProof.observedAt);
});
test('every target, mode, service and source field mismatch rejects before password',async()=>{
  for(const key of Object.keys(C.TARGET)){const f=fixture();f.config.target[key]=key==='port'?6543:'wrong';f.save();await rejectedBeforePassword(f,'APPROVAL_TARGET_INVALID');}
  for(const mutate of [f=>f.config.command='deploy',f=>f.config.authority='SELF_APPROVED',f=>f.config.serviceId='srv-wrong',f=>f.config.opsRevision='c'.repeat(40),f=>f.config.runId=randomUUID(),f=>f.config.sourceBindingSha256='0'.repeat(64),f=>f.config.runnerSourceSha256='0'.repeat(64),f=>f.config.extra=SENTINEL,f=>f.config.target.extra=SENTINEL]){const f=fixture();mutate(f);f.save();await rejectedBeforePassword(f);}
});
test('freshness boundaries, invalid timestamps and missing independent proof/gates fail closed',async()=>{
  const mutations=[f=>f.config.validFrom=new Date(f.now+1).toISOString(),f=>f.config.expiresAt=new Date(f.now).toISOString(),f=>f.config.expiresAt=new Date(f.now+600000).toISOString(),f=>f.config.expiresAt=new Date(f.now+1800000).toISOString(),f=>f.config.validFrom='2026-02-30T00:00:00.000Z',f=>delete f.config.validFrom,f=>f.config.controlledTlsProof.observedAt=new Date(f.now+1).toISOString(),f=>f.config.controlledTlsProof.observedAt=new Date(f.now-86400001).toISOString(),f=>f.config.controlledTlsProof.extra=SENTINEL,f=>f.config.gates.pop(),f=>f.config.gates[0].role='F01',f=>f.config.gates[0].status='PENDING'];
  for(const mutate of mutations){const f=fixture();mutate(f);f.save();await rejectedBeforePassword(f);}
  const f=fixture();f.config.expiresAt=new Date(f.now+600001).toISOString();f.save();assert.equal((await runCapture(f.options,f.deps)).status,'PASSED');
});
test('pins and runtime identity are checked before password',async()=>{
  for(const key of ['engineSha256','cliSha256','caSha256','contractSha256','sourceBindingSha256','nodePlatform','prismaVersion','wrongCaRejectedBeforeCredentials','wrongHostnameRejectedBeforeCredentials','noTlsRejectedBeforeCredentials','noPlaintextFallback']){const f=fixture();f.config.controlledTlsProof[key]=key.endsWith('Sha256')?'0'.repeat(64):false;f.save();await rejectedBeforePassword(f);}
  for(const key of ['engineSha256','cliSha256','prismaVersion','nodePlatform','nodeVersion','cli']){const f=fixture();f.runtime[key]='wrong';await rejectedBeforePassword(f);}
  const f=fixture();fs.writeFileSync(path.join(f.packageRoot,'supabase-root-2021.crt'),'wrong');await rejectedBeforePassword(f,'CA_PIN_MISMATCH');
});
test('wrong/untrusted config hash, actual commit and wrong host platform are rejected',async()=>{
  for(const alter of [f=>delete f.env.RELEASE18_TRANSPORT_APPROVED_CONFIG_SHA256,f=>f.env.RELEASE18_TRANSPORT_APPROVED_CONFIG_SHA256='0'.repeat(64),f=>fs.appendFileSync(f.configPath,' '),f=>f.env.RENDER_GIT_COMMIT='c'.repeat(40),f=>f.env.RENDER_SERVICE_ID='srv-wrong',f=>f.options.platform='win32']){const f=fixture();alter(f);await rejectedBeforePassword(f);}
});
test('all unsupported argv and credential/hook/proxy/TLS environment names fail before value access',async()=>{
  for(const key of ['DATABASE_URL','DIRECT_URL','STAGING_DB_ADMIN_PASSWORD','NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','PGOPTIONS','npm_config_userconfig','PRISMA_CONFIG','DOTENV_CONFIG_PATH','HTTP_PROXY','https_proxy','ALL_PROXY','LD_PRELOAD','UNKNOWN_API_KEY','RELEASE18_APPROVED_CONFIG_SHA256']) {
    const f=fixture();Object.defineProperty(f.env,key,{enumerable:true,get(){throw new Error(SENTINEL);}});await rejectedBeforePassword(f);
  }
  for(const argv of [['verify'],['capture'],['capture','--approval-file','relative.json','--run-id',randomUUID()],['capture','--run-id',randomUUID(),'--approval-file','/x'],['capture','--approval-file','/x','--run-id',randomUUID(),'--deploy']]){const f=fixture();f.options.argv=argv;await rejectedBeforePassword(f);}
  const f=fixture();for(const k of ['BASH_FUNC_copy_secret_files%%','BASH_FUNC_remove_secret_files%%'])Object.defineProperty(f.env,k,{enumerable:true,get(){throw new Error(SENTINEL);}});
  assert.equal((await runCapture(f.options,f.deps)).status,'PASSED');
});
test('all six executable config suffixes, dotenv/rc and nearest package Prisma settings fail before CLI',async()=>{
  for(const name of ['prisma.config.js','prisma.config.ts','prisma.config.mjs','prisma.config.cjs','prisma.config.mts','prisma.config.cts','.env','.env.local','.npmrc','.prismarc']){const f=fixture();fs.writeFileSync(path.join(f.runnerRoot,name),"throw new Error('"+SENTINEL+"');");await rejectedBeforePassword(f);}
  const f=fixture();fs.writeFileSync(path.join(f.runnerRoot,'package.json'),JSON.stringify({prisma:{schema:'outside.prisma'}}));await rejectedBeforePassword(f,'PACKAGE_PRISMA_CONFIG_FORBIDDEN');
});
test('reviewed source changes and SQL mutation between approval and credential access fail closed',async()=>{
  for(const name of C.RUNTIME_FILES){const f=fixture();fs.appendFileSync(path.join(f.runnerRoot,name),'\n ');await rejectedBeforePassword(f,'APPROVAL_SOURCE_MISMATCH');}
  const f=fixture();f.deps.frozenRuntime=async()=>{fs.appendFileSync(path.join(f.runnerRoot,'transport.sql'),'\nSELECT 2;');return f.tools;};await rejectedBeforePassword(f,'SQL_TEMPLATE_INVALID');
});
test('exclusive UUID and unknown target lock reject replay with zero new password access',async()=>{
  const f=fixture();assert.equal((await runCapture(f.options,f.deps)).status,'PASSED');f.reads=0;f.calls=[];await rejectedBeforePassword(f,'RUN_ALREADY_EXISTS');
  const g=fixture();g.result={status:1,error:new Error(SENTINEL)};assert.equal((await runCapture(g.options,g.deps)).status,'FAILED_OR_UNKNOWN');
  g.runId=randomUUID();g.config.runId=g.runId;g.options.argv[4]=g.runId;g.save();g.reads=0;g.calls=[];await rejectedBeforePassword(g,'UNRESOLVED_PRIOR_CAPTURE');
});
test('nonzero, timeout, signal, spawn error, overflow, unknown cleanup and throw never create success proof or leak output',async()=>{
  const variants=[{status:1},{status:0,reason:'TIMEOUT'},{status:0,signal:'SIGTERM'},{status:0,error:new Error(SENTINEL)},{status:0,reason:'OUTPUT_LIMIT'},{status:0,processCleanup:{verified:false,quiescent:true,remainingLivePids:[]}},{status:0,processCleanup:{verified:true,quiescent:true,remainingLivePids:[123]}}];
  for(const result of variants){const f=fixture();f.result={...result,stdout:SENTINEL,stderr:SENTINEL};const out=await runCapture(f.options,f.deps);assert.equal(out.status,'FAILED_OR_UNKNOWN');assert(!out.reviewedProjection);assert(!JSON.stringify(f.events).includes(SENTINEL));assert(!fs.existsSync(path.join(f.runnerRoot,'evidence',f.runId,'prisma-transport-proof.json')));}
  const f=fixture();f.tools.runPrismaProcess=async()=>{throw new Error(SENTINEL);};assert.equal((await runCapture(f.options,f.deps)).failureCode,'TRANSPORT_CAPTURE_FAILED');assert(!JSON.stringify(f.events).includes(SENTINEL));
});
test('canonical safe transfer excludes extra nested sentinel values and preserves frozen preflight compatibility',async()=>{
  const f=fixture();const out=await runCapture(f.options,f.deps),e=out.reviewedProjection.evidence,p=out.reviewedProjection.prismaTransportProof;
  assert.equal(C.sha256(C.canonical(e)),p.evidenceSha256);assert.equal(C.sha256(C.canonical(p)),out.proofSha256);
  assert.deepEqual(JSON.parse(JSON.stringify(out.reviewedProjection)),{evidence:e,prismaTransportProof:p});
  assert(!publicSummary(e,p,'SUMMARY_ONLY').reviewedProjection);
  for(const mutate of [x=>x.extra=SENTINEL,x=>x.target.extra=SENTINEL,x=>x.actualTarget.raw=SENTINEL,x=>x.controlledNegativeEvidence.raw=SENTINEL,x=>x.opsRevision=SENTINEL,x=>x.actualTarget.databaseTls=false]) {const bad=structuredClone(e);mutate(bad);assert.throws(()=>publicSummary(bad,p,'REVIEWED_SANITIZED_PROOF'));}
  const bad=structuredClone(p);bad.raw=SENTINEL;assert.throws(()=>publicSummary(e,bad,'REVIEWED_SANITIZED_PROOF'));
  const a={schemaVersion:1,authority:'F01_INDEPENDENT_RELEASE_REVIEW',application:'9a8a3aeea6b614fbd58421d0fc1f1c01b36eb4ef',sourceBindingSha256:C.FROZEN_BINDING,opsRevision:GOOD_COMMIT,command:'preflight',runId:f.runId,profile:'STAGE_EMPTY',...C.TARGET,serviceId:C.SERVICE,validFrom:f.config.validFrom,expiresAt:f.config.expiresAt,gates:f.config.gates.map(({runnerSourceSha256,...g})=>g),prismaTransportProof:p,applicationDeployment:false,unknownRunPolicy:'STOP_AND_INSPECT_NO_AUTOMATIC_RETRY'};
  const ctx={binding:{bindingSha256:C.FROZEN_BINDING},target:C.TARGET,command:'preflight',runId:f.runId,now:f.now,opsRevision:GOOD_COMMIT,serviceId:C.SERVICE,profile:'STAGE_EMPTY'};
  assert.equal(actualContract.validateApproval(a,ctx),a);
  for(const mutate of [x=>x.prismaTransportProof.host='wrong',x=>x.prismaTransportProof.sourceBindingSha256='0'.repeat(64),x=>x.prismaTransportProof.observedAt=new Date(f.now-86400001).toISOString(),x=>x.opsRevision='c'.repeat(40),x=>x.runId=randomUUID()]){const bad=structuredClone(a);mutate(bad);assert.throws(()=>actualContract.validateApproval(bad,ctx));}
});
let ExistingAjv;try{ExistingAjv=createRequire(import.meta.url)('ajv/dist/2020').default;}catch{}
test('existing local Ajv validates approval JSON Schema; separate from runtime guards',{skip:!ExistingAjv?'Existing root Ajv unavailable; no unrelated Linux toolchain installed':false},()=>{
  const ajv=new ExistingAjv({strict:true,allErrors:true});
  ajv.addFormat('date-time',{type:'string',validate:v=>{try{C.utc(v);return true;}catch{return false;}}});
  const validate=ajv.compile(JSON.parse(fs.readFileSync(path.join(HERE,'transport-approval.schema.json'))));
  const f=fixture();assert(validate(f.config),JSON.stringify(validate.errors));f.config.controlledTlsProof.extra=SENTINEL;assert.equal(validate(f.config),false);
});
test('read-only git invocation receives only clean environment; arbitrary git output is rejected',()=>{
  const calls=[];assert.equal(gitRevision('/fixture',{PATH:'safe'},(...args)=>{calls.push(args);return {status:0,stdout:GOOD_COMMIT+'\n'};}),GOOD_COMMIT);
  assert.deepEqual(calls[0][1],['-C','/fixture','rev-parse','HEAD']);assert.deepEqual(calls[0][2].env,{PATH:'safe'});
  assert.throws(()=>gitRevision('/fixture',{},()=>({status:0,stdout:SENTINEL})));
});
test('hostile source symlink and output symlink are rejected without following them',{skip:process.platform==='win32'?'Windows symlink creation privilege unavailable; Linux selected check remains required':false},async()=>{
  const f=fixture();const source=path.join(f.runnerRoot,'transport.sql');fs.renameSync(source,source+'.original');fs.symlinkSync(source+'.original',source);await rejectedBeforePassword(f);
  const g=fixture();fs.symlinkSync(g.dir,path.join(g.runnerRoot,'evidence'),'dir');await rejectedBeforePassword(g);
});
test('actual Linux process-group timeout/overflow cleanup remains required',{skip:process.platform!=='linux'?'No Linux runtime installed on this Windows host; prepared for Linux execution':false},async()=>{
  const f=fixture();
  for(const [script,limit] of [['setInterval(()=>{},1000)',1024],['setInterval(()=>process.stdout.write("x".repeat(4096)),1)',1024]]) {
    const r=await actualProcess.runPrismaProcess(process.execPath,['-e',script],{cwd:f.dir,env:C.cleanEnvironment(process.env),timeout:300,maxBuffer:limit});
    assert(['TIMEOUT','OUTPUT_LIMIT'].includes(r.reason));assert.equal(r.processCleanup.verified,true);assert.equal(r.processCleanup.quiescent,true);assert.deepEqual(r.processCleanup.remainingLivePids,[]);
  }
});

test('projection, publication and emitter failures preserve truthful proof and lock state without successful return',async()=>{
 for(const phase of ['projection','publication','emitter']){
  const f=fixture();
  if(phase==='projection')f.deps.publicSummary=()=>{throw Error(SENTINEL);};
  if(phase==='publication')f.deps.publishCapture=()=>{throw Error(SENTINEL);};
  if(phase==='emitter')f.deps.emit=()=>{throw Error(SENTINEL);};
  const out=await runCapture(f.options,f.deps);
  assert.equal(out.status,'FAILED_OR_UNKNOWN');assert.equal(out.transportAssertionsPassed,true);assert.equal(out.lockRetained,true);
  assert.equal(out.proofCreated,phase!=='projection');assert.equal(out.publicResultPrepared,phase==='emitter');
  const run=path.join(f.runnerRoot,'evidence',f.runId),record=JSON.parse(fs.readFileSync(path.join(run,'rejected.json')));
  assert.equal(record.proofCreated,fs.existsSync(path.join(run,'prisma-transport-proof.json'))||fs.existsSync(path.join(run,'rejected-artifacts/prisma-transport-proof.json')));assert.equal(record.publicResultPrepared,phase==='emitter');
  assert(!JSON.stringify(out).includes(SENTINEL));assert(!f.events.some(e=>e.status==='PASSED'));
 }
});

test('schema and runtime required keys, target constants and gate shapes do not drift (structural check only)',()=>{
 const schema=JSON.parse(fs.readFileSync(path.join(HERE,'transport-approval.schema.json'))),f=fixture();
 assert.equal(schema.additionalProperties,false);assert.deepEqual([...schema.required].sort(),Object.keys(f.config).sort());
 assert.deepEqual(schema.properties.target.const,C.TARGET);
 assert.equal(schema.properties.sourceBindingSha256.const,C.FROZEN_BINDING);
 assert.deepEqual(schema.properties.projectionMode.enum,['SUMMARY_ONLY','REVIEWED_SANITIZED_PROOF']);
 const gates=schema.properties.gates.items;assert.equal(gates.additionalProperties,false);assert.deepEqual([...gates.required].sort(),Object.keys(f.config.gates[0]).sort());
 const proof=schema.properties.controlledTlsProof;assert.equal(proof.additionalProperties,false);assert.deepEqual([...proof.required].sort(),Object.keys(f.config.controlledTlsProof).sort());
});

test('post-proof JSON/index/rename/receipt/emit failures quarantine owned successes and publish only failure',async()=>{
 const {publishCapture:publish}=await import('./public-result.mjs');
 for(const phase of ['json','index','rename','receipt','emit']){
  const f=fixture();
  if(['json','index','rename'].includes(phase))f.deps.publishCapture=(summary,root)=>publish(summary,root,{...fs,writeFileSync(file,...args){if(phase==='json'&&file.endsWith('.json')||phase==='index'&&file.endsWith('.pending'))throw Error(SENTINEL);return fs.writeFileSync(file,...args);},renameSync(...args){if(phase==='rename')throw Error(SENTINEL);return fs.renameSync(...args);}});
  if(phase==='receipt')f.deps.exclusive=(file,bytes)=>{if(file.endsWith('receipt.json'))throw Error(SENTINEL);return exclusive(file,bytes);};
  if(phase==='emit')f.deps.emit=v=>{if(v.status==='PASSED')throw Error(SENTINEL);f.events.push(v);};
  const out=await runCapture(f.options,f.deps),run=path.join(f.runnerRoot,'evidence',f.runId),publicRoot=path.resolve(f.runnerRoot,'../public-result');
  assert.equal(out.status,'FAILED_OR_UNKNOWN');assert.equal(out.proofCreated,true);assert.equal(out.privateResultQuarantined,true);assert.equal(out.publicSuccessRevoked,true);assert.equal(out.quarantineState,'COMPLETED');assert.equal(out.lockRetained,true);
  for(const name of ['evidence.json','prisma-transport-proof.json','receipt.json'])assert(!fs.existsSync(path.join(run,name)),name);
  assert(fs.existsSync(path.join(run,'rejected-artifacts/prisma-transport-proof.json')));
  assert(!fs.existsSync(path.join(publicRoot,'result-'+f.runId+'.json')));
  assert(!fs.existsSync(path.join(publicRoot,'.index-'+f.runId+'.pending')));
  const html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');assert(html.includes('FAILED_OR_UNKNOWN'));assert(!html.includes('PASSED'));
  const failed=JSON.parse(fs.readFileSync(path.join(publicRoot,'failed-'+f.runId+'.json')));assert.equal(failed.proofAvailable,false);
  assert(!f.events.some(e=>e.status==='PASSED'));assert(!JSON.stringify(f.events).includes(SENTINEL));
 }
});
test('failed quarantine or output ownership uncertainty stays unknown and preserves lock without foreign cleanup',async()=>{
 for(const phase of ['private','public']){
  const f=fixture();f.deps.emit=v=>{if(v.status==='PASSED')throw Error(SENTINEL);f.events.push(v);};
  if(phase==='private')f.deps.quarantinePrivateResult=()=>{throw Error(SENTINEL);};
  else f.deps.revokeCapturePublication=()=>{throw Error(SENTINEL);};
  const out=await runCapture(f.options,f.deps);
  assert.equal(out.status,'FAILED_OR_UNKNOWN');assert.equal(out.quarantineState,'FAILED_OR_UNKNOWN');assert.equal(out.lockRetained,true);
  assert.equal(out.privateResultQuarantined,phase!=='private');assert.equal(out.publicSuccessRevoked,phase!=='public');
  assert(!f.events.some(e=>e.status==='PASSED'));assert(!JSON.stringify(out).includes(SENTINEL));
 }
 const f=fixture();f.deps.publishCapture=()=>{const root=path.resolve(f.runnerRoot,'../public-result');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'index.html'),'FOREIGN_FILE_MUST_REMAIN');throw Error(SENTINEL);};
 const out=await runCapture(f.options,f.deps);assert.equal(out.quarantineState,'FAILED_OR_UNKNOWN');assert.equal(fs.readFileSync(path.resolve(f.runnerRoot,'../public-result/index.html'),'utf8'),'FOREIGN_FILE_MUST_REMAIN');
});
