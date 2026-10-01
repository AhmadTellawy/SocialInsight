-- Single statement: PostgreSQL requires concurrent indexes outside a transaction.
CREATE INDEX CONCURRENTLY "Post_pageId_status_isDeleted_createdAt_id_idx" ON "Post"("pageId", "status", "isDeleted", "createdAt" DESC, "id" DESC);
