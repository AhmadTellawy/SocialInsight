-- Runtime/database duty separation for Pages.
--
-- The migration/admin principal deliberately retains ownership. Application
-- connections inherit this NOLOGIN role and therefore cannot bypass RLS or
-- perform DDL. The SECURITY DEFINER helpers are owned by the migration role;
-- the preflight below requires that role to have BYPASSRLS because every Page
-- table is forced through RLS and recursive policy lookups must remain finite.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'PAGES_RLS_MIGRATOR_MUST_HAVE_BYPASSRLS';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'socialinsight_runtime') THEN
    CREATE ROLE socialinsight_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE socialinsight_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$migration$;

REVOKE ALL ON SCHEMA public FROM socialinsight_runtime;
GRANT USAGE ON SCHEMA public TO socialinsight_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO socialinsight_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO socialinsight_runtime;
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM socialinsight_runtime;

-- Keep later additive migrations usable by the runtime role without granting
-- object creation, ownership, TRIGGER, TRUNCATE, REFERENCES, or function-wide
-- EXECUTE privileges.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO socialinsight_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO socialinsight_runtime;

DO $database_grant$
BEGIN
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO socialinsight_runtime', current_database());
END
$database_grant$;

-- A backend connection can always SET arbitrary custom GUCs.  Never use a
-- bare GUC as authority: the only trusted context is an HMAC token verified
-- with a key that the runtime role cannot read or alter.  Tokens are bound to
-- both the backend PID and current transaction ID, so a captured token cannot
-- be replayed through another pooled transaction or connection.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.socialinsight_page_context_keys (
  kid text PRIMARY KEY,
  secret bytea NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at timestamptz
);
REVOKE ALL ON TABLE public.socialinsight_page_context_keys FROM PUBLIC;
REVOKE ALL ON TABLE public.socialinsight_page_context_keys FROM socialinsight_runtime;

CREATE TABLE IF NOT EXISTS public.socialinsight_page_transition_admissions (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  page_id text NOT NULL,
  actor_id text NOT NULL,
  transition_kind text NOT NULL CHECK (transition_kind IN ('INVITATION_ACCEPT', 'TRANSFER_ACCEPT')),
  PRIMARY KEY (backend_pid, transaction_id, page_id, transition_kind)
);
REVOKE ALL ON TABLE public.socialinsight_page_transition_admissions FROM PUBLIC;
REVOKE ALL ON TABLE public.socialinsight_page_transition_admissions FROM socialinsight_runtime;

-- The original membership invariant used the caller search_path. RPCs below
-- deliberately use a locked path, so harden the trigger function and qualify
-- its lookup before invoking it from a SECURITY DEFINER transition.
CREATE OR REPLACE FUNCTION public.pages_enforce_membership_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public."Page" WHERE id = NEW."pageId" AND "ownerId" = NEW."userId") THEN
    RAISE EXCEPTION 'PAGE_OWNER_IS_NOT_MEMBERSHIP' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_context_claim()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
  token text := nullif(pg_catalog.current_setting('socialinsight.page_context', true), '');
  fields text[];
  signing_key bytea;
  now_epoch bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  issued_epoch bigint;
  expires_epoch bigint;
  expected_mac text;
BEGIN
  IF token IS NULL THEN RETURN NULL; END IF;
  fields := pg_catalog.string_to_array(token, '.');
  -- v1.kid.actor-or-0.staff.system.test.iat.exp.pid.txid.nonce.mac
  IF pg_catalog.array_length(fields, 1) <> 12 OR fields[1] <> 'v1'
    OR fields[2] !~ '^[A-Za-z0-9_-]{1,64}$'
    OR fields[3] !~ '^(0|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
    OR fields[4] !~ '^[01]$' OR fields[5] !~ '^[01]$' OR fields[6] !~ '^[01]$'
    OR fields[7] !~ '^[0-9]{1,16}$' OR fields[8] !~ '^[0-9]{1,16}$'
    OR fields[9] !~ '^[0-9]{1,16}$' OR fields[10] !~ '^[0-9]{1,20}$'
    OR fields[11] !~ '^[0-9a-f]{32,128}$' OR fields[12] !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  IF ((fields[4] = '1' OR fields[6] = '1') AND fields[3] = '0')
    OR (fields[5] = '1' AND (fields[3] <> '0' OR fields[4] <> '0' OR fields[6] <> '0')) THEN
    RETURN NULL;
  END IF;
  issued_epoch := fields[7]::bigint;
  expires_epoch := fields[8]::bigint;
  IF issued_epoch > now_epoch + 5 OR expires_epoch < now_epoch
    OR expires_epoch <= issued_epoch OR expires_epoch - issued_epoch > 60
    OR fields[9]::integer <> pg_catalog.pg_backend_pid()
    OR fields[10]::bigint <> pg_catalog.txid_current() THEN
    RETURN NULL;
  END IF;
  SELECT key.secret INTO signing_key
  FROM public.socialinsight_page_context_keys key
  WHERE key.kid = fields[2] AND key.active;
  IF signing_key IS NULL THEN RETURN NULL; END IF;
  expected_mac := pg_catalog.encode(
    public.hmac(pg_catalog.convert_to(pg_catalog.array_to_string(fields[1:11], '.'), 'UTF8'), signing_key, 'sha256'),
    'hex'
  );
  IF expected_mac <> fields[12] THEN RETURN NULL; END IF;
  RETURN fields;
