-- PR-1: T-Soft tek kaynak mimarisi — şema temeli
-- Hiçbir kolon/veri DROP edilmez; hepsi NULLABLE eklenir. XML değeri enum'da korunur (PR-5'te kaldırılacak).

-- 1) ProductFeedSource enum'una TSOFT değeri
ALTER TYPE "ProductFeedSource" ADD VALUE IF NOT EXISTS 'TSOFT';

-- 2) Product — T-Soft eşlemesi ve push guard alanları
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tsoftId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tsoftLastPulledAt" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pendingPushOp" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'products_tsoftId_key'
  ) THEN
    CREATE UNIQUE INDEX "products_tsoftId_key" ON "products"("tsoftId");
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "products_tsoftId_idx" ON "products"("tsoftId");
CREATE INDEX IF NOT EXISTS "products_pendingPushOp_idx" ON "products"("pendingPushOp");

-- 3) ProductVariant — T-Soft eşlemesi + kendi görseli + liste/indirimli fiyat + açıklama
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "tsoftId" TEXT;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "listPrice" DOUBLE PRECISION;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "salePriceAmount" DOUBLE PRECISION;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "additionalImages" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'product_variants_tsoftId_key'
  ) THEN
    CREATE UNIQUE INDEX "product_variants_tsoftId_key" ON "product_variants"("tsoftId");
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "product_variants_tsoftId_idx" ON "product_variants"("tsoftId");
CREATE INDEX IF NOT EXISTS "product_variants_sku_idx" ON "product_variants"("sku");

-- 4) SalesOrder — CRM→T-Soft push bayrakları
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "pushToTsoft" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "tsoftPushedAt" TIMESTAMP(3);
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "tsoftLastError" TEXT;

-- 5) OrderItem — varyant referansı
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "productVariantId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'order_items' AND constraint_name = 'order_items_productVariantId_fkey'
  ) THEN
    ALTER TABLE "order_items"
      ADD CONSTRAINT "order_items_productVariantId_fkey"
      FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "order_items_productVariantId_idx" ON "order_items"("productVariantId");

-- 6) TsoftPushQueue — CRM→T-Soft dayanıklı iş kuyruğu
CREATE TABLE IF NOT EXISTS "tsoft_push_queue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "op" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "doneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tsoft_push_queue_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tsoft_push_queue' AND constraint_name = 'tsoft_push_queue_organizationId_fkey'
  ) THEN
    ALTER TABLE "tsoft_push_queue"
      ADD CONSTRAINT "tsoft_push_queue_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "tsoft_push_queue_org_status_sched_idx"
  ON "tsoft_push_queue"("organizationId", "status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "tsoft_push_queue_entity_idx"
  ON "tsoft_push_queue"("entity", "entityId");

-- 7) Backfill: mevcut "kartela fotoğrafı parent'a sızmış" varyantları temizleme politikası —
-- İlk T-Soft pull sonrası imageUrl doğru URL ile doldurulacak; şimdilik sadece NULL bırakma.
-- (Varyantın kendi görseli T-Soft yanıtından geliyorsa değişmez; olmayanlarda parent'a düşer UI tarafında.)
UPDATE "product_variants"
  SET "imageUrl" = NULL
  WHERE "imageUrl" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "products" p
      WHERE p."id" = "product_variants"."productId"
        AND p."productFeedSource" = 'XML'
        AND p."imageUrl" IS NOT NULL
        AND p."imageUrl" = "product_variants"."imageUrl"
    );
