-- Preserve independently edited share text while removing Page text copied at share creation.
SET lock_timeout = '5s';
ALTER TABLE "Post" ADD COLUMN "sharedCopiedTitle" TEXT;
ALTER TABLE "Post" ADD COLUMN "sharedCopiedDescription" TEXT;
ALTER TABLE "Post" ADD COLUMN "sharedCopiedCategory" TEXT;
ALTER TABLE "Post" ADD COLUMN "sharedRootPageId" TEXT;
RESET lock_timeout;
CREATE INDEX CONCURRENTLY "Post_shared_root_page_idx" ON "Post"("sharedRootPageId", "id");
