-- Supabase installs pgcrypto in extensions; disposable PostgreSQL defaults to
-- public. Preserve the signed-context implementation and its ACL/owner/locked
-- search_path, qualifying hmac with the actual extension namespace instead of
-- moving the extension or introducing a publicly callable signing wrapper.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $crypto_namespace$
DECLARE
  crypto_schema text;
  definition text;
  original_call constant text := 'public.hmac(';
  qualified_call text;
BEGIN
  SELECT namespace.nspname INTO STRICT crypto_schema
  FROM pg_catalog.pg_extension extension
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto';

  qualified_call := pg_catalog.format('%I.hmac(', crypto_schema);
  definition := pg_catalog.pg_get_functiondef('public.socialinsight_context_claim()'::regprocedure);

  IF length(definition) - length(replace(definition, original_call, '')) = length(original_call) THEN
    IF qualified_call <> original_call THEN
      EXECUTE replace(definition, original_call, qualified_call);
    END IF;
  ELSIF qualified_call <> original_call
    AND length(definition) - length(replace(definition, qualified_call, '')) = length(qualified_call) THEN
    -- Safe operator retry after the same namespace binding was already applied.
    NULL;
  ELSE
    RAISE EXCEPTION 'PAGES_CRYPTO_NAMESPACE_UNEXPECTED_CONTEXT_IMPLEMENTATION';
  END IF;
END
$crypto_namespace$;

RESET statement_timeout;
RESET lock_timeout;
