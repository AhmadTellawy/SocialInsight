-- Initial application installation only. No application data or credentials are read.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog;
DO $preflight$
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version_num')::int / 10000 <> 17
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR NOT EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'STAGE_INITIAL_INSTALL_IDENTITY_FAILED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')
     OR NOT has_schema_privilege(current_user, 'public', 'USAGE')
     OR NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'STAGE_INITIAL_INSTALL_SCHEMA_AUTHORITY_FAILED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '_prisma_migrations')
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') THEN
    RAISE EXCEPTION 'STAGE_INITIAL_INSTALL_NOT_EMPTY';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated')) <> 2 THEN
    RAISE EXCEPTION 'STAGE_INITIAL_INSTALL_PROVIDER_ROLES_MISSING';
  END IF;
END $preflight$;
ROLLBACK;
