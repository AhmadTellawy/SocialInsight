CREATE TABLE "VideoAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestKey" TEXT NOT NULL, "providerId" TEXT, "uploadUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'CREATING',
  "bytes" INTEGER NOT NULL CHECK ("bytes" > 0 AND "bytes" <= 157286400), "mime" TEXT NOT NULL,
  "duration" DOUBLE PRECISION, "width" INTEGER, "height" INTEGER, "errorCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoAsset_status_check" CHECK ("status" IN ('CREATING','UPLOADING','PROCESSING','READY','FAILED','PENDING_DELETE','DELETED')),
  CONSTRAINT "VideoAsset_ready_check" CHECK ("status" <> 'READY' OR ("providerId" IS NOT NULL AND "duration" IS NOT NULL AND "width" IS NOT NULL AND "height" IS NOT NULL AND "duration" > 0 AND "duration" <= 60 AND "width" > 0 AND "height" > 0))
);
CREATE UNIQUE INDEX "VideoAsset_providerId_key" ON "VideoAsset"("providerId");
CREATE UNIQUE INDEX "VideoAsset_ownerId_requestKey_key" ON "VideoAsset"("ownerId", "requestKey");
CREATE INDEX "VideoAsset_status_updatedAt_idx" ON "VideoAsset"("status", "updatedAt");
ALTER TABLE "Post" ADD COLUMN "presentationFormat" TEXT NOT NULL DEFAULT 'STANDARD', ADD COLUMN "videoAssetId" TEXT;
CREATE UNIQUE INDEX "Post_videoAssetId_key" ON "Post"("videoAssetId");
ALTER TABLE "Post" ADD CONSTRAINT "Post_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "VideoAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_reel_video_check" CHECK (("presentationFormat" = 'STANDARD' AND "videoAssetId" IS NULL) OR ("presentationFormat" = 'REEL' AND "videoAssetId" IS NOT NULL));
CREATE INDEX "Post_reels_feed_idx" ON "Post"("createdAt" DESC, "id" DESC) WHERE "presentationFormat" = 'REEL' AND "status" = 'PUBLISHED' AND "isDeleted" = FALSE;
ALTER TABLE "Response" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "VideoAsset" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "VideoAsset" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "VideoAsset" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "VideoAsset" FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'socialinsight_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "VideoAsset" TO socialinsight_runtime;
    CREATE POLICY video_api_only ON "VideoAsset" TO socialinsight_runtime USING (TRUE) WITH CHECK (TRUE);
  END IF;
END $$;
