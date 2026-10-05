-- Recipient decisions must not borrow Page UPDATE rights before membership.
-- Keep signed identity, canonical server coordination and atomic narrow RPCs.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE POLICY socialinsight_runtime_pending_invitation_select ON public."Page"
  FOR SELECT TO socialinsight_runtime
  USING (
    "purgedAt" IS NULL
    AND (NOT "isTestFixture" OR public.socialinsight_context_is_test_user())
    AND EXISTS (
      SELECT 1 FROM public."PageInvitation" invitation
      WHERE invitation."pageId" = "Page".id
        AND invitation."recipientId" = public.socialinsight_context_user_id()
        AND invitation.status = 'PENDING'
        AND invitation."expiresAt" > CURRENT_TIMESTAMP
    )
  );

DO $constraint$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.socialinsight_page_transition_admissions'::regclass
    AND contype = 'c'
    AND pg_catalog.pg_get_constraintdef(oid) LIKE '%INVITATION_ACCEPT%'
    AND pg_catalog.pg_get_constraintdef(oid) LIKE '%TRANSFER_ACCEPT%';
  EXECUTE pg_catalog.format('ALTER TABLE public.socialinsight_page_transition_admissions DROP CONSTRAINT %I', constraint_name);
END
$constraint$;
ALTER TABLE public.socialinsight_page_transition_admissions
  ADD CONSTRAINT socialinsight_transition_kind_guard
  CHECK (transition_kind IN ('INVITATION_ACCEPT', 'TRANSFER_ACCEPT', 'INVITATION_SAFETY'));

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
    AND NOT public.socialinsight_page_actor_has_role(OLD.id, ARRAY['OWNER','SYSTEM'])
    AND NOT (
      NEW."publicationState" IS NOT DISTINCT FROM OLD."publicationState"
      AND NEW."deletionRequestedAt" IS NOT DISTINCT FROM OLD."deletionRequestedAt"
      AND OLD."safetyHiddenAt" IS NOT NULL AND NEW."safetyHiddenAt" IS NULL
      AND public.socialinsight_page_actor_has_role(OLD.id, ARRAY['ADMIN','EDITOR','ANALYST'])
      AND EXISTS (
        SELECT 1 FROM public.socialinsight_page_transition_admissions admission
        WHERE admission.backend_pid = pg_catalog.pg_backend_pid()
          AND admission.transaction_id = pg_catalog.txid_current()
          AND admission.page_id = OLD.id
          AND admission.actor_id = public.socialinsight_context_user_id()
          AND admission.transition_kind = 'INVITATION_SAFETY'
      )
    ) THEN
    RAISE EXCEPTION 'PAGE_LIFECYCLE_CHANGE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NEW."safetyHiddenAt" IS DISTINCT FROM OLD."safetyHiddenAt" THEN
    DELETE FROM public.socialinsight_page_transition_admissions admission
    WHERE admission.backend_pid = pg_catalog.pg_backend_pid()
      AND admission.transaction_id = pg_catalog.txid_current()
      AND admission.page_id = OLD.id
      AND admission.actor_id = public.socialinsight_context_user_id()
      AND admission.transition_kind = 'INVITATION_SAFETY';
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

