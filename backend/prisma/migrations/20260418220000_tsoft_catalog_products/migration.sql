-- T-Soft katalog önbelleği + site sipariş ID
CREATE TABLE "tsoft_catalog_products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tsoftProductId" TEXT,
    "productCode" TEXT NOT NULL,
    "barcode" TEXT,
    "productName" TEXT NOT NULL,
    "sellingPrice" DOUBLE PRECISION,
    "listPrice" DOUBLE PRECISION,
    "buyingPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "stock" INTEGER,
    "vatRate" INTEGER,
    "brand" TEXT,
    "model" TEXT,
    "categoryCode" TEXT,
    "categoryName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "shortDescription" TEXT,
    "detailsText" TEXT,
    "subproductsJson" JSONB,
    "rawSnapshotJson" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tsoft_catalog_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tsoft_catalog_products_organizationId_productCode_key" ON "tsoft_catalog_products"("organizationId", "productCode");
CREATE INDEX "tsoft_catalog_products_organizationId_idx" ON "tsoft_catalog_products"("organizationId");

ALTER TABLE "tsoft_catalog_products" ADD CONSTRAINT "tsoft_catalog_products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_orders" ADD COLUMN "tsoftSiteOrderId" TEXT;
