-- Additive authentication-security foundation.
-- Legacy "OTPCode" and "PendingRegistration" storage is retained for compatibility.
-- Before production rollout, verify the backend database role owns these tables or
-- has BYPASSRLS; this migration intentionally creates no client-facing RLS policy.
-- If the application has not written to these tables, rollback can drop the four
-- new tables and two enum types. After writes begin, prefer a reviewed forward-fix
-- so session, OAuth-link, and OTP audit evidence is not discarded.

CREATE TYPE "OAuthStateMode" AS ENUM ('LOGIN', 'LINK');
CREATE TYPE "OtpDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- A pending registration is a capability, not an email-address lookup. Allow
-- independent attempts for the same address and bind each attempt to a secret
-- browser cookie so knowing an email never reveals or overwrites another flow.
ALTER TABLE "PendingRegistration" ADD COLUMN "browserSecretHash" CHAR(64);
DROP INDEX IF EXISTS "PendingRegistration_email_key";
CREATE INDEX "PendingRegistration_email_idx" ON "PendingRegistration"("email");
ALTER TABLE "users" ADD COLUMN "auth_invalidated_at" TIMESTAMP(3);

CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "csrf_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "auth_sessions_revoked_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at"),
  CONSTRAINT "auth_sessions_last_used_check" CHECK ("last_used_at" IS NULL OR "last_used_at" >= "created_at")
);

CREATE TABLE "oauth_accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "provider_account_id" VARCHAR(255) NOT NULL,
  "email_snapshot" VARCHAR(320),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oauth_accounts_provider_check" CHECK (char_length(btrim("provider")) > 0),
  CONSTRAINT "oauth_accounts_provider_account_check" CHECK (char_length(btrim("provider_account_id")) > 0)
);

CREATE TABLE "oauth_states" (
  "id" TEXT NOT NULL,
  "state_hash" CHAR(64) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "pkce_verifier" VARCHAR(128) NOT NULL,
  "nonce" VARCHAR(255) NOT NULL,
  "mode" "OAuthStateMode" NOT NULL DEFAULT 'LOGIN',
  "linking_user_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oauth_states_provider_check" CHECK (char_length(btrim("provider")) > 0),
  CONSTRAINT "oauth_states_pkce_verifier_check" CHECK (char_length("pkce_verifier") BETWEEN 43 AND 128),
  CONSTRAINT "oauth_states_nonce_check" CHECK (char_length(btrim("nonce")) > 0),
  CONSTRAINT "oauth_states_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "oauth_states_consumed_check" CHECK ("consumed_at" IS NULL OR "consumed_at" >= "created_at"),
  CONSTRAINT "oauth_states_mode_link_check" CHECK (
    ("mode" = 'LOGIN' AND "linking_user_id" IS NULL)
    OR ("mode" = 'LINK' AND "linking_user_id" IS NOT NULL)
  )
);

CREATE TABLE "otp_challenges" (
  "id" TEXT NOT NULL,
  "destination" VARCHAR(320) NOT NULL,
  "destination_hash" CHAR(64) NOT NULL,
  "purpose" VARCHAR(64) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "code_hash" VARCHAR(255) NOT NULL,
  "delivery_status" "OtpDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "cooldown_until" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "consumed_at" TIMESTAMP(3),
  "invalidated_at" TIMESTAMP(3),
  "ip_hash" CHAR(64),
  "user_agent_hash" CHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "otp_challenges_destination_check" CHECK (char_length(btrim("destination")) > 0),
  CONSTRAINT "otp_challenges_purpose_check" CHECK (char_length(btrim("purpose")) > 0),
  CONSTRAINT "otp_challenges_subject_check" CHECK (char_length(btrim("subject")) > 0),
  CONSTRAINT "otp_challenges_code_hash_check" CHECK (char_length(btrim("code_hash")) > 0),
  CONSTRAINT "otp_challenges_attempts_check" CHECK (
    "attempts" >= 0 AND "max_attempts" > 0 AND "attempts" <= "max_attempts"
  ),
  CONSTRAINT "otp_challenges_version_check" CHECK ("version" > 0),
  CONSTRAINT "otp_challenges_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "otp_challenges_cooldown_check" CHECK (
    "cooldown_until" >= "created_at" AND "cooldown_until" <= "expires_at"
  ),
  CONSTRAINT "otp_challenges_terminal_state_check" CHECK (
    NOT ("consumed_at" IS NOT NULL AND "invalidated_at" IS NOT NULL)
  ),
  CONSTRAINT "otp_challenges_consumed_check" CHECK ("consumed_at" IS NULL OR "consumed_at" >= "created_at"),
  CONSTRAINT "otp_challenges_invalidated_check" CHECK ("invalidated_at" IS NULL OR "invalidated_at" >= "created_at"),
  CONSTRAINT "otp_challenges_failed_delivery_check" CHECK (
    "delivery_status" <> 'FAILED' OR "invalidated_at" IS NOT NULL
  )
);

