-- Additive social-tagging foundation. Existing authored text remains unchanged.
CREATE TYPE "MentionSourceType" AS ENUM ('POST', 'COMMENT', 'REPLY', 'PROFILE', 'GROUP');
CREATE TYPE "MentionSurface" AS ENUM ('POST_TITLE', 'POST_DESCRIPTION', 'REPOST_CAPTION', 'COMMENT_TEXT', 'PROFILE_BIO', 'GROUP_DESCRIPTION', 'GROUP_RULES');
CREATE TYPE "MentionState" AS ENUM ('STAGED', 'ACTIVE');
CREATE TYPE "PeopleTagPermission" AS ENUM ('EVERYONE', 'FOLLOWING', 'NO_ONE');
CREATE TYPE "PeopleTagStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REMOVED');

ALTER TABLE "users"
  ADD COLUMN "people_tag_permission" "PeopleTagPermission" NOT NULL DEFAULT 'EVERYONE';

ALTER TABLE "notifications"
  ADD COLUMN "dedupe_key" TEXT;

CREATE TABLE "Mention" (
  "id" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "postId" TEXT,
  "commentId" TEXT,
  "profileUserId" TEXT,
  "groupId" TEXT,
  "sourceType" "MentionSourceType" NOT NULL,
  "state" "MentionState" NOT NULL DEFAULT 'ACTIVE',
  "notificationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Mention_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Mention_source_shape_check" CHECK (
    ("sourceType" = 'POST' AND "postId" IS NOT NULL AND "commentId" IS NULL AND "profileUserId" IS NULL AND "groupId" IS NULL)
    OR ("sourceType" IN ('COMMENT', 'REPLY') AND "postId" IS NOT NULL AND "commentId" IS NOT NULL AND "profileUserId" IS NULL AND "groupId" IS NULL)
    OR ("sourceType" = 'PROFILE' AND "postId" IS NULL AND "commentId" IS NULL AND "profileUserId" IS NOT NULL AND "groupId" IS NULL)
    OR ("sourceType" = 'GROUP' AND "postId" IS NULL AND "commentId" IS NULL AND "profileUserId" IS NULL AND "groupId" IS NOT NULL)
  )
);

CREATE TABLE "MentionOccurrence" (
  "id" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "surface" "MentionSurface" NOT NULL,
  "startOffset" INTEGER NOT NULL,
  "endOffset" INTEGER NOT NULL,
  "rawText" TEXT NOT NULL,

  CONSTRAINT "MentionOccurrence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MentionOccurrence_offsets_check" CHECK ("startOffset" >= 0 AND "endOffset" > "startOffset")
);

CREATE TABLE "Hashtag" (
  "id" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Hashtag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostHashtag" (
  "postId" TEXT NOT NULL,
  "hashtagId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PostHashtag_pkey" PRIMARY KEY ("postId", "hashtagId")
);

CREATE TABLE "CommentHashtag" (
  "commentId" TEXT NOT NULL,
  "hashtagId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommentHashtag_pkey" PRIMARY KEY ("commentId", "hashtagId")
);

CREATE TABLE "PostTaggedUser" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "taggedUserId" TEXT NOT NULL,
  "taggedByUserId" TEXT NOT NULL,
  "status" "PeopleTagStatus" NOT NULL DEFAULT 'PENDING',
  "notificationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),

  CONSTRAINT "PostTaggedUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
CREATE UNIQUE INDEX "Mention_notificationId_key" ON "Mention"("notificationId");
CREATE UNIQUE INDEX "Mention_post_target_key" ON "Mention"("postId", "targetUserId") WHERE "sourceType" = 'POST';
CREATE UNIQUE INDEX "Mention_comment_target_key" ON "Mention"("commentId", "targetUserId") WHERE "sourceType" IN ('COMMENT', 'REPLY');
CREATE UNIQUE INDEX "Mention_profile_target_key" ON "Mention"("profileUserId", "targetUserId") WHERE "sourceType" = 'PROFILE';
CREATE UNIQUE INDEX "Mention_group_target_key" ON "Mention"("groupId", "targetUserId") WHERE "sourceType" = 'GROUP';
CREATE INDEX "Mention_targetUserId_createdAt_idx" ON "Mention"("targetUserId", "createdAt");
CREATE INDEX "Mention_actorUserId_createdAt_idx" ON "Mention"("actorUserId", "createdAt");
CREATE INDEX "Mention_postId_state_idx" ON "Mention"("postId", "state");
CREATE INDEX "Mention_commentId_state_idx" ON "Mention"("commentId", "state");
CREATE INDEX "Mention_profileUserId_idx" ON "Mention"("profileUserId");
CREATE INDEX "Mention_groupId_idx" ON "Mention"("groupId");
CREATE UNIQUE INDEX "MentionOccurrence_mention_surface_offsets_key" ON "MentionOccurrence"("mentionId", "surface", "startOffset", "endOffset");
CREATE INDEX "MentionOccurrence_mentionId_surface_idx" ON "MentionOccurrence"("mentionId", "surface");
CREATE UNIQUE INDEX "Hashtag_normalizedName_key" ON "Hashtag"("normalizedName");
CREATE INDEX "Hashtag_createdAt_idx" ON "Hashtag"("createdAt");
CREATE INDEX "PostHashtag_hashtagId_postId_idx" ON "PostHashtag"("hashtagId", "postId");
CREATE INDEX "PostHashtag_createdAt_idx" ON "PostHashtag"("createdAt");
CREATE INDEX "CommentHashtag_hashtagId_commentId_idx" ON "CommentHashtag"("hashtagId", "commentId");
CREATE UNIQUE INDEX "PostTaggedUser_notificationId_key" ON "PostTaggedUser"("notificationId");
CREATE UNIQUE INDEX "PostTaggedUser_postId_taggedUserId_key" ON "PostTaggedUser"("postId", "taggedUserId");
CREATE INDEX "PostTaggedUser_taggedUserId_status_createdAt_idx" ON "PostTaggedUser"("taggedUserId", "status", "createdAt");
CREATE INDEX "PostTaggedUser_taggedByUserId_createdAt_idx" ON "PostTaggedUser"("taggedByUserId", "createdAt");
CREATE INDEX "PostTaggedUser_postId_status_idx" ON "PostTaggedUser"("postId", "status");

ALTER TABLE "Mention" ADD CONSTRAINT "Mention_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_profileUserId_fkey" FOREIGN KEY ("profileUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MentionOccurrence" ADD CONSTRAINT "MentionOccurrence_mentionId_fkey" FOREIGN KEY ("mentionId") REFERENCES "Mention"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostHashtag" ADD CONSTRAINT "PostHashtag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostHashtag" ADD CONSTRAINT "PostHashtag_hashtagId_fkey" FOREIGN KEY ("hashtagId") REFERENCES "Hashtag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentHashtag" ADD CONSTRAINT "CommentHashtag_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentHashtag" ADD CONSTRAINT "CommentHashtag_hashtagId_fkey" FOREIGN KEY ("hashtagId") REFERENCES "Hashtag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostTaggedUser" ADD CONSTRAINT "PostTaggedUser_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostTaggedUser" ADD CONSTRAINT "PostTaggedUser_taggedUserId_fkey" FOREIGN KEY ("taggedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostTaggedUser" ADD CONSTRAINT "PostTaggedUser_taggedByUserId_fkey" FOREIGN KEY ("taggedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostTaggedUser" ADD CONSTRAINT "PostTaggedUser_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
