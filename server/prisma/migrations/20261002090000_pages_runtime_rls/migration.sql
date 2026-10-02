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

CREATE OR REPLACE FUNCTION public.socialinsight_context_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT nullif(pg_catalog.current_setting('socialinsight.user_id', true), '')
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_context_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT coalesce(
    nullif(pg_catalog.current_setting('socialinsight.page_staff', true), '')::boolean,
    false
  )
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_context_is_system()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT coalesce(
    nullif(pg_catalog.current_setting('socialinsight.page_system', true), '')::boolean,
    false
  )
$function$;

CREATE OR REPLACE FUNCTION public.socialinsight_context_is_test_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT coalesce(
    nullif(pg_catalog.current_setting('socialinsight.page_test_user', true), '')::boolean,
    false
  )
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
    AND NOT (
      NEW."ownerId" = public.socialinsight_context_user_id()
      AND public.socialinsight_page_actor_has_pending_transfer(OLD.id)
    ) THEN
    RAISE EXCEPTION 'PAGE_OWNER_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.socialinsight_context_is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_context_is_system() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_context_is_test_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_is_public(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_actor_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_actor_has_role(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_follower_count(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_page_actor_has_pending_transfer(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.socialinsight_enforce_page_sensitive_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.socialinsight_context_user_id() TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_context_is_staff() TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_context_is_system() TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_context_is_test_user() TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_is_public(text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_actor_role(text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_actor_has_role(text, text[]) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_follower_count(text) TO socialinsight_runtime;
GRANT EXECUTE ON FUNCTION public.socialinsight_page_actor_has_pending_transfer(text) TO socialinsight_runtime;

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
    OR public.socialinsight_page_actor_has_pending_transfer(id)
  )
  WITH CHECK (public.socialinsight_page_actor_has_role(id, ARRAY['OWNER','ADMIN','SYSTEM']));
CREATE POLICY socialinsight_runtime_delete ON public."Page"
  FOR DELETE TO socialinsight_runtime
  USING (public.socialinsight_context_is_system());

-- PageMembership: users can see their own membership; team management remains
-- owner/admin/staff/system-authorized. A recipient can insert only its own row
-- while accepting an invitation already validated and locked by the server.
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
  WITH CHECK (
    "userId" = public.socialinsight_context_user_id()
    OR public.socialinsight_page_actor_has_role("pageId", ARRAY['OWNER','SYSTEM'])
    OR (role IN ('EDITOR','ANALYST')
      AND public.socialinsight_page_actor_has_role("pageId", ARRAY['ADMIN']))
  );
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
