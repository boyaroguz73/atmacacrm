-- organizationId Prisma şemasında var; ilk tablo migration'larında yoktu — eksik kolon Prisma sorgularında 500 üretiyordu.

-- message_templates
ALTER TABLE "message_templates" ADD COLUMN "organizationId" TEXT;

CREATE INDEX "message_templates_organizationId_idx" ON "message_templates"("organizationId");

ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- auto_reply_flows
ALTER TABLE "auto_reply_flows" ADD COLUMN "organizationId" TEXT;

CREATE INDEX "auto_reply_flows_organizationId_idx" ON "auto_reply_flows"("organizationId");

ALTER TABLE "auto_reply_flows" ADD CONSTRAINT "auto_reply_flows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
