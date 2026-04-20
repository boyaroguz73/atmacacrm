-- Birim fiyatın KDV dahil mi hariç mi olduğu (XML genelde hariç)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "priceIncludesVat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "priceIncludesVat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "quote_items" ADD COLUMN IF NOT EXISTS "priceIncludesVat" BOOLEAN NOT NULL DEFAULT true;
