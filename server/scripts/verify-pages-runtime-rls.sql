-- Destructive-safe direct PostgreSQL verification for the Pages runtime role.
-- Run only against a disposable database whose name starts pages_rls_test_:
--   psql "$PAGES_RLS_TEST_DATABASE_URL" -X -f server/scripts/verify-pages-runtime-rls.sql
--
-- The database must already contain all migrations preceding
-- 20261002090000_pages_runtime_rls. This script applies the target migration
-- twice (upgrade + retry), creates fixtures inside a rolled-back transaction,
-- and never provisions a LOGIN or records a password.

\set ON_ERROR_STOP on

SELECT (current_database() ~ '^pages_rls_test_')::int AS safe_test_database
\gset
\if :safe_test_database
\else
  \echo 'Refusing to run: database name must start with pages_rls_test_'
  \quit 9
\endif

-- Applying the same SQL twice proves that interrupted operator retry does not
-- duplicate policies or broaden the role. Prisma still records it once.
\ir ../prisma/migrations/20261002090000_pages_runtime_rls/migration.sql
\ir ../prisma/migrations/20261002090000_pages_runtime_rls/migration.sql

DO $role_properties$
DECLARE
  runtime pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO STRICT runtime FROM pg_catalog.pg_roles WHERE rolname = 'socialinsight_runtime';
  IF runtime.rolcanlogin OR runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole
    OR runtime.rolinherit OR runtime.rolreplication OR runtime.rolbypassrls THEN
    RAISE EXCEPTION 'runtime role property failure';
  END IF;
  IF pg_catalog.has_schema_privilege('socialinsight_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'runtime role has public schema CREATE';
  END IF;
  IF pg_catalog.has_table_privilege('socialinsight_runtime', 'public._prisma_migrations',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'runtime role can mutate Prisma migration history';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class object
    JOIN pg_catalog.pg_roles owner ON owner.oid = object.relowner
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
    WHERE namespace.nspname = 'public' AND owner.rolname = 'socialinsight_runtime'
  ) THEN
    RAISE EXCEPTION 'runtime role owns a public object';
  END IF;
END
$role_properties$;

DO $rls_catalog$
DECLARE
  page_tables text[] := ARRAY[
    'Page', 'PageMembership', 'PageHandle', 'PageInvitation',
    'PageOwnershipTransfer', 'PageFollow', 'PageBlock', 'PageAuditEvent',
    'PageCase', 'PageEvent', 'PagePurgeJob'
  ];
  backend_tables text[] := ARRAY[
    'auth_sessions', 'oauth_accounts', 'oauth_states', 'otp_challenges',
    'auth_rate_limits', 'OTPCode', 'PendingRegistration', 'handle_aliases',
    'security_email_outbox', 'deletion_decisions', 'user_mfa',
    'auth_challenges', 'account_cleanup_jobs'
  ];
  table_name text;
  enabled boolean;
  forced boolean;
BEGIN
  FOREACH table_name IN ARRAY page_tables || backend_tables LOOP
    SELECT class.relrowsecurity, class.relforcerowsecurity
      INTO STRICT enabled, forced
    FROM pg_catalog.pg_class class
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public' AND class.relname = table_name;
    IF NOT enabled OR NOT forced THEN
      RAISE EXCEPTION 'RLS not enabled and forced for %', table_name;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(page_tables)
        AND 'socialinsight_runtime' = ANY(roles)) <> 41 THEN
    RAISE EXCEPTION 'unexpected Pages policy count';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(backend_tables)
        AND policyname = 'socialinsight_runtime_backend_all'
        AND 'socialinsight_runtime' = ANY(roles)) <> 13 THEN
    RAISE EXCEPTION 'unexpected backend-only policy count';
  END IF;
END
$rls_catalog$;

-- The request context is transaction-local. It must disappear at COMMIT and
-- must never leak through a pooled connection to the next request.
BEGIN;
SET LOCAL ROLE socialinsight_runtime;
SELECT pg_catalog.set_config('socialinsight.user_id', 'rls-context-sentinel', true);
SELECT pg_catalog.set_config('socialinsight.page_staff', 'false', true);
SELECT pg_catalog.set_config('socialinsight.page_system', 'false', true);
SELECT pg_catalog.set_config('socialinsight.page_test_user', 'true', true);
DO $context_present$
BEGIN
  IF public.socialinsight_context_user_id() <> 'rls-context-sentinel'
    OR NOT public.socialinsight_context_is_test_user() THEN
    RAISE EXCEPTION 'transaction-local context was not set';
  END IF;
END
$context_present$;
COMMIT;

