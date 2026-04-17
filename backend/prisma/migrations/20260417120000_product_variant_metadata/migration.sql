-- XML subproduct/type2 ve diğer varyant meta bilgisi
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