EXCEPTION WHEN others THEN
  -- Invalid attacker-controlled GUC input must fail closed, not make policy
  -- evaluation throw a parsing exception.
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_context_user_id()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT CASE WHEN claim[3] = '0' THEN NULL ELSE claim[3] END
  FROM (SELECT public.socialinsight_context_claim() AS claim) verified
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_context_is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT coalesce(claim[4] = '1', false)
  FROM (SELECT public.socialinsight_context_claim() AS claim) verified
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_context_is_system()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT coalesce(claim[5] = '1', false)
  FROM (SELECT public.socialinsight_context_claim() AS claim) verified
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_context_is_test_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT coalesce(claim[6] = '1', false)
  FROM (SELECT public.socialinsight_context_claim() AS claim) verified
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_page_is_public(target_page_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."Page" page
    WHERE page.id = target_page_id
      AND page."publicationState" = 'PUBLISHED'
      AND page."platformState" <> 'SUSPENDED'
      AND page."safetyHiddenAt" IS NULL
      AND page."deletionRequestedAt" IS NULL
      AND page."purgedAt" IS NULL
      AND (NOT page."isTestFixture" OR public.socialinsight_context_is_test_user())
      AND (
        EXISTS (
          SELECT 1 FROM public.users owner
          WHERE owner.id = page."ownerId" AND owner.status = 'ACTIVE'
        )
        OR EXISTS (
          SELECT 1
          FROM public."PageMembership" membership
          JOIN public.users member ON member.id = membership."userId"
          WHERE membership."pageId" = page.id
            AND membership.role IN ('ADMIN','EDITOR')
            AND member.status = 'ACTIVE'
        )
      )
      AND (
        public.socialinsight_context_user_id() IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public."PageBlock" block
          WHERE block."pageId" = page.id
            AND block."userId" = public.socialinsight_context_user_id()
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_page_actor_role(target_page_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
  SELECT CASE
    WHEN public.socialinsight_context_is_system() OR public.socialinsight_context_is_staff() THEN 'SYSTEM'
    ELSE (
      SELECT CASE
        WHEN page."ownerId" = public.socialinsight_context_user_id() THEN 'OWNER'
        ELSE membership.role
      END
      FROM public."Page" page
      LEFT JOIN public."PageMembership" membership
        ON membership."pageId" = page.id
       AND membership."userId" = public.socialinsight_context_user_id()
      WHERE page.id = target_page_id
        AND page."purgedAt" IS NULL
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_page_actor_has_role(target_page_id text, allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
  SELECT coalesce(public.socialinsight_page_actor_role(target_page_id) = ANY(allowed_roles), false)
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_page_follower_count(target_page_id text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
  SELECT CASE
    WHEN public.socialinsight_page_is_public(target_page_id)
      OR public.socialinsight_page_actor_has_role(
        target_page_id, ARRAY['OWNER','ADMIN','EDITOR','ANALYST','SYSTEM']
      )
    THEN (
      SELECT count(*) FROM public."PageFollow" follow
      WHERE follow."pageId" = target_page_id
    )
    ELSE 0::bigint
  END
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_page_actor_has_pending_transfer(target_page_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."PageOwnershipTransfer" transfer
    JOIN public."Page" page ON page.id = transfer."pageId"
    WHERE transfer."pageId" = target_page_id
      AND transfer."recipientId" = public.socialinsight_context_user_id()
      AND transfer."senderId" = page."ownerId"
      AND transfer.status = 'PENDING'
      AND transfer."expiresAt" > CURRENT_TIMESTAMP
      AND page."deletionRequestedAt" IS NULL
      AND page."purgedAt" IS NULL
  )
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_page_actor_has_pending_invitation(
  target_page_id text, target_user_id text, target_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public."PageInvitation" invitation
    WHERE invitation."pageId" = target_page_id
      AND invitation."recipientId" = target_user_id
      AND invitation.role = target_role
      AND invitation.status = 'PENDING'
      AND invitation."expiresAt" > CURRENT_TIMESTAMP
  )
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_enforce_page_invitation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF NEW."pageId" IS DISTINCT FROM OLD."pageId"
    OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId"
    OR NEW."senderId" IS DISTINCT FROM OLD."senderId"
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'PAGE_INVITATION_IDENTITY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt" THEN
      RAISE EXCEPTION 'PAGE_INVITATION_DECISION_REQUIRES_STATUS' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('ACCEPTED','REJECTED','WITHDRAWN','EXPIRED')
    OR NEW."decidedAt" IS NULL THEN
    RAISE EXCEPTION 'PAGE_INVITATION_INVALID_TRANSITION' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('ACCEPTED','REJECTED')
    AND NEW."recipientId" <> public.socialinsight_context_user_id() THEN
    RAISE EXCEPTION 'PAGE_INVITATION_RECIPIENT_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'ACCEPTED' AND NOT EXISTS (
    SELECT 1 FROM public.socialinsight_page_transition_admissions admission
    WHERE admission.backend_pid = pg_catalog.pg_backend_pid()
      AND admission.transaction_id = pg_catalog.txid_current()
      AND admission.page_id = NEW."pageId"
      AND admission.actor_id = NEW."recipientId"
      AND admission.transition_kind = 'INVITATION_ACCEPT'
  ) THEN
    RAISE EXCEPTION 'PAGE_INVITATION_ACCEPTANCE_RPC_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'WITHDRAWN'
    AND NOT (NEW."senderId" = public.socialinsight_context_user_id()
      OR public.socialinsight_page_actor_has_role(NEW."pageId", ARRAY['OWNER','ADMIN','SYSTEM'])) THEN
    RAISE EXCEPTION 'PAGE_INVITATION_SENDER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'EXPIRED' AND NOT public.socialinsight_context_is_system()
    AND (NEW."expiresAt" > CURRENT_TIMESTAMP
      OR NOT public.socialinsight_page_actor_has_role(NEW."pageId", ARRAY['OWNER','ADMIN','SYSTEM'])) THEN
    RAISE EXCEPTION 'PAGE_INVITATION_EXPIRY_NOT_DUE' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'ACCEPTED' THEN
    DELETE FROM public.socialinsight_page_transition_admissions admission
    WHERE admission.backend_pid = pg_catalog.pg_backend_pid()
      AND admission.transaction_id = pg_catalog.txid_current()
      AND admission.page_id = NEW."pageId"
      AND admission.actor_id = NEW."recipientId"
      AND admission.transition_kind = 'INVITATION_ACCEPT';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_enforce_page_transfer_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF NEW."pageId" IS DISTINCT FROM OLD."pageId"
    OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId"
    OR NEW."senderId" IS DISTINCT FROM OLD."senderId"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_IDENTITY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt" THEN
      RAISE EXCEPTION 'PAGE_TRANSFER_DECISION_REQUIRES_STATUS' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('ACCEPTED','REJECTED','WITHDRAWN','EXPIRED')
    OR NEW."decidedAt" IS NULL THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_INVALID_TRANSITION' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('ACCEPTED','REJECTED')
    AND NEW."recipientId" <> public.socialinsight_context_user_id() THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_RECIPIENT_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'WITHDRAWN'
    AND NOT (NEW."senderId" = public.socialinsight_context_user_id()
      OR public.socialinsight_page_actor_has_role(NEW."pageId", ARRAY['OWNER','SYSTEM'])) THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_SENDER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'EXPIRED' AND NOT public.socialinsight_context_is_system()
    AND (NEW."expiresAt" > CURRENT_TIMESTAMP
      OR NOT public.socialinsight_page_actor_has_role(NEW."pageId", ARRAY['OWNER','SYSTEM'])) THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_EXPIRY_NOT_DUE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

-- Acceptance changes several rows whose intermediate state must never be
-- exposed to a caller.  These narrowly scoped RPCs lock the invitation or
-- transfer and Page row, re-check the signed recipient identity, and perform
-- the membership/ownership state transition atomically.  Direct DML cannot
-- use either acceptance path.
CREATE OR REPLACE FUNCTION public.socialinsight_accept_page_invitation(target_invitation_id text)
RETURNS TABLE(page_id text, accepted_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
  invitation public."PageInvitation"%ROWTYPE;
  target_page public."Page"%ROWTYPE;
  actor text := public.socialinsight_context_user_id();
BEGIN
  SELECT * INTO invitation FROM public."PageInvitation" WHERE id = target_invitation_id FOR UPDATE;
  IF NOT FOUND OR actor IS NULL OR invitation."recipientId" <> actor
    OR invitation.status <> 'PENDING' OR invitation."expiresAt" <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'PAGE_INVITATION_ACCEPTANCE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target_page FROM public."Page" WHERE id = invitation."pageId" FOR UPDATE;
  IF NOT FOUND OR target_page."deletionRequestedAt" IS NOT NULL OR target_page."purgedAt" IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = actor AND status = 'ACTIVE')
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = invitation."senderId" AND status = 'ACTIVE')
    OR NOT (target_page."ownerId" = invitation."senderId" OR EXISTS (
      SELECT 1 FROM public."PageMembership" member
      WHERE member."pageId" = invitation."pageId" AND member."userId" = invitation."senderId"
        AND ((member.role = 'ADMIN' AND invitation.role IN ('EDITOR','ANALYST'))
          OR (member.role = 'EDITOR' AND invitation.role = 'ANALYST'))
    ))
    OR EXISTS (SELECT 1 FROM public."PageMembership" member
      WHERE member."pageId" = invitation."pageId" AND member."userId" = actor)
    OR EXISTS (SELECT 1 FROM public."PageBlock" block
      WHERE block."pageId" = invitation."pageId" AND block."userId" IN (actor, invitation."senderId"))
    OR EXISTS (SELECT 1 FROM public.user_blocks block
      WHERE (block.blocker_id = actor AND block.blocked_id = invitation."senderId")
         OR (block.blocker_id = invitation."senderId" AND block.blocked_id = actor)) THEN
    RAISE EXCEPTION 'PAGE_INVITATION_ACCEPTANCE_INVALID' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."PageMembership" ("pageId", "userId", role, "updatedAt")
    VALUES (invitation."pageId", actor, invitation.role, CURRENT_TIMESTAMP);
  INSERT INTO public.socialinsight_page_transition_admissions (
    backend_pid, transaction_id, page_id, actor_id, transition_kind
  ) VALUES (pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), invitation."pageId", actor, 'INVITATION_ACCEPT');
  UPDATE public."PageInvitation"
    SET status = 'ACCEPTED', "decidedAt" = CURRENT_TIMESTAMP
    WHERE id = invitation.id;
  RETURN QUERY SELECT invitation."pageId", invitation.role;
END
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_accept_page_transfer(target_transfer_id text)
RETURNS TABLE(page_id text, accepted_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
  transfer public."PageOwnershipTransfer"%ROWTYPE;
  target_page public."Page"%ROWTYPE;
  actor text := public.socialinsight_context_user_id();
BEGIN
  SELECT * INTO transfer FROM public."PageOwnershipTransfer" WHERE id = target_transfer_id FOR UPDATE;
  IF NOT FOUND OR actor IS NULL OR transfer."recipientId" <> actor
    OR transfer.status <> 'PENDING' OR transfer."expiresAt" <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_ACCEPTANCE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target_page FROM public."Page" WHERE id = transfer."pageId" FOR UPDATE;
  IF NOT FOUND OR target_page."ownerId" <> transfer."senderId"
    OR target_page."deletionRequestedAt" IS NOT NULL OR target_page."purgedAt" IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = actor AND status = 'ACTIVE' AND email_verified_at IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = transfer."senderId" AND status = 'ACTIVE'
      AND email_verified_at IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM public."PageMembership" member
      WHERE member."pageId" = transfer."pageId" AND member."userId" = actor)
    OR EXISTS (SELECT 1 FROM public."PageBlock" block
      WHERE block."pageId" = transfer."pageId" AND block."userId" IN (actor, transfer."senderId"))
    OR EXISTS (SELECT 1 FROM public.user_blocks block
      WHERE (block.blocker_id = actor AND block.blocked_id = transfer."senderId")
         OR (block.blocker_id = transfer."senderId" AND block.blocked_id = actor))
    OR (SELECT count(*) FROM public."Page" page WHERE page."ownerId" = actor AND page."purgedAt" IS NULL) >= 5 THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_ACCEPTANCE_INVALID' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."PageMembership" WHERE "pageId" = transfer."pageId" AND "userId" = actor;
  INSERT INTO public.socialinsight_page_transition_admissions (
    backend_pid, transaction_id, page_id, actor_id, transition_kind
  ) VALUES (pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), transfer."pageId", actor, 'TRANSFER_ACCEPT');
  UPDATE public."Page" SET "ownerId" = actor WHERE id = transfer."pageId";
  INSERT INTO public."PageMembership" ("pageId", "userId", role, "updatedAt")
    VALUES (transfer."pageId", transfer."senderId", 'ADMIN', CURRENT_TIMESTAMP)
    ON CONFLICT ("pageId", "userId") DO UPDATE SET role = 'ADMIN', "updatedAt" = CURRENT_TIMESTAMP;
  UPDATE public."PageOwnershipTransfer"
    SET status = 'ACCEPTED', "decidedAt" = CURRENT_TIMESTAMP
    WHERE id = transfer.id;
  RETURN QUERY SELECT transfer."pageId", 'OWNER'::text;
END
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_enforce_page_sensitive_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
    AND NOT public.socialinsight_context_is_system()
    AND NOT public.socialinsight_context_is_staff()
    AND NOT EXISTS (
      SELECT 1 FROM public.socialinsight_page_transition_admissions admission
      WHERE admission.backend_pid = pg_catalog.pg_backend_pid()
        AND admission.transaction_id = pg_catalog.txid_current()
        AND admission.page_id = OLD.id
        AND admission.actor_id = NEW."ownerId"
        AND admission.transition_kind = 'TRANSFER_ACCEPT'
    ) THEN
    RAISE EXCEPTION 'PAGE_OWNER_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" THEN
    DELETE FROM public.socialinsight_page_transition_admissions admission
    WHERE admission.backend_pid = pg_catalog.pg_backend_pid()
      AND admission.transaction_id = pg_catalog.txid_current()
      AND admission.page_id = OLD.id
      AND admission.actor_id = NEW."ownerId"
      AND admission.transition_kind = 'TRANSFER_ACCEPT';
  END IF;

  IF NEW.handle IS DISTINCT FROM OLD.handle
    AND NOT public.socialinsight_page_actor_has_role(OLD.id, ARRAY['OWNER','SYSTEM']) THEN
    RAISE EXCEPTION 'PAGE_HANDLE_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF (NEW."publicationState" IS DISTINCT FROM OLD."publicationState"
      OR NEW."safetyHiddenAt" IS DISTINCT FROM OLD."safetyHiddenAt"
      OR NEW."deletionRequestedAt" IS DISTINCT FROM OLD."deletionRequestedAt")
    AND NOT public.socialinsight_context_is_staff()
    AND NOT public.socialinsight_page_actor_has_role(OLD.id, ARRAY['OWNER','SYSTEM']) THEN
    RAISE EXCEPTION 'PAGE_LIFECYCLE_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF (NEW."platformState" IS DISTINCT FROM OLD."platformState"
      OR NEW."legalHoldUntil" IS DISTINCT FROM OLD."legalHoldUntil"
      OR NEW."legalHoldReason" IS DISTINCT FROM OLD."legalHoldReason")
    AND NOT public.socialinsight_context_is_staff()
    AND NOT public.socialinsight_context_is_system() THEN
    RAISE EXCEPTION 'PAGE_STAFF_STATE_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF NEW."purgedAt" IS DISTINCT FROM OLD."purgedAt"
    AND NOT public.socialinsight_context_is_system() THEN
    RAISE EXCEPTION 'PAGE_PURGE_ADMISSION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF (NEW."createRequestId" IS DISTINCT FROM OLD."createRequestId"
      OR NEW."representationAt" IS DISTINCT FROM OLD."representationAt"
      OR NEW."isTestFixture" IS DISTINCT FROM OLD."isTestFixture")
    AND NOT public.socialinsight_context_is_system() THEN
    RAISE EXCEPTION 'PAGE_IMMUTABLE_FIELD_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.socialinsight_context_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_context_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_context_is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_context_is_system() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_context_is_test_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_is_public(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_actor_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_actor_has_role(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_follower_count(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_actor_has_pending_transfer(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_actor_has_pending_invitation(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_enforce_page_sensitive_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_enforce_page_invitation_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_enforce_page_transfer_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_accept_page_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_accept_page_transfer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.socialinsight_context_user_id() TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_context_is_staff() TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_context_is_system() TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_context_is_test_user() TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_is_public(text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_actor_role(text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_actor_has_role(text, text[]) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_follower_count(text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_actor_has_pending_transfer(text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_actor_has_pending_invitation(text, text, text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_accept_page_invitation(text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_accept_page_transfer(text) TO socialinsight_runtime;

