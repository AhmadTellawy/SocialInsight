-- Additive media foundation. Legacy image columns remain during compatibility and backfill.

CREATE TYPE "MediaPurpose" AS ENUM ('POST', 'PROFILE_AVATAR', 'GROUP_IMAGE', 'QUESTION_IMAGE', 'OPTION_IMAGE');
CREATE TYPE "MediaStatus" AS ENUM ('TEMPORARY', 'PROCESSING', 'READY', 'ATTACHED', 'PENDING_DELETE', 'DELETED', 'FAILED');
CREATE TYPE "MediaAccessScope" AS ENUM ('OWNER_ONLY', 'PUBLIC', 'RESTRICTED', 'INHERITED_GROUP');
CREATE TYPE "MediaVariantKind" AS ENUM ('MASTER', 'THUMBNAIL', 'SMALL', 'MEDIUM', 'LARGE', 'XLARGE');
CREATE TYPE "MediaTransitionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED');

ALTER TABLE "users"
  ADD COLUMN "avatar_media_id" TEXT,
  ADD COLUMN "media_privacy_target" BOOLEAN;

ALTER TABLE "Group" ADD COLUMN "imageMediaId" TEXT;
ALTER TABLE "Post" ADD COLUMN "mediaAspectRatio" DOUBLE PRECISION;
ALTER TABLE "Question" ADD COLUMN "imageMediaId" TEXT;
ALTER TABLE "Option" ADD COLUMN "imageMediaId" TEXT;

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "purpose" "MediaPurpose" NOT NULL,
  "status" "MediaStatus" NOT NULL DEFAULT 'TEMPORARY',
  "accessScope" "MediaAccessScope" NOT NULL DEFAULT 'OWNER_ONLY',
  "sourceMime" TEXT,
  "sourceWidth" INTEGER,
  "sourceHeight" INTEGER,
  "sourceByteSize" INTEGER,
  "checksum" TEXT,
  "aspectRatio" DOUBLE PRECISION,
  "cropX" DOUBLE PRECISION,
  "cropY" DOUBLE PRECISION,
  "cropWidth" DOUBLE PRECISION,
  "cropHeight" DOUBLE PRECISION,
  "focalX" DOUBLE PRECISION,
  "focalY" DOUBLE PRECISION,
  "altText" TEXT,
  "uploadBucket" TEXT,
  "uploadKey" TEXT,
  "errorCode" TEXT,
  "moderationStatus" TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
  "moderationMetadata" JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaAsset_sourceWidth_check" CHECK ("sourceWidth" IS NULL OR "sourceWidth" > 0),
  CONSTRAINT "MediaAsset_sourceHeight_check" CHECK ("sourceHeight" IS NULL OR "sourceHeight" > 0),
  CONSTRAINT "MediaAsset_sourceByteSize_check" CHECK ("sourceByteSize" IS NULL OR "sourceByteSize" > 0),
  CONSTRAINT "MediaAsset_aspectRatio_check" CHECK ("aspectRatio" IS NULL OR "aspectRatio" BETWEEN 0.8 AND 1.91),
  CONSTRAINT "MediaAsset_crop_check" CHECK (
    ("cropX" IS NULL AND "cropY" IS NULL AND "cropWidth" IS NULL AND "cropHeight" IS NULL)
    OR (
      "cropX" BETWEEN 0 AND 1 AND "cropY" BETWEEN 0 AND 1
      AND "cropWidth" > 0 AND "cropWidth" <= 1
      AND "cropHeight" > 0 AND "cropHeight" <= 1
      AND "cropX" + "cropWidth" <= 1.000001
      AND "cropY" + "cropHeight" <= 1.000001
    )
  ),
  CONSTRAINT "MediaAsset_focal_check" CHECK (
    ("focalX" IS NULL AND "focalY" IS NULL)
    OR ("focalX" BETWEEN 0 AND 1 AND "focalY" BETWEEN 0 AND 1)
  )
);

CREATE TABLE "MediaVariant" (
  "id" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "kind" "MediaVariantKind" NOT NULL,
  "storageBucket" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "mime" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaVariant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaVariant_dimensions_check" CHECK ("width" > 0 AND "height" > 0 AND "byteSize" > 0)
);

CREATE TABLE "PostMedia" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PostMedia_sortOrder_check" CHECK ("sortOrder" BETWEEN 0 AND 7)
);

CREATE TABLE "MediaPrivacyTransition" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetIsPrivate" BOOLEAN NOT NULL,
  "status" "MediaTransitionStatus" NOT NULL DEFAULT 'PENDING',
  "cursorAssetId" TEXT,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaPrivacyTransition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_avatar_media_id_key" ON "users"("avatar_media_id");
CREATE UNIQUE INDEX "Group_imageMediaId_key" ON "Group"("imageMediaId");
CREATE UNIQUE INDEX "Question_imageMediaId_key" ON "Question"("imageMediaId");
CREATE UNIQUE INDEX "Option_imageMediaId_key" ON "Option"("imageMediaId");
CREATE INDEX "MediaAsset_ownerId_status_idx" ON "MediaAsset"("ownerId", "status");
CREATE INDEX "MediaAsset_status_expiresAt_idx" ON "MediaAsset"("status", "expiresAt");
CREATE INDEX "MediaAsset_purpose_createdAt_idx" ON "MediaAsset"("purpose", "createdAt");
CREATE UNIQUE INDEX "MediaVariant_storageBucket_storageKey_key" ON "MediaVariant"("storageBucket", "storageKey");
CREATE UNIQUE INDEX "MediaVariant_mediaAssetId_kind_width_isPublic_key" ON "MediaVariant"("mediaAssetId", "kind", "width", "isPublic");
CREATE INDEX "MediaVariant_mediaAssetId_isPublic_width_idx" ON "MediaVariant"("mediaAssetId", "isPublic", "width");
CREATE UNIQUE INDEX "PostMedia_mediaAssetId_key" ON "PostMedia"("mediaAssetId");
CREATE UNIQUE INDEX "PostMedia_postId_sortOrder_key" ON "PostMedia"("postId", "sortOrder");
CREATE INDEX "PostMedia_postId_idx" ON "PostMedia"("postId");
CREATE INDEX "MediaPrivacyTransition_status_createdAt_idx" ON "MediaPrivacyTransition"("status", "createdAt");
CREATE INDEX "MediaPrivacyTransition_userId_status_idx" ON "MediaPrivacyTransition"("userId", "status");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaVariant" ADD CONSTRAINT "MediaVariant_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaPrivacyTransition" ADD CONSTRAINT "MediaPrivacyTransition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Group" ADD CONSTRAINT "Group_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Option" ADD CONSTRAINT "Option_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Post" ADD CONSTRAINT "Post_mediaAspectRatio_check" CHECK ("mediaAspectRatio" IS NULL OR "mediaAspectRatio" BETWEEN 0.8 AND 1.91);
