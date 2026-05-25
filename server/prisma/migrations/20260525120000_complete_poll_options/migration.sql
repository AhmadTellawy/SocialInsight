-- Persist poll option settings that are exposed in the creation UI.
ALTER TABLE "Option" ADD COLUMN "withFollowUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Option" ADD COLUMN "followUpLabel" TEXT;
ALTER TABLE "Option" ADD COLUMN "isUserAdded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Option" ADD COLUMN "addedByUserId" TEXT;
ALTER TABLE "Option" ADD COLUMN "addedByGuestId" TEXT;

-- Allow one response to contain several selected options for the same question.
DROP INDEX IF EXISTS "Answer_responseId_questionId_key";
CREATE INDEX IF NOT EXISTS "Answer_responseId_questionId_idx" ON "Answer"("responseId", "questionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Answer_responseId_questionId_optionId_key" ON "Answer"("responseId", "questionId", "optionId");
