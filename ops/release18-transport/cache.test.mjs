import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as C from './contract.mjs';
import { saveCache,verifyCache,materializeCache,dependencyFiles } from './cache.mjs';
import { publishCapture,publishCache } from './public-result.mjs';
import { publicSummary } from './capture.mjs';
import { prepareCache } from './prepare-cache.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(process.env.RELEASE18_TEST_ARTIFACT_ROOT??path.join(HERE,'../../../test-runs'));fs.mkdirSync(ROOT,{recursive:true,mode:0o700});
function fixture(){
 const root=fs.mkdtempSync(path.join(ROOT,'cache-')),runnerRoot=path.join(root,'ops/release18-transport'),packageRoot=path.join(root,'package'),cacheHome=path.join(root,'cache');
 for(const d of [runnerRoot,packageRoot,cacheHome])fs.mkdirSync(d,{recursive:true,mode:0o700});
 for(const name of C.RUNTIME_FILES)fs.copyFileSync(path.join(HERE,name),path.join(runnerRoot,name));
 fs.writeFileSync(path.join(packageRoot,'package-lock.json'),'{"synthetic":true}\n');
 const modules=path.join(packageRoot,'node_modules');fs.mkdirSync(modules,{mode:0o700});
 fs.writeFileSync(path.join(modules,'synthetic-public-dependency.js'),'export const fixture=true;\n',{mode:0o600});
 fs.mkdirSync(path.join(modules,'.bin'));fs.writeFileSync(path.join(modules,'.bin','excluded-synthetic-link'),'unused');
 const ctx={cacheHome,packageRoot,runnerRoot,opsRevision:'a'.repeat(40),nodeVersion:'v24.13.0',platform:process.platform};
 return {root,modules,...ctx,ctx};
}
test('credential-free public dependency cache saves, validates, reuses and copies exact bytes into a fresh consumer',()=>{
 const f=fixture(),saved=saveCache(f.ctx);assert.equal(saved.files,1);assert.equal(saved.reusedVerifiedCache,false);
 assert.equal(saveCache(f.ctx).reusedVerifiedCache,true);
 const verified=verifyCache({...f.ctx,manifestSha256:saved.manifestSha256});
 assert.equal(C.sha256(fs.readFileSync(path.join(verified.folder,'manifest.json'))),saved.manifestSha256);
 const runDirectory=path.join(f.root,'fresh-consumer');fs.mkdirSync(runDirectory,{mode:0o700});
 const copy=materializeCache({...f.ctx,manifestSha256:saved.manifestSha256,runDirectory});
 assert.deepEqual(dependencyFiles(path.join(copy.runtimeRoot,'node_modules')),verified.manifest.files);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(copy.runtimeRoot,'package.json'))),{private:true});
 assert(!fs.existsSync(path.join(copy.runtimeRoot,'node_modules/.bin')));
 assert.throws(()=>materializeCache({...f.ctx,manifestSha256:saved.manifestSha256,runDirectory}),/TOOLCHAIN_ALREADY_EXISTS/);
});
test('cache missing, corrupt, extra, malformed manifest, node, package lock and source mismatch reject without repair',()=>{
 for(const mutation of ['missing','corrupt','extra','manifest','node','lock','source','type']){
  const f=fixture(),s=saveCache(f.ctx),folder=path.join(f.cacheHome,'opiniup-db18-toolchain',s.manifestSha256),file=path.join(folder,'node_modules/synthetic-public-dependency.js');
  if(mutation==='missing')fs.renameSync(file,path.join(f.root,'retained-original'));
  if(mutation==='corrupt')fs.appendFileSync(file,'CORRUPTED');
  if(mutation==='extra')fs.writeFileSync(path.join(folder,'node_modules/extra.js'),'extra');
  if(mutation==='manifest')fs.appendFileSync(path.join(folder,'manifest.json'),' ');
  if(mutation==='node')f.ctx.nodeVersion='v24.14.0';
  if(mutation==='lock')fs.appendFileSync(path.join(f.packageRoot,'package-lock.json'),' ');
  if(mutation==='source')fs.appendFileSync(path.join(f.runnerRoot,'prepare-cache.mjs'),'\n// changed');
  if(mutation==='type'){fs.renameSync(file,path.join(f.root,'retained-original'));fs.mkdirSync(file);}
  const before=fs.readdirSync(folder).sort();assert.throws(()=>verifyCache({...f.ctx,manifestSha256:s.manifestSha256}),undefined,mutation);
  assert.deepEqual(fs.readdirSync(folder).sort(),before,'Validation must not repair cache');
 }
});
test('private dotenv/evidence files cannot enter cache; missing cache and path escape are rejected',()=>{
 for(const name of ['.env','.env.local','.npmrc','evidence']){
  const f=fixture();fs.writeFileSync(path.join(f.modules,name),'SYNTHETIC_PRIVATE_SENTINEL');assert.throws(()=>saveCache(f.ctx),/CACHE_PRIVATE_INPUT_FORBIDDEN/);
 }
 const f=fixture();assert.throws(()=>verifyCache({...f.ctx,manifestSha256:'../outside'}));assert.throws(()=>verifyCache({...f.ctx,manifestSha256:'0'.repeat(64)}));
});
test('prepare-cache rejects secret variable names without reading values, spawning, or printing them',async()=>{
 for(const name of ['RELEASE18_DB_ADMIN_PASSWORD','DATABASE_URL','PGPASSWORD','STAGING_DB_ADMIN_PASSWORD','UNKNOWN_API_KEY']){
  let reads=0,spawns=0;const events=[],env={};Object.defineProperty(env,name,{enumerable:true,get(){reads++;return 'SYNTHETIC_SECRET_MUST_NOT_READ';}});
  const result=await prepareCache({argv:['prepare-cache'],env,platform:'linux'},{spawnSync:()=>spawns++,emit:v=>events.push(v)});
  assert.equal(result.status,'REJECTED');assert.equal(reads,0);assert.equal(spawns,0);assert(!JSON.stringify(events).includes('SYNTHETIC_SECRET'));
 }
});
function summary(){
 const now=new Date().toISOString(),e=C.resultEvidence({runId:randomUUID(),opsRevision:'a'.repeat(40),runnerSourceSha256:'b'.repeat(64),configSha256:'c'.repeat(64),toolchainCacheManifestSha256:'f'.repeat(64),contractSha256:'d'.repeat(64),controlledTlsProof:{evidenceSha256:'e'.repeat(64),operationsCommit:'a'.repeat(40),observedAt:now},startedAt:now,observedAt:now});
 return publicSummary(e,C.proofProjection(e),'REVIEWED_SANITIZED_PROOF');
}
test('static receipt has exact canonical minimized projection and recomputable evidence; no private artifacts copied',()=>{
 const f=fixture(),s=summary(),result=publishCapture(s,f.runnerRoot);assert.deepEqual(result,{recordWritten:true,indexPublished:true});
 const root=path.resolve(f.runnerRoot,'../public-result'),bytes=fs.readFileSync(path.join(root,'result-'+s.runId+'.json'),'utf8');
 const retrieved=JSON.parse(bytes);assert.deepEqual(retrieved,s);assert.equal(C.sha256(C.canonical(retrieved.reviewedProjection.evidence)),s.evidenceSha256);
 assert.deepEqual(fs.readdirSync(root).sort(),['index.html','result-'+s.runId+'.json'].sort());assert(!bytes.includes('postgresql://'));
 assert.throws(()=>publishCapture(s,f.runnerRoot)); // no overwrite/replay
});
test('public projection rejects nested sentinel, invalid typed values and mismatched hashes before writing',()=>{
 for(const mutate of [s=>s.raw='SYNTHETIC_SENTINEL',s=>s.reviewedProjection.evidence.actualTarget.raw='SYNTHETIC_SENTINEL',s=>s.reviewedProjection.evidence.target.host='SYNTHETIC_SENTINEL',s=>s.status='FAILED',s=>s.databaseMutation='false',s=>s.proofSha256='0'.repeat(64),s=>s.evidenceSha256='0'.repeat(64),s=>s.runId='../outside']){
  const f=fixture(),s=summary();mutate(s);assert.throws(()=>publishCapture(s,f.runnerRoot));assert(!fs.existsSync(path.resolve(f.runnerRoot,'../public-result')));
 }
});
test('static JSON, pending index and atomic rename failures do not produce a successful publication',()=>{
 for(const phase of ['json','index','rename']){
  const f=fixture(),s=summary(),io={...fs,writeFileSync(file,...args){if(phase==='json'&&file.endsWith('.json')||phase==='index'&&file.endsWith('.pending'))throw Error('SYNTHETIC_WRITE_FAILURE');return fs.writeFileSync(file,...args);},renameSync(...args){if(phase==='rename')throw Error('SYNTHETIC_RENAME_FAILURE');return fs.renameSync(...args);}};
  assert.throws(()=>publishCapture(s,f.runnerRoot,io));assert(!fs.existsSync(path.resolve(f.runnerRoot,'../public-result/index.html')));
 }
});
test('cache static result has only the typed allowlist and requires valid phase/service/binding',()=>{
 const f=fixture(),s={event:'RELEASE18_TOOLCHAIN_CACHE',status:'PASSED',phase:'CACHE_ROUNDTRIP',runId:randomUUID(),serviceId:C.SERVICE,opsRevision:'a'.repeat(40),sourceBindingSha256:C.FROZEN_BINDING,runnerSourceSha256:'b'.repeat(64),cacheManifestSha256:'c'.repeat(64),files:1,bytes:27,databaseMutation:false,applicationDeployment:false};
 assert.equal(publishCache(s,f.runnerRoot).indexPublished,true);
 for(const mutate of [x=>x.raw='SYNTHETIC_SENTINEL',x=>x.phase='WRONG',x=>x.serviceId='wrong',x=>x.opsRevision='x'.repeat(40),x=>x.files=-1]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>publishCache(bad,fixture().runnerRoot));}
});

