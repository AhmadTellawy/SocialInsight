-- Read-only PostgreSQL/Supabase permission inventory for PRIV-20-01.
-- Run with the same staging/production connection role used by migrations and
-- capture the output as restricted release evidence. This script changes no data.

BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database_name,
       current_user AS connected_role,
       session_user AS session_role,
       version() AS server_version;

SELECT rolname,
       rolsuper,
       rolinherit,
       rolcreaterole,
       rolcreatedb,
       rolcanlogin,
       rolbypassrls
FROM pg_roles
WHERE rolname IN (current_user, 'postgres', 'anon', 'authenticated', 'service_role')
ORDER BY rolname;

WITH inspected_roles AS (
  SELECT rolname FROM pg_roles
  WHERE rolname IN (current_user, 'anon', 'authenticated', 'service_role')
), inspected_schemas AS (
  SELECT nspname FROM pg_namespace
  WHERE nspname IN ('public', 'storage', 'auth')
)
SELECT r.rolname,
       s.nspname AS schema_name,
       has_schema_privilege(r.rolname, s.nspname, 'USAGE') AS can_use,
       has_schema_privilege(r.rolname, s.nspname, 'CREATE') AS can_create
FROM inspected_roles r CROSS JOIN inspected_schemas s
ORDER BY s.nspname, r.rolname;

SELECT table_schema,
       table_name,
       grantee,
       string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema IN ('public', 'storage', 'auth')
  AND grantee IN (current_user, 'PUBLIC', 'anon', 'authenticated', 'service_role')
GROUP BY table_schema, table_name, grantee
ORDER BY table_schema, table_name, grantee;

SELECT object_schema AS sequence_schema,
       object_name AS sequence_name,
       grantee,
       string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_usage_grants
WHERE object_type = 'SEQUENCE'
  AND object_schema IN ('public', 'storage', 'auth')
  AND grantee IN (current_user, 'PUBLIC', 'anon', 'authenticated', 'service_role')
GROUP BY object_schema, object_name, grantee
ORDER BY object_schema, object_name, grantee;

SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       c.relkind,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY n.nspname, c.relname;

SELECT schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual AS using_expression,
       with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'storage')
  AND p.prosecdef
ORDER BY n.nspname, p.proname;

SELECT pg_get_userbyid(d.defaclrole) AS owner,
       COALESCE(n.nspname, '*') AS schema_name,
       d.defaclobjtype AS object_type,
       d.defaclacl AS default_acl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY owner, schema_name, object_type;

-- A secure outcome for the application schema requires explicit evidence that
-- browser-facing roles cannot directly read or mutate private application
-- tables, new objects inherit reviewed defaults, and storage.objects policies
-- permit only the intended public bucket while denying private/original buckets.

ROLLBACK;
