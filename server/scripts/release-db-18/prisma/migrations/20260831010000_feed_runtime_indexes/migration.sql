-- Feed discovery and profile feeds filter on publication state before sorting.
CREATE INDEX "Post_feed_status_deleted_created_id_idx"
ON "Post"("status", "isDeleted", "createdAt" DESC, "id" DESC);

CREATE INDEX "Post_author_feed_created_idx"
ON "Post"("authorId", "status", "isDeleted", "createdAt" DESC);

CREATE INDEX "Post_author_status_updated_id_idx"
ON "Post"("authorId", "status", "isDeleted", "updatedAt" DESC, "id" DESC);

-- Viewer-specific repost state is resolved by source post and viewer/author.
CREATE INDEX "Post_shared_viewer_idx"
ON "Post"("sharedFromId", "authorId");

-- Reverse follow checks and group membership aggregates are frequent feed predicates.
CREATE INDEX "follows_following_status_follower_idx"
ON "follows"("following_id", "status", "follower_id");

CREATE INDEX "follows_following_status_created_id_idx"
ON "follows"("following_id", "status", "created_at" DESC, "id" DESC);

CREATE INDEX "follows_follower_status_created_id_idx"
ON "follows"("follower_id", "status", "created_at" DESC, "id" DESC);

CREATE INDEX "GroupMember_group_status_idx"
ON "GroupMember"("groupId", "status");

CREATE INDEX "GroupMember_user_status_group_idx"
ON "GroupMember"("userId", "status", "groupId");

-- Popular-user fallback and bounded recent-interaction samples.
CREATE INDEX "users_status_followers_id_idx"
ON "users"("status", "followers_count" DESC, "id");

CREATE INDEX "UserLike_user_created_idx"
ON "UserLike"("userId", "createdAt" DESC);

CREATE INDEX "Comment_user_created_idx"
ON "Comment"("userId", "createdAt" DESC);

CREATE INDEX "Response_user_timestamp_idx"
ON "Response"("userId", "timestamp" DESC);

-- Feed relation hydration and per-viewer participation state.
CREATE INDEX "Section_post_order_idx"
ON "Section"("postId", "order");

CREATE INDEX "Question_post_order_idx"
ON "Question"("postId", "order");

CREATE INDEX "Question_section_order_idx"
ON "Question"("sectionId", "order");

CREATE INDEX "Option_question_order_idx"
ON "Option"("questionId", "order");

CREATE INDEX "Response_post_user_idx"
ON "Response"("postId", "userId");

CREATE INDEX "Response_post_guest_idx"
ON "Response"("postId", "guestId");

-- Stable newest-first notification pages.
CREATE INDEX "notifications_user_created_id_idx"
ON "notifications"("userId", "createdAt" DESC, "id" DESC);

-- Cursor-paginated detail sheets avoid sorting or scanning whole interaction tables.
CREATE INDEX "Comment_post_parent_created_id_idx"
ON "Comment"("postId", "parentId", "createdAt" DESC, "id" DESC);

CREATE INDEX "UserLike_post_created_id_idx"
ON "UserLike"("postId", "createdAt" DESC, "id" DESC);

CREATE INDEX "CommentLike_comment_created_id_idx"
ON "CommentLike"("commentId", "createdAt" DESC, "id" DESC);

CREATE INDEX "Response_post_timestamp_id_idx"
ON "Response"("postId", "timestamp" DESC, "id" DESC);

CREATE INDEX "user_saved_posts_user_created_post_idx"
ON "user_saved_posts"("user_id", "created_at" DESC, "post_id" DESC);

-- Public/member group discovery orders by activity without a table-wide sort.
CREATE INDEX "Group_visibility_member_count_idx"
ON "Group"("isDeleted", "isPublic", "memberCount" DESC, "id");
