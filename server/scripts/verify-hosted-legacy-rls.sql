-- Regression: hosted legacy RLS must allow only the trusted backend group.
-- Never run this fixture script against shared/Production databases.
\set ON_ERROR_STOP on
SELECT (current_database() ~ '^pages_rls_test_' AND inet_server_addr() <<= '127.0.0.0/8'::inet)::int AS safe_test_database
\gset
\if :safe_test_database
\else
  \echo 'Refusing: disposable loopback pages_rls_test_ database required'
  \quit 9
\endif

BEGIN;
CREATE ROLE pages_legacy_client_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO pages_legacy_client_probe;
GRANT SELECT ON public.users TO pages_legacy_client_probe;
INSERT INTO public.users (id,name,handle,updated_at)
VALUES ('00000000-0000-4000-8000-000000008901','Hosted RLS test','rls_cp89_local_only',CURRENT_TIMESTAMP);

SET LOCAL ROLE socialinsight_runtime;
DO $backend$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id='00000000-0000-4000-8000-000000008901') THEN
    RAISE EXCEPTION 'BACKEND_LEGACY_READ_DENIED';
  END IF;
  UPDATE public.users SET bio='local regression' WHERE id='00000000-0000-4000-8000-000000008901';
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id='00000000-0000-4000-8000-000000008901' AND bio='local regression') THEN
    RAISE EXCEPTION 'BACKEND_LEGACY_WRITE_DENIED';
  END IF;
  IF pg_catalog.has_schema_privilege(current_user,'public','CREATE')
    OR pg_catalog.has_table_privilege(current_user,'public._prisma_migrations','SELECT')
    OR pg_catalog.has_table_privilege(current_user,'public.socialinsight_page_context_keys','SELECT') THEN
    RAISE EXCEPTION 'BACKEND_EXCESSIVE_PRIVILEGE';
  END IF;
END
$backend$;
RESET ROLE;
SET LOCAL ROLE pages_legacy_client_probe;
DO $client$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id='00000000-0000-4000-8000-000000008901') THEN
    RAISE EXCEPTION 'CLIENT_LEGACY_DATA_EXPOSED';
  END IF;
END
$client$;
RESET ROLE;

DO $catalog$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public'
    AND policyname='socialinsight_runtime_legacy_all'
    AND roles=ARRAY['socialinsight_runtime']::name[]) <> 35 THEN
    RAISE EXCEPTION 'HOSTED_LEGACY_POLICY_SCOPE_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public'
    AND policyname='socialinsight_runtime_legacy_all'
    AND (tablename LIKE 'Page%' OR tablename IN ('_prisma_migrations',
      'socialinsight_page_context_keys','socialinsight_page_transition_admissions'))) THEN
    RAISE EXCEPTION 'PROTECTED_TABLE_POLICY_WIDENED';
  END IF;
END
$catalog$;
ROLLBACK;
\echo 'PASS: hosted legacy backend read/write, public-client denial, role boundaries and finite policy scope'
