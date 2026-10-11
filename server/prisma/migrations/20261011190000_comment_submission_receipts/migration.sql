-- Additive. No changes to existing comments. Receipts retain no comment text.
CREATE TABLE public."CommentSubmission" (
  "userId" TEXT NOT NULL, "mutationId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "postId" TEXT NOT NULL, "commentId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommentSubmission_pkey" PRIMARY KEY ("userId","mutationId"),
  CONSTRAINT "CommentSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommentSubmission_postId_fkey" FOREIGN KEY ("postId") REFERENCES public."Post"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommentSubmission_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES public."Comment"(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommentSubmission_commentId_key" ON public."CommentSubmission"("commentId");
CREATE INDEX "CommentSubmission_postId_idx" ON public."CommentSubmission"("postId");
ALTER TABLE public."CommentSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommentSubmission" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public."CommentSubmission" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CommentSubmission" TO socialinsight_runtime;
CREATE POLICY socialinsight_submission_owner ON public."CommentSubmission" FOR ALL TO socialinsight_runtime
  USING ("userId" = public.socialinsight_context_user_id() OR public.socialinsight_context_is_system())
  WITH CHECK ("userId" = public.socialinsight_context_user_id() OR public.socialinsight_context_is_system());
