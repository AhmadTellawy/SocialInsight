-- Provision the LOGIN principal used by the application without placing a
-- password in this file, shell history, process arguments, or psql variables.
--
-- Usage from a protected administrator session:
--   psql "$DIRECT_URL" --set=runtime_login=socialinsight_app \
--     --file=server/scripts/provision-pages-runtime-role.sql
--
-- psql's \password command prompts twice without echoing the value and sends
-- the generated ALTER ROLE command without logging the cleartext password.

\set ON_ERROR_STOP on

\if :{?runtime_login}
\else
  \echo 'runtime_login is required (example: --set=runtime_login=socialinsight_app)'
  \quit 3
\endif

SELECT (:'runtime_login' ~ '^[a-z][a-z0-9_]{2,62}$')::int AS runtime_login_valid
\gset

\if :runtime_login_valid
\else
  \echo 'runtime_login must match ^[a-z][a-z0-9_]{2,62}$'
  \quit 4
\endif

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'socialinsight_runtime'
) THEN 1 ELSE 0 END AS runtime_group_exists
\gset

\if :runtime_group_exists
\else
  \echo 'socialinsight_runtime is missing; apply the reviewed migration first'
  \quit 5
\endif

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'runtime_login'
) THEN 1 ELSE 0 END AS runtime_login_exists
\gset

\if :runtime_login_exists
  \echo 'Refusing to reuse an existing role; choose a fresh runtime_login or retire the old role through a separately reviewed change'
  \quit 6
\endif

SELECT pg_catalog.format(
  'CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_login'
)
\gexec

SELECT pg_catalog.format('GRANT socialinsight_runtime TO %I', :'runtime_login')
\gexec

SELECT pg_catalog.format('REVOKE CREATE ON SCHEMA public FROM %I', :'runtime_login')
\gexec

SELECT (
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = :'runtime_login'
      AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls
  )
  AND pg_catalog.pg_has_role(:'runtime_login', 'socialinsight_runtime', 'MEMBER')
  AND 1 = (
    SELECT count(*) FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member ON member.oid = membership.member
    WHERE member.rolname = :'runtime_login'
  )
  AND NOT pg_catalog.has_schema_privilege(:'runtime_login', 'public', 'CREATE')
  AND NOT pg_catalog.has_table_privilege(:'runtime_login', 'public._prisma_migrations',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT pg_catalog.has_table_privilege(:'runtime_login', 'public.socialinsight_page_context_keys',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class object
    JOIN pg_catalog.pg_roles owner ON owner.oid = object.relowner
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
    WHERE owner.rolname = :'runtime_login' AND namespace.nspname = 'public'
  )
)::int AS runtime_login_properties_valid
\gset

\if :runtime_login_properties_valid
\else
  \echo 'runtime login property or membership verification failed'
  \quit 7
\endif

\echo 'Enter the protected runtime password. It will not be echoed.'
\password :runtime_login
\echo 'Runtime login provisioned; update the protected DATABASE_URL secret through the authorized provider path.'
