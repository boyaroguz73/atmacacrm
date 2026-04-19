-- ============================================================================
-- T-Soft kusursuz akış — temel (PR-1 foundation)
--
-- Bu migration sadece EKLEMEDEN ibarettir; hiçbir kolon/tablo DROP edilmez,
-- mevcut veriye dokunulmaz. Güvenli geri alınabilir (rollback: ters ALTER'lar).
--
-- Kapsam:
--   1) ProductFeedSource enum'una 'TSOFT' eklenir.
--   2) T-Soft push kuyruğu için 4 yeni enum: TsoftPushEntity / TsoftPushOp /
--      TsoftPushStatus (CREATE/UPDATE/DELETE ve PENDING/RUNNING/DONE/FAILED).
--   3) ProductVariant: tsoftId (unique) + pendingPushOp + tsoftLastPulledAt.
--   4) OrderItem: productVariantId (FK → product_variants, SET NULL).
--   5) SalesOrder: pushToTsoft + tsoftPushedAt + tsoftLastError.
--   6) tsoft_push_queue tablosu + indeksler + Organization FK.
-- ============================================================================

-- 1) ProductFeedSource.TSOFT ------------------------------------------------
ALTER TYPE "ProductFeedSource" ADD VALUE IF NOT EXISTS 'TSOFT';

-- 2) T-Soft push enum'ları --------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "TsoftPushEntity" AS ENUM ('PRODUCT','VARIANT','ORDER','IMAGE','STOCK','PRICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TsoftPushOp" AS ENUM ('CREATE','UPDATE','DELETE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TsoftPushStatus" AS ENUM ('PENDING','RUNNING','DONE','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) ProductVariant ---------------------------------------------------------
ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "tsoftId" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingPushOp" "TsoftPushOp",
  ADD COLUMN IF NOT EXISTS "tsoftLastPulledAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_tsoftId_key"
  ON "product_variants"("tsoftId");
CREATE INDEX IF NOT EXISTS "product_variants_tsoftId_idx"
  ON "product_variants"("tsoftId");

-- 4) OrderItem.productVariantId --------------------------------------------
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "productVariantId" TEXT;

CREATE INDEX IF NOT EXISTS "order_items_productVariantId_idx"
  ON "order_items"("productVariantId");

DO $$ BEGIN
  ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_productVariantId_fkey"
    FOREIGN KEY ("productVariantId")
    REFERENCES "product_variants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) SalesOrder push-gate alanları -----------------------------------------
ALTER TABLE "sales_orders"
  ADD COLUMN IF NOT EXISTS "pushToTsoft" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tsoftPushedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tsoftLastError" TEXT;

-- 6) tsoft_push_queue -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tsoft_push_queue" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entity"         "TsoftPushEntity" NOT NULL,
  "entityId"       TEXT NOT NULL,
  "op"             "TsoftPushOp" NOT NULL,
  "payload"        JSONB NOT NULL,
  "status"         "TsoftPushStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount"   INTEGER NOT NULL DEFAULT 0,
  "lastError"      TEXT,
  "scheduledAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "doneAt"         TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tsoft_push_queue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tsoft_push_queue_org_status_scheduledAt_idx"
  ON "tsoft_push_queue"("organizationId", "status", "scheduledAt");

CREATE INDEX IF NOT EXISTS "tsoft_push_queue_entity_entityId_idx"
  ON "tsoft_push_queue"("entity", "entityId");

DO $$ BEGIN
  ALTER TABLE "tsoft_push_queue"
    ADD CONSTRAINT "tsoft_push_queue_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
