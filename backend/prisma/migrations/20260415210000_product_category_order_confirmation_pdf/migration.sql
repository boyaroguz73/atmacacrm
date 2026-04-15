-- Ürün kategorisi (g:product_type) + sipariş onay PDF URL

DO $$ BEGIN
  ALTER TABLE "products" ADD COLUMN "category" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sales_orders" ADD COLUMN "confirmationPdfUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

UPDATE "products"
SET "category" = "googleProductType"
WHERE "category" IS NULL AND "googleProductType" IS NOT NULL AND TRIM("googleProductType") <> '';
