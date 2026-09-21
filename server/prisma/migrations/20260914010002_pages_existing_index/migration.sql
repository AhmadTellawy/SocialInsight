-- Single statement: PostgreSQL requires concurrent indexes outside a transaction.
CREATE INDEX CONCURRENTLY "MediaAsset_pageId_status_idx" ON "MediaAsset"("pageId", "status");
