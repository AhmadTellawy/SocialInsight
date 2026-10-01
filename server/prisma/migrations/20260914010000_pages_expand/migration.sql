-- Additive Pages migration; no Groups are converted. Existing-table indexes follow separately.
SET lock_timeout = '5s';
-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "pageId" TEXT;

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "pageId" TEXT;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "pageId" TEXT;

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "handle" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" TEXT NOT NULL,
    "bio" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "website" TEXT,
    "links" JSONB NOT NULL DEFAULT '[]',
    "publicEmail" TEXT,
    "publicPhone" TEXT,
    "cta" TEXT,
    "avatarMediaId" TEXT,
    "coverMediaId" TEXT,
    "publicationState" TEXT NOT NULL DEFAULT 'DRAFT',
    "platformState" TEXT NOT NULL DEFAULT 'NONE',
    "safetyHiddenAt" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "legalHoldUntil" TIMESTAMP(3),
    "legalHoldReason" TEXT,
    "lastHandleChangedAt" TIMESTAMP(3),
    "representationAt" TIMESTAMP(3) NOT NULL,
    "createRequestId" TEXT NOT NULL,
    "isTestFixture" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageMembership" (
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageMembership_pkey" PRIMARY KEY ("pageId","userId")
);

-- CreateTable
CREATE TABLE "PageHandle" (
    "handle" VARCHAR(30) NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageHandle_pkey" PRIMARY KEY ("handle")
);

-- CreateTable
CREATE TABLE "PageInvitation" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PageInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageOwnershipTransfer" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PageOwnershipTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageFollow" (
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageFollow_pkey" PRIMARY KEY ("pageId","userId")
);

-- CreateTable
CREATE TABLE "PageBlock" (
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageBlock_pkey" PRIMARY KEY ("pageId","userId","direction")
);

-- CreateTable
CREATE TABLE "PageAuditEvent" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageCase" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "postId" TEXT,
    "reporterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'REPORT',
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "decision" TEXT,
    "decisionReason" TEXT,
    "parentId" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "legalHoldUntil" TIMESTAMP(3),
    "legalHoldReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PageCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageEvent" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "PageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Page_handle_key" ON "Page"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Page_avatarMediaId_key" ON "Page"("avatarMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_coverMediaId_key" ON "Page"("coverMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_createRequestId_key" ON "Page"("createRequestId");

-- CreateIndex
CREATE INDEX "Page_ownerId_purgedAt_idx" ON "Page"("ownerId", "purgedAt");