DO $context_cleared$
BEGIN
  IF nullif(pg_catalog.current_setting('socialinsight.user_id', true), '') IS NOT NULL
    OR nullif(pg_catalog.current_setting('socialinsight.page_test_user', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'transaction-local context leaked after commit';
  END IF;
END
$context_cleared$;

BEGIN;

INSERT INTO public.users (id, name, handle, updated_at) VALUES
  ('00000000-0000-4000-8000-00000000a101', 'RLS owner', 'rls_owner_a101', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-00000000a102', 'RLS editor', 'rls_editor_a102', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-00000000a103', 'RLS stranger', 'rls_stranger_a103', CURRENT_TIMESTAMP);

INSERT INTO public."Page" (
  id, "ownerId", handle, name, category, bio, "publicationState",
  "platformState", "representationAt", "createRequestId", "isTestFixture", "updatedAt"
) VALUES
  ('00000000-0000-4000-8000-00000000b101', '00000000-0000-4000-8000-00000000a101',
   'rls_public_b101', 'RLS public', 'other', '', 'PUBLISHED', 'NONE', CURRENT_TIMESTAMP,
   '00000000-0000-4000-8000-00000000c101', false, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-00000000b102', '00000000-0000-4000-8000-00000000a101',
   'rls_draft_b102', 'RLS draft', 'other', '', 'DRAFT', 'NONE', CURRENT_TIMESTAMP,
   '00000000-0000-4000-8000-00000000c102', false, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-00000000b103', '00000000-0000-4000-8000-00000000a101',
   'rls_test_b103', 'RLS test fixture', 'other', '', 'PUBLISHED', 'NONE', CURRENT_TIMESTAMP,
   '00000000-0000-4000-8000-00000000c103', true, CURRENT_TIMESTAMP);

INSERT INTO public."PageMembership" ("pageId", "userId", role, "updatedAt") VALUES
  ('00000000-0000-4000-8000-00000000b102', '00000000-0000-4000-8000-00000000a102',
   'ADMIN', CURRENT_TIMESTAMP);

INSERT INTO public."PageOwnershipTransfer" (
  id, "pageId", "senderId", "recipientId", status, "expiresAt"
) VALUES (
  '00000000-0000-4000-8000-00000000d102', '00000000-0000-4000-8000-00000000b102',
  '00000000-0000-4000-8000-00000000a101', '00000000-0000-4000-8000-00000000a102',
  'PENDING', CURRENT_TIMESTAMP + INTERVAL '1 day'
);

INSERT INTO public."PageFollow" ("pageId", "userId") VALUES
  ('00000000-0000-4000-8000-00000000b101', '00000000-0000-4000-8000-00000000a101'),
  ('00000000-0000-4000-8000-00000000b101', '00000000-0000-4000-8000-00000000a102');

INSERT INTO public."PageBlock" ("pageId", "userId", direction) VALUES
  ('00000000-0000-4000-8000-00000000b101', '00000000-0000-4000-8000-00000000a103',
   'USER_TO_PAGE');

SET LOCAL ROLE socialinsight_runtime;

-- No context: only the public Page is visible; writes and permanent DDL fail.
DO $anonymous_checks$
DECLARE
  visible_count integer;
  blocked boolean := false;
BEGIN
  SELECT count(*) INTO visible_count FROM public."Page"
  WHERE id IN ('00000000-0000-4000-8000-00000000b101', '00000000-0000-4000-8000-00000000b102',
    '00000000-0000-4000-8000-00000000b103');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'anonymous Page visibility failure'; END IF;

  IF EXISTS (SELECT 1 FROM public."PageFollow"
      WHERE "pageId" = '00000000-0000-4000-8000-00000000b101') THEN
    RAISE EXCEPTION 'public Page exposed follower identities';
  END IF;
  IF public.socialinsight_page_follower_count('00000000-0000-4000-8000-00000000b101') <> 2 THEN
    RAISE EXCEPTION 'public Page follower count helper failed';
  END IF;

  BEGIN
    INSERT INTO public."Page" (
      id, "ownerId", handle, name, category, bio, "representationAt", "createRequestId", "updatedAt"
    ) VALUES (
      '00000000-0000-4000-8000-00000000b199', '00000000-0000-4000-8000-00000000a103',
      'rls_denied_b199', 'Denied', 'other', '', CURRENT_TIMESTAMP,
      '00000000-0000-4000-8000-00000000c199', CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'anonymous insert unexpectedly succeeded'; END IF;

  blocked := false;
  BEGIN
    EXECUTE 'CREATE TABLE public.pages_rls_forbidden_ddl (id integer)';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'runtime permanent DDL unexpectedly succeeded'; END IF;
END
$anonymous_checks$;

-- Backend authentication access works before auth context exists.
SELECT count(*) FROM public.auth_sessions;

-- A stranger cannot see or mutate a draft Page.
SELECT pg_catalog.set_config('socialinsight.user_id', '00000000-0000-4000-8000-00000000a103', true);
DO $stranger_checks$
DECLARE
  affected integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public."Page" WHERE id = '00000000-0000-4000-8000-00000000b102') THEN
    RAISE EXCEPTION 'stranger saw draft Page';
  END IF;
  IF EXISTS (SELECT 1 FROM public."Page" WHERE id = '00000000-0000-4000-8000-00000000b101') THEN
    RAISE EXCEPTION 'blocked viewer saw public Page';
  END IF;
  IF public.socialinsight_page_follower_count('00000000-0000-4000-8000-00000000b101') <> 0 THEN
    RAISE EXCEPTION 'blocked viewer obtained follower count';
  END IF;
  UPDATE public."Page" SET bio = 'forbidden'
    WHERE id = '00000000-0000-4000-8000-00000000b102';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'stranger changed draft Page'; END IF;
END
$stranger_checks$;

-- Synthetic fixtures are visible only when the trusted transaction marks the
-- authenticated account as an approved test user.
SELECT pg_catalog.set_config('socialinsight.user_id', '', true);
SELECT pg_catalog.set_config('socialinsight.page_test_user', 'true', true);
DO $test_fixture_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."Page" WHERE id = '00000000-0000-4000-8000-00000000b103') THEN
    RAISE EXCEPTION 'approved test-user context could not see test fixture';
  END IF;
END
$test_fixture_checks$;
SELECT pg_catalog.set_config('socialinsight.page_test_user', 'false', true);

-- Owner and admin contexts are positive paths.
SELECT pg_catalog.set_config('socialinsight.user_id', '00000000-0000-4000-8000-00000000a101', true);
DO $owner_checks$
DECLARE
  affected integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."Page" WHERE id = '00000000-0000-4000-8000-00000000b102') THEN
    RAISE EXCEPTION 'owner could not see draft Page';
  END IF;
  IF (SELECT count(*) FROM public."PageFollow"
      WHERE "pageId" = '00000000-0000-4000-8000-00000000b101') <> 2 THEN
    RAISE EXCEPTION 'Page owner could not inspect follower identities';
  END IF;
  UPDATE public."Page" SET bio = 'owner update'
    WHERE id = '00000000-0000-4000-8000-00000000b102';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'owner update failed'; END IF;
