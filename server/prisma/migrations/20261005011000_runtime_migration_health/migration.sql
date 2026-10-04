-- Health must not require the runtime login to read migration names, checksums,
-- logs or to modify migration history. Expose only the existing failure count.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE FUNCTION public.socialinsight_failed_migration_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT count(*)::bigint FROM public."_prisma_migrations"
  WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
$function$;

REVOKE ALL ON FUNCTION public.socialinsight_failed_migration_count() FROM PUBLIC;
-- Hosted PostgreSQL can have default EXECUTE grants for provider API roles.
-- Remove those from this newly introduced helper; preserve only its owner.
DO $acl$
DECLARE
  grantee_name text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT role.rolname
    FROM pg_catalog.pg_proc function
    CROSS JOIN LATERAL pg_catalog.aclexplode(function.proacl) privilege
    JOIN pg_catalog.pg_roles role ON role.oid = privilege.grantee
    WHERE function.oid = 'public.socialinsight_failed_migration_count()'::regprocedure
      AND privilege.grantee <> function.proowner
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.socialinsight_failed_migration_count() FROM %I', grantee_name);
  END LOOP;
END
$acl$;
GRANT EXECUTE ON FUNCTION public.socialinsight_failed_migration_count() TO socialinsight_runtime;

RESET statement_timeout;
RESET lock_timeout;
