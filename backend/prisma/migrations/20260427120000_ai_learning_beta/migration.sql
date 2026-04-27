-- AlterTable: AiConfig — beta mode fields
ALTER TABLE "ai_configs" ADD COLUMN "betaMode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ai_configs" ADD COLUMN "betaContactIds" JSONB NOT NULL DEFAULT '[]';

-- AlterTable: AiBusinessMemory — learning engine fields
ALTER TABLE "ai_business_memories" ADD COLUMN "learnedFaq" JSONB;
ALTER TABLE "ai_business_memories" ADD COLUMN "learnedProducts" JSONB;
ALTER TABLE "ai_business_memories" ADD COLUMN "learnedObjections" JSONB;
ALTER TABLE "ai_business_memories" ADD COLUMN "learningStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "ai_business_memories" ADD COLUMN "learningProgress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_business_memories" ADD COLUMN "learningError" TEXT;
ALTER TABLE "ai_business_memories" ADD COLUMN "learnedAt" TIMESTAMP(3);
