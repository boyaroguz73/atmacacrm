-- Sipariş kalemlerinde renk/kumaş ve ölçü (teklif satırlarıyla uyum)
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "colorFabricInfo" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "measurementInfo" TEXT;
