CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "public"."follows" DROP CONSTRAINT "follows_pkey";

ALTER TABLE "public"."follows" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "public"."follows" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "public"."follows" ADD COLUMN "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "public"."follows" ADD COLUMN "rejected_at" TIMESTAMP(3);
ALTER TABLE "public"."follows" ADD COLUMN "removed_at" TIMESTAMP(3);
ALTER TABLE "public"."follows" ADD COLUMN "requested_at" TIMESTAMP(3);
ALTER TABLE "public"."follows" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "public"."follows" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "public"."follows" ADD CONSTRAINT "follows_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "follows_follower_id_following_id_key" ON "public"."follows"("follower_id", "following_id");
