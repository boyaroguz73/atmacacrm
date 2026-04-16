-- Contact tablosuna yeni alanlar
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "taxNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "identityNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "billingAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingAddress" TEXT;

-- Quote tablosuna yeni alanlar
ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "partialPaymentAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "currentVersion" INTEGER DEFAULT 1;

-- QuoteVersion tablosu
CREATE TABLE IF NOT EXISTS "quote_versions" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "pdfUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "quote_versions_quoteId_idx" ON "quote_versions"("quoteId");

ALTER TABLE "quote_versions" 
  DROP CONSTRAINT IF EXISTS "quote_versions_quoteId_fkey";

ALTER TABLE "quote_versions" 
  ADD CONSTRAINT "quote_versions_quoteId_fkey" 
  FOREIGN KEY ("quoteId") 
  REFERENCES "quotes"("id") 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;