CREATE FUNCTION public.socialinsight_decide_page_invitation(target_invitation_id text, decision text)
RETURNS TABLE(page_id text, decided_status text, accepted_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE
  invitation public."PageInvitation"%ROWTYPE;
  target_page public."Page"%ROWTYPE;
  actor text := public.socialinsight_context_user_id();
  decision_status text;
  decision_role text;
BEGIN
  IF actor IS NULL OR decision NOT IN ('accept', 'reject') OR decision IS NULL THEN
    RAISE EXCEPTION 'PAGE_INVITATION_DECISION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO invitation FROM public."PageInvitation" WHERE id = target_invitation_id FOR UPDATE;
  IF NOT FOUND OR invitation."recipientId" <> actor OR invitation.status <> 'PENDING'
    OR invitation."expiresAt" <= CURRENT_TIMESTAMP
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = actor AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'PAGE_INVITATION_DECISION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target_page FROM public."Page" WHERE id = invitation."pageId" FOR UPDATE;
  IF NOT FOUND OR target_page."purgedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'PAGE_INVITATION_DECISION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF decision = 'accept' THEN
    -- Keep the API's mayManagePageRole contract even if an invitation remains
    -- pending after an out-of-band sender demotion. Editors cannot grant roles.
    IF NOT (target_page."ownerId" = invitation."senderId" OR EXISTS (
      SELECT 1 FROM public."PageMembership" sender
      WHERE sender."pageId" = target_page.id AND sender."userId" = invitation."senderId"
        AND sender.role = 'ADMIN' AND invitation.role IN ('EDITOR','ANALYST')
    )) THEN
      RAISE EXCEPTION 'PAGE_INVITATION_SENDER_REVOKED' USING ERRCODE = '42501';
    END IF;
    SELECT accepted.accepted_role INTO decision_role
    FROM public.socialinsight_accept_page_invitation(target_invitation_id) accepted;
    decision_status := 'ACCEPTED';
    -- Match the existing independent safety constraint, not lifecycle/platform
    -- state. Only this verified same-transaction acceptance can clear it.
    IF target_page."safetyHiddenAt" IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.users WHERE id = target_page."ownerId" AND status = 'ACTIVE')
      OR EXISTS (SELECT 1 FROM public."PageMembership" member
        JOIN public.users person ON person.id = member."userId"
        WHERE member."pageId" = target_page.id AND member.role IN ('ADMIN','EDITOR') AND person.status = 'ACTIVE')
    ) THEN
      INSERT INTO public.socialinsight_page_transition_admissions
        (backend_pid, transaction_id, page_id, actor_id, transition_kind)
        VALUES (pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), target_page.id, actor, 'INVITATION_SAFETY');
      UPDATE public."Page" SET "safetyHiddenAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE id = target_page.id;
      INSERT INTO public."PageAuditEvent" (id, "pageId", "actorId", action)
        VALUES (pg_catalog.gen_random_uuid()::text, target_page.id, NULL, 'PAGE_SAFETY_RESTORED');
    END IF;
  ELSE
    decision_status := 'REJECTED';
    UPDATE public."PageInvitation" SET status = 'REJECTED', "decidedAt" = CURRENT_TIMESTAMP
      WHERE id = target_invitation_id;
  END IF;
  INSERT INTO public."PageAuditEvent" (id, "pageId", "actorId", action, "targetId")
    VALUES (pg_catalog.gen_random_uuid()::text, target_page.id, actor, 'INVITATION_' || decision_status, target_invitation_id);
  INSERT INTO public."PageEvent" (id, "pageId", "recipientId", kind, "targetId", "dedupeKey")
    VALUES (pg_catalog.gen_random_uuid()::text, target_page.id, invitation."senderId", 'PAGE_INVITATION_' || decision_status,
      target_invitation_id, target_invitation_id || ':' || decision_status)
    ON CONFLICT ("dedupeKey") DO NOTHING;
  RETURN QUERY SELECT target_page.id, decision_status, decision_role;
END
$function$;

REVOKE ALL ON FUNCTION public.socialinsight_decide_page_invitation(text,text) FROM PUBLIC;
DO $acl$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT role.rolname FROM pg_catalog.pg_proc function
    CROSS JOIN LATERAL pg_catalog.aclexplode(function.proacl) privilege
    JOIN pg_catalog.pg_roles role ON role.oid = privilege.grantee
    WHERE function.oid = 'public.socialinsight_decide_page_invitation(text,text)'::regprocedure
      AND privilege.grantee <> function.proowner
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.socialinsight_decide_page_invitation(text,text) FROM %I', grantee_name);
  END LOOP;
END
$acl$;
GRANT EXECUTE ON FUNCTION public.socialinsight_decide_page_invitation(text,text) TO socialinsight_runtime;

RESET statement_timeout;
RESET lock_timeout;
