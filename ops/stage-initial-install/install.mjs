// Dedicated one-shot migration executor. Never import application code here.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMIT, PRISMA_VERSION, PROJECT, STAGE_CA_SHA256, childEnvironment, connectionContract, sha256 } from './contract.mjs';
import { executionContext, emitReceipt } from './execution-events.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const safeCodes = new Set(['UNEXPECTED_INHERITED_CONFIGURATION','STAGE_TARGET_NOT_ACKNOWLEDGED','STAGE_TRANSPORT_INVALID','ADMIN_PASSWORD_MISSING_OR_INVALID','CA_PATH_INVALID','CA_BINDING_INVALID','BUNDLE_INVALID','PRISMA_VERSION_MISMATCH','PREFLIGHT_FAILED','MIGRATE_DEPLOY_FAILED','POSTFLIGHT_FAILED','MODE_INVALID','ENV_FILE_FORBIDDEN','LOCAL_RECEIPT_EXISTS']);
function verify() {
  const binding = JSON.parse(readFileSync(resolve(here, 'source-binding.json'), 'utf8'));
  if (binding.sourceRevision !== COMMIT || binding.prismaVersion !== PRISMA_VERSION || binding.files.length !== 19 || binding.migrations.length !== 15) throw new Error('BUNDLE_INVALID');
  const allowed = new Set(['package.json','package-lock.json','prisma/schema.prisma','prisma/migrations/migration_lock.toml', ...binding.migrations.map(item => `prisma/migrations/${item.name}/migration.sql`)]);
  if (allowed.size !== 19 || new Set(binding.files.map(item => item.path)).size !== 19) throw new Error('BUNDLE_INVALID');
  for (const item of binding.files) {
    if (!allowed.has(item.path) || !/^(?:package(?:-lock)?\.json|prisma\/(?:schema\.prisma|migrations\/(?:migration_lock\.toml|\d{14}_[a-z_]+\/migration\.sql)))$/.test(item.path)) throw new Error('BUNDLE_INVALID');
    const bytes = readFileSync(resolve(here, item.path));
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error('BUNDLE_INVALID');
  }
  const actual = readdirSync(resolve(here, 'prisma/migrations')).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...binding.migrations.map(item => item.name),'migration_lock.toml'].sort())) throw new Error('BUNDLE_INVALID');
  for (const item of binding.migrations) {
    if (item.checksum !== binding.files.find(file => file.path === `prisma/migrations/${item.name}/migration.sql`)?.sha256) throw new Error('BUNDLE_INVALID');
  }
  for (const file of [resolve(here,'.env'),resolve(here,'prisma/.env'),resolve(here,'prisma.config.ts'),resolve(here,'prisma.config.js')]) if (existsSync(file)) throw new Error('ENV_FILE_FORBIDDEN');
  if (sha256(readFileSync(resolve(here,'supabase-root-2021.crt'))) !== STAGE_CA_SHA256) throw new Error('CA_BINDING_INVALID');
  return binding;
}

function postflightSql(binding) {
  const expected = JSON.stringify(binding.migrations).replaceAll("'", "''");
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s'; SET LOCAL search_path = pg_catalog;
DO $postflight$
DECLARE expected CONSTANT jsonb := '${expected}'::jsonb; item record; n bigint;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR session_user <> 'postgres' THEN RAISE EXCEPTION 'POSTFLIGHT_IDENTITY_FAILED'; END IF;
  IF to_regclass('public._prisma_migrations') IS NULL THEN RAISE EXCEPTION 'POSTFLIGHT_LEDGER_MISSING'; END IF;
  IF (SELECT count(*) FROM public._prisma_migrations) <> 15 OR EXISTS (
    SELECT 1 FROM public._prisma_migrations m FULL JOIN jsonb_to_recordset(expected) e(name text, checksum text)
    ON m.migration_name=e.name
    WHERE m.id IS NULL OR e.name IS NULL OR m.checksum <> e.checksum OR m.finished_at IS NULL OR m.rolled_back_at IS NOT NULL
  ) OR (SELECT count(DISTINCT migration_name) FROM public._prisma_migrations) <> 15 THEN RAISE EXCEPTION 'POSTFLIGHT_LEDGER_MISMATCH'; END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) <> 46 THEN RAISE EXCEPTION 'POSTFLIGHT_TABLE_COUNT_FAILED'; END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity) <> 10 THEN RAISE EXCEPTION 'POSTFLIGHT_RLS_COUNT_FAILED'; END IF;
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready))
    OR EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated) THEN RAISE EXCEPTION 'POSTFLIGHT_OBJECT_VALIDITY_FAILED'; END IF;
  FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations' LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', item.relname) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'POSTFLIGHT_UNEXPECTED_WRITES'; END IF;
  END LOOP;
