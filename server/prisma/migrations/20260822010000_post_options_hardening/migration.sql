-- Additive report intake lifecycle. Existing reports intentionally keep a NULL
-- dedupe key so historical duplicate records are preserved.
ALTER TABLE "reports"
  ADD COLUMN "dedupe_key" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "target_snapshot" JSONB,
  ADD COLUMN "resolution_note" TEXT,
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "reports_dedupe_key_key" ON "reports"("dedupe_key");
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");
