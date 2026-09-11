-- Fixed metadata assertions only. No application rows, DDL, migration, role change, or backend cancellation.
BEGIN READ ONLY;
DO $transport$
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR current_setting('transaction_read_only') IS DISTINCT FROM 'on'
     OR current_setting('default_transaction_read_only') IS DISTINCT FROM 'on'
     OR current_setting('TimeZone') IS DISTINCT FROM 'UTC'
     OR current_setting('lock_timeout')::interval IS DISTINCT FROM interval '5 seconds'
     OR current_setting('statement_timeout')::interval IS DISTINCT FROM interval '120 seconds'
     OR current_setting('application_name') IS DISTINCT FROM '__INVOCATION_TAG__'
     OR (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'TRANSPORT_ASSERTION_FAILED';
  END IF;
END
$transport$;
ROLLBACK;