END $postflight$;
ROLLBACK;`;
}

const mode = process.argv[2];
let receipt;
try {
  if (process.argv.length !== 3 || !['--verify','--preflight','--deploy'].includes(mode)) throw new Error('MODE_INVALID');
  const binding = verify();
  if (mode === '--verify') {
    console.log(`BUNDLE_VERIFIED files=19 migrations=15 source=${COMMIT}`);
  } else {
    const context = executionContext(process.env);
    const installed = JSON.parse(readFileSync(resolve(here, 'node_modules/prisma/package.json'), 'utf8'));
    if (installed.version !== PRISMA_VERSION) throw new Error('PRISMA_VERSION_MISMATCH');
    const connectionEnv = { ...process.env, STAGING_DB_CA_FILE: resolve(here,'supabase-root-2021.crt'), STAGING_DB_CA_SHA256: STAGE_CA_SHA256 };
    const conn = connectionContract(connectionEnv, readFileSync(connectionEnv.STAGING_DB_CA_FILE));
    const childEnv = childEnvironment(process.env, conn.url);
    const receiptPath = resolve(here, `execution-${mode.slice(2)}.json`);
    if (existsSync(receiptPath)) throw new Error('LOCAL_RECEIPT_EXISTS');
    receipt = { sourceRevision: COMMIT, project: PROJECT, transport: conn.transport, host: conn.host, prismaVersion: PRISMA_VERSION, sourceBindingSha256: sha256(readFileSync(resolve(here,'source-binding.json'))), mode, startedAt: new Date().toISOString(), steps: [], status: 'RUNNING' };
    // A receipt exists before any network action. Never overwrite it on retries.
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    const save = () => {
      writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
      emitReceipt(receipt, context);
    };
    save();
    const run = (name, args, timeout) => {
      const step = { name, startedAt: new Date().toISOString(), status: 'RUNNING' };
      receipt.steps.push(step); save();
      const result = spawnSync(process.execPath, [resolve(here,'node_modules/prisma/build/index.js'), ...args, '--schema', resolve(here,'prisma/schema.prisma')], { cwd: here, env: childEnv, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
      step.finishedAt = new Date().toISOString(); step.exitCode = result.status;
      step.status = result.status === 0 && !result.error ? 'PASSED' : 'FAILED';
      // Raw Prisma stdout/stderr/error objects may contain sensitive data. Never emit or persist them.
      save();
      if (step.status !== 'PASSED') throw new Error(`${name}_FAILED`);
    };
    try {
      run('PREFLIGHT', ['db','execute','--file',resolve(here,'preflight.sql')], 60000);
      if (mode === '--deploy') {
        run('MIGRATE_DEPLOY', ['migrate','deploy'], 360000);
        const postPath = resolve(here,'executed-postflight.sql');
        writeFileSync(postPath, postflightSql(binding), { flag: 'wx' });
        run('POSTFLIGHT', ['db','execute','--file',postPath], 60000);
      }
      receipt.status = 'PASSED';
    } catch (error) {
      receipt.status = 'FAILED_REVIEW_REQUIRED';
      receipt.failureCode = safeCodes.has(error.message) ? error.message : 'EXECUTION_FAILED';
      // Timeout/disconnect/partial migration is never an authorization for automatic retry or reset.
      throw error;
    } finally { receipt.finishedAt = new Date().toISOString(); save(); }
    console.log(`STAGE_INITIAL_INSTALL_${mode === '--deploy' ? 'MIGRATION_CHECKS' : 'PREFLIGHT'}_PASSED project=${PROJECT} source=${COMMIT}`);
  }
} catch (error) {
  console.error(safeCodes.has(error.message) ? error.message : 'INITIAL_INSTALL_PREPARATION_OR_EXECUTION_FAILED');
  process.exitCode = 1;
}
