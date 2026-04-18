-- CreateTable
CREATE TABLE "tsoft_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tsoftId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Yeni',
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "billingAddress" JSONB,
    "shippingAddress" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "tsoftCreatedAt" TIMESTAMP(3),
    "contactId" TEXT,
    "sentAutoReply" BOOLEAN NOT NULL DEFAULT false,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tsoft_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tsoft_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tsoftItemId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "imageUrl" TEXT,

    CONSTRAINT "tsoft_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tsoft_auto_replies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tsoft_auto_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tsoft_orders_organizationId_tsoftCreatedAt_idx" ON "tsoft_orders"("organizationId", "tsoftCreatedAt" DESC);

-- CreateIndex
CREATE INDEX "tsoft_orders_contactId_idx" ON "tsoft_orders"("contactId");

-- CreateIndex
CREATE INDEX "tsoft_orders_customerPhone_idx" ON "tsoft_orders"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "tsoft_orders_organizationId_tsoftId_key" ON "tsoft_orders"("organizationId", "tsoftId");

-- CreateIndex
CREATE INDEX "tsoft_order_items_orderId_idx" ON "tsoft_order_items"("orderId");

-- CreateIndex
CREATE INDEX "tsoft_auto_replies_organizationId_idx" ON "tsoft_auto_replies"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "tsoft_auto_replies_organizationId_eventType_key" ON "tsoft_auto_replies"("organizationId", "eventType");

-- AddForeignKey
ALTER TABLE "tsoft_orders" ADD CONSTRAINT "tsoft_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tsoft_orders" ADD CONSTRAINT "tsoft_orders_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tsoft_order_items" ADD CONSTRAINT "tsoft_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "tsoft_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tsoft_auto_replies" ADD CONSTRAINT "tsoft_auto_replies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
