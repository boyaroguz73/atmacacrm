-- Ürün kategorileri tablosu
CREATE TABLE IF NOT EXISTS "product_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_categories_name_key" ON "product_categories"("name");

-- Sipariş / fatura panel düzenleme izi
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "panelEditedAt" TIMESTAMP(3);
ALTER TABLE "accounting_invoices" ADD COLUMN IF NOT EXISTS "panelEditedAt" TIMESTAMP(3);

-- Teklif (önceki migrasyon yoksa)
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "panelEditedAt" TIMESTAMP(3);
