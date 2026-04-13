-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'TRIALING', 'EXPIRED');

-- Convert existing plan column from string to enum
ALTER TABLE "organizations" ADD COLUMN "plan_new" "PlanType" NOT NULL DEFAULT 'FREE';
UPDATE "organizations" SET "plan_new" = CASE
  WHEN "plan" = 'premium' THEN 'ENTERPRISE'::"PlanType"
  WHEN "plan" = 'professional' THEN 'PROFESSIONAL'::"PlanType"
  WHEN "plan" = 'starter' THEN 'STARTER'::"PlanType"
  ELSE 'FREE'::"PlanType"
END;
ALTER TABLE "organizations" DROP COLUMN "plan";
ALTER TABLE "organizations" RENAME COLUMN "plan_new" TO "plan";

-- Add branding columns
ALTER TABLE "organizations" ADD COLUMN "logo" TEXT;
ALTER TABLE "organizations" ADD COLUMN "primaryColor" TEXT NOT NULL DEFAULT '#25D366';
ALTER TABLE "organizations" ADD COLUMN "secondaryColor" TEXT NOT NULL DEFAULT '#1a2238';

-- Add billing columns
ALTER TABLE "organizations" ADD COLUMN "billingEmail" TEXT;
ALTER TABLE "organizations" ADD COLUMN "billingName" TEXT;
ALTER TABLE "organizations" ADD COLUMN "billingAddress" TEXT;
ALTER TABLE "organizations" ADD COLUMN "taxNumber" TEXT;

-- CreateTable subscriptions
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "PlanType" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "priceMonthly" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "iyzicoSubRef" TEXT,
    "iyzicoCustomerRef" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable invoices
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "iyzicoPaymentId" TEXT,
    "description" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_iyzicoSubRef_key" ON "subscriptions"("iyzicoSubRef");
CREATE INDEX "subscriptions_organizationId_idx" ON "subscriptions"("organizationId");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");
CREATE INDEX "invoices_organizationId_idx" ON "invoices"("organizationId");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
