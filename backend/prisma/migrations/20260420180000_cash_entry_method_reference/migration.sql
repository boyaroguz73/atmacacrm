-- CashBookEntry: ödeme yöntemi + referans alanı
-- Sipariş başına kısmi tahsilat UI'ı için gerekli kırılım.

DO $$ BEGIN
  CREATE TYPE "CashMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'CHECK', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "cash_book_entries"
  ADD COLUMN IF NOT EXISTS "method" "CashMethod" NOT NULL DEFAULT 'OTHER';

ALTER TABLE "cash_book_entries"
  ADD COLUMN IF NOT EXISTS "reference" TEXT;

-- Sipariş bazlı ödeme özet sorgusu için indeks
CREATE INDEX IF NOT EXISTS "cash_book_entries_orderId_idx"
  ON "cash_book_entries" ("orderId");

CREATE INDEX IF NOT EXISTS "cash_book_entries_invoiceId_idx"
  ON "cash_book_entries" ("invoiceId");
