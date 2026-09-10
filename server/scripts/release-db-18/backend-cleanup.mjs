import { must } from './core.mjs';
import { pgClient } from './capture.mjs';

export const BACKEND_CLEANUP_MS=8000;
const READ_ONLY_GRACE_MS=1500;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function applicationName(runId) {
  must(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/.test(runId),'RUN_ID_INVALID');
  return `si_release18_${runId}`;
}

// This is limited to a captured PID/start identity for this exact database/principal/run marker.
// It never terminates a backend, changes data, broad-cancels activity or asserts DDL rollback.
export async function settleInvocationBackends(target,password,marker) {
  must(/^si_release18_[a-f0-9-]{36}(?![\s\S])/.test(marker),'APPLICATION_NAME_INVALID');
  const started=Date.now();
  const result={status:'UNVERIFIED',applicationName:marker,budgetMs:BACKEND_CLEANUP_MS,observedBackends:[],remainingBackends:[],cancelAttempts:[],queryEndConfirmed:false,rollbackConfirmed:false,elapsedMs:0};
  let client,expired=false,connected=false;
  const timer=setTimeout(()=>{expired=true;client?.connection?.stream?.destroy();},BACKEND_CLEANUP_MS);
  try {
    client=await pgClient(target,password);client.on('error',()=>{});await client.connect();connected=true;
    if(!target.local)must(client.connection.stream.encrypted===true&&client.connection.stream.authorized===true,'CLEANUP_CLIENT_TLS_REQUIRED');
    await client.query('BEGIN READ ONLY');
    const identity=(await client.query("SELECT current_database() AS database,current_user AS role,session_user AS session_role,host(inet_server_addr()) AS address,inet_server_port() AS port,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS database_tls")).rows[0];
    await client.query('ROLLBACK');
    must(identity.database===target.database&&identity.role==='postgres'&&identity.session_role==='postgres','CLEANUP_IDENTITY_MISMATCH');
    must(target.local?identity.address==='127.0.0.1'&&identity.port===55447:identity.database_tls===true,'CLEANUP_TARGET_OR_TLS_MISMATCH');
    const observe=async()=>{
      await client.query('BEGIN READ ONLY');
      const rows=(await client.query("SELECT pid,backend_start::text AS backend_start,state FROM pg_stat_activity WHERE datname=$1 AND usename='postgres' AND application_name=$2 AND backend_type='client backend' AND pid<>pg_backend_pid() ORDER BY pid",[target.database,marker])).rows;
      await client.query('ROLLBACK');return rows;
    };
    const initial=await observe();result.observedBackends=initial;
    let remaining=initial;
    while(remaining.length&&Date.now()-started<READ_ONLY_GRACE_MS&&!expired){await delay(100);remaining=await observe();}
    if(remaining.length&&!expired){
      // New or reused identities after capture are ambiguous. Do not cancel them.
      const matches=remaining.every(row=>initial.some(old=>old.pid===row.pid&&old.backend_start===row.backend_start));
      must(matches,'CLEANUP_BACKEND_IDENTITY_CHANGED');
      for(const row of remaining){
        must(Date.now()-started<BACKEND_CLEANUP_MS,'CLEANUP_DEADLINE');
        const cancelled=(await client.query("SELECT pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND datname=$3 AND usename='postgres' AND application_name=$4 AND backend_type='client backend' AND pid<>pg_backend_pid()",[row.pid,row.backend_start,target.database,marker])).rows;
        result.cancelAttempts.push({pid:row.pid,backend_start:row.backend_start,identityMatched:cancelled.length===1,cancelAccepted:cancelled.length===1&&cancelled[0].cancelled===true});
      }
      while(remaining.length&&!expired&&Date.now()-started<BACKEND_CLEANUP_MS){await delay(100);remaining=await observe();}
    }
    result.remainingBackends=remaining;
    result.queryEndConfirmed=remaining.length===0;
    result.status=result.queryEndConfirmed?'QUIESCENT':'NOT_QUIESCENT';
  }catch{result.status='UNVERIFIED';result.failureCode=expired?'CLEANUP_DEADLINE':'CLEANUP_NOT_VERIFIED';}
  finally{clearTimeout(timer);if(client){client.connection.stream.destroy();}result.elapsedMs=Date.now()-started;result.observedAt=new Date().toISOString();}
  return result;
}
