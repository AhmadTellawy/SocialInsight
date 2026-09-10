-- Optional private demographic value; residence/country on the public profile
-- has a different meaning and is deliberately not used for backfill.
ALTER TABLE "user_demographics" ADD COLUMN "nationality" TEXT;
