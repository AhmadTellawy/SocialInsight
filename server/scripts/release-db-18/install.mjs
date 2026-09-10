import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { APPLICATION, PRISMA, ROOT, UUID, must, readRegular, realDirectory, sanitizedFailure, sha256, verifyBundle } from './core.mjs';
import { CA_SHA256, CLEANUP_RESERVE_MS, CLI_SHA256, LINUX_ENGINE_SHA256, LIMITS, RUN_BUDGET_MS, assertNoAmbientDotenv, childEnvironment, connectionUrl, profile, readHostedApproval, rejectInherited, targetFor } from './contract.mjs';
import { postflightSql, preflightSql } from './sql.mjs';
import { captureBaseline } from './capture.mjs';
import { runPrismaProcess } from './process-runner.mjs';
import { applicationName, settleInvocationBackends } from './backend-cleanup.mjs';

export function materialize(binding, name, directory, count = 18) {
  must(Number.isInteger(count) && count >= 1 && count <= 18, 'MATERIALIZE_COUNT_INVALID');
  for (const path of ['schema.prisma', 'migrations/migration_lock.toml', ...binding.migrations.slice(0,count).map(x=>`migrations/${x.name}/migration.sql`)]) {
    const destination = resolve(directory, 'prisma', path);
    mkdirSync(dirname(destination), { recursive:true, mode:0o700 });
    const source = name === 'PROD_10' && path === `migrations/${binding.migrations[9].name}/migration.sql` ? resolve(ROOT,'overlays/PROD_10/migration10.sql') : resolve(ROOT,'prisma',path);
    writeFileSync(destination, readRegular(source), { flag:'wx', mode:0o600 });
  }
}
export function verifyRuntime(runtimeRoot, local) {
  must(/^v24\./.test(process.version) && Number(process.versions.node.split('.')[1])>=13,'NODE_VERSION_MISMATCH');
  const cli = resolve(runtimeRoot,'node_modules/prisma/build/index.js');
  const version = JSON.parse(readRegular(resolve(runtimeRoot,'node_modules/prisma/package.json'))).version;
  must(version === PRISMA && sha256(readRegular(cli,32*1024*1024)) === CLI_SHA256, 'PRISMA_CLI_BINDING_INVALID');
  const engines = resolve(runtimeRoot,'node_modules/@prisma/engines');
  const native = readdirSync(engines).filter(name => local && process.platform==='win32' ? name==='schema-engine-windows.exe' : /^schema-engine-(?:debian|linux)-/.test(name));
  must(native.length===1, 'PRISMA_ENGINE_SELECTION_INVALID');
  const engineSha256=sha256(readRegular(resolve(engines,native[0]),256*1024*1024));
  if (!local) must(process.platform==='linux' && engineSha256===LINUX_ENGINE_SHA256,'PRISMA_ENGINE_BINDING_INVALID');
  return {cli,cliSha256:CLI_SHA256,engineSha256,prismaVersion:version,nodeVersion:process.version,nodePlatform:process.platform};
}
function evidenceRoot() {
  const path=resolve(ROOT,'evidence'); mkdirSync(path,{recursive:true,mode:0o700});
  must(realDirectory(path)===path,'EVIDENCE_DIRECTORY_INVALID');
  return path;
}
export function saveReceipt(path,receipt) {
  const tmp=`${path}.pending`;
  writeFileSync(tmp,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  renameSync(tmp,path);
}
export function projectedReceipt(r) {
  return {schemaVersion:1,runId:r.runId,profile:r.profile,project:r.project,host:r.host,database:r.database,command:r.command,application:r.application,sourceBindingSha256:r.sourceBindingSha256,startedAt:r.startedAt,finishedAt:r.finishedAt,status:r.status,failureCode:r.failureCode,applicationDeployment:false,localSyntheticOnly:r.localSyntheticOnly,lockScope:'PERSISTED_EXECUTION_DIRECTORY_ONLY',missingReceiptAfterInterruption:'UNKNOWN_REQUIRES_F01_DISPOSITION',externalFenceRequiredUntil:'VERIFIED_QUIESCENCE_AND_F01_DISPOSITION',steps:r.steps.map(s=>({name:s.name,status:s.status,startedAt:s.startedAt,finishedAt:s.finishedAt,exitCode:s.exitCode,timeoutMs:s.timeoutMs,executionTimeoutMs:s.executionTimeoutMs,cancellationReason:s.cancellationReason,processCleanup:s.processCleanup,backendCleanup:s.backendCleanup}))};
}
export async function runRelease(options) {
  const {command,name,runId,localName,transport='direct',approvalFile,env=process.env}=options;
  must(['preflight','deploy'].includes(command),'COMMAND_INVALID'); profile(name); must(UUID.test(runId ?? ''),'RUN_ID_INVALID');
  const binding=verifyBundle(); rejectInherited(env); assertNoAmbientDotenv(ROOT);
  const target=targetFor(name,transport,localName);
  // A separately installed approval digest is required before a password property is evaluated.
  const approval=target.local ? undefined : readHostedApproval({env,file:approvalFile,binding,target,command,runId,profile:name});
  const runtimeRoot=target.local && process.platform==='win32' ? resolve(ROOT,'../../../../account-settings/server') : ROOT;
  const runtime=verifyRuntime(runtimeRoot,target.local);
  const caPath=resolve(ROOT,'supabase-root-2021.crt');
  if (!target.local) must(sha256(readRegular(caPath))===CA_SHA256,'CA_BINDING_INVALID');
  const password=target.local ? 'settings-local-fixture' : env.RELEASE18_DB_ADMIN_PASSWORD;
  const marker=applicationName(runId);
  const url=new URL(connectionUrl(target,password,caPath));url.searchParams.set('application_name',marker);
  const childEnv=childEnvironment(env,url.href);
  const receiptBase=evidenceRoot(), directory=resolve(receiptBase,runId);
  must(!existsSync(directory),'RUN_ALREADY_EXISTS'); mkdirSync(directory,{mode:0o700});
  const receiptPath=resolve(directory,'receipt.json');
  const lockPath=resolve(receiptBase,`target-${sha256(`${target.host}:${target.port}/${target.database}`)}.lock`);
  const receipt={schemaVersion:1,runId,profile:name,project:target.project,host:target.host,database:target.database,command,application:APPLICATION,sourceBindingSha256:binding.bindingSha256,startedAt:new Date().toISOString(),status:'PREPARING',steps:[],applicationDeployment:false,localSyntheticOnly:target.local,lockScope:'PERSISTED_EXECUTION_DIRECTORY_ONLY',missingReceiptAfterInterruption:'UNKNOWN_REQUIRES_F01_DISPOSITION',externalFenceRequiredUntil:'VERIFIED_QUIESCENCE_AND_F01_DISPOSITION',cleanupReserveMs:CLEANUP_RESERVE_MS,applicationName:marker,runtime:{...runtime,cli:undefined},approvalConfigSha256:target.local?undefined:env.RELEASE18_APPROVED_CONFIG_SHA256};
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  let ownsLock=false, migrationStarted=false;
  const started=Date.now();
  const persist=()=>saveReceipt(receiptPath,receipt);
  try {
    must(!existsSync(lockPath),'UNRESOLVED_TARGET_RUN');
    if(command==='deploy') { writeFileSync(lockPath,JSON.stringify({runId,sourceBindingSha256:binding.bindingSha256,startedAt:receipt.startedAt})+'\n',{flag:'wx',mode:0o600}); ownsLock=true; }
    const snapshot=target.local && options.localSnapshot ? options.localSnapshot : await captureBaseline(binding,name,target,password);
    writeFileSync(resolve(directory,'baseline-snapshot.json'),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
    receipt.baselineSnapshotSha256=sha256(readRegular(resolve(directory,'baseline-snapshot.json')));
    receipt.metadataTransport=snapshot.transport;
    persist();
    materialize(binding,name,directory);
    assertNoAmbientDotenv(directory);
    writeFileSync(resolve(directory,'preflight.sql'),preflightSql(binding,name,target,snapshot),{flag:'wx',mode:0o600});
    const run=async(phase,args)=>{
      const timeout=Math.min(LIMITS[phase],RUN_BUDGET_MS-(Date.now()-started)-CLEANUP_RESERVE_MS);
      must(timeout>0,'RUN_DEADLINE_EXCEEDED');
      if(approval) must(Date.parse(approval.expiresAt)>Date.now()+timeout+CLEANUP_RESERVE_MS,'APPROVAL_EXPIRED_DURING_RUN');
      const step={name:phase,startedAt:new Date().toISOString(),status:'RUNNING',timeoutMs:timeout};
      receipt.steps.push(step); receipt.status='RUNNING'; persist();
      if(phase==='MIGRATE_DEPLOY') migrationStarted=true;
      const spawn=target.local && options.localSpawn ? options.localSpawn : runPrismaProcess;
      const result=await spawn(process.execPath,[runtime.cli,...args,'--schema',resolve(directory,'prisma/schema.prisma')],{cwd:directory,env:childEnv,timeout,maxBuffer:1024*1024});
      step.finishedAt=new Date().toISOString(); step.exitCode=Number.isInteger(result.status)?result.status:null;
      step.processCleanup=result.processCleanup;
      step.executionTimeoutMs=result.timeoutMs??timeout;
      step.cancellationReason=result.reason;
      const treeVerified=target.local&&options.localSpawn&&!result.processCleanup ? true : process.platform!=='linux'||result.processCleanup?.verified===true&&result.processCleanup?.quiescent===true;
      step.status=result.status===0 && !result.error && !result.signal && !result.reason && treeVerified?'PASSED':'FAILED';
      if(step.status!=='PASSED'){
        receipt.status=migrationStarted?'FAILED_OR_UNKNOWN':'PREFLIGHT_REJECTED';receipt.failureCode=`${phase}_FAILED`;persist();
        const settle=target.local&&options.localBackendCleanup?options.localBackendCleanup:settleInvocationBackends;
        step.backendCleanup=await settle(target,password,marker);
        step.finishedAt=new Date().toISOString();
      }
      persist();
      // Never inspect, emit or persist raw child output or Error objects: they may contain secrets.
      must(step.status==='PASSED',`${phase}_FAILED`);
    };
    await run('PREFLIGHT',['db','execute','--file',resolve(directory,'preflight.sql')]);
    if(command==='deploy') {
      const migrationStartedAt=snapshot.databaseObservedAt??new Date().toISOString();
      // Recheck every frozen byte immediately before the first write-capable subprocess.
      must(verifyBundle().bindingSha256===binding.bindingSha256,'SOURCE_CHANGED_DURING_RUN');
      await run('MIGRATE_DEPLOY',['migrate','deploy']);
      writeFileSync(resolve(directory,'postflight.sql'),postflightSql(binding,name,target,snapshot,migrationStartedAt),{flag:'wx',mode:0o600});
      await run('POSTFLIGHT',['db','execute','--file',resolve(directory,'postflight.sql')]);
    }
    receipt.status='PASSED';
  } catch(error) {
    receipt.status=migrationStarted?'FAILED_OR_UNKNOWN':'PREFLIGHT_REJECTED'; receipt.failureCode=sanitizedFailure(error);
  } finally {
    receipt.finishedAt=new Date().toISOString(); persist();
    // A write-capable failure retains the lock even when Prisma reports a definite error.
    if(ownsLock && (!migrationStarted || receipt.status==='PASSED')) unlinkSync(lockPath);
  }
  return projectedReceipt(receipt);
}
