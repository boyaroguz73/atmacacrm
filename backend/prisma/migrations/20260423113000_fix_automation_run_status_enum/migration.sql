-- automation_runs.status TEXT -> enum uyumu
-- Hedef: Prisma şemasındaki AutomationRunStatus tipine geçirmek.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'AutomationRunStatus'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
  END IF;
END
$$;

-- Beklenmeyen / null durumları güvenli bir değere çek
UPDATE "automation_runs"
SET "status" = 'FAILED'
WHERE "status" IS NULL
   OR UPPER("status") NOT IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- Küçük/büyük harf farklarını normalize et
UPDATE "automation_runs"
SET "status" = UPPER("status")
WHERE "status" <> UPPER("status");

ALTER TABLE "automation_runs"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "automation_runs"
  ALTER COLUMN "status" TYPE "AutomationRunStatus"
  USING UPPER("status")::"AutomationRunStatus";

ALTER TABLE "automation_runs"
  ALTER COLUMN "status" SET DEFAULT 'PENDING'::"AutomationRunStatus";