CREATE TABLE "auth_rate_limits" (
  "key_hash" CHAR(64) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "window_started_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key_hash"),
  CONSTRAINT "auth_rate_limits_count_check" CHECK ("count" > 0),
  CONSTRAINT "auth_rate_limits_expiry_check" CHECK ("expires_at" > "window_started_at")
);

CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_user_revoked_expires_idx" ON "auth_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions"("expires_at");

CREATE UNIQUE INDEX "oauth_accounts_provider_account_key" ON "oauth_accounts"("provider", "provider_account_id");
CREATE UNIQUE INDEX "oauth_accounts_user_provider_key" ON "oauth_accounts"("user_id", "provider");

-- The application normalizes email addresses before writes. Enforce the same
-- invariant in PostgreSQL so concurrent requests cannot create case variants.
-- Production preflight on 2026-09-04 found zero lower(email) collisions.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users"(lower("email")) WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX "oauth_states_state_hash_key" ON "oauth_states"("state_hash");
CREATE INDEX "oauth_states_provider_expires_idx" ON "oauth_states"("provider", "expires_at");
CREATE INDEX "oauth_states_linking_user_consumed_idx" ON "oauth_states"("linking_user_id", "consumed_at");
CREATE INDEX "oauth_states_expires_idx" ON "oauth_states"("expires_at");

CREATE UNIQUE INDEX "otp_challenges_destination_purpose_subject_version_key"
  ON "otp_challenges"("destination_hash", "purpose", "subject", "version");
CREATE INDEX "otp_challenges_destination_purpose_created_idx"
  ON "otp_challenges"("destination_hash", "purpose", "created_at" DESC);
CREATE INDEX "otp_challenges_subject_purpose_created_idx"
  ON "otp_challenges"("subject", "purpose", "created_at" DESC);
CREATE INDEX "otp_challenges_delivery_created_idx"
  ON "otp_challenges"("delivery_status", "created_at");
CREATE INDEX "otp_challenges_expires_idx" ON "otp_challenges"("expires_at");
CREATE INDEX "auth_rate_limits_expires_idx" ON "auth_rate_limits"("expires_at");

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_accounts"
  ADD CONSTRAINT "oauth_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_states"
  ADD CONSTRAINT "oauth_states_linking_user_id_fkey"
  FOREIGN KEY ("linking_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS blocks direct PostgREST access. Table owners and roles with BYPASSRLS keep
-- their normal PostgreSQL behavior because FORCE ROW LEVEL SECURITY is not used.
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otp_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "OTPCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "PendingRegistration" ENABLE ROW LEVEL SECURITY;

-- Supabase installations normally expose anon/authenticated roles, while plain
-- PostgreSQL installations may not. Revoke only roles that actually exist and do
-- not alter grants belonging to the owner, migration role, or backend role.
DO $$
DECLARE
  target_role TEXT;
  target_table TEXT;
BEGIN
  FOR target_role IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    FOREACH target_table IN ARRAY ARRAY[
      'auth_sessions',
      'oauth_accounts',
      'oauth_states',
      'otp_challenges',
      'auth_rate_limits',
      'OTPCode',
      'PendingRegistration'
    ]
    LOOP
      IF to_regclass(format('%I.%I', 'public', target_table)) IS NOT NULL THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I',
          'public',
          target_table,
          target_role
        );
      END IF;
    END LOOP;
  END LOOP;
END
$$;
