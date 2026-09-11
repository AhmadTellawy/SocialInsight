// Only used by the Linux interruption proof, exclusively on a fresh synthetic database.
import { must, UUID, sanitizedFailure } from '../core.mjs';
import { childEnvironment, localDatabase, targetFor } from '../contract.mjs';
import { pgClient } from '../capture.mjs';
import { runRelease } from '../install.mjs';
import { runPrismaProcess } from '../process-runner.mjs';

let locker;
try {
  must(process.platform==='linux'&&process.argv.length===5,'LINUX_INTERRUPTION_ARGUMENT_INVALID');
  const [mode,database,runId]=process.argv.slice(2);must(['timeout','signal'].includes(mode)&&UUID.test(runId),'INTERRUPTION_MODE_INVALID');localDatabase(database);
  const env=childEnvironment(process.env,'synthetic');delete env.DATABASE_URL;delete env.DIRECT_URL;
  locker=await pgClient(targetFor('STAGE_15','direct',database),'settings-local-fixture');await locker.connect();
  const identity=(await locker.query("SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port")).rows[0];
  must(identity.database===database&&identity.role==='postgres'&&identity.host==='127.0.0.1'&&identity.port===55447,'SYNTHETIC_LOCK_TARGET_INVALID');
  const result=await runRelease({command:'deploy',name:'STAGE_15',runId,localName:database,env,localSpawn:async(command,args,options)=>{
    if(args.includes('deploy')){
      // The ordinary immutable migration16 now reaches a real relation-lock wait after preflight passed.
      await locker.query('BEGIN');await locker.query('LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE');
      return runPrismaProcess(command,args,{...options,timeout:mode==='timeout'?4000:options.timeout,onSpawn:pid=>process.send?.({event:'MIGRATION_STARTED',cliPid:pid})});
    }
    return runPrismaProcess(command,args,options);
  }});
  process.send?.({event:'RESULT',result});
  process.exitCode=result.status==='FAILED_OR_UNKNOWN'?0:1;
}catch(error){process.send?.({event:'FAILED',failureCode:sanitizedFailure(error)});process.exitCode=1;}
finally{if(locker){await locker.query('ROLLBACK').catch(()=>{});await locker.end().catch(()=>{});}if(process.connected)process.disconnect();}
