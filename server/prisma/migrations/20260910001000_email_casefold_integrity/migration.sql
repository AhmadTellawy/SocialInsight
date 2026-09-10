BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $$ BEGIN
 IF EXISTS (SELECT lower(email) FROM users WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1) THEN RAISE EXCEPTION 'Email case collisions require reviewed repair'; END IF;
END $$;
-- The existing users_email_lower_key (auth_security migration) already enforces this invariant.
DO $$ DECLARE r TEXT; BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE handle_aliases,security_email_outbox FROM %I',r);
 END LOOP;
END $$;
COMMIT;
