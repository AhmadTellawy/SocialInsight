// Actual pinned CLI + native schema engine + PostgreSQL, never a process or database mock.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { ROOT, must, readRegular, sanitizedFailure, sha256, verifyBundle } from '../core.mjs';
import { CLI_SHA256, LINUX_ENGINE_SHA256, childEnvironment, connectionUrl, localDatabase, targetFor } from '../contract.mjs';
import { pgClient } from '../capture.mjs';
import { materialize, runRelease, verifyRuntime } from '../install.mjs';
import { PROCESS_CLEANUP_MS, processGroupMembers, runPrismaProcess } from '../process-runner.mjs';
import { BACKEND_CLEANUP_MS, applicationName } from '../backend-cleanup.mjs';
import { ident } from '../sql.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stamp=randomUUID().replaceAll('-','').slice(0,16),directory=resolve(ROOT,`evidence/interruption-${stamp}`);
mkdirSync(directory,{recursive:true,mode:0o700});
const receipt={schemaVersion:1,status:'RUNNING',startedAt:new Date().toISOString(),providerConnections:0,realCredentialsRead:false,cases:[],databases:[],assertions:0};
const save=()=>writeFileSync(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
const check=(condition,label)=>{receipt.assertions++;assert.ok(condition,label);};
const env=childEnvironment(process.env,'synthetic');delete env.DATABASE_URL;delete env.DIRECT_URL;
let admin,observer,activeWorker,control;
const observedGroups=new Set();
try {
  must(process.platform==='linux'&&process.argv.length===2,'LINUX_INTERRUPTION_REQUIRED');
  const binding=verifyBundle(),runtime=verifyRuntime(ROOT,false);receipt.sourceBindingSha256=binding.bindingSha256;receipt.runtime={...runtime,cli:undefined};
  check(runtime.cliSha256===CLI_SHA256&&runtime.engineSha256===LINUX_ENGINE_SHA256,'exact_pinned_runtime');
  admin=await pgClient({...targetFor('STAGE_EMPTY','direct','si_release18_admin'),database:'postgres'},'settings-local-fixture');await admin.connect();
  const adminIdentity=(await admin.query("SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_user AS role,current_setting('server_version_num')::int/10000 AS major")).rows[0];
  check(adminIdentity.host==='127.0.0.1'&&adminIdentity.port===55447&&adminIdentity.role==='postgres'&&adminIdentity.major===17,'fixed_synthetic_database_instance');
  for(const mode of ['timeout','signal']){
    const database=localDatabase(`si_release18_${stamp}_${mode}`),runId=randomUUID(),marker=applicationName(runId);
    await admin.query(`CREATE DATABASE ${ident(database)}`);receipt.databases.push(database);save();
    const baseline=resolve(directory,`baseline-${mode}`);mkdirSync(baseline);materialize(binding,'STAGE_15',baseline,15);
    const target=targetFor('STAGE_15','direct',database);
    const setup=await runPrismaProcess(process.execPath,[runtime.cli,'migrate','deploy','--schema',resolve(baseline,'prisma/schema.prisma')],{cwd:baseline,env:childEnvironment(env,connectionUrl(target,'settings-local-fixture')),timeout:180000,maxBuffer:1048576});
    check(setup.status===0&&!setup.reason&&setup.processCleanup.quiescent,'real_stage15_baseline');
    observer=await pgClient(target,'settings-local-fixture');await observer.connect();await observer.query(readRegular(resolve(ROOT,'tests/fixture.sql')).toString());
    let cliPid,result,messageFailure,workerExit=false,workerExitCode,signalSentAt;
    const child=spawn(process.execPath,[resolve(ROOT,'tests/interruption-worker.mjs'),mode,database,runId],{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});activeWorker=child;
    child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
    child.on('error',()=>{messageFailure='WORKER_SPAWN_FAILED';});
    child.on('message',message=>{if(message.event==='MIGRATION_STARTED'){cliPid=message.cliPid;observedGroups.add(cliPid);}else if(message.event==='RESULT')result=message.result;else if(message.event==='FAILED')messageFailure=message.failureCode;});
    child.once('exit',code=>{workerExit=true;workerExitCode=code;});
    const phaseWait=Date.now();while(!cliPid&&!messageFailure&&!workerExit&&Date.now()-phaseWait<30000)await delay(50);
    check(Number.isInteger(cliPid)&&cliPid>1,'actual_cli_spawned_after_preflight');
    // Another active connection in the same database/principal must remain untouched by scoped cancellation.
    control=await pgClient(target,'settings-local-fixture');await control.connect();
    const controlMarker=applicationName(randomUUID());await control.query("SELECT set_config('application_name',$1,false)",[controlMarker]);
    const controlIdentity=(await control.query("SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS backend_start")).rows[0];
    let controlFinished=false,controlFailed=false;
    const controlQuery=control.query('SELECT pg_sleep(20)').then(()=>{controlFinished=true;}).catch(()=>{controlFailed=true;controlFinished=true;});
    let backend;
    const waitStarted=Date.now();
    while(!backend&&!workerExit&&Date.now()-waitStarted<3800){
      backend=(await observer.query("SELECT pid,backend_start::text AS backend_start,application_name,state,wait_event_type,query LIKE '%Handle case collisions require reviewed repair%' AS migration16 FROM pg_stat_activity WHERE datname=$1 AND usename='postgres' AND application_name=$2 AND backend_type='client backend' AND state='active' AND wait_event_type='Lock'",[database,marker])).rows.find(row=>row.migration16);
      if(!backend)await delay(50);
    }
    check(Boolean(backend),'real_immutable_migration16_in_flight_before_interruption');
    check(backend.application_name===marker,'application_name_reached_actual_schema_engine_connection');
    const members=processGroupMembers(cliPid);
    const engineMember=members.find(member=>{try{return basename(readlinkSync(`/proc/${member.pid}/exe`)).startsWith('schema-engine-');}catch{return false;}});
    check(Boolean(engineMember)&&members.some(member=>member.pid===cliPid),'cli_and_engine_share_owned_process_group');
    check(sha256(readFileSync(`/proc/${engineMember.pid}/exe`))===LINUX_ENGINE_SHA256,'running_descendant_has_pinned_engine_bytes');
    const interruptionStartedAt=Date.now();
    if(mode==='signal'){signalSentAt=new Date().toISOString();child.kill('SIGTERM');}
    while(!workerExit&&Date.now()-interruptionStartedAt<PROCESS_CLEANUP_MS+BACKEND_CLEANUP_MS+7000)await delay(50);
    check(workerExit&&workerExitCode===0&&Boolean(result),'worker_completed_bounded_cleanup_and_receipt');activeWorker=undefined;
    const phase=result.steps.find(step=>step.name==='MIGRATE_DEPLOY');
    check(result.status==='FAILED_OR_UNKNOWN'&&result.failureCode==='MIGRATE_DEPLOY_FAILED','unknown_outcome_retained');
    check(phase.cancellationReason===(mode==='timeout'?'TIMEOUT':'PARENT_SIGTERM'),'real_requested_interruption_path_executed');
    check(phase.processCleanup.verified===true&&phase.processCleanup.quiescent===true&&phase.processCleanup.remainingLivePids.length===0,'whole_group_no_live_descendants');
    check(phase.processCleanup.elapsedMs<=PROCESS_CLEANUP_MS+1000,'process_cleanup_bound');
    check(phase.backendCleanup.status==='QUIESCENT'&&phase.backendCleanup.queryEndConfirmed===true,'database_backend_quiescence_verified');
    check(phase.backendCleanup.elapsedMs<=BACKEND_CLEANUP_MS+1000,'backend_cleanup_bound');
    check(phase.backendCleanup.rollbackConfirmed===false,'no_ddl_rollback_claim');
    const remaining=(await observer.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND application_name=$2",[database,marker])).rows[0].n;
    check(remaining===0,'independent_observer_confirms_backend_connections_gone');
    const controlState=(await observer.query("SELECT state FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND application_name=$3",[controlIdentity.pid,controlIdentity.backend_start,controlMarker])).rows[0];
    check(!controlFinished&&controlState?.state==='active','other_invocation_query_not_cancelled');
    check(processGroupMembers(cliPid).filter(p=>!['Z','X'].includes(p.state)).length===0,'independent_observer_confirms_no_live_processes');
    const lock=resolve(ROOT,`evidence/target-${sha256(`127.0.0.1:55447/${database}`)}.lock`);
    check(existsSync(lock)&&JSON.parse(readRegular(lock)).runId===runId,'durable_unknown_lock_retained');
    const onDisk=JSON.parse(readRegular(resolve(ROOT,`evidence/${runId}/receipt.json`)));
    check(onDisk.status==='FAILED_OR_UNKNOWN','durable_unknown_receipt');
    const retry=await runRelease({command:'deploy',name:'STAGE_15',runId:randomUUID(),localName:database,env});
    check(retry.failureCode==='UNRESOLVED_TARGET_RUN'&&retry.steps.length===0,'new_uuid_retry_rejected_before_database_operation');
    await controlQuery;check(!controlFailed,'other_invocation_query_completed_normally');await control.end();control=undefined;
    receipt.cases.push({name:mode,status:'PASSED',database,runId,cliPid,enginePid:engineMember.pid,observedBackend:{pid:backend.pid,backend_start:backend.backend_start,application_name:backend.application_name},signalSentAt,processCleanup:phase.processCleanup,backendCleanup:phase.backendCleanup,otherInvocationUnaffected:true,result});save();
    await observer.end();observer=undefined;
    console.log(JSON.stringify({case:mode,status:'PASSED',processCleanupMs:phase.processCleanup.elapsedMs,backendCleanupMs:phase.backendCleanup.elapsedMs,cancelAttempts:phase.backendCleanup.cancelAttempts.length}));
  }
  check(verifyBundle().bindingSha256===receipt.sourceBindingSha256,'final_binding_unchanged');receipt.status='PASSED';
}catch(error){receipt.status='FAILED';receipt.failureCode=sanitizedFailure(error);process.exitCode=1;}
finally{
  if(activeWorker){activeWorker.kill('SIGTERM');await delay(PROCESS_CLEANUP_MS+BACKEND_CLEANUP_MS+500);if(activeWorker.exitCode===null&&activeWorker.signalCode===null)activeWorker.kill('SIGKILL');}
  if(receipt.status!=='PASSED')for(const groupId of observedGroups){try{if(processGroupMembers(groupId).some(p=>!['Z','X'].includes(p.state))){process.kill(-groupId,'SIGKILL');(receipt.emergencyFixtureCleanup??=[]).push({groupId,signal:'SIGKILL'});}}catch{receipt.emergencyFixtureCleanupUnverified=true;}}
  if(control)await control.end().catch(()=>{});
  if(observer)await observer.end().catch(()=>{});if(admin)await admin.end().catch(()=>{});
  receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,assertions:receipt.assertions,result:resolve(directory,'receipt.json'),failureCode:receipt.failureCode,providerConnections:0}));
}