-- CreateIndex
CREATE INDEX "Page_publicationState_platformState_createdAt_id_idx" ON "Page"("publicationState", "platformState", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Page_deletionRequestedAt_purgedAt_idx" ON "Page"("deletionRequestedAt", "purgedAt");

-- CreateIndex
CREATE INDEX "PageMembership_userId_pageId_idx" ON "PageMembership"("userId", "pageId");

-- CreateIndex
CREATE INDEX "PageHandle_pageId_idx" ON "PageHandle"("pageId");

-- CreateIndex
CREATE INDEX "PageInvitation_recipientId_status_createdAt_id_idx" ON "PageInvitation"("recipientId", "status", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "PageInvitation_pageId_status_createdAt_id_idx" ON "PageInvitation"("pageId", "status", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "PageOwnershipTransfer_recipientId_status_createdAt_id_idx" ON "PageOwnershipTransfer"("recipientId", "status", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "PageOwnershipTransfer_pageId_status_idx" ON "PageOwnershipTransfer"("pageId", "status");

-- CreateIndex
CREATE INDEX "PageFollow_userId_createdAt_pageId_idx" ON "PageFollow"("userId", "createdAt" DESC, "pageId");

-- CreateIndex
CREATE INDEX "PageFollow_pageId_createdAt_idx" ON "PageFollow"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "PageBlock_userId_pageId_idx" ON "PageBlock"("userId", "pageId");

-- CreateIndex
CREATE INDEX "PageAuditEvent_pageId_createdAt_id_idx" ON "PageAuditEvent"("pageId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "PageAuditEvent_createdAt_idx" ON "PageAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PageCase_status_createdAt_id_idx" ON "PageCase"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PageCase_reporterId_createdAt_id_idx" ON "PageCase"("reporterId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "PageCase_pageId_createdAt_id_idx" ON "PageCase"("pageId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "PageEvent_dedupeKey_key" ON "PageEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "PageEvent_deliveredAt_availableAt_id_idx" ON "PageEvent"("deliveredAt", "availableAt", "id");

-- CreateIndex
-- Index on existing table follows in a single-statement concurrent migration.

-- CreateIndex
-- Index on existing table follows in a single-statement concurrent migration.

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageMembership" ADD CONSTRAINT "PageMembership_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageMembership" ADD CONSTRAINT "PageMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageHandle" ADD CONSTRAINT "PageHandle_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageInvitation" ADD CONSTRAINT "PageInvitation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageOwnershipTransfer" ADD CONSTRAINT "PageOwnershipTransfer_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageFollow" ADD CONSTRAINT "PageFollow_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageFollow" ADD CONSTRAINT "PageFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageBlock" ADD CONSTRAINT "PageBlock_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageBlock" ADD CONSTRAINT "PageBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageAuditEvent" ADD CONSTRAINT "PageAuditEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageCase" ADD CONSTRAINT "PageCase_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageEvent" ADD CONSTRAINT "PageEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Page" ADD CONSTRAINT "Page_state_check" CHECK (
 "publicationState" IN ('DRAFT','PUBLISHED','UNPUBLISHED') AND "platformState" IN ('NONE','RESTRICTED','SUSPENDED'));
ALTER TABLE "Page" ADD CONSTRAINT "Page_handle_check" CHECK (handle ~ '^[a-z][a-z0-9_]{2,29}$');
ALTER TABLE "PageMembership" ADD CONSTRAINT "PageMembership_role_check" CHECK (role IN ('ADMIN','EDITOR','ANALYST'));
ALTER TABLE "PageInvitation" ADD CONSTRAINT "PageInvitation_role_check" CHECK (role IN ('ADMIN','EDITOR','ANALYST'));
ALTER TABLE "PageBlock" ADD CONSTRAINT "PageBlock_direction_check" CHECK (direction IN ('PAGE_TO_USER','USER_TO_PAGE'));
ALTER TABLE "Post" ADD CONSTRAINT "Post_page_no_groups" CHECK ("pageId" IS NULL OR
 ("groupId" IS NULL AND coalesce("targetGroups",'[]') IN ('','[]') AND coalesce("targetAudience",'') !~* 'groups')) NOT VALID;
ALTER TABLE "Post" VALIDATE CONSTRAINT "Post_page_no_groups";
CREATE UNIQUE INDEX "PageInvitation_pending_unique" ON "PageInvitation" ("pageId","recipientId") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "PageOwnershipTransfer_pending_unique" ON "PageOwnershipTransfer" ("pageId") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "PageCase_active_report_unique" ON "PageCase" ("pageId",coalesce("postId",''),"reporterId",kind) WHERE status IN ('OPEN','IN_REVIEW');

CREATE FUNCTION pages_enforce_group_destination() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_post text; publisher_page text;
BEGIN
 IF TG_TABLE_NAME = '_PostTargetGroups' THEN
   target_post := NEW."B";
   SELECT "pageId" INTO publisher_page FROM "Post" WHERE id = target_post FOR UPDATE;
   IF publisher_page IS NOT NULL THEN RAISE EXCEPTION 'PAGE_GROUP_DESTINATION_FORBIDDEN' USING ERRCODE='23514'; END IF;
 ELSE
   IF NEW."pageId" IS NOT NULL AND EXISTS (SELECT 1 FROM "_PostTargetGroups" WHERE "B" = NEW.id) THEN
     RAISE EXCEPTION 'PAGE_GROUP_DESTINATION_FORBIDDEN' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pages_group_join_guard BEFORE INSERT OR UPDATE ON "_PostTargetGroups" FOR EACH ROW EXECUTE FUNCTION pages_enforce_group_destination();
CREATE TRIGGER pages_post_destination_guard BEFORE INSERT OR UPDATE OF "pageId" ON "Post" FOR EACH ROW EXECUTE FUNCTION pages_enforce_group_destination();

CREATE FUNCTION pages_enforce_membership_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "Page" WHERE id=NEW."pageId" AND "ownerId"=NEW."userId") THEN
   RAISE EXCEPTION 'PAGE_OWNER_IS_NOT_MEMBERSHIP' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pages_owner_membership_guard BEFORE INSERT OR UPDATE ON "PageMembership" FOR EACH ROW EXECUTE FUNCTION pages_enforce_membership_owner();

ALTER TABLE "Page" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageMembership" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageHandle" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageInvitation" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageOwnershipTransfer" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageFollow" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageBlock" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageAuditEvent" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageCase" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PageEvent" ENABLE ROW LEVEL SECURITY;
