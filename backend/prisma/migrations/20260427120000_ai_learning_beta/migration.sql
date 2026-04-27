-- AlterTable: AiConfig — beta mode fields
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "betaMode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "betaContactIds" JSONB NOT NULL DEFAULT '[]';

-- AlterTable: AiBusinessMemory — learning engine fields
ALTER TABLE "ai_business_memories" ADD COLUMN IF NOT EXISTS "learnedFaq" JSONB;
ALTER TABLE "ai_business_memories" ADD COLUMN IF NOT EXISTS "learnedProducts" JSONB;
ALTER TABLE "ai_business_memories" ADD COLUMN IF NOT EXISTS "learnedObjections" JSONB;
ALTER TABLE "ai_business_memories" ADD COLUMN IF NOT EXISTS "learningStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "ai_business_memories" ADD COLUMN IF NOT EXISTS "learningProgress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_business_memories" ADD COLUMN IF NOT EXISTS "learningError" TEXT;
ALTER TABLE "ai_business_memories" ADD COLUMN IF NOT EXISTS "learnedAt" TIMESTAMP(3);