END
$owner_checks$;

SELECT pg_catalog.set_config('socialinsight.user_id', '00000000-0000-4000-8000-00000000a102', true);
DO $admin_checks$
DECLARE
  affected integer;
  blocked boolean := false;
BEGIN
  IF public.socialinsight_page_actor_role('00000000-0000-4000-8000-00000000b102') <> 'ADMIN' THEN
    RAISE EXCEPTION 'admin role resolution failed';
  END IF;
  UPDATE public."Page" SET bio = 'admin update'
    WHERE id = '00000000-0000-4000-8000-00000000b102';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'admin update failed'; END IF;

  BEGIN
    UPDATE public."Page" SET "ownerId" = '00000000-0000-4000-8000-00000000a103'
      WHERE id = '00000000-0000-4000-8000-00000000b102';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'admin arbitrary ownership change unexpectedly succeeded'; END IF;

  blocked := false;
  BEGIN
    UPDATE public."Page" SET "publicationState" = 'PUBLISHED'
      WHERE id = '00000000-0000-4000-8000-00000000b102';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'admin lifecycle change unexpectedly succeeded'; END IF;
END
$admin_checks$;

-- Acceptance removes the recipient membership before atomically changing the
-- owner. The pending-transfer helper keeps that exact write possible while the
-- sensitive-field trigger rejects an arbitrary owner change.
DELETE FROM public."PageMembership"
WHERE "pageId" = '00000000-0000-4000-8000-00000000b102'
  AND "userId" = '00000000-0000-4000-8000-00000000a102';
UPDATE public."Page" SET "ownerId" = '00000000-0000-4000-8000-00000000a102'
WHERE id = '00000000-0000-4000-8000-00000000b102';

-- Worker context can access durable purge state; ordinary users cannot.
SELECT pg_catalog.set_config('socialinsight.user_id', '', true);
SELECT pg_catalog.set_config('socialinsight.page_system', 'true', true);
INSERT INTO public."PagePurgeJob" ("pageId", "updatedAt")
VALUES ('00000000-0000-4000-8000-00000000b102', CURRENT_TIMESTAMP);
SELECT pg_catalog.set_config('socialinsight.page_system', 'false', true);
DO $worker_checks$
BEGIN
  IF EXISTS (SELECT 1 FROM public."PagePurgeJob"
    WHERE "pageId" = '00000000-0000-4000-8000-00000000b102') THEN
    RAISE EXCEPTION 'purge job visible without system context';
  END IF;
END
$worker_checks$;

RESET ROLE;
ROLLBACK;

\echo 'PASS: Pages runtime role, forced RLS, context isolation, backend bootstrap, and positive/negative SQL checks'
