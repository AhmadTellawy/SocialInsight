-- Statement-level revisions keep cache validity atomic with the original writes.
-- No answer/demographic content is copied; runtime authorization is still checked for every result request.
SET lock_timeout = '5s';
SET statement_timeout = '30s';
CREATE TABLE public."AnalysisRevision" (key TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0);
ALTER TABLE public."AnalysisRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AnalysisRevision" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public."AnalysisRevision" FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON public."AnalysisRevision" TO socialinsight_runtime;
CREATE POLICY socialinsight_revision_backend ON public."AnalysisRevision" FOR ALL TO socialinsight_runtime USING (true) WITH CHECK (true);
CREATE FUNCTION public.socialinsight_analysis_revision() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog,public AS $body$
DECLARE source_sql text; query_sql text; target text;
BEGIN
  source_sql := CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows' ELSE 'SELECT * FROM new_rows UNION ALL SELECT * FROM old_rows' END;
  query_sql := CASE TG_TABLE_NAME
    WHEN 'Response' THEN 'SELECT DISTINCT c."postId" FROM changed c'
    WHEN 'Answer' THEN 'SELECT DISTINCT r."postId" FROM changed c JOIN public."Response" r ON r.id=c."responseId"'
    WHEN 'Question' THEN 'SELECT DISTINCT COALESCE(c."postId",s."postId") FROM changed c LEFT JOIN public."Section" s ON s.id=c."sectionId"'
    WHEN 'Option' THEN 'SELECT DISTINCT COALESCE(q."postId",s."postId") FROM changed c JOIN public."Question" q ON q.id=c."questionId" LEFT JOIN public."Section" s ON s.id=q."sectionId"'
    WHEN 'Section' THEN 'SELECT DISTINCT c."postId" FROM changed c'
  END;
  FOR target IN EXECUTE 'WITH changed AS (' || source_sql || ') ' || query_sql || ' ORDER BY 1'
  LOOP
    IF target IS NOT NULL THEN
      INSERT INTO public."AnalysisRevision" (key,revision) VALUES ('post:'||target,1)
      ON CONFLICT (key) DO UPDATE SET revision="AnalysisRevision".revision+1;
    END IF;
  END LOOP;
  RETURN NULL;
END $body$;
REVOKE ALL ON FUNCTION public.socialinsight_analysis_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.socialinsight_analysis_revision() TO socialinsight_runtime;
CREATE TRIGGER socialinsight_analysis_insert AFTER INSERT ON public."Response" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_update AFTER UPDATE ON public."Response" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_delete AFTER DELETE ON public."Response" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_insert AFTER INSERT ON public."Answer" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_update AFTER UPDATE ON public."Answer" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_delete AFTER DELETE ON public."Answer" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_insert AFTER INSERT ON public."Question" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_update AFTER UPDATE ON public."Question" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_delete AFTER DELETE ON public."Question" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_insert AFTER INSERT ON public."Option" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_update AFTER UPDATE ON public."Option" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_delete AFTER DELETE ON public."Option" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_insert AFTER INSERT ON public."Section" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_update AFTER UPDATE ON public."Section" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();
CREATE TRIGGER socialinsight_analysis_delete AFTER DELETE ON public."Section" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_revision();

CREATE FUNCTION public.socialinsight_analysis_demographics_revision() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog,public AS $body$
DECLARE changed boolean;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='users' THEN
      SELECT EXISTS(SELECT 1 FROM new_rows n JOIN old_rows o USING(id) WHERE n.birthday IS DISTINCT FROM o.birthday OR n.country IS DISTINCT FROM o.country) INTO changed;
    ELSE
      SELECT EXISTS(SELECT 1 FROM new_rows n JOIN old_rows o USING(id) WHERE (to_jsonb(n)-'updated_at') IS DISTINCT FROM (to_jsonb(o)-'updated_at')) INTO changed;
    END IF;
  ELSIF TG_OP='INSERT' THEN SELECT EXISTS(SELECT 1 FROM new_rows) INTO changed;
  ELSE SELECT EXISTS(SELECT 1 FROM old_rows) INTO changed;
  END IF;
  IF changed THEN
    INSERT INTO public."AnalysisRevision"(key,revision) VALUES ('demographics',1)
      ON CONFLICT(key) DO UPDATE SET revision="AnalysisRevision".revision+1;
  END IF;
  RETURN NULL;
END $body$;
REVOKE ALL ON FUNCTION public.socialinsight_analysis_demographics_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.socialinsight_analysis_demographics_revision() TO socialinsight_runtime;
CREATE TRIGGER socialinsight_analysis_demo_insert AFTER INSERT ON public."users" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_demographics_revision();
CREATE TRIGGER socialinsight_analysis_demo_update AFTER UPDATE ON public."users" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_demographics_revision();
CREATE TRIGGER socialinsight_analysis_demo_delete AFTER DELETE ON public."users" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_demographics_revision();
CREATE TRIGGER socialinsight_analysis_demo_insert AFTER INSERT ON public."user_demographics" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_demographics_revision();
CREATE TRIGGER socialinsight_analysis_demo_update AFTER UPDATE ON public."user_demographics" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_demographics_revision();
CREATE TRIGGER socialinsight_analysis_demo_delete AFTER DELETE ON public."user_demographics" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_demographics_revision();
-- Erasure removes per-post revision metadata after dependent rows have been erased.
CREATE FUNCTION public.socialinsight_analysis_post_erasure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
BEGIN
  DELETE FROM public."AnalysisRevision" WHERE key IN (SELECT 'post:'||id FROM old_rows);
  RETURN NULL;
END $body$;
REVOKE ALL ON FUNCTION public.socialinsight_analysis_post_erasure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.socialinsight_analysis_post_erasure() TO socialinsight_runtime;
CREATE TRIGGER socialinsight_analysis_erasure AFTER DELETE ON public."Post" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.socialinsight_analysis_post_erasure();
RESET statement_timeout;
RESET lock_timeout;
