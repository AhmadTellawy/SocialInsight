-- Profile links, date-only birthdays, and profile cover media.
-- Existing birthday values are preserved by converting their timestamp date component.

ALTER TYPE "MediaPurpose" ADD VALUE IF NOT EXISTS 'PROFILE_COVER';

ALTER TABLE "users"
  ADD COLUMN "cover_media_id" TEXT,
  ALTER COLUMN "birthday" TYPE DATE USING "birthday"::date;

ALTER TABLE "PendingRegistration"
  ALTER COLUMN "dob" TYPE DATE USING "dob"::date;

CREATE TABLE "profile_links" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "title" VARCHAR(50) NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "normalized_url" VARCHAR(2048) NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "profile_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "profile_links_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 50),
  CONSTRAINT "profile_links_url_check" CHECK (char_length("url") BETWEEN 1 AND 2048),
  CONSTRAINT "profile_links_normalized_url_check" CHECK (char_length("normalized_url") BETWEEN 1 AND 2048),
  CONSTRAINT "profile_links_sort_order_check" CHECK ("sort_order" BETWEEN 0 AND 4)
);

CREATE UNIQUE INDEX "users_cover_media_id_key" ON "users"("cover_media_id");
CREATE UNIQUE INDEX "profile_links_user_id_normalized_url_key" ON "profile_links"("user_id", "normalized_url");
CREATE UNIQUE INDEX "profile_links_user_id_sort_order_key" ON "profile_links"("user_id", "sort_order");

ALTER TABLE "profile_links"
  ADD CONSTRAINT "profile_links_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_cover_media_id_fkey"
  FOREIGN KEY ("cover_media_id") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_aspectRatio_check";
ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_aspectRatio_check" CHECK (
    "aspectRatio" IS NULL
    OR ("purpose" = 'PROFILE_COVER' AND abs("aspectRatio" - 3.0) < 0.0001)
    OR ("purpose" <> 'PROFILE_COVER' AND "aspectRatio" BETWEEN 0.8 AND 1.91)
  );
