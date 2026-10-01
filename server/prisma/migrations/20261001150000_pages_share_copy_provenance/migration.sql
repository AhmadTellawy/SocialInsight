-- Preserve independently edited share text while removing Page text copied at share creation.
-- Legacy Page shares have no provenance. Refuse an automatic migration that
-- would later have to choose between deleting authored text and retaining a copy.
-- Bound both the legacy scan and the index build on an existing Post table.
SET statement_timeout = '5s';
SET lock_timeout = '2s';
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "Post" child JOIN "Post" source ON source.id = child."sharedFromId"
    WHERE source."pageId" IS NOT NULL AND child."pageId" IS DISTINCT FROM source."pageId"
  ) THEN
    RAISE EXCEPTION 'PAGE_LEGACY_SHARE_PROVENANCE_MISSING';
  END IF;
END $$;
ALTER TABLE "Post" ADD COLUMN "sharedCopiedTitle" TEXT;
ALTER TABLE "Post" ADD COLUMN "sharedCopiedDescription" TEXT;
ALTER TABLE "Post" ADD COLUMN "sharedCopiedCategory" TEXT;
ALTER TABLE "Post" ADD COLUMN "sharedRootPageId" TEXT;
CREATE INDEX "Post_shared_root_page_idx" ON "Post"("sharedRootPageId", "id");
RESET lock_timeout;
RESET statement_timeout;
