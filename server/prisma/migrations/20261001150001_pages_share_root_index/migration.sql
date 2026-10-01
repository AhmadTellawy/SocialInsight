-- A single statement is required: Prisma sends multi-statement migration files
-- in one transaction, while PostgreSQL forbids concurrent index builds there.
-- Use a bounded migration session and inspect pg_index.indisvalid on failure.
CREATE INDEX CONCURRENTLY "Post_shared_root_page_idx" ON "Post"("sharedRootPageId", "id");