test('credential-free preparation invokes only fixed frozen package commands with a scrubbed environment',async()=>{
 const f=fixture(),calls=[],events=[],env={PATH:process.env.PATH,RENDER_SERVICE_ID:C.SERVICE,RENDER_GIT_COMMIT:'a'.repeat(40),XDG_CACHE_HOME:f.cacheHome,STAGING_INITIAL_INSTALL_MODE:'verify'};
 const out=await prepareCache({argv:['prepare-cache'],env,platform:'linux',runnerRoot:f.runnerRoot,packageRoot:f.packageRoot},{frozenPackage:()=>({}),gitRevision:()=>env.RENDER_GIT_COMMIT,spawnSync:(...args)=>{calls.push(args);return {status:0};},verifyRuntime:()=>({}),saveCache:()=>({manifestSha256:'c'.repeat(64),files:1,bytes:27}),emit:e=>events.push(e)});
 assert.equal(out.status,'PASSED');assert.equal(calls.length,3);
 assert.deepEqual(calls[0].slice(0,2),['npm',['ci']]);assert.deepEqual(calls[1].slice(0,2),[process.execPath,[path.join(f.packageRoot,'launch.mjs'),'verify']]);assert.deepEqual(calls[2].slice(0,2),[process.execPath,[path.join(f.packageRoot,'tests/tls.mjs')]]);
 for(const [, ,options] of calls){assert.equal(options.cwd,f.packageRoot);assert.equal(options.env.STAGING_INITIAL_INSTALL_MODE,undefined);assert.equal(options.env.RENDER_SERVICE_ID,undefined);assert.equal(options.env.XDG_CACHE_HOME,undefined);assert.equal(options.maxBuffer,2097152);}
 assert.deepEqual(calls.map(c=>c[2].timeout),[300000,60000,210000]);
 let reads=0;const bad={...env};Object.defineProperty(bad,'RELEASE18_DB_ADMIN_PASSWORD',{enumerable:true,get(){reads++;return 'SYNTHETIC_SENTINEL';}});
 assert.equal((await prepareCache({argv:['prepare-cache'],env:bad,platform:'linux'},{spawnSync:()=>{throw Error('MUST_NOT_SPAWN');},emit:()=>{}})).status,'REJECTED');assert.equal(reads,0);
});
