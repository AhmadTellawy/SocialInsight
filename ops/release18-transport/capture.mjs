import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGET,SERVICE,FROZEN_BINDING,CLI_SHA256,ENGINE_SHA256,CA_SHA256,RUN_MS,SQL_MS,CLEANUP_MS,COMMIT,UUID,must,sha256,canonical,failureCode,readRegular,directory,sourceSnapshot,frozenPackage,environmentGuard,cleanEnvironment,argumentsFor,approval,resultEvidence,proofProjection,digest,checkedProjection } from './contract.mjs';

import { materializeCache } from './cache.mjs';
import { publishCapture,revokeCapturePublication } from './public-result.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const PACKAGE=path.resolve(HERE,'../../server/scripts/release-db-18');
const SQL_SHA256='46f20637f9e22d1c0f2e1b0c1512b927d672bbfd3aac588e5cf4b6438b57d515';
const SCHEMA='datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")\n}\n';
export function auditConfiguration(start,repository=start) {
  let dir=directory(start),root=directory(repository);
  must(dir===root || dir.startsWith(root+path.sep),'CONFIGURATION_PATH_INVALID');
  for(;;) {
    for(const name of fs.readdirSync(dir)) {
      must(!/^\.env(?:\.|$)|^\.prismarc(?:\.|$)|^\.npmrc$|^prisma\.config\.(?:js|ts|mjs|cjs|mts|cts)$/i.test(name),'AMBIENT_CONFIG_FILE_FORBIDDEN');
    }
    const manifest=path.join(dir,'package.json');
    if(fs.existsSync(manifest)) {
      const p=JSON.parse(readRegular(manifest,1048576));
      must(p && typeof p==='object' && !Object.hasOwn(p,'prisma'),'PACKAGE_PRISMA_CONFIG_FORBIDDEN');
    }
    if(dir===root)break;
    dir=path.dirname(dir);
  }
}
export function ensurePrivate(dir,platform=process.platform) {
  directory(dir);
  if(platform==='linux')must((fs.statSync(dir).mode&0o077)===0 && fs.statSync(dir).uid===process.getuid(),'PRIVATE_DIRECTORY_PERMISSIONS_INVALID');
}
export function exclusive(file,value) { fs.writeFileSync(file,value,{flag:'wx',mode:0o600}); }
export function createRun(runnerRoot,runId,platform=process.platform,evidenceRoot=platform==='linux'?'/tmp/opiniup-release18-transport':path.join(runnerRoot,'evidence')) {
  must(UUID.test(runId)&&runId.length===36,'RUN_ID_INVALID');
  directory(runnerRoot);
  const evidence=path.resolve(evidenceRoot);
  if(!fs.existsSync(evidence))fs.mkdirSync(evidence,{mode:0o700});
  ensurePrivate(evidence,platform);
  const run=path.join(evidence,runId);
  must(!fs.existsSync(run),'RUN_ALREADY_EXISTS');
  const lock=path.join(evidence,'stage-session.lock');
  must(!fs.existsSync(lock),'UNRESOLVED_PRIOR_CAPTURE');
  fs.mkdirSync(run,{mode:0o700});ensurePrivate(run,platform);
  try {
    exclusive(lock,canonical({runId,status:'STARTED',policy:'STOP_AND_REVIEW_NO_AUTOMATIC_RETRY'})+'\n');
    exclusive(path.join(run,'package.json'),'{"private":true}\n');
    exclusive(path.join(run,'schema.prisma'),SCHEMA);
  } catch(error) { error.reservation={run,lock}; throw error; }
  return {run,lock};
}

export function quarantinePrivateResult(location) {
  const names=['evidence.json','prisma-transport-proof.json','receipt.json'].filter(n=>fs.existsSync(path.join(location.run,n)));
  if(!names.length)return {status:'NOT_REQUIRED',files:0};
  const target=path.join(location.run,'rejected-artifacts');
  must(!fs.existsSync(target),'PRIVATE_QUARANTINE_ALREADY_EXISTS');
  fs.mkdirSync(target,{mode:0o700});ensurePrivate(target);
  for(const name of names) {
    const source=path.join(location.run,name);readRegular(source,1048576);
    must(!fs.existsSync(path.join(target,name)),'PRIVATE_QUARANTINE_ALREADY_EXISTS');
    fs.renameSync(source,path.join(target,name));
  }
  return {status:'QUARANTINED',files:names.length};
}

