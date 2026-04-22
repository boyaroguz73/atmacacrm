-- Re-run safe one-time assignment backfill by WA session name suffix mapping
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
