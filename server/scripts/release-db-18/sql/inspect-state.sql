-- Read-only operator investigation after FAILED_OR_UNKNOWN. Never marks a run safe to retry.
-- Establish the same verified target/TLS/UTC/bounds contract first.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database() AS database_name, current_user AS database_role,
 current_setting('TimeZone') AS timezone, current_setting('lock_timeout') AS lock_timeout,
 current_setting('statement_timeout') AS statement_timeout,
 (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS database_tls;
SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
 rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count
FROM public._prisma_migrations ORDER BY migration_name,started_at,id;
SELECT count(*) AS invalid_indexes FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready);
SELECT count(*) AS unvalidated_constraints FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated;
SELECT count(*) AS other_active_connections FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle';
ROLLBACK;