export function gitRevision(repository,clean,run=spawnSync) {
  const result=run('git',['-C',repository,'rev-parse','HEAD'],{env:clean,encoding:'utf8',timeout:10000,maxBuffer:128,windowsHide:true,stdio:['ignore','pipe','pipe']});
  must(result && result.status===0&&!result.error&&!result.signal&&typeof result.stdout==='string'&&/^[a-f0-9]{40}\r?\n?$/.test(result.stdout),'OPS_REVISION_UNAVAILABLE');
  return result.stdout.trim();
}
async function frozenRuntime(packageRoot,context) {
  const {runtimeRoot}=materializeCache({...context,packageRoot});
  const [{verifyRuntime},{connectionUrl,childEnvironment},{runPrismaProcess}]=await Promise.all([
    import(pathToFileURL(path.join(packageRoot,'install.mjs'))),
    import(pathToFileURL(path.join(packageRoot,'contract.mjs'))),
    import(pathToFileURL(path.join(packageRoot,'process-runner.mjs')))
  ]);
  return {runtimeRoot,runtime:verifyRuntime(runtimeRoot,false),connectionUrl,childEnvironment,runPrismaProcess};
}
function runtimeCheck(r) {
  must(r && r.nodePlatform==='linux' && /^v24\./.test(r.nodeVersion) && Number(r.nodeVersion.split('.')[1])>=13 && r.prismaVersion==='6.19.2' && r.cliSha256===CLI_SHA256 && r.engineSha256===ENGINE_SHA256,'RUNTIME_PIN_MISMATCH');
}
export function passedProcess(r) {
  return r && r.status===0&&!r.error&&!r.signal&&!r.reason && r.processCleanup?.verified===true && r.processCleanup?.quiescent===true && Array.isArray(r.processCleanup.remainingLivePids)&&r.processCleanup.remainingLivePids.length===0;
}
export function publicSummary(e,proof,mode) {
  const projected=checkedProjection(e,proof);
  const value={event:'RELEASE18_TRANSPORT_CAPTURE',status:'PASSED',runId:e.runId,evidenceSha256:sha256(canonical(e)),proofSha256:sha256(canonical(proof)),databaseMutation:false,applicationDeployment:false};
  // Full private receipt/process metadata is never an emission source.
  // This optional projection requires explicit separate E01/E04/F01 approval of this mode.
  if(mode==='REVIEWED_SANITIZED_PROOF')value.reviewedProjection=projected;
  return value;
}
// Dependency injection is for offline tests. CLI does not accept override modules, roots or executables.
export async function runCapture({argv=process.argv.slice(2),env=process.env,platform=process.platform,runnerRoot=HERE,packageRoot=PACKAGE}={},dependencies={}) {
  const now=dependencies.now??Date.now, started=now(),startedAt=new Date(started).toISOString();
  const frozen=dependencies.frozenPackage??frozenPackage;
  const runtimeLoader=dependencies.frozenRuntime??frozenRuntime;
  const getRevision=dependencies.gitRevision??gitRevision;
  const makeRun=dependencies.createRun??createRun;
  const audit=dependencies.auditConfiguration??auditConfiguration;
  const writePrivate=dependencies.exclusive??exclusive;
  const emit=dependencies.emit??(value=>console.log(JSON.stringify(value)));
  let location,credentialAccessed=false,childAttempted=false,proofCreated=false,transportAssertionsPassed=false,publicResultPrepared=false,receipt,safeSummary;
  const deadline=()=>must(now()-started<RUN_MS,'CAPTURE_DEADLINE_EXCEEDED');
  try {
    must(platform==='linux','HOSTED_LINUX_REQUIRED');
    environmentGuard(env);
    const args=argumentsFor(argv);
    directory(runnerRoot);directory(packageRoot);
    const repository=path.resolve(packageRoot,'../../..');
    audit(runnerRoot,runnerRoot);audit(packageRoot,packageRoot);
    const binding=frozen(packageRoot),runnerSourceSha256=sourceSnapshot(runnerRoot);
    digest(env.RELEASE18_TRANSPORT_APPROVED_CONFIG_SHA256,'TRUSTED_CONFIG_DIGEST_REQUIRED');
    const bytes=readRegular(args.file,65536),configSha256=sha256(bytes);
    must(configSha256===env.RELEASE18_TRANSPORT_APPROVED_CONFIG_SHA256,'TRUSTED_CONFIG_HASH_MISMATCH');
    const clean=cleanEnvironment(env),opsRevision=getRevision(repository,clean);
    must(typeof env.RENDER_GIT_COMMIT==='string' && env.RENDER_GIT_COMMIT===opsRevision && COMMIT.test(opsRevision)&&opsRevision.length===40,'OPS_REVISION_MISMATCH');
    const approved=approval(JSON.parse(bytes),{runId:args.runId,opsRevision,serviceId:env.RENDER_SERVICE_ID,runnerSourceSha256,contractSha256:binding.contractSha256,now:now()});
    location=makeRun(runnerRoot,args.runId,platform);
    const runtimeTools=await runtimeLoader(packageRoot,{cacheHome:env.XDG_CACHE_HOME,manifestSha256:approved.toolchainCacheManifestSha256,runnerRoot,runDirectory:location.run});
    runtimeCheck(runtimeTools.runtime);
    must(path.resolve(runtimeTools.runtime.cli)===path.resolve(runtimeTools.runtimeRoot??packageRoot,'node_modules/prisma/build/index.js'),'CLI_PATH_MISMATCH');
    const caFile=path.join(packageRoot,'supabase-root-2021.crt');
    must(sha256(readRegular(caFile))===CA_SHA256,'CA_PIN_MISMATCH');
    // Reserve the UUID and preserve an unresolved target lock before touching credentials.
    audit(location.run,location.run);
    const template=readRegular(path.join(runnerRoot,'transport.sql')).toString('utf8');
    must(sha256(Buffer.from(template))===SQL_SHA256 && template.split('__INVOCATION_TAG__').length===2,'SQL_TEMPLATE_INVALID');
    const tag='si_r18_transport_'+args.runId.replaceAll('-','');
    writePrivate(path.join(location.run,'transport.sql'),template.replace('__INVOCATION_TAG__',tag));
    must(frozen(packageRoot).sourceBindingSha256===binding.sourceBindingSha256 && sourceSnapshot(runnerRoot)===runnerSourceSha256,'SOURCE_CHANGED_BEFORE_CREDENTIALS');
    must(sha256(readRegular(args.file,65536))===configSha256,'CONFIG_CHANGED_BEFORE_CREDENTIALS');
    approval(approved,{runId:args.runId,opsRevision,serviceId:env.RENDER_SERVICE_ID,runnerSourceSha256,contractSha256:binding.contractSha256,now:now()});
    deadline();
    receipt={schemaVersion:1,runId:args.runId,startedAt,status:'STARTED',credentialAccessed:false,childAttempted:false,databaseMutation:false,applicationDeployment:false,approvedConfigSha256:configSha256,sourceBindingSha256:FROZEN_BINDING,runnerSourceSha256,unknownRunPolicy:'STOP_AND_REVIEW_NO_AUTOMATIC_RETRY'};
    writePrivate(path.join(location.run,'started.json'),canonical(receipt)+'\n');
    // This is the only password property access. No installation/config-loading subprocess follows it.
    credentialAccessed=true;
    const password=env.RELEASE18_DB_ADMIN_PASSWORD;
    must(typeof password==='string'&&password.length>0&&password.length<=4096&&!/[\u0000\r\n]/.test(password),'PASSWORD_INVALID');
    const url=new URL(runtimeTools.connectionUrl({...TARGET,local:false},password,caFile));
    must(url.hostname===TARGET.host&&url.port==='5432'&&url.pathname==='/postgres'&&decodeURIComponent(url.username)===TARGET.user&&url.searchParams.get('connect_timeout')==='10'&&url.searchParams.get('connection_limit')==='1'&&url.searchParams.get('schema')==='public'&&url.searchParams.get('options')==='-c timezone=UTC -c lock_timeout=5000 -c statement_timeout=120000'&&url.searchParams.get('sslmode')==='require'&&url.searchParams.get('sslaccept')==='strict'&&url.searchParams.get('sslcert')===caFile,'CONNECTION_CONTRACT_MISMATCH');
    url.searchParams.set('application_name',tag);
    url.searchParams.set('options',url.searchParams.get('options')+' -c default_transaction_read_only=on');
    const childEnv=runtimeTools.childEnvironment(clean,url.href);
    const timeout=Math.min(SQL_MS,RUN_MS-(now()-started)-CLEANUP_MS);
    must(timeout>0 && Date.parse(approved.expiresAt)>now()+timeout+CLEANUP_MS,'CAPTURE_DEADLINE_EXCEEDED');
    childAttempted=true;
    const result=await runtimeTools.runPrismaProcess(process.execPath,[runtimeTools.runtime.cli,'db','execute','--file',path.join(location.run,'transport.sql'),'--schema',path.join(location.run,'schema.prisma')],{cwd:location.run,env:childEnv,timeout,maxBuffer:65536});
    deadline();
    must(passedProcess(result),'PRISMA_TRANSPORT_FAILED');
    must(now()<Date.parse(approved.expiresAt),'APPROVAL_EXPIRED_DURING_RUN');
    must(frozen(packageRoot).sourceBindingSha256===binding.sourceBindingSha256 && sourceSnapshot(runnerRoot)===runnerSourceSha256,'SOURCE_CHANGED_DURING_RUN');
    transportAssertionsPassed=true;
    const observedAt=new Date(now()).toISOString();
    const evidence=resultEvidence({runId:args.runId,opsRevision,runnerSourceSha256,configSha256,toolchainCacheManifestSha256:approved.toolchainCacheManifestSha256,contractSha256:binding.contractSha256,controlledTlsProof:approved.controlledTlsProof,startedAt,observedAt});
    const proof=proofProjection(evidence);
    const summary=(dependencies.publicSummary??publicSummary)(evidence,proof,approved.projectionMode);
    safeSummary=summary;
    writePrivate(path.join(location.run,'evidence.json'),canonical(evidence)+'\n');
    writePrivate(path.join(location.run,'prisma-transport-proof.json'),canonical(proof)+'\n');
    proofCreated=true;
    (dependencies.publishCapture??publishCapture)(summary,runnerRoot);
    publicResultPrepared=true;
    writePrivate(path.join(location.run,'receipt.json'),canonical({...receipt,status:'PASSED',finishedAt:observedAt,credentialAccessed,childAttempted,processCleanupVerified:true,evidenceSha256:sha256(canonical(evidence)),proofSha256:sha256(canonical(proof))})+'\n');
    // Retain the capture lock even on success; F01 disposition owns any future capture.
    emit(summary);
    return summary;
  } catch(error) {
    location??=error?.reservation;
    const lockRetained=Boolean(location && fs.existsSync(location.lock));
    const code=failureCode(error);
    let privateResultQuarantined=false,publicSuccessRevoked=false,quarantineState='NOT_REQUIRED';
    if(location && safeSummary) {
      try { (dependencies.quarantinePrivateResult??quarantinePrivateResult)(location);privateResultQuarantined=true; } catch {}
      try { (dependencies.revokeCapturePublication??revokeCapturePublication)(safeSummary,runnerRoot);publicSuccessRevoked=true; } catch {}
      quarantineState=privateResultQuarantined&&publicSuccessRevoked?'COMPLETED':'FAILED_OR_UNKNOWN';
    }
    if(location) {
      try {writePrivate(path.join(location.run,'rejected.json'),canonical({schemaVersion:1,status:childAttempted?'FAILED_OR_UNKNOWN':'REJECTED',failureCode:code,credentialAccessed,childAttempted,finishedAt:new Date(now()).toISOString(),databaseMutation:false,applicationDeployment:false,proofCreated,transportAssertionsPassed,publicResultPrepared,privateResultQuarantined,publicSuccessRevoked,quarantineState,lockRetained,unknownRunPolicy:'STOP_AND_REVIEW_NO_AUTOMATIC_RETRY'})+'\n');}catch{}
      // Keep lock, UUID directory and original failure evidence; never auto-retry.
    }
    const summary={event:'RELEASE18_TRANSPORT_CAPTURE',status:childAttempted?'FAILED_OR_UNKNOWN':'REJECTED',failureCode:code,proofCreated,transportAssertionsPassed,publicResultPrepared,privateResultQuarantined,publicSuccessRevoked,quarantineState,lockRetained,databaseMutation:false,applicationDeployment:false};
    try { emit(summary); } catch {}
    return summary;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await runCapture();
  if(result.status!=='PASSED')process.exitCode=1;
}
