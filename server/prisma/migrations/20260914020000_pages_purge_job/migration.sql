CREATE TABLE "PagePurgeJob" (
  "pageId" TEXT NOT NULL PRIMARY KEY REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "phase" TEXT NOT NULL DEFAULT 'NOTIFICATIONS',
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX "PagePurgeJob_completedAt_availableAt_pageId_idx" ON "PagePurgeJob" ("completedAt", "availableAt", "pageId");
ALTER TABLE "PagePurgeJob" ENABLE ROW LEVEL SECURITY;
-- Existing server DB role owns the table. No browser/public grants or RLS policies.
-- Forward fix: disable the worker first; retain durable cursors and Page tombstones.
-- Do not drop this table after admission, or admitted erasure could lose its cursor.
