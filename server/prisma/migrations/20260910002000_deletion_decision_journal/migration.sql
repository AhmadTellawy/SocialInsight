BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "deletion_decisions" (
  "id" TEXT NOT NULL,
  "subject_kind" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "action_version" INTEGER NOT NULL DEFAULT 1,
  "resource_pointers" JSONB NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deletion_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deletion_decisions_scope_check" CHECK (
    ("subject_kind" = 'ACCOUNT' AND "action" = 'ACCOUNT_ERASE') OR
    ("subject_kind" = 'MEDIA' AND "action" = 'MEDIA_PURGE')
  ),
  CONSTRAINT "deletion_decisions_version_check" CHECK ("action_version" = 1),
  CONSTRAINT "deletion_decisions_pointers_check" CHECK (jsonb_typeof("resource_pointers") = 'object'),
  CONSTRAINT "deletion_decisions_subject_check" CHECK (length("subject_id") BETWEEN 1 AND 128)
);
CREATE INDEX "deletion_decisions_subject_id_idx" ON "deletion_decisions"("subject_id");
CREATE INDEX "deletion_decisions_recorded_at_id_idx" ON "deletion_decisions"("recorded_at", "id");
ALTER TABLE "deletion_decisions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "deletion_decisions" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "deletion_decisions" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "deletion_decisions" FROM authenticated;
  END IF;
END $$;

-- Runtime INSERT/SELECT and operational export permissions are provisioned
-- separately for the verified role. UPDATE/DELETE are not runtime privileges.
-- No time-based purge can safely infer the expiry of independently held backups.
COMMIT;
