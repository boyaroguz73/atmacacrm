-- Teklif kalemi: ürün satırına özel renk/kumaş ve ölçü
ALTER TABLE "quote_items" ADD COLUMN IF NOT EXISTS "colorFabricInfo" TEXT;
ALTER TABLE "quote_items" ADD COLUMN IF NOT EXISTS "measurementInfo" TEXT;
