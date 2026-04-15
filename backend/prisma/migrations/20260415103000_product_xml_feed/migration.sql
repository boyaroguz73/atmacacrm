-- CreateEnum
CREATE TYPE "ProductFeedSource" AS ENUM ('MANUAL', 'XML');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "productFeedSource" "ProductFeedSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "products" ADD COLUMN "productUrl" TEXT;
ALTER TABLE "products" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "products" ADD COLUMN "googleCondition" TEXT;
ALTER TABLE "products" ADD COLUMN "googleAvailability" TEXT;
ALTER TABLE "products" ADD COLUMN "googleIdentifierExists" TEXT;
ALTER TABLE "products" ADD COLUMN "listPrice" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN "salePriceAmount" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN "salePriceEffectiveRange" TEXT;
ALTER TABLE "products" ADD COLUMN "brand" TEXT;
ALTER TABLE "products" ADD COLUMN "googleProductCategory" TEXT;
ALTER TABLE "products" ADD COLUMN "googleProductType" TEXT;
ALTER TABLE "products" ADD COLUMN "googleCustomLabel0" TEXT;
ALTER TABLE "products" ADD COLUMN "gtin" TEXT;
ALTER TABLE "products" ADD COLUMN "additionalImages" JSONB;
ALTER TABLE "products" ADD COLUMN "xmlSyncedAt" TIMESTAMP(3);

CREATE INDEX "products_productFeedSource_idx" ON "products"("productFeedSource");
