-- CreateTable: ai_configs
CREATE TABLE IF NOT EXISTS "ai_configs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'BALANCED',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 500,
    "openaiKey" TEXT,
    "customerMemoryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "betaMode" BOOLEAN NOT NULL DEFAULT true,
    "betaContactIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_configs_organizationId_key" ON "ai_configs"("organizationId");

-- CreateTable: ai_action_policies
CREATE TABLE IF NOT EXISTS "ai_action_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'OFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_action_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_action_policies_organizationId_action_key" ON "ai_action_policies"("organizationId", "action");
CREATE INDEX IF NOT EXISTS "ai_action_policies_organizationId_idx" ON "ai_action_policies"("organizationId");

-- CreateTable: ai_business_memories
CREATE TABLE IF NOT EXISTS "ai_business_memories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sector" TEXT,
    "tone" TEXT,
    "salesStyle" TEXT,
    "pricingBehavior" TEXT,
    "objectionPatterns" TEXT,
    "closingPatterns" TEXT,
    "rawMemory" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "analyzeStatus" TEXT NOT NULL DEFAULT 'idle',
    "analyzeProgress" INTEGER NOT NULL DEFAULT 0,
    "analyzeError" TEXT,
    "learnedFaq" JSONB,
    "learnedProducts" JSONB,
    "learnedObjections" JSONB,
    "learningStatus" TEXT NOT NULL DEFAULT 'idle',
    "learningProgress" INTEGER NOT NULL DEFAULT 0,
    "learningError" TEXT,
    "learnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_business_memories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_business_memories_organizationId_key" ON "ai_business_memories"("organizationId");

-- CreateTable: ai_prompts
CREATE TABLE IF NOT EXISTS "ai_prompts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "salesPrompt" TEXT,
    "supportPrompt" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "customTone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_prompts_organizationId_key" ON "ai_prompts"("organizationId");

-- CreateTable: ai_automation_rules
CREATE TABLE IF NOT EXISTS "ai_automation_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_automation_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_automation_rules_organizationId_idx" ON "ai_automation_rules"("organizationId");

-- CreateTable: ai_pending_actions
CREATE TABLE IF NOT EXISTS "ai_pending_actions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "contactId" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "suggestion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_pending_actions_organizationId_status_idx" ON "ai_pending_actions"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "ai_pending_actions_organizationId_createdAt_idx" ON "ai_pending_actions"("organizationId", "createdAt" DESC);

-- CreateTable: ai_logs
CREATE TABLE IF NOT EXISTS "ai_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "contactId" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "action" TEXT NOT NULL,
    "input" TEXT,
    "output" TEXT,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_logs_organizationId_createdAt_idx" ON "ai_logs"("organizationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ai_logs_organizationId_action_idx" ON "ai_logs"("organizationId", "action");
CREATE INDEX IF NOT EXISTS "ai_logs_organizationId_status_idx" ON "ai_logs"("organizationId", "status");

-- AddForeignKey constraints (only if organizations table exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_configs_organizationId_fkey') THEN
    ALTER TABLE "ai_configs" ADD CONSTRAINT "ai_configs_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_action_policies_organizationId_fkey') THEN
    ALTER TABLE "ai_action_policies" ADD CONSTRAINT "ai_action_policies_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_business_memories_organizationId_fkey') THEN
    ALTER TABLE "ai_business_memories" ADD CONSTRAINT "ai_business_memories_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_prompts_organizationId_fkey') THEN
    ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_automation_rules_organizationId_fkey') THEN
    ALTER TABLE "ai_automation_rules" ADD CONSTRAINT "ai_automation_rules_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_pending_actions_organizationId_fkey') THEN
    ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_logs_organizationId_fkey') THEN
    ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
