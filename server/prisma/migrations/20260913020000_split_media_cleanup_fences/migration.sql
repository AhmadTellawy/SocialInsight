-- Separate the signed source-upload capability boundary from processing/public
-- object cleanup leases. Existing rows retain the most conservative boundary.
ALTER TABLE "MediaAsset"
ADD COLUMN "sourceCleanupNotBefore" TIMESTAMP(3);

UPDATE "MediaAsset"
SET "sourceCleanupNotBefore" = "storageCleanupNotBefore"
WHERE "uploadBucket" IS NOT NULL
  AND "uploadKey" IS NOT NULL;
