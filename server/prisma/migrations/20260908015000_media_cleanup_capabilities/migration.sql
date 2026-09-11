ALTER TABLE "MediaAsset" ADD COLUMN "storageCleanupNotBefore" TIMESTAMP(3);

-- Existing signed upload URLs can still be valid after account deletion.
-- Keep the source key in the durable cleanup ledger for at least their full
-- provider validity window from this upgrade; later cleanup removes it again.
UPDATE "MediaAsset"
SET "storageCleanupNotBefore" = CURRENT_TIMESTAMP + INTERVAL '2 hours'
WHERE "uploadKey" IS NOT NULL;
