// Dedicated localhost rehearsal; never reads .env, accepts provider URLs or rewrites a migration ledger.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, must, readRegular, sanitizedFailure, sha256, verifyBundle } from '../core.mjs';
import { childEnvironment, connectionUrl, localDatabase, profile, targetFor } from '../contract.mjs';
import { materialize, runRelease, verifyRuntime } from '../install.mjs';
import { pgClient } from '../capture.mjs';
import { expectedMigrations, ident, preflightSql } from '../sql.mjs';
import { applicationName } from '../backend-cleanup.mjs';

const stamp=randomUUID().replaceAll('-','').slice(0,16),directory=resolve(ROOT,`evidence/rehearsal-${stamp}`);
mkdirSync(directory,{recursive:true,mode:0o700});
const binding=verifyBundle();
const receipt={schemaVersion:1,status:'RUNNING',startedAt:new Date().toISOString(),sourceBindingSha256:binding.bindingSha256,providerConnections:0,realCredentialsRead:false,databases:[],checks:[],runs:[]};
const save=()=>writeFileSync(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
const pass=(name,detail={})=>{receipt.checks.push({name,status:'PASSED',...detail});save();console.log(JSON.stringify({check:name,status:'PASSED'}));};
const clean=childEnvironment(process.env,'synthetic');delete clean.DATABASE_URL;delete clean.DIRECT_URL;
let admin;
async function connect(name) { localDatabase(name);const c=await pgClient(targetFor('STAGE_EMPTY','direct',name),'settings-local-fixture');await c.connect();return c; }
async function newDb(suffix) {
  const name=localDatabase(`si_release18_${stamp}_${suffix}`);
  // Only a newly generated namespace is ever created. Existing databases are neither dropped nor changed.
  await admin.query(`CREATE DATABASE ${ident(name)}`);receipt.databases.push(name);save();return name;
}
function prismaBaseline(name,db,count) {
  const dir=resolve(directory,`baseline-${name}-${db}`);mkdirSync(dir,{mode:0o700});materialize(binding,name,dir,count);
  const root=process.platform==='linux'?ROOT:resolve(ROOT,'../../../../account-settings/server');
  const runtime=verifyRuntime(root,true),target=targetFor(name,'direct',db),url=connectionUrl(target,'settings-local-fixture');
  const result=spawnSync(process.execPath,[runtime.cli,'migrate','deploy','--schema',resolve(dir,'prisma/schema.prisma')],{cwd:dir,env:childEnvironment(clean,url),timeout:180000,maxBuffer:1024*1024,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  must(result.status===0 && !result.error && !result.signal,'SYNTHETIC_BASELINE_INSTALL_FAILED');
}
async function assertFinal(db,name) {
  const c=await connect(db);
  try {
    const rows=(await c.query('SELECT migration_name AS name,checksum FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
    assert.deepEqual(rows,expectedMigrations(binding,name));
    if(name==='PROD_10') assert.equal((await c.query('SELECT count(*)::int n FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL')).rows[0].n,1);
    if(name!=='STAGE_EMPTY') { assert.deepEqual((await c.query('SELECT count(*)::int n,count(*) FILTER(WHERE user_id IS NULL)::int tombstones FROM public.handle_aliases')).rows[0],{n:3,tombstones:1}); }
  } finally {await c.end();}
}
try {
  must(process.argv.length===2,'ARGUMENT_INVALID');
  // The administrative connection is fixed to this local instance and is used only for CREATE DATABASE.
  admin=await pgClient({...targetFor('STAGE_EMPTY','direct','si_release18_admin'),database:'postgres'},'settings-local-fixture');await admin.connect();
  const identity=(await admin.query("SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_user AS role,current_setting('server_version_num')::int/10000 AS major")).rows[0];
  assert.deepEqual(identity,{host:'127.0.0.1',port:55447,role:'postgres',major:17});
  for(const name of ['STAGE_EMPTY','STAGE_15','PROD_10']) {
    const db=await newDb(name.toLowerCase()),baseline=profile(name).baseline;
    if(baseline) {
      prismaBaseline(name,db,baseline);
      const c=await connect(db);
      try {
        await c.query(readRegular(resolve(ROOT,'tests/fixture.sql')).toString());
        if(name==='PROD_10') await c.query("INSERT INTO public._prisma_migrations(id,checksum,migration_name,started_at,rolled_back_at,applied_steps_count) VALUES($1,$2,$3,now()-interval '2 days',now()-interval '2 days'+interval '1 minute',0)",[randomUUID(),binding.migrations[8].checksum,binding.migrations[8].name]);
      } finally {await c.end();}
    }
    const result=await runRelease({command:'deploy',name,runId:randomUUID(),localName:db,env:clean});receipt.runs.push(result);save();
    assert.equal(result.status,'PASSED',`EXECUTOR_${name}_${result.failureCode??'FAILED'}`);await assertFinal(db,name);
    pass(`${name}_to_18_actual_executor`,{database:db,prismaPreflight:true,prismaMigrateDeploy:true,prismaPostflight:true,originalDataDigestsPreserved:baseline>0});
  }
  const bad=await newDb('collision');prismaBaseline('PROD_10',bad,10);const badClient=await connect(bad);
  try {
    await badClient.query(readRegular(resolve(ROOT,'tests/fixture.sql')).toString());
    await badClient.query("INSERT INTO public._prisma_migrations(id,checksum,migration_name,started_at,rolled_back_at,applied_steps_count) VALUES($1,$2,$3,now()-interval '2 days',now()-interval '2 days'+interval '1 minute',0)",[randomUUID(),binding.migrations[8].checksum,binding.migrations[8].name]);
    await badClient.query("UPDATE public.users SET email='owner@fixture.invalid' WHERE id='fixture_u2'");
  } finally {await badClient.end();}
  const rejected=await runRelease({command:'deploy',name:'PROD_10',runId:randomUUID(),localName:bad,env:clean});receipt.runs.push(rejected);assert.equal(rejected.status,'PREFLIGHT_REJECTED');assert.equal(rejected.steps.length,1);assert.equal(rejected.steps[0].name,'PREFLIGHT');
  const retained=await connect(bad);try{assert.equal((await retained.query('SELECT count(*)::int n FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].n,10);assert.equal((await retained.query("SELECT to_regclass('public.auth_sessions') AS relation")).rows[0].relation,null);}finally{await retained.end();}
  pass('collision_rejected_before_migration_11_without_repair',{database:bad});
  const settingsDb=receipt.databases[0],settings=await connect(settingsDb);
  try {
    const r=(await settings.query("SELECT current_setting('TimeZone') timezone,current_setting('lock_timeout') AS lock,current_setting('statement_timeout') AS statement")).rows[0];
    assert.deepEqual(r,{timezone:'UTC',lock:'5s',statement:'2min'});
    // Test the real Prisma session with deliberately missing startup options; the DO assertion must reject.
    const dir=resolve(directory,'missing-options');mkdirSync(dir);materialize(binding,'STAGE_EMPTY',dir);
    writeFileSync(resolve(dir,'guard.sql'),preflightSql(binding,'STAGE_EMPTY',targetFor('STAGE_EMPTY','direct',settingsDb)));
    const url=new URL(connectionUrl(targetFor('STAGE_EMPTY','direct',settingsDb),'settings-local-fixture'));url.searchParams.set('options','-c timezone=America/New_York -c lock_timeout=0 -c statement_timeout=0');
    const runtime=verifyRuntime(process.platform==='linux'?ROOT:resolve(ROOT,'../../../../account-settings/server'),true);
    const result=spawnSync(process.execPath,[runtime.cli,'db','execute','--file',resolve(dir,'guard.sql'),'--schema',resolve(dir,'prisma/schema.prisma')],{cwd:dir,env:childEnvironment(clean,url.href),encoding:'utf8',windowsHide:true,timeout:60000,stdio:['ignore','pipe','pipe']});
    assert.equal(result.status,1);assert.match(result.stderr,/CONNECTION_SETTINGS_MISMATCH/);pass('actual_Prisma_connection_without_UTC_and_bounds_is_rejected');
    // A transport that drops the UUID tag must fail before any migration is attempted.
    const marker=applicationName(randomUUID());
    writeFileSync(resolve(dir,'tag-guard.sql'),preflightSql(binding,'STAGE_EMPTY',targetFor('STAGE_EMPTY','direct',settingsDb),undefined,marker));
    const tagResult=spawnSync(process.execPath,[runtime.cli,'db','execute','--file',resolve(dir,'tag-guard.sql'),'--schema',resolve(dir,'prisma/schema.prisma')],{cwd:dir,env:childEnvironment(clean,connectionUrl(targetFor('STAGE_EMPTY','direct',settingsDb),'settings-local-fixture')),encoding:'utf8',windowsHide:true,timeout:60000,stdio:['ignore','pipe','pipe']});
    assert.equal(tagResult.status,1);assert.match(tagResult.stderr,/INVOCATION_TAG_MISMATCH/);pass('actual_Prisma_connection_without_run_tag_is_rejected');
  } finally {await settings.end();}
  assert.equal(verifyBundle().bindingSha256,binding.bindingSha256);pass('source_binding_unchanged_through_rehearsal');
  receipt.status='PASSED';
} catch(error) {receipt.status='FAILED';receipt.failureCode=sanitizedFailure(error);process.exitCode=1;console.error(JSON.stringify({status:'FAILED',failureCode:receipt.failureCode}));}
finally {if(admin)await admin.end();receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:receipt.status,checks:receipt.checks.length,receipt:resolve(directory,'receipt.json'),providerConnections:0}));}
