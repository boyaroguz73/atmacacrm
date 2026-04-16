-- Tedarikçiler + sipariş kalemleri (supplierId), ürün varyantları, teklif kalemi varyant/görsel
-- Şema ile uyum; mevcut kolon/tablolar için idempotent

-- Suppliers
CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- order_items: tedarikçi ve stok alanları
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "supplierOrderNo" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "isFromStock" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "order_items_supplierId_idx" ON "order_items"("supplierId");

DO $$ BEGIN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Product variants (XML item_group_id)
CREATE TABLE IF NOT EXISTS "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "vatRate" INTEGER NOT NULL DEFAULT 20,
    "stock" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_externalId_key" ON "product_variants"("externalId");
CREATE INDEX IF NOT EXISTS "product_variants_productId_idx" ON "product_variants"("productId");

DO $$ BEGIN
  ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- quote_items: varyant ve satır görseli
ALTER TABLE "quote_items" ADD COLUMN IF NOT EXISTS "productVariantId" TEXT;
ALTER TABLE "quote_items" ADD COLUMN IF NOT EXISTS "lineImageUrl" TEXT;

CREATE INDEX IF NOT EXISTS "quote_items_productVariantId_idx" ON "quote_items"("productVariantId");

DO $$ BEGIN
  ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
