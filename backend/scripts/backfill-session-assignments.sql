-- Tek seferlik: eski sohbetleri session adına göre temsilciye ata.
-- 0415 → Umeyma, 0456 → Betül, 0440 → Sümeyye.
-- Aktif atama (unassignedAt IS NULL) olan sohbetlere dokunmaz.

INSERT INTO "assignments" (id, "conversationId", "userId", "assignedAt")
SELECT gen_random_uuid(), c.id, u.id, NOW()
FROM "conversations" c
JOIN "whatsapp_sessions" s ON s.id = c."sessionId"
JOIN "users" u ON u.name = CASE s.name
    WHEN '0415' THEN 'Umeyma'
    WHEN '0456' THEN 'Betül'
    WHEN '0440' THEN 'Sümeyye'
  END
WHERE s.name IN ('0415', '0456', '0440')
  AND NOT EXISTS (
    SELECT 1 FROM "assignments" a
    WHERE a."conversationId" = c.id AND a."unassignedAt" IS NULL
  );

-- Dağılımı görmek için:
-- SELECT u.name, COUNT(*) FROM "assignments" a
-- JOIN "users" u ON u.id = a."userId"
-- WHERE a."unassignedAt" IS NULL
-- GROUP BY u.name;
