-- A completed Page purge leaves only an anonymous referential tombstone.
-- Allow its original account link to be detached after the grace period.
ALTER TABLE "Page" ALTER COLUMN "ownerId" DROP NOT NULL;
