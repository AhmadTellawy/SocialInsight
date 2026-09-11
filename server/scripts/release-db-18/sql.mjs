import { resolve } from 'node:path';
import { HASH, ROOT, must, readRegular } from './core.mjs';
import { profile } from './contract.mjs';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export const ident = value => { must(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value), 'SQL_IDENTIFIER_INVALID'); return `"${value}"`; };
export function expectedMigrations(binding, name, count = 18) {
  profile(name);
  return binding.migrations.slice(0, count).map((item, i) => ({ ...item, checksum: name === 'PROD_10' && i === 9 ? '6c523622f3a261b11eacdd71a541fca178f0f757c36852f32325d7f486363f21' : item.checksum }));
}
export function tableDigestSql(table, columns) {
  must(Array.isArray(columns) && columns.length > 0 && columns.length <= 200 && new Set(columns).size === columns.length, 'SNAPSHOT_COLUMNS_INVALID');
  const projection = `jsonb_build_array(${columns.map(ident).join(',')})::text`;
  return `SELECT count(*)::text AS count, encode(sha256(convert_to(COALESCE(string_agg(v, E'\\n' ORDER BY v COLLATE "C"), ''), 'UTF8')), 'hex') AS digest FROM (SELECT ${projection} AS v FROM public.${ident(table)}) s`;
}
export const ROLLBACK_DIGEST_SQL = `SELECT encode(sha256(convert_to(COALESCE(string_agg(jsonb_build_array(id,checksum,migration_name,started_at,finished_at,rolled_back_at,applied_steps_count)::text,E'\\n' ORDER BY id COLLATE "C"),''),'UTF8')),'hex') AS digest FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL`;
export function preservationSql(snapshot, { requireSnapshot = false } = {}) {
  if (!snapshot) { must(!requireSnapshot, 'BASELINE_SNAPSHOT_REQUIRED'); return ''; }
  must(Array.isArray(snapshot.tables) && snapshot.tables.length <= 100 && new Set(snapshot.tables.map(x => x.name)).size === snapshot.tables.length, 'SNAPSHOT_INVALID');
  return snapshot.tables.map(t => {
    must(/^(?:0|[1-9][0-9]{0,12})$/.test(t.count) && HASH.test(t.digest), 'SNAPSHOT_INVALID');
    return `IF NOT EXISTS (SELECT 1 FROM (${tableDigestSql(t.name, t.columns)}) s WHERE s.count=${quote(t.count)} AND s.digest=${quote(t.digest)}) THEN RAISE EXCEPTION 'BASELINE_DATA_CHANGED'; END IF;`;
  }).join('\n');
}
function connectionChecks(target, marker) {
  if (marker === undefined) must(target.local, 'RUN_TAG_REQUIRED');
  else must(/^si_release18_[a-f0-9-]{36}(?![\s\S])/.test(marker), 'APPLICATION_NAME_INVALID');
  return `IF current_database() <> ${quote(target.database)} OR current_user <> 'postgres' OR session_user <> 'postgres' THEN RAISE EXCEPTION 'TARGET_IDENTITY_MISMATCH'; END IF;
  IF current_setting('server_version_num')::int / 10000 <> 17 THEN RAISE EXCEPTION 'POSTGRES_VERSION_MISMATCH'; END IF;
  IF current_setting('transaction_read_only') <> 'on' OR current_setting('TimeZone') <> 'UTC' OR current_setting('lock_timeout')::interval <> interval '5 seconds' OR current_setting('statement_timeout')::interval <> interval '120 seconds' THEN RAISE EXCEPTION 'CONNECTION_SETTINGS_MISMATCH'; END IF;
  ${marker === undefined ? '' : `IF current_setting('application_name') <> ${quote(marker)} THEN RAISE EXCEPTION 'INVOCATION_TAG_MISMATCH'; END IF;`}
  ${target.local ? `IF inet_server_addr() <> '127.0.0.1'::inet OR inet_server_port() <> 55447 THEN RAISE EXCEPTION 'LOCAL_ENDPOINT_MISMATCH'; END IF;` : `IF NOT EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN RAISE EXCEPTION 'DATABASE_TLS_REQUIRED'; END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated')) <> 2 THEN RAISE EXCEPTION 'HOSTED_ROLES_MISSING'; END IF;`}`;
}
function ledgerChecks(binding, name, count, rollbackDigest) {
  const expected = JSON.stringify(expectedMigrations(binding, name, count));
  const rollbackAllowed = name === 'PROD_10';
  return `IF to_regclass('public._prisma_migrations') IS NULL THEN RAISE EXCEPTION 'LEDGER_MISSING'; END IF;
  IF (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> ${count}
    OR EXISTS (SELECT 1 FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(${quote(expected)}::jsonb) e(name text, checksum text) FULL JOIN (SELECT migration_name,checksum FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) m ON m.migration_name=e.name WHERE e.name IS NULL OR m.migration_name IS NULL OR m.checksum<>e.checksum)
    OR (SELECT count(DISTINCT migration_name) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> ${count}
    THEN RAISE EXCEPTION 'LEDGER_PREFIX_MISMATCH'; END IF;
  ${rollbackAllowed ? `IF (SELECT count(*) FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL) <> 1 OR EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL AND (migration_name <> '20260831020000_profile_links_dob_cover' OR checksum <> '649cfcf4061330ae5892e14d2061760d22cc04ffcb7ea73006572b21f82ead81')) THEN RAISE EXCEPTION 'HISTORICAL_ROLLBACK_MISMATCH'; END IF;` : `IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NOT NULL) THEN RAISE EXCEPTION 'UNEXPECTED_ROLLBACK_HISTORY'; END IF;`}
  ${rollbackDigest ? `IF (${ROLLBACK_DIGEST_SQL}) <> ${quote(rollbackDigest)} THEN RAISE EXCEPTION 'ROLLBACK_HISTORY_CHANGED'; END IF;` : ''}`;
}
function tableSetChecks(tables) {
  must(Array.isArray(tables) && tables.length > 0, 'TABLE_BINDING_INVALID');
  return `IF EXISTS (SELECT 1 FROM (SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) actual FULL JOIN unnest(ARRAY[${[...tables,'_prisma_migrations'].map(quote).join(',')}]) expected(name) ON actual.relname=expected.name WHERE actual.relname IS NULL OR expected.name IS NULL) THEN RAISE EXCEPTION 'TABLE_SET_MISMATCH'; END IF;`;
}
const validity = `IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready)) OR EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated) THEN RAISE EXCEPTION 'CATALOG_INVALID'; END IF;`;
export function preflightSql(binding, name, target, snapshot, marker) {
  const baseline = profile(name).baseline;
  if (snapshot) {
    must(HASH.test(snapshot.rollbackDigest ?? ''), 'ROLLBACK_SNAPSHOT_REQUIRED');
    must(JSON.stringify(snapshot.tables.map(x=>x.name).sort()) === JSON.stringify((binding.tables[String(baseline)] ?? []).slice().sort()), 'SNAPSHOT_TABLE_SET_INVALID');
  }
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
DO $release18$ BEGIN
${connectionChecks(target, marker)}
${baseline === 0 ? readRegular(resolve(ROOT, 'sql/preflight-stage-empty.sql')).toString() : `${ledgerChecks(binding,name,baseline,snapshot?.rollbackDigest)}
${tableSetChecks(binding.tables[String(baseline)])}
${validity}
${readRegular(resolve(ROOT, 'sql/preflight-common.sql')).toString()}
${readRegular(resolve(ROOT, name === 'PROD_10' ? 'sql/preflight-prod10.sql' : 'sql/preflight-stage15.sql')).toString()}
${preservationSql(snapshot, {requireSnapshot: !target.local})}`}
END $release18$;
ROLLBACK;`;
}
export function postflightSql(binding, name, target, snapshot, migrationStartedAt, marker) {
  if (snapshot) must(HASH.test(snapshot.rollbackDigest ?? ''), 'ROLLBACK_SNAPSHOT_REQUIRED');
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
DO $release18$ BEGIN
${connectionChecks(target, marker)}
${ledgerChecks(binding,name,18,snapshot?.rollbackDigest)}
${tableSetChecks(binding.tables['18'])}
${validity}
${readRegular(resolve(ROOT,'sql/postflight18.sql')).toString()}
${preservationSql(snapshot, {requireSnapshot: !target.local && name !== 'STAGE_EMPTY'})}
${name === 'STAGE_EMPTY' ? binding.tables['18'].map(table=>`IF EXISTS (SELECT 1 FROM public.${ident(table)}) THEN RAISE EXCEPTION 'UNEXPECTED_APPLICATION_WRITES'; END IF;`).join('\n') : ''}
${name === 'PROD_10' ? `IF EXISTS (SELECT 1 FROM public."MediaAsset" WHERE "uploadKey" IS NOT NULL AND ("storageCleanupNotBefore" IS NULL OR "storageCleanupNotBefore" < ${quote(migrationStartedAt)}::timestamptz + interval '2 hours')) THEN RAISE EXCEPTION 'MEDIA_CLEANUP_FENCE_MISSING'; END IF;
  IF EXISTS (SELECT 1 FROM public."Response" WHERE guest_proof_hash IS NOT NULL OR guest_proof_expires_at IS NOT NULL) OR EXISTS (SELECT 1 FROM public."PendingRegistration" WHERE "browserSecretHash" IS NOT NULL) OR EXISTS (SELECT 1 FROM public.oauth_accounts) THEN RAISE EXCEPTION 'INVENTED_HISTORICAL_CAPABILITY'; END IF;` : ''}
END $release18$;
ROLLBACK;`;
}
