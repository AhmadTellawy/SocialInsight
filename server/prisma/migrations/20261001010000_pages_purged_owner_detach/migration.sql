-- A completed Page purge leaves only an anonymous referential tombstone.
-- Allow its original account link to be detached after the grace period.
ALTER TABLE "Page" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "Page" ADD CONSTRAINT "Page_owner_required_until_purged" CHECK ("ownerId" IS NOT NULL OR "purgedAt" IS NOT NULL);
