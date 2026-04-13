-- org_integrations: şemada vardı, migration eksikti; GET /integrations Prisma hatası -> 500
CREATE TABLE IF NOT EXISTS "org_integrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationKey" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_integrations_organizationId_integrationKey_key"
    ON "org_integrations"("organizationId", "integrationKey");

CREATE INDEX IF NOT EXISTS "org_integrations_organizationId_idx"
    ON "org_integrations"("organizationId");

DO $$ BEGIN
    ALTER TABLE "org_integrations"
        ADD CONSTRAINT "org_integrations_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
