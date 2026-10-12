-- Synchronous, rebuildable answer profiles. These contain option IDs and only
-- text-presence flags, never answer text or demographics. Every API request still
-- authorizes against live source rows before accessing these backend-only tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE public."Response", public."Answer" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public."AnalysisAnswerProfile" (
  id BIGSERIAL PRIMARY KEY,
  "postId" TEXT NOT NULL,
  "userId" TEXT,
  "userKey" TEXT GENERATED ALWAYS AS (COALESCE('u:' || "userId", 'g:')) STORED NOT NULL,
  "answerHash" BYTEA NOT NULL,
  answers JSONB NOT NULL CHECK (jsonb_typeof(answers)='array'),
  weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0),
  UNIQUE ("postId", "userKey", "answerHash")
);
CREATE TABLE public."AnalysisResponseProfile" (
  "responseId" TEXT PRIMARY KEY REFERENCES public."Response"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "profileId" BIGINT NOT NULL REFERENCES public."AnalysisAnswerProfile"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AnalysisResponseProfile_profileId_idx" ON public."AnalysisResponseProfile"("profileId");
ALTER TABLE public."AnalysisAnswerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AnalysisAnswerProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."AnalysisResponseProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AnalysisResponseProfile" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public."AnalysisAnswerProfile", public."AnalysisResponseProfile" FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON public."AnalysisAnswerProfile", public."AnalysisResponseProfile" TO socialinsight_runtime;
REVOKE ALL ON SEQUENCE public."AnalysisAnswerProfile_id_seq" FROM PUBLIC;
GRANT USAGE,SELECT ON SEQUENCE public."AnalysisAnswerProfile_id_seq" TO socialinsight_runtime;
CREATE POLICY analysis_answer_profile_backend ON public."AnalysisAnswerProfile" TO socialinsight_runtime USING(true) WITH CHECK(true);
CREATE POLICY analysis_response_profile_backend ON public."AnalysisResponseProfile" TO socialinsight_runtime USING(true) WITH CHECK(true);

CREATE FUNCTION public.socialinsight_analysis_profile_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
BEGIN
  -- A digest collision must abort the write, never combine different answers.
  IF (OLD."postId",OLD."userId",OLD."answerHash",OLD.answers) IS DISTINCT FROM
     (NEW."postId",NEW."userId",NEW."answerHash",NEW.answers) THEN
    RAISE EXCEPTION 'Analysis profile identity mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $body$;
CREATE TRIGGER analysis_profile_identity BEFORE UPDATE ON public."AnalysisAnswerProfile"
FOR EACH ROW EXECUTE FUNCTION public.socialinsight_analysis_profile_identity();

CREATE FUNCTION public.socialinsight_analysis_profile_weights() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
DECLARE source_sql TEXT; item RECORD; touched BIGINT[] := ARRAY[]::bigint[];
BEGIN
  source_sql := CASE TG_OP
    WHEN 'INSERT' THEN 'SELECT "profileId",1 AS delta FROM new_maps'
    WHEN 'DELETE' THEN 'SELECT "profileId",-1 AS delta FROM old_maps'
    ELSE 'SELECT "profileId",1 AS delta FROM new_maps UNION ALL SELECT "profileId",-1 AS delta FROM old_maps' END;
  FOR item IN EXECUTE 'SELECT "profileId",sum(delta)::int AS delta FROM (' || source_sql || ') s GROUP BY "profileId" HAVING sum(delta)<>0 ORDER BY "profileId"'
  LOOP
    UPDATE public."AnalysisAnswerProfile" SET weight=weight+item.delta WHERE id=item."profileId";
    IF NOT FOUND THEN RAISE EXCEPTION 'Analysis profile missing' USING ERRCODE='23503'; END IF;
    touched := array_append(touched,item."profileId");
  END LOOP;
  -- UPSERT invokes UPDATE and INSERT statement triggers separately. A bucket
  -- temporarily at zero must survive when newly inserted maps still reference it.
  DELETE FROM public."AnalysisAnswerProfile" p WHERE p.id=ANY(touched) AND p.weight=0
    AND NOT EXISTS (SELECT 1 FROM public."AnalysisResponseProfile" m WHERE m."profileId"=p.id);
  RETURN NULL;
END $body$;
CREATE TRIGGER analysis_profile_map_insert AFTER INSERT ON public."AnalysisResponseProfile" REFERENCING NEW TABLE AS new_maps FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_profile_weights();
CREATE TRIGGER analysis_profile_map_update AFTER UPDATE ON public."AnalysisResponseProfile" REFERENCING OLD TABLE AS old_maps NEW TABLE AS new_maps FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_profile_weights();
CREATE TRIGGER analysis_profile_map_delete AFTER DELETE ON public."AnalysisResponseProfile" REFERENCING OLD TABLE AS old_maps FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_profile_weights();

CREATE FUNCTION public.socialinsight_refresh_analysis_profiles(response_ids TEXT[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
BEGIN
  IF COALESCE(cardinality(response_ids),0)=0 THEN RETURN; END IF;
  -- Serialize changes to the same response before taking the source snapshot.
  PERFORM id FROM public."Response" WHERE id=ANY(response_ids) ORDER BY id FOR UPDATE;
  WITH computed AS MATERIALIZED (
    SELECT r.id AS "responseId",r."postId",r."userId",COALESCE('u:'||r."userId",'g:') AS "userKey",
      a.answers,sha256(convert_to(a.answers::text,'UTF8')) AS "answerHash"
    FROM public."Response" r CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_array(a."questionId",a."optionId",CASE WHEN COALESCE(a."textValue",'')<>'' THEN '1' ELSE NULL END)
        ORDER BY a."questionId",a."optionId",CASE WHEN COALESCE(a."textValue",'')<>'' THEN '1' ELSE NULL END),'[]'::jsonb) AS answers
      FROM public."Answer" a WHERE a."responseId"=r.id
    ) a WHERE r.id=ANY(response_ids)
  ), buckets AS (
    INSERT INTO public."AnalysisAnswerProfile"("postId","userId","answerHash",answers)
      SELECT DISTINCT "postId","userId","answerHash",answers FROM computed ORDER BY "postId","userId","answerHash",answers
    ON CONFLICT ("postId","userKey","answerHash") DO UPDATE SET answers=EXCLUDED.answers
    RETURNING id,"postId","userKey","answerHash"
  )
  INSERT INTO public."AnalysisResponseProfile"("responseId","profileId")
    SELECT c."responseId",p.id FROM computed c JOIN buckets p USING("postId","userKey","answerHash")
  ON CONFLICT ("responseId") DO UPDATE SET "profileId"=EXCLUDED."profileId"
    WHERE "AnalysisResponseProfile"."profileId"<>EXCLUDED."profileId";
