-- Additive OTP/Resend security storage only. Existing OTPCode and
-- Existing OTPCode and legacy PendingRegistration OTP columns remain untouched
-- for safe application rollback. One nullable capability hash is added.

ALTER TABLE "PendingRegistration"
  ADD COLUMN IF NOT EXISTS "registration_secret_hash" CHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PendingRegistration_registration_secret_hash_check'
  ) THEN
    ALTER TABLE "PendingRegistration"
      ADD CONSTRAINT "PendingRegistration_registration_secret_hash_check"
      CHECK ("registration_secret_hash" IS NULL OR char_length("registration_secret_hash") = 64);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "otp_challenges" (
  "id" TEXT NOT NULL,
  "destination_hash" CHAR(64) NOT NULL,
  "purpose" VARCHAR(64) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "code_hash" VARCHAR(255) NOT NULL,
  "delivery_status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "cooldown_until" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "consumed_at" TIMESTAMP(3),
  "invalidated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "otp_challenges_destination_hash_check" CHECK (char_length("destination_hash") = 64),
  CONSTRAINT "otp_challenges_purpose_check" CHECK (char_length(btrim("purpose")) > 0),
  CONSTRAINT "otp_challenges_subject_check" CHECK (char_length(btrim("subject")) > 0),
  CONSTRAINT "otp_challenges_code_hash_check" CHECK (char_length(btrim("code_hash")) > 0),
  CONSTRAINT "otp_challenges_delivery_status_check" CHECK ("delivery_status" IN ('PENDING', 'SENT', 'FAILED')),
  CONSTRAINT "otp_challenges_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" > 0 AND "attempts" <= "max_attempts"),
  CONSTRAINT "otp_challenges_version_check" CHECK ("version" > 0),
  CONSTRAINT "otp_challenges_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "otp_challenges_cooldown_check" CHECK ("cooldown_until" >= "created_at" AND "cooldown_until" <= "expires_at"),
  CONSTRAINT "otp_challenges_terminal_state_check" CHECK (NOT ("consumed_at" IS NOT NULL AND "invalidated_at" IS NOT NULL)),
  CONSTRAINT "otp_challenges_consumed_check" CHECK ("consumed_at" IS NULL OR "consumed_at" >= "created_at"),
  CONSTRAINT "otp_challenges_invalidated_check" CHECK ("invalidated_at" IS NULL OR "invalidated_at" >= "created_at"),
  CONSTRAINT "otp_challenges_failed_delivery_check" CHECK ("delivery_status" <> 'FAILED' OR "invalidated_at" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "otp_challenges_destination_purpose_subject_version_key"
  ON "otp_challenges"("destination_hash", "purpose", "subject", "version");
CREATE INDEX IF NOT EXISTS "otp_challenges_destination_purpose_version_idx"
  ON "otp_challenges"("destination_hash", "purpose", "version" DESC);
CREATE INDEX IF NOT EXISTS "otp_challenges_subject_purpose_version_idx"
  ON "otp_challenges"("subject", "purpose", "version" DESC);
CREATE INDEX IF NOT EXISTS "otp_challenges_expires_idx" ON "otp_challenges"("expires_at");

-- Browser-facing roles remain denied. A dedicated NOBYPASSRLS backend role may
-- use the policy below only after receiving explicit table privileges.
ALTER TABLE "otp_challenges" ENABLE ROW LEVEL SECURITY;

-- RLS remains effective for a dedicated NOBYPASSRLS backend role. Access is
-- still fail-closed at the PostgreSQL ACL layer: only roles explicitly granted
-- table privileges can use this policy, while browser-facing roles are revoked
-- below.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'otp_challenges'
      AND policyname = 'otp_challenges_backend_acl'
  ) THEN
    CREATE POLICY "otp_challenges_backend_acl"
      ON "otp_challenges"
      FOR ALL
      TO PUBLIC
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

DO $$
DECLARE target_role TEXT;
BEGIN
  FOR target_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I', 'public', 'otp_challenges', target_role);
  END LOOP;
END
$$;
