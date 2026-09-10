-- Additive migration. Never remove historical answers to satisfy a constraint.
-- Run the accompanying read-only preflight first and resolve any collisions
-- through a separately reviewed data repair before deploying this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
  IF EXISTS (SELECT lower(handle) FROM users GROUP BY lower(handle) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Handle case collisions require reviewed repair';
  END IF;
  IF EXISTS (SELECT 1 FROM "Response" WHERE "userId" IS NOT NULL GROUP BY "postId", "userId" HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM "Response" WHERE "guestId" IS NOT NULL GROUP BY "postId", "guestId" HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM "Response" WHERE guest_proof_hash IS NOT NULL GROUP BY "postId", guest_proof_hash HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM "Answer" GROUP BY "responseId", "questionId", "optionId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Vote duplicates require reviewed repair';
  END IF;
END $$;

CREATE TABLE handle_aliases (
  handle TEXT PRIMARY KEY CHECK (handle = lower(handle)),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX handle_aliases_user_id_idx ON handle_aliases(user_id);
INSERT INTO handle_aliases(handle, user_id)
  SELECT lower(handle), CASE WHEN status = 'DELETED' THEN NULL ELSE id END FROM users;
CREATE UNIQUE INDEX users_handle_casefold_unique ON users(lower(handle));

CREATE TABLE security_email_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PASSWORD_CHANGED', 'PASSWORD_RESET', 'EMAIL_CHANGED', 'USERNAME_CHANGED')),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP(3) NOT NULL,
  next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until TIMESTAMP(3),
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX security_email_outbox_next_attempt_at_expires_at_idx ON security_email_outbox(next_attempt_at, expires_at);
CREATE INDEX security_email_outbox_user_id_idx ON security_email_outbox(user_id);
ALTER TABLE handle_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON handle_aliases, security_email_outbox FROM PUBLIC;

CREATE UNIQUE INDEX "Response_post_user_unique" ON "Response"("postId", "userId");
CREATE UNIQUE INDEX "Response_post_guest_unique" ON "Response"("postId", "guestId");
CREATE UNIQUE INDEX "Response_post_guest_proof_unique" ON "Response"("postId", guest_proof_hash);
CREATE UNIQUE INDEX "Answer_response_question_option_unique" ON "Answer"("responseId", "questionId", "optionId");
CREATE UNIQUE INDEX "Answer_response_question_text_unique" ON "Answer"("responseId", "questionId") WHERE "optionId" IS NULL;
COMMIT;
