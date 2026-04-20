-- PR-5 XML hard cut
-- 1) Backfill: XML kaynaklı ürünleri MANUAL'a çevir (varyantlar product.productFeedSource'a bağlı olduğundan ayrıca güncellenmez)
UPDATE "products" SET "productFeedSource" = 'MANUAL' WHERE "productFeedSource" = 'XML';

-- 2) XML'e özgü kolonları düşür
ALTER TABLE "products" DROP COLUMN IF EXISTS "xmlSyncedAt";

-- 3) Enum'dan XML değerini kaldır (PostgreSQL'de enum değer kaldırmak için tip yeniden oluşturulur)
ALTER TYPE "ProductFeedSource" RENAME TO "ProductFeedSource_old";
CREATE TYPE "ProductFeedSource" AS ENUM ('MANUAL', 'TSOFT');
ALTER TABLE "products" ALTER COLUMN "productFeedSource" DROP DEFAULT;
ALTER TABLE "products"
  ALTER COLUMN "productFeedSource" TYPE "ProductFeedSource"
  USING ("productFeedSource"::text::"ProductFeedSource");
ALTER TABLE "products" ALTER COLUMN "productFeedSource" SET DEFAULT 'MANUAL';
DROP TYPE "ProductFeedSource_old";
