// Pinned node-pg is used only for read-only metadata/digests. Prisma performs all migrations.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, must, readRegular, sha256 } from './core.mjs';
import { CONNECTION_OPTIONS, profile } from './contract.mjs';
import { ROLLBACK_DIGEST_SQL, tableDigestSql } from './sql.mjs';

export function pgModuleRoot(local) {
  return local && process.platform==='win32' ? resolve(ROOT,'../../../../../.ai-company/memory/tasks/SI-CREATE-TWO-STEPS-20260906/local-postgres/node_modules/pg') : resolve(ROOT,'node_modules/pg');
}
export async function pgClient(target,password) {
  const root=pgModuleRoot(target.local);
  must(JSON.parse(readRegular(resolve(root,'package.json'))).version==='8.23.0','PG_VERSION_MISMATCH');
  const {default:pg}=await import(pathToFileURL(resolve(root,'lib/index.js')));
  return new pg.Client({host:target.host,port:target.port,database:target.database,user:target.user,password,
    connectionTimeoutMillis:10000,query_timeout:60000,options:CONNECTION_OPTIONS,
    ssl:target.local?false:{ca:readRegular(resolve(ROOT,'supabase-root-2021.crt')).toString(),servername:target.host,rejectUnauthorized:true,minVersion:'TLSv1.2'}});
}
export async function captureBaseline(binding,name,target,password) {
  const client=await pgClient(target,password), tables=[];
  let connected=false, timedOut=false;
  client.on('error',()=>{}); // Query/connect promises carry errors; never emit driver diagnostics.
  const timer=setTimeout(()=>{timedOut=true;client.connection.stream.destroy();},60000);
  try {
    await client.connect(); connected=true;
    if(!target.local) must(client.connection.stream.encrypted===true && client.connection.stream.authorized===true,'PG_CLIENT_TLS_REQUIRED');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {rows:[identity]}=await client.query("SELECT current_database() AS database,current_user AS role,current_setting('transaction_read_only') AS read_only,current_setting('TimeZone') AS timezone,current_setting('lock_timeout')::interval=interval '5 seconds' AS bounded_lock,current_setting('statement_timeout')::interval=interval '120 seconds' AS bounded_statement,host(inet_server_addr()) AS address,inet_server_port() AS port,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS database_tls,clock_timestamp() AS database_now");
    must(identity.database===target.database && identity.role==='postgres' && identity.read_only==='on' && identity.timezone==='UTC' && identity.bounded_lock && identity.bounded_statement,'PG_CONNECTION_SETTINGS_MISMATCH');
    must(target.local ? identity.address==='127.0.0.1' && identity.port===55447 : identity.database_tls===true,'PG_DATABASE_TLS_OR_TARGET_INVALID');
    const expected=binding.tables[String(profile(name).baseline)];
    for(const table of expected) {
      const {rows}=await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[table]);
      const columns=rows.map(x=>x.column_name);
      const {rows:[digest]}=await client.query(tableDigestSql(table,columns));
      tables.push({name:table,columns,...digest});
    }
    let rollbackDigest=sha256('');
    if(profile(name).baseline>0) rollbackDigest=(await client.query(ROLLBACK_DIGEST_SQL)).rows[0].digest;
    await client.query('ROLLBACK');
    return {observedAt:new Date().toISOString(),databaseObservedAt:identity.database_now.toISOString(),tables,rollbackDigest,transport:{client:'pg',version:'8.23.0',localSyntheticOnly:target.local,clientTls:target.local?false:true,databaseTls:identity.database_tls,timezone:identity.timezone,lockTimeoutMs:5000,statementTimeoutMs:120000}};
  } catch(error) { must(!timedOut,'BASELINE_CAPTURE_TIMEOUT'); throw error; }
  finally {clearTimeout(timer);if(connected && !timedOut) await client.end();else if(!timedOut)client.end().catch(()=>{});}
}
