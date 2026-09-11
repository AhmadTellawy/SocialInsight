ALTER TABLE "Response" ADD COLUMN "guest_proof_hash" CHAR(64), ADD COLUMN "guest_proof_expires_at" TIMESTAMP(3);
CREATE INDEX "response_post_guest_proof_idx" ON "Response"("postId", "guest_proof_hash");
