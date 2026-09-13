-- Add explicit OTP hash and intent versions without invalidating unexpired
-- version-1 challenges. New challenges are written as version 2; version 1
-- remains verification-only until its existing expiry time.
ALTER TABLE "otp_challenges"
    ADD COLUMN "hash_version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "intent_version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "source_destination_hash" CHAR(64);

ALTER TABLE "otp_challenges"
    ADD CONSTRAINT "otp_challenges_hash_version_check" CHECK ("hash_version" IN (1, 2)),
    ADD CONSTRAINT "otp_challenges_intent_version_check" CHECK ("intent_version" > 0);

CREATE INDEX "otp_challenges_subject_purpose_intent_idx"
    ON "otp_challenges"("subject", "purpose", "intent_version" DESC);
