IF to_regnamespace('public') IS NULL OR NOT has_schema_privilege(current_user,'public','CREATE') THEN RAISE EXCEPTION 'PUBLIC_SCHEMA_AUTHORITY_MISSING'; END IF;
IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
 OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')
 OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
 OR EXISTS (SELECT 1 FROM pg_class WHERE relname='_prisma_migrations')
THEN RAISE EXCEPTION 'STAGE_NOT_EMPTY'; END IF;
