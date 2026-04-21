-- 1) Automation run state table for step-based flow engine
CREATE TABLE "automation_runs" (
  "id" TEXT NOT NULL,
  "flowId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "contactId" TEXT,
  "conversationId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "currentStep" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "context" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_runs_dedupeKey_key" ON "automation_runs"("dedupeKey");
CREATE INDEX "automation_runs_organizationId_status_nextRunAt_idx" ON "automation_runs"("organizationId", "status", "nextRunAt");
CREATE INDEX "automation_runs_flowId_status_idx" ON "automation_runs"("flowId", "status");
CREATE INDEX "automation_runs_entityType_entityId_idx" ON "automation_runs"("entityType", "entityId");

ALTER TABLE "automation_runs"
ADD CONSTRAINT "automation_runs_flowId_fkey"
FOREIGN KEY ("flowId") REFERENCES "auto_reply_flows"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) One-time assignment backfill by session name suffix mapping
-- Session name number => agent
-- 0415 -> Umeyma
-- 0456 -> Betül
-- 0440 -> Sümeyye
WITH mapping AS (
  SELECT '%0415%'::text AS session_like, 'Umeyma'::text AS full_name, 'umeyma@atmacaofis.com.tr'::text AS email
  UNION ALL
  SELECT '%0456%'::text, 'Betül'::text, 'betul@atmacaofis.com.tr'::text
  UNION ALL
  SELECT '%0440%'::text, 'Sümeyye'::text, 'sumeyye@atmacaofis.com.tr'::text
),
target AS (
  SELECT
    c.id AS "conversationId",
    u.id AS "userId"
  FROM "conversations" c
  JOIN "whatsapp_sessions" ws ON ws.id = c."sessionId"
  JOIN mapping m ON ws."name" ILIKE m.session_like
  JOIN "contacts" ct ON ct.id = c."contactId"
  JOIN "users" u
    ON u."organizationId" = ct."organizationId"
   AND u."role" = 'AGENT'
   AND u."isActive" = true
   AND (LOWER(u."name") = LOWER(m.full_name) OR LOWER(u."email") = LOWER(m.email))
),
closed_prev AS (
  UPDATE "assignments" a
  SET "unassignedAt" = NOW()
  FROM target t
  WHERE a."conversationId" = t."conversationId"
    AND a."unassignedAt" IS NULL
    AND a."userId" <> t."userId"
  RETURNING a."conversationId"
)
INSERT INTO "assignments" ("id", "conversationId", "userId", "assignedAt")
SELECT md5(random()::text || clock_timestamp()::text), t."conversationId", t."userId", NOW()
FROM target t
LEFT JOIN "assignments" active_a
  ON active_a."conversationId" = t."conversationId"
 AND active_a."unassignedAt" IS NULL
WHERE active_a."id" IS NULL;
