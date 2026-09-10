ALTER TABLE "users"
  ADD COLUMN "search_visibility" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allow_sharing" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "group_invites" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "deactivated_at" TIMESTAMP(3);
ALTER TABLE "users" ADD CONSTRAINT "users_theme_check" CHECK ("theme" IN ('system','light','dark'));
ALTER TABLE "auth_sessions" ADD COLUMN "recent_authenticated_at" TIMESTAMP(3), ADD COLUMN "device_label" TEXT;
-- Preserve the actual authentication age of sessions issued before upgrade.
-- Migration time is not fresh proof of the account holder's identity.
UPDATE "auth_sessions" SET "recent_authenticated_at" = "created_at";
ALTER TABLE "auth_sessions" ALTER COLUMN "recent_authenticated_at" SET NOT NULL,
  ALTER COLUMN "recent_authenticated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TYPE "OAuthStateMode" ADD VALUE IF NOT EXISTS 'REAUTH';
ALTER TABLE "oauth_states" ADD COLUMN "session_id" TEXT;
ALTER TABLE "oauth_states" DROP CONSTRAINT "oauth_states_mode_link_check";
-- Compare textual enum values so adding REAUTH is safe in the same migration.
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_mode_link_check" CHECK (
  ("mode"::text = 'LOGIN' AND "linking_user_id" IS NULL AND "session_id" IS NULL)
  OR ("mode"::text = 'LINK' AND "linking_user_id" IS NOT NULL)
  OR ("mode"::text = 'REAUTH' AND "linking_user_id" IS NOT NULL AND "session_id" IS NOT NULL)
);
CREATE TABLE "user_mfa" (
  "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "encrypted_secret" TEXT, "enabled_at" TIMESTAMP(3), "pending_secret" TEXT,
  "pending_session_id" TEXT, "pending_expires_at" TIMESTAMP(3), "last_accepted_step" BIGINT,
  "recovery_code_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "auth_challenges" (
  "id" TEXT PRIMARY KEY, "token_hash" CHAR(64) NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "cookie_binding_hash" CHAR(64) NOT NULL, "purpose" TEXT NOT NULL, "session_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "auth_challenges_token_hash_key" ON "auth_challenges"("token_hash");
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges"("expires_at");
CREATE TABLE "account_cleanup_jobs" (
  "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "media_ids" TEXT[] NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "account_cleanup_jobs_user_id_key" ON "account_cleanup_jobs"("user_id");
ALTER TABLE "user_mfa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_cleanup_jobs" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE target_role TEXT; target_table TEXT;
BEGIN
  FOR target_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    FOREACH target_table IN ARRAY ARRAY['user_mfa','auth_challenges','account_cleanup_jobs'] LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', target_table, target_role);
    END LOOP;
  END LOOP;
END $$;
