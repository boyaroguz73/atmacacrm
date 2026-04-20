-- OrderItem: priceIncludesVat bayrağı (teklif QuoteItem ile birebir aynı mantık).
-- Mevcut kayıtlar KDV dahil varsayılır (şimdiye kadarki davranış); veri bozulmaz.

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "priceIncludesVat" BOOLEAN NOT NULL DEFAULT TRUE;
