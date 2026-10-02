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

SELECT pg_catalog.format(
  'CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_login'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'runtime_login'
)
\gexec

SELECT pg_catalog.format(
  'ALTER ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
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
)::int AS runtime_login_properties_valid
\gset

\if :runtime_login_properties_valid
\else
  \echo 'runtime login property or membership verification failed'
  \quit 6
\endif

\echo 'Enter the protected runtime password. It will not be echoed.'
\password :runtime_login
\echo 'Runtime login provisioned; update the protected DATABASE_URL secret through the authorized provider path.'