-- Page: public rows are readable anonymously; management rows require the
-- transaction-local actor, staff, or system context. Physical deletion is a
-- system-worker operation only.
ALTER TABLE public."Page" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Page" FORCE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS socialinsight_enforce_sensitive_update ON public."Page";
CREATE TRIGGER socialinsight_enforce_sensitive_update
  BEFORE UPDATE ON public."Page"
  FOR EACH ROW EXECUTE FUNCTION public.socialinsight_enforce_page_sensitive_update();
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."Page";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."Page";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."Page";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."Page";
CREATE POLICY socialinsight_runtime_select ON public."Page"
  FOR SELECT TO socialinsight_runtime
  USING (
    public.socialinsight_page_is_public(id)
    OR public.socialinsight_page_actor_has_role(id, ARRAY['OWNER','ADMIN','EDITOR','ANALYST','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_insert ON public."Page"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (
    public.socialinsight_context_is_system()
    OR public.socialinsight_context_is_staff()
    OR (public.socialinsight_context_user_id() IS NOT NULL
      AND "ownerId" = public.socialinsight_context_user_id())
  );
CREATE POLICY socialinsight_runtime_update ON public."Page"
  FOR UPDATE TO socialinsight_runtime
  USING (
    public.socialinsight_page_actor_has_role(id, ARRAY['OWNER','ADMIN','SYSTEM'])
  )
  WITH CHECK (public.socialinsight_page_actor_has_role(id, ARRAY['OWNER','ADMIN','SYSTEM']));
CREATE POLICY socialinsight_runtime_delete ON public."Page"
  FOR DELETE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system());

-- PageMembership is created only by the invitation acceptance RPC (or a
-- system worker).  Team owners/admins create invitations, never memberships.
ALTER TABLE public."PageMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageMembership" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageMembership";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageMembership";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageMembership";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageMembership";
CREATE POLICY socialinsight_runtime_select ON public."PageMembership"
  FOR SELECT TO socialinsight_runtime
  USING (
    "userId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_insert ON public."PageMembership"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (public.socialinsight_context_is_system());
CREATE POLICY socialinsight_runtime_update ON public."PageMembership"
  FOR UPDATE TO socialinsight_runtime
  USING (
    public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
    OR (role IN ('EDITOR','ANALYST')
      AND public.socialinsight_page_actor_has_role("pageId", ARRAY['ADMIN']))
  )
  WITH CHECK (
    public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
    OR (role IN ('EDITOR','ANALYST')
      AND public.socialinsight_page_actor_has_role("pageId", ARRAY['ADMIN']))
  );
CREATE POLICY socialinsight_runtime_delete ON public."PageMembership"
  FOR DELETE TO socialinsight_runtime
  USING (
    "userId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
    OR (role IN ('EDITOR','ANALYST')
      AND public.socialinsight_page_actor_has_role("pageId", ARRAY['ADMIN']))
  );

ALTER TABLE public."PageHandle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageHandle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageHandle";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageHandle";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageHandle";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageHandle";
CREATE POLICY socialinsight_runtime_select ON public."PageHandle"
  FOR SELECT TO socialinsight_runtime
  USING (
    public.socialinsight_page_is_public("pageId")
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','ANALYST','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_insert ON public."PageHandle"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM']));
CREATE POLICY socialinsight_runtime_update ON public."PageHandle"
  FOR UPDATE TO socialinsight_runtime
  USING (public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM']))
  WITH CHECK (public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM']));
CREATE POLICY socialinsight_runtime_delete ON public."PageHandle"
  FOR DELETE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system());

ALTER TABLE public."PageInvitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageInvitation" FORCE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS socialinsight_enforce_invitation_update ON public."PageInvitation";
CREATE TRIGGER socialinsight_enforce_invitation_update
  BEFORE UPDATE ON public."PageInvitation"
  FOR EACH ROW EXECUTE FUNCTION public.socialinsight_enforce_page_invitation_update();
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageInvitation";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageInvitation";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageInvitation";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageInvitation";
CREATE POLICY socialinsight_runtime_select ON public."PageInvitation"
  FOR SELECT TO socialinsight_runtime
  USING (
    "recipientId" = public.socialinsight_context_user_id()
    OR "senderId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_insert ON public."PageInvitation"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (
    "senderId" = public.socialinsight_context_user_id()
    AND (
      public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
      OR (role IN ('EDITOR','ANALYST')
        AND public.socialinsight_page_actor_has_role("pageId", ARRAY['ADMIN']))
    )
  );
CREATE POLICY socialinsight_runtime_update ON public."PageInvitation"
  FOR UPDATE TO socialinsight_runtime
  USING (
    "recipientId" = public.socialinsight_context_user_id()
    OR "senderId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','SYSTEM'])
  )
  WITH CHECK (
    "recipientId" = public.socialinsight_context_user_id()
    OR "senderId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_delete ON public."PageInvitation"
  FOR DELETE TO socialinsight_runtime
  USING (public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','SYSTEM']));

ALTER TABLE public."PageOwnershipTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageOwnershipTransfer" FORCE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS socialinsight_enforce_transfer_update ON public."PageOwnershipTransfer";
CREATE TRIGGER socialinsight_enforce_transfer_update
  BEFORE UPDATE ON public."PageOwnershipTransfer"
  FOR EACH ROW EXECUTE FUNCTION public.socialinsight_enforce_page_transfer_update();
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageOwnershipTransfer";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageOwnershipTransfer";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageOwnershipTransfer";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageOwnershipTransfer";
CREATE POLICY socialinsight_runtime_select ON public."PageOwnershipTransfer"
  FOR SELECT TO socialinsight_runtime
  USING (
    "recipientId" = public.socialinsight_context_user_id()
    OR "senderId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_insert ON public."PageOwnershipTransfer"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (
    "senderId" = public.socialinsight_context_user_id()
    AND public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_update ON public."PageOwnershipTransfer"
  FOR UPDATE TO socialinsight_runtime
  USING (
    "recipientId" = public.socialinsight_context_user_id()
    OR "senderId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
  )
  WITH CHECK (
    "recipientId" = public.socialinsight_context_user_id()
    OR "senderId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_delete ON public."PageOwnershipTransfer"
  FOR DELETE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system());

ALTER TABLE public."PageFollow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageFollow" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageFollow";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageFollow";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageFollow";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageFollow";
CREATE POLICY socialinsight_runtime_select ON public."PageFollow"
  FOR SELECT TO socialinsight_runtime
  USING (
    "userId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','ANALYST','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_insert ON public."PageFollow"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (
    "userId" = public.socialinsight_context_user_id()
    AND public.socialinsight_page_is_public("pageId")
  );
CREATE POLICY socialinsight_runtime_update ON public."PageFollow"
  FOR UPDATE TO socialinsight_runtime
  USING ("userId" = public.socialinsight_context_user_id())
  WITH CHECK ("userId" = public.socialinsight_context_user_id());
CREATE POLICY socialinsight_runtime_delete ON public."PageFollow"
  FOR DELETE TO socialinsight_runtime
  USING (
    "userId" = public.socialinsight_context_user_id()
    OR public.socialinsight_context_is_system()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','SYSTEM'])
  );

ALTER TABLE public."PageBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageBlock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageBlock";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageBlock";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageBlock";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageBlock";
CREATE POLICY socialinsight_runtime_select ON public."PageBlock"
  FOR SELECT TO socialinsight_runtime
  USING (
    (direction = 'USER_TO_PAGE' AND "userId" = public.socialinsight_context_user_id())
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_insert ON public."PageBlock"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (
    (direction = 'USER_TO_PAGE' AND "userId" = public.socialinsight_context_user_id())
    OR (direction = 'PAGE_TO_USER'
      AND public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','SYSTEM']))
  );
CREATE POLICY socialinsight_runtime_update ON public."PageBlock"
  FOR UPDATE TO socialinsight_runtime
  USING (
    (direction = 'USER_TO_PAGE' AND "userId" = public.socialinsight_context_user_id())
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','SYSTEM'])
  )
  WITH CHECK (
    (direction = 'USER_TO_PAGE' AND "userId" = public.socialinsight_context_user_id())
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_delete ON public."PageBlock"
  FOR DELETE TO socialinsight_runtime
  USING (
    (direction = 'USER_TO_PAGE' AND "userId" = public.socialinsight_context_user_id())
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','SYSTEM'])
  );

ALTER TABLE public."PageAuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageAuditEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageAuditEvent";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageAuditEvent";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageAuditEvent";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageAuditEvent";
CREATE POLICY socialinsight_runtime_select ON public."PageAuditEvent"
  FOR SELECT TO socialinsight_runtime
  USING (public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','SYSTEM']));
CREATE POLICY socialinsight_runtime_insert ON public."PageAuditEvent"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (
    public.socialinsight_context_is_system()
    OR public.socialinsight_context_is_staff()
    OR "actorId" = public.socialinsight_context_user_id()
    OR ("actorId" IS NULL AND public.socialinsight_context_user_id() IS NOT NULL AND (
      public.socialinsight_page_is_public("pageId")
      OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','SYSTEM'])
    ))
  );
CREATE POLICY socialinsight_runtime_update ON public."PageAuditEvent"
  FOR UPDATE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system())
  WITH CHECK (public.socialinsight_context_is_system());
CREATE POLICY socialinsight_runtime_delete ON public."PageAuditEvent"
  FOR DELETE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system());

ALTER TABLE public."PageCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageCase" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageCase";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageCase";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageCase";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageCase";
CREATE POLICY socialinsight_runtime_select ON public."PageCase"
  FOR SELECT TO socialinsight_runtime
  USING (
    "reporterId" = public.socialinsight_context_user_id()
    OR public.socialinsight_context_is_staff()
    OR public.socialinsight_context_is_system()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_insert ON public."PageCase"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (
    public.socialinsight_context_user_id() IS NOT NULL
    AND "reporterId" = public.socialinsight_context_user_id()
  );
CREATE POLICY socialinsight_runtime_update ON public."PageCase"
  FOR UPDATE TO socialinsight_runtime
  USING (public.socialinsight_context_is_staff() OR public.socialinsight_context_is_system())
  WITH CHECK (public.socialinsight_context_is_staff() OR public.socialinsight_context_is_system());
CREATE POLICY socialinsight_runtime_delete ON public."PageCase"
  FOR DELETE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system());

ALTER TABLE public."PageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PageEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS socialinsight_runtime_select ON public."PageEvent";
DROP POLICY IF EXISTS socialinsight_runtime_insert ON public."PageEvent";
DROP POLICY IF EXISTS socialinsight_runtime_update ON public."PageEvent";
DROP POLICY IF EXISTS socialinsight_runtime_delete ON public."PageEvent";
CREATE POLICY socialinsight_runtime_select ON public."PageEvent"
  FOR SELECT TO socialinsight_runtime
  USING (
    "recipientId" = public.socialinsight_context_user_id()
    OR public.socialinsight_context_is_system()
  );
CREATE POLICY socialinsight_runtime_insert ON public."PageEvent"
  FOR INSERT TO socialinsight_runtime
  WITH CHECK (
    public.socialinsight_context_is_system()
    OR public.socialinsight_context_is_staff()
    OR (public.socialinsight_context_user_id() IS NOT NULL
      AND public.socialinsight_page_is_public("pageId"))
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','ADMIN','EDITOR','SYSTEM'])
  );
CREATE POLICY socialinsight_runtime_update ON public."PageEvent"
  FOR UPDATE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system())
  WITH CHECK (public.socialinsight_context_is_system());
CREATE POLICY socialinsight_runtime_delete ON public."PageEvent"
  FOR DELETE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system());

ALTER TABLE public."PagePurgeJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PagePurgeJob" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS socialinsight_runtime_all ON public."PagePurgeJob";
CREATE POLICY socialinsight_runtime_all ON public."PagePurgeJob"
  FOR ALL TO socialinsight_runtime
  USING (public.socialinsight_context_is_system())
  WITH CHECK (public.socialinsight_context_is_system());

-- Authentication and account-lifecycle tables are reached before a request
-- has a trusted user context. They remain inaccessible to anon/authenticated
-- database roles; only the backend runtime role receives this explicit policy.
DO $backend_tables$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'auth_sessions', 'oauth_accounts', 'oauth_states', 'otp_challenges',
    'auth_rate_limits', 'OTPCode', 'PendingRegistration', 'handle_aliases',
    'security_email_outbox', 'deletion_decisions', 'user_mfa',
    'auth_challenges', 'account_cleanup_jobs'
  ]
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'PAGES_RLS_REQUIRED_BACKEND_TABLE_MISSING:%', table_name;
    END IF;
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE pg_catalog.format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS socialinsight_runtime_backend_all ON public.%I', table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY socialinsight_runtime_backend_all ON public.%I FOR ALL TO socialinsight_runtime USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$backend_tables$;

DO $postflight$
BEGIN
  IF pg_catalog.has_schema_privilege('socialinsight_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'PAGES_RLS_RUNTIME_MUST_NOT_HAVE_SCHEMA_CREATE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class object
    JOIN pg_catalog.pg_roles owner ON owner.oid = object.relowner
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
    WHERE namespace.nspname = 'public' AND owner.rolname = 'socialinsight_runtime'
  ) THEN
    RAISE EXCEPTION 'PAGES_RLS_RUNTIME_MUST_NOT_OWN_OBJECTS';
  END IF;
END
$postflight$;

RESET statement_timeout;
RESET lock_timeout;
