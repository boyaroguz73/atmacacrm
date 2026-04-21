-- CreateTable: cargo_companies
CREATE TABLE "cargo_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isAmbar" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cargo_companies_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add cargo fields to sales_orders
ALTER TABLE "sales_orders"
    ADD COLUMN "cargoCompanyId" TEXT,
    ADD COLUMN "cargoTrackingNo" TEXT,
    ADD COLUMN "cargoNotificationSentAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_cargoCompanyId_fkey"
    FOREIGN KEY ("cargoCompanyId") REFERENCES "cargo_companies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
