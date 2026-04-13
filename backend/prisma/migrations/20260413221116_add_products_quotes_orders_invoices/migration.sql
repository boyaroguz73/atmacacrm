-- CreateEnum QuoteStatus
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum OrderStatus
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum AccInvoiceStatus
CREATE TYPE "AccInvoiceStatus" AS ENUM ('PENDING', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum DiscountType
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterEnum: Add ACCOUNTANT to UserRole
ALTER TYPE "UserRole" ADD VALUE 'ACCOUNTANT';

-- CreateTable products
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'Adet',
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "vatRate" INTEGER NOT NULL DEFAULT 20,
    "stock" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable quotes
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "quoteNumber" SERIAL NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENT',
    "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "deliveryDate" TIMESTAMP(3),
    "notes" TEXT,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable quote_items
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 20,
    "discountType" "DiscountType" DEFAULT 'PERCENT',
    "discountValue" DOUBLE PRECISION DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable sales_orders
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" SERIAL NOT NULL,
    "quoteId" TEXT,
    "contactId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingAddress" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable order_items
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 20,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable accounting_invoices
CREATE TABLE "accounting_invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" SERIAL NOT NULL,
    "orderId" TEXT,
    "quoteId" TEXT,
    "contactId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "AccInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "uploadedPdfUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "products_sku_idx" ON "products"("sku");

CREATE UNIQUE INDEX "quotes_quoteNumber_key" ON "quotes"("quoteNumber");
CREATE INDEX "quotes_contactId_idx" ON "quotes"("contactId");
CREATE INDEX "quotes_status_idx" ON "quotes"("status");
CREATE INDEX "quotes_createdAt_idx" ON "quotes"("createdAt" DESC);

CREATE INDEX "quote_items_quoteId_idx" ON "quote_items"("quoteId");

CREATE UNIQUE INDEX "sales_orders_orderNumber_key" ON "sales_orders"("orderNumber");
CREATE UNIQUE INDEX "sales_orders_quoteId_key" ON "sales_orders"("quoteId");
CREATE INDEX "sales_orders_contactId_idx" ON "sales_orders"("contactId");
CREATE INDEX "sales_orders_status_idx" ON "sales_orders"("status");
CREATE INDEX "sales_orders_createdAt_idx" ON "sales_orders"("createdAt" DESC);

CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

CREATE UNIQUE INDEX "accounting_invoices_invoiceNumber_key" ON "accounting_invoices"("invoiceNumber");
CREATE UNIQUE INDEX "accounting_invoices_orderId_key" ON "accounting_invoices"("orderId");
CREATE UNIQUE INDEX "accounting_invoices_quoteId_key" ON "accounting_invoices"("quoteId");
CREATE INDEX "accounting_invoices_contactId_idx" ON "accounting_invoices"("contactId");
CREATE INDEX "accounting_invoices_status_idx" ON "accounting_invoices"("status");
CREATE INDEX "accounting_invoices_createdAt_idx" ON "accounting_invoices"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_invoices" ADD CONSTRAINT "accounting_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
