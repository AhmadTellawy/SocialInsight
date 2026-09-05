-- Additive, PII-free lifetime budget. No automatic reset or retention.
-- Older servers ignore this table; rollback leaves it and its row intact.
CREATE TABLE IF NOT EXISTS "staging_otp_email_reservation" (
  "slot" INTEGER NOT NULL DEFAULT 1,
  "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staging_otp_email_reservation_pkey" PRIMARY KEY ("slot"),
  CONSTRAINT "staging_otp_email_reservation_singleton" CHECK ("slot" = 1)
);

REVOKE ALL PRIVILEGES ON TABLE "staging_otp_email_reservation" FROM PUBLIC;
ALTER TABLE "staging_otp_email_reservation" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'staging_otp_email_reservation' AND policyname = 'staging_budget_read') THEN
    CREATE POLICY "staging_budget_read" ON "staging_otp_email_reservation"
      FOR SELECT TO PUBLIC USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'staging_otp_email_reservation' AND policyname = 'staging_budget_reserve') THEN
    CREATE POLICY "staging_budget_reserve" ON "staging_otp_email_reservation"
      FOR INSERT TO PUBLIC WITH CHECK ("slot" = 1);
  END IF;
END
$$;

-- Grant only SELECT/INSERT to the dedicated backend role during provisioning.
-- No UPDATE/DELETE policy: even accidental CRUD grants cannot release a slot.
DO $$
DECLARE target_role TEXT;
BEGIN
  FOR target_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I',
      'public', 'staging_otp_email_reservation', target_role);
  END LOOP;
END
$$;
