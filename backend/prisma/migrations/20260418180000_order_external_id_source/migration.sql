-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN "externalId" TEXT;
ALTER TABLE "sales_orders" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_externalId_key" ON "sales_orders"("externalId");
