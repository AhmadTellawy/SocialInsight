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

-- A disposable, deterministic key exists only inside this verification
-- transaction. Production provisioning writes a distinct secret through the
-- migration/admin connection; the runtime role has no grant on this table.
INSERT INTO public.socialinsight_page_context_keys (kid, secret, active)
VALUES ('sql-test', decode('8c91d7b457c01fa2e8890b3c8f28d15a1f448d3a09aa9a86d3e352aac872f0c1', 'hex'), true)
ON CONFLICT (kid) DO UPDATE SET secret = EXCLUDED.secret, active = true, rotated_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION pg_temp.pages_rls_set_context(
  actor text DEFAULT '0', staff boolean DEFAULT false, system_actor boolean DEFAULT false, test_user boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql AS $function$
DECLARE
  issued bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  payload text;
  nonce text := md5(actor || ':' || pg_backend_pid()::text || ':' || txid_current()::text || ':' || issued::text);
BEGIN
  payload := pg_catalog.concat_ws('.', 'v1', 'sql-test', actor,
    CASE WHEN staff THEN '1' ELSE '0' END, CASE WHEN system_actor THEN '1' ELSE '0' END,
    CASE WHEN test_user THEN '1' ELSE '0' END, issued::text, (issued + 30)::text,
    pg_backend_pid()::text, txid_current()::text, nonce);
  PERFORM pg_catalog.set_config('socialinsight.page_context', payload || '.' ||
    pg_catalog.encode(public.hmac(pg_catalog.convert_to(payload, 'UTF8'),
      decode('8c91d7b457c01fa2e8890b3c8f28d15a1f448d3a09aa9a86d3e352aac872f0c1', 'hex'), 'sha256'), 'hex'), true);
END
$function$;

-- The request context is transaction-local. It must disappear at COMMIT and
-- must never leak through a pooled connection to the next request.
BEGIN;
SET LOCAL ROLE socialinsight_runtime;
SELECT pg_temp.pages_rls_set_context('00000000-0000-4000-8000-00000000a103', false, false, true);
DO $context_present$
BEGIN
  IF public.socialinsight_context_user_id() <> '00000000-0000-4000-8000-00000000a103'
    OR NOT public.socialinsight_context_is_test_user() THEN
    RAISE EXCEPTION 'transaction-local context was not set';
  END IF;
END
$context_present$;
COMMIT;

DO $context_cleared$
BEGIN
  IF nullif(pg_catalog.current_setting('socialinsight.page_context', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'transaction-local context leaked after commit';
  END IF;
END
$context_cleared$;

BEGIN;

INSERT INTO public.users (id, name, handle, updated_at) VALUES
  ('00000000-0000-4000-8000-00000000a101', 'RLS owner', 'rls_owner_a101', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-00000000a102', 'RLS editor', 'rls_editor_a102', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-00000000a103', 'RLS stranger', 'rls_stranger_a103', CURRENT_TIMESTAMP);
UPDATE public.users SET email_verified_at = CURRENT_TIMESTAMP
WHERE id IN ('00000000-0000-4000-8000-00000000a101', '00000000-0000-4000-8000-00000000a102');

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

INSERT INTO public."PageInvitation" (
  id, "pageId", "senderId", "recipientId", role, status, "expiresAt"
) VALUES (
  '00000000-0000-4000-8000-00000000d101', '00000000-0000-4000-8000-00000000b102',
  '00000000-0000-4000-8000-00000000a101', '00000000-0000-4000-8000-00000000a102',
  'EDITOR', 'PENDING', CURRENT_TIMESTAMP + INTERVAL '1 day'
);
INSERT INTO public."PageInvitation" (
  id, "pageId", "senderId", "recipientId", role, status, "expiresAt"
) VALUES (
  '00000000-0000-4000-8000-00000000d103', '00000000-0000-4000-8000-00000000b102',
  '00000000-0000-4000-8000-00000000a101', '00000000-0000-4000-8000-00000000a103',
  'ANALYST', 'PENDING', CURRENT_TIMESTAMP + INTERVAL '1 day'
);

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
SELECT pg_temp.pages_rls_set_context('00000000-0000-4000-8000-00000000a103');
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

-- Legacy GUCs and forged context are attacker-controlled input, not authority.
SELECT pg_catalog.set_config('socialinsight.page_system', 'true', true);
SELECT pg_catalog.set_config('socialinsight.user_id', '00000000-0000-4000-8000-00000000a101', true);
SELECT pg_catalog.set_config('socialinsight.page_context',
  'v1.sql-test.0.0.1.0.1.9999999999.1.1.deadbeefdeadbeefdeadbeefdeadbeef.0000000000000000000000000000000000000000000000000000000000000000', true);
DO $forgery_checks$
DECLARE blocked boolean := false;
BEGIN
  IF public.socialinsight_context_is_system() OR public.socialinsight_context_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'forged context became authority';
  END IF;
  BEGIN
    PERFORM secret FROM public.socialinsight_page_context_keys WHERE kid = 'sql-test';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'runtime role read signing key'; END IF;
END
$forgery_checks$;
SELECT pg_temp.pages_rls_set_context('00000000-0000-4000-8000-00000000a103');
DO $membership_escalation_checks$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public."PageMembership" ("pageId", "userId", role, "updatedAt") VALUES
      ('00000000-0000-4000-8000-00000000b102', '00000000-0000-4000-8000-00000000a103', 'OWNER', CURRENT_TIMESTAMP);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'self-membership without matching invitation succeeded'; END IF;
END
$membership_escalation_checks$;

SELECT * FROM public.socialinsight_accept_page_invitation('00000000-0000-4000-8000-00000000d103');
DO $invitation_rpc_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."PageMembership" WHERE "pageId" = '00000000-0000-4000-8000-00000000b102'
      AND "userId" = '00000000-0000-4000-8000-00000000a103' AND role = 'ANALYST')
    OR NOT EXISTS (SELECT 1 FROM public."PageInvitation" WHERE id = '00000000-0000-4000-8000-00000000d103'
      AND status = 'ACCEPTED' AND "decidedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'invitation acceptance RPC was not atomic';
  END IF;
END
$invitation_rpc_checks$;

-- Synthetic fixtures are visible only when the trusted transaction marks the
-- authenticated account as an approved test user.
SELECT pg_temp.pages_rls_set_context('00000000-0000-4000-8000-00000000a103', false, false, true);
DO $test_fixture_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."Page" WHERE id = '00000000-0000-4000-8000-00000000b103') THEN
    RAISE EXCEPTION 'approved test-user context could not see test fixture';
  END IF;
END
$test_fixture_checks$;
-- Owner and admin contexts are positive paths.
SELECT pg_temp.pages_rls_set_context('00000000-0000-4000-8000-00000000a101');
DO $owner_checks$
DECLARE
  affected integer;
  inserted_id text;
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

  -- INSERT ... RETURNING must evaluate the owner's direct SELECT predicate;
  -- the new row cannot yet be discovered through PageMembership.
  INSERT INTO public."Page" (
    id, "ownerId", handle, name, category, bio, "representationAt", "createRequestId", "updatedAt"
  ) VALUES (
    '00000000-0000-4000-8000-00000000b104', '00000000-0000-4000-8000-00000000a101',
    'rls_returning_b104', 'RLS returning', 'other', '', CURRENT_TIMESTAMP,
    '00000000-0000-4000-8000-00000000c104', CURRENT_TIMESTAMP
  ) RETURNING id INTO inserted_id;
  IF inserted_id <> '00000000-0000-4000-8000-00000000b104' THEN
    RAISE EXCEPTION 'signed owner INSERT RETURNING failed';
  END IF;
END
$owner_checks$;

-- A signed, non-owner context still cannot discover or mutate that Page.
SELECT pg_temp.pages_rls_set_context('00000000-0000-4000-8000-00000000a103');
DO $returning_stranger_checks$
DECLARE
  affected integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public."Page" WHERE id = '00000000-0000-4000-8000-00000000b104') THEN
    RAISE EXCEPTION 'non-owner saw signed owner returned Page';
  END IF;
  UPDATE public."Page" SET bio = 'forbidden returning update'
    WHERE id = '00000000-0000-4000-8000-00000000b104';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'non-owner updated signed owner returned Page'; END IF;
END
$returning_stranger_checks$;

SELECT pg_temp.pages_rls_set_context('00000000-0000-4000-8000-00000000a102');
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

  blocked := false;
  BEGIN
    UPDATE public."PageInvitation" SET role = 'ADMIN'
      WHERE id = '00000000-0000-4000-8000-00000000d101';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'recipient changed immutable invitation role'; END IF;

  blocked := false;
  BEGIN
    UPDATE public."PageInvitation" SET "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '10 days'
      WHERE id = '00000000-0000-4000-8000-00000000d101';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'recipient changed immutable invitation expiry'; END IF;

  blocked := false;
  BEGIN
    UPDATE public."PageInvitation" SET "pageId" = '00000000-0000-4000-8000-00000000b101'
      WHERE id = '00000000-0000-4000-8000-00000000d101';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'recipient changed immutable invitation page'; END IF;

  blocked := false;
  BEGIN
    UPDATE public."PageOwnershipTransfer" SET "senderId" = '00000000-0000-4000-8000-00000000a103'
      WHERE id = '00000000-0000-4000-8000-00000000d102';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'recipient changed immutable transfer sender'; END IF;

  blocked := false;
  BEGIN
    UPDATE public."PageOwnershipTransfer" SET status = 'WITHDRAWN', "decidedAt" = CURRENT_TIMESTAMP
      WHERE id = '00000000-0000-4000-8000-00000000d102';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'recipient withdrew ownership transfer'; END IF;

  blocked := false;
  BEGIN
    UPDATE public."PageOwnershipTransfer" SET "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '10 days'
      WHERE id = '00000000-0000-4000-8000-00000000d102';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'recipient changed immutable transfer expiry'; END IF;

  blocked := false;
  BEGIN
    UPDATE public."Page" SET "ownerId" = '00000000-0000-4000-8000-00000000a102'
      WHERE id = '00000000-0000-4000-8000-00000000b102';
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'direct transfer ownership acceptance succeeded'; END IF;

  blocked := false;
  BEGIN
    INSERT INTO public."PageMembership" ("pageId", "userId", role, "updatedAt") VALUES
      ('00000000-0000-4000-8000-00000000b102', '00000000-0000-4000-8000-00000000a103', 'EDITOR', CURRENT_TIMESTAMP);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'admin direct membership insert succeeded'; END IF;
END
$admin_checks$;

-- Only the security-definer RPC can consume the protected transaction
-- admission and perform the ownership transition atomically.
SELECT * FROM public.socialinsight_accept_page_transfer('00000000-0000-4000-8000-00000000d102');

-- Worker context can access durable purge state; ordinary users cannot.
SELECT pg_temp.pages_rls_set_context('0', false, true, false);
INSERT INTO public."PagePurgeJob" ("pageId", "updatedAt")
VALUES ('00000000-0000-4000-8000-00000000b102', CURRENT_TIMESTAMP);
SELECT pg_temp.pages_rls_set_context('00000000-0000-4000-8000-00000000a103');
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
