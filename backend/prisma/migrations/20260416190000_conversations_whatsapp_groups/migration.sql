-- WhatsApp grup sohbetleri: conversations.isGroup, waGroupId, ...
-- Grup mesajları: messages.participantPhone / participantName
-- Şema ile uyum; kolon varsa atlanır

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "waGroupId" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "groupName" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "groupDescription" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "groupAvatarUrl" TEXT;

CREATE INDEX IF NOT EXISTS "conversations_isGroup_idx" ON "conversations"("isGroup");

-- Prisma: @@unique([waGroupId, sessionId])
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_waGroupId_sessionId_key" UNIQUE ("waGroupId", "sessionId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "participantPhone" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "participantName" TEXT;

CREATE INDEX IF NOT EXISTS "messages_participantPhone_idx" ON "messages"("participantPhone");