END $body$;

CREATE FUNCTION public.socialinsight_analysis_profile_refresh_trigger() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
DECLARE source_sql TEXT; id_column TEXT; ids TEXT[];
BEGIN
  IF TG_TABLE_NAME='Response' AND TG_OP='UPDATE' THEN
    SELECT array_agg(DISTINCT COALESCE(n.id,o.id)) INTO ids FROM new_rows n FULL JOIN old_rows o USING(id)
      WHERE n.id IS NULL OR o.id IS NULL OR (n."postId",n."userId") IS DISTINCT FROM (o."postId",o."userId");
    PERFORM public.socialinsight_refresh_analysis_profiles(ids);
    RETURN NULL;
  END IF;
  id_column := CASE TG_TABLE_NAME WHEN 'Response' THEN 'id' ELSE '"responseId"' END;
  source_sql := CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
    ELSE 'SELECT * FROM new_rows UNION ALL SELECT * FROM old_rows' END;
  EXECUTE 'SELECT array_agg(DISTINCT ' || id_column || ') FROM (' || source_sql || ') changed' INTO ids;
  PERFORM public.socialinsight_refresh_analysis_profiles(ids);
  RETURN NULL;
END $body$;

-- Response deletion is handled by the map FK; no orphan user or answer vector remains.
CREATE TRIGGER socialinsight_profile_insert AFTER INSERT ON public."Response" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_profile_refresh_trigger();
CREATE TRIGGER socialinsight_profile_update AFTER UPDATE ON public."Response" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_profile_refresh_trigger();
CREATE TRIGGER socialinsight_profile_insert AFTER INSERT ON public."Answer" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_profile_refresh_trigger();
CREATE TRIGGER socialinsight_profile_update AFTER UPDATE ON public."Answer" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_profile_refresh_trigger();
CREATE TRIGGER socialinsight_profile_delete AFTER DELETE ON public."Answer" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_profile_refresh_trigger();

REVOKE ALL ON FUNCTION public.socialinsight_analysis_profile_identity(),public.socialinsight_analysis_profile_weights(),public.socialinsight_refresh_analysis_profiles(TEXT[]),public.socialinsight_analysis_profile_refresh_trigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.socialinsight_analysis_profile_identity(),public.socialinsight_analysis_profile_weights(),public.socialinsight_refresh_analysis_profiles(TEXT[]),public.socialinsight_analysis_profile_refresh_trigger() TO socialinsight_runtime;

-- Managed installations may grant provider roles through default privileges;
-- plain PostgreSQL does not necessarily have these optional roles.
DO $body$ DECLARE recipient TEXT; BEGIN
  FOR recipient IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON public."AnalysisAnswerProfile",public."AnalysisResponseProfile" FROM %I',recipient);
    EXECUTE format('REVOKE ALL ON SEQUENCE public."AnalysisAnswerProfile_id_seq" FROM %I',recipient);
    EXECUTE format('REVOKE ALL ON FUNCTION public.socialinsight_analysis_profile_identity(),public.socialinsight_analysis_profile_weights(),public.socialinsight_refresh_analysis_profiles(TEXT[]),public.socialinsight_analysis_profile_refresh_trigger() FROM %I',recipient);
  END LOOP;
END $body$;

-- One atomic additive migration: no partially initialized projection is published.
DO $body$ DECLARE ids TEXT[]; BEGIN
  FOR ids IN SELECT array_agg(id) FROM (SELECT id,(row_number() OVER(ORDER BY id)-1)/5000 AS batch FROM public."Response") s GROUP BY batch ORDER BY batch
  LOOP PERFORM public.socialinsight_refresh_analysis_profiles(ids); END LOOP;
END $body$;
ANALYZE public."AnalysisAnswerProfile";
ANALYZE public."AnalysisResponseProfile";
COMMIT;
