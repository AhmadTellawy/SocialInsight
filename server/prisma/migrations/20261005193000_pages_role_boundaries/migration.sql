-- Existing recipient/self-service journeys and aggregate analytics only.
-- No table grants, general audit visibility, or Page UPDATE policy expansion.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.socialinsight_page_transition_admissions
  DROP CONSTRAINT socialinsight_transition_kind_guard;
ALTER TABLE public.socialinsight_page_transition_admissions
  ADD CONSTRAINT socialinsight_transition_kind_guard
  CHECK (transition_kind IN ('INVITATION_ACCEPT','TRANSFER_ACCEPT','INVITATION_SAFETY','TEAM_LEAVE','TEAM_SAFETY'));

-- Preserve the entire previously reviewed trigger definition and insert only
-- transaction-bound safety/leave admissions. Fail closed if its anchor differs.
DO $guards$
DECLARE definition text; anchor text; replacement text;
BEGIN
  definition := replace(pg_catalog.pg_get_functiondef('public.socialinsight_enforce_page_sensitive_update()'::regprocedure),chr(13),'');
  anchor := E'    AND NOT (\n      NEW."publicationState"';
  IF (length(definition) - length(replace(definition,anchor,''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'PAGE_SENSITIVE_TRIGGER_BASELINE_CHANGED';
  END IF;
  replacement := E'    AND NOT (\n      NEW."publicationState" IS NOT DISTINCT FROM OLD."publicationState"\n      AND NEW."deletionRequestedAt" IS NOT DISTINCT FROM OLD."deletionRequestedAt"\n      AND EXISTS (SELECT 1 FROM public.socialinsight_page_transition_admissions admission\n        WHERE admission.backend_pid = pg_catalog.pg_backend_pid()\n          AND admission.transaction_id = pg_catalog.txid_current()\n          AND admission.page_id = OLD.id\n          AND admission.actor_id = public.socialinsight_context_user_id()\n          AND admission.transition_kind = ''TEAM_SAFETY'')\n    )\n    AND NOT (\n      NEW."publicationState"';
  EXECUTE replace(definition,anchor,replacement);
  definition := replace(pg_catalog.pg_get_functiondef('public.socialinsight_enforce_page_transfer_update()'::regprocedure),chr(13),'');
  anchor := E'IF NEW.status = ''WITHDRAWN''\n    AND NOT (NEW."senderId" = public.socialinsight_context_user_id()';
  IF (length(definition) - length(replace(definition,anchor,''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_TRIGGER_BASELINE_CHANGED';
  END IF;
  replacement := E'IF NEW.status = ''WITHDRAWN''\n    AND NOT (NEW."recipientId" = public.socialinsight_context_user_id() AND EXISTS (\n      SELECT 1 FROM public.socialinsight_page_transition_admissions admission\n      WHERE admission.backend_pid = pg_catalog.pg_backend_pid()\n        AND admission.transaction_id = pg_catalog.txid_current()\n        AND admission.page_id = NEW."pageId"\n        AND admission.actor_id = NEW."recipientId" AND admission.transition_kind = ''TEAM_LEAVE''))\n    AND NOT (NEW."senderId" = public.socialinsight_context_user_id()';
  EXECUTE replace(definition,anchor,replacement);
END
$guards$;

CREATE FUNCTION public.socialinsight_leave_page_team(target_page_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = off
AS $function$
DECLARE actor text := public.socialinsight_context_user_id(); target_page public."Page"%ROWTYPE; eligible boolean;
BEGIN
  SELECT * INTO target_page FROM public."Page" WHERE id=target_page_id FOR UPDATE;
  IF NOT FOUND OR actor IS NULL OR target_page."ownerId"=actor OR target_page."purgedAt" IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=actor AND status='ACTIVE')
    OR NOT EXISTS (SELECT 1 FROM public."PageMembership" WHERE "pageId"=target_page_id AND "userId"=actor) THEN
    RAISE EXCEPTION 'PAGE_TEAM_LEAVE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.socialinsight_page_transition_admissions (backend_pid,transaction_id,page_id,actor_id,transition_kind)
    VALUES (pg_backend_pid(),txid_current(),target_page_id,actor,'TEAM_LEAVE');
  UPDATE public."PageInvitation" SET status='WITHDRAWN',"decidedAt"=CURRENT_TIMESTAMP
    WHERE "pageId"=target_page_id AND "senderId"=actor AND status='PENDING';
  UPDATE public."PageOwnershipTransfer" SET status='WITHDRAWN',"decidedAt"=CURRENT_TIMESTAMP
    WHERE "pageId"=target_page_id AND "recipientId"=actor AND status='PENDING';
  DELETE FROM public."PageMembership" WHERE "pageId"=target_page_id AND "userId"=actor;
  INSERT INTO public."PageAuditEvent" (id,"pageId","actorId",action)
    VALUES (gen_random_uuid()::text,target_page_id,actor,'MEMBER_LEFT');
  eligible := EXISTS (SELECT 1 FROM public.users WHERE id=target_page."ownerId" AND status='ACTIVE')
    OR EXISTS (SELECT 1 FROM public."PageMembership" member JOIN public.users person ON person.id=member."userId"
      WHERE member."pageId"=target_page_id AND member.role IN ('ADMIN','EDITOR') AND person.status='ACTIVE');
  IF (NOT eligible AND target_page."safetyHiddenAt" IS NULL) OR (eligible AND target_page."safetyHiddenAt" IS NOT NULL) THEN
    INSERT INTO public.socialinsight_page_transition_admissions (backend_pid,transaction_id,page_id,actor_id,transition_kind)
      VALUES (pg_backend_pid(),txid_current(),target_page_id,actor,'TEAM_SAFETY');
    UPDATE public."Page" SET "safetyHiddenAt"=CASE WHEN eligible THEN NULL ELSE CURRENT_TIMESTAMP END,
      "updatedAt"=CURRENT_TIMESTAMP WHERE id=target_page_id;
    INSERT INTO public."PageAuditEvent" (id,"pageId","actorId",action)
      VALUES (gen_random_uuid()::text,target_page_id,NULL,CASE WHEN eligible THEN 'PAGE_SAFETY_RESTORED' ELSE 'PAGE_SAFETY_HIDDEN' END);
  END IF;
  DELETE FROM public.socialinsight_page_transition_admissions
    WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND page_id=target_page_id
      AND actor_id=actor AND transition_kind IN ('TEAM_LEAVE','TEAM_SAFETY');
  RETURN true;
END
$function$;

CREATE FUNCTION public.socialinsight_decide_page_transfer(target_transfer_id text, decision text)
RETURNS TABLE(page_id text,decided_status text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = off
AS $function$
DECLARE actor text := public.socialinsight_context_user_id(); transfer public."PageOwnershipTransfer"%ROWTYPE;
  target_page public."Page"%ROWTYPE; decision_status text;
BEGIN
  IF actor IS NULL OR decision IS NULL OR decision NOT IN ('accept','reject') THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_DECISION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT * INTO transfer FROM public."PageOwnershipTransfer" WHERE id=target_transfer_id FOR UPDATE;
  IF NOT FOUND OR transfer."recipientId"<>actor OR transfer.status<>'PENDING'
    OR transfer."expiresAt"<=CURRENT_TIMESTAMP
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=actor AND status='ACTIVE' AND email_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_DECISION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT * INTO target_page FROM public."Page" WHERE id=transfer."pageId" FOR UPDATE;
  IF NOT FOUND OR target_page."purgedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'PAGE_TRANSFER_DECISION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF decision='accept' THEN
    -- Serialize the recipient's owned-Page quota across different transfers.
    PERFORM id FROM public.users WHERE id=actor FOR UPDATE;
    PERFORM * FROM public.socialinsight_accept_page_transfer(target_transfer_id);
    decision_status := 'ACCEPTED';
    UPDATE public."PageInvitation" SET status='WITHDRAWN',"decidedAt"=CURRENT_TIMESTAMP
      WHERE "pageId"=target_page.id AND "senderId"=transfer."senderId" AND role='ADMIN' AND status='PENDING';
  ELSE
    decision_status := 'REJECTED';
    UPDATE public."PageOwnershipTransfer" SET status='REJECTED',"decidedAt"=CURRENT_TIMESTAMP WHERE id=target_transfer_id;
  END IF;
  INSERT INTO public."PageAuditEvent" (id,"pageId","actorId",action,"targetId")
    VALUES (gen_random_uuid()::text,target_page.id,actor,'OWNERSHIP_TRANSFER_'||decision_status,target_transfer_id);
  INSERT INTO public."PageEvent" (id,"pageId","recipientId",kind,"targetId","dedupeKey")
    SELECT gen_random_uuid()::text,target_page.id,recipient,'PAGE_TRANSFER_'||decision_status,target_page.id,
      target_transfer_id||':'||decision_status||':'||recipient
    FROM (SELECT DISTINCT unnest(ARRAY[transfer."senderId",transfer."recipientId"]) AS recipient) recipients
    ON CONFLICT ("dedupeKey") DO NOTHING;
  RETURN QUERY SELECT target_page.id,decision_status;
END
$function$;

CREATE FUNCTION public.socialinsight_page_follower_change(target_page_id text, period_days integer)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = off
AS $function$
BEGIN
  IF period_days IS NULL OR period_days NOT IN (7,30) OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id=public.socialinsight_context_user_id() AND status='ACTIVE'
  ) OR NOT public.socialinsight_page_actor_has_role(target_page_id,ARRAY['OWNER','ADMIN','EDITOR','ANALYST']) THEN
    RAISE EXCEPTION 'PAGE_ANALYTICS_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT coalesce(sum((data->>'delta')::integer),0)::bigint FROM public."PageAuditEvent"
    WHERE "pageId"=target_page_id AND action='FOLLOW_CHANGED'
      AND "createdAt">=CURRENT_TIMESTAMP-pg_catalog.make_interval(days=>period_days));
END
$function$;

-- Remove PUBLIC and provider default function grants; runtime only.
DO $acl$
DECLARE signature text; grantee_name text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.socialinsight_leave_page_team(text)',
    'public.socialinsight_decide_page_transfer(text,text)','public.socialinsight_page_follower_change(text,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
    FOR grantee_name IN SELECT DISTINCT role.rolname FROM pg_proc function
      CROSS JOIN LATERAL aclexplode(function.proacl) privilege JOIN pg_roles role ON role.oid=privilege.grantee
      WHERE function.oid=signature::regprocedure AND privilege.grantee<>function.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,grantee_name);
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO socialinsight_runtime',signature);
  END LOOP;
END
$acl$;
RESET statement_timeout;
RESET lock_timeout;
