-- Preserve the existing optionId vote model while making visual presentation explicit.
ALTER TABLE "Post"
  ADD COLUMN "optionPresentation" TEXT,
  ADD COLUMN "showOptionNames" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Question"
  ADD COLUMN "optionPresentation" TEXT,
  ADD COLUMN "showOptionNames" BOOLEAN NOT NULL DEFAULT true;
