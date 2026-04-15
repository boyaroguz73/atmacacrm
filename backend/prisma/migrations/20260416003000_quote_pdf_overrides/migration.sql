ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "termsOverride" TEXT,
  ADD COLUMN IF NOT EXISTS "footerNoteOverride" TEXT;
