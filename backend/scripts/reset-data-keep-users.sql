-- Satırları temizler (TRUNCATE); tablolar kalır. Müşteriye BOŞ kurulum için bunu değil,
-- delivery-reset-database.sql + migrate deploy kullanın.
--
-- Veritabanındaki iş verisini siler; SADECE "users" tablosundaki kayıtlar kalır.
-- _prisma_migrations dokunulmaz (şema geçmişi korunur).
-- Çalıştırmadan önce mutlaka yedek alın.
--
-- Örnek (Docker):
--   docker compose exec -T postgres psql -U crm_user -d whatsapp_crm -f - < backend/scripts/reset-data-keep-users.sql
-- veya psql içinde \i ile dosyayı çağırın.

BEGIN;

UPDATE "users" SET "organizationId" = NULL;

-- CASCADE kullanmıyoruz: yanlışlıkla "users" veya migrasyon tablosuna sıçramasın.
TRUNCATE TABLE "accounting_invoices" RESTART IDENTITY;
TRUNCATE TABLE "order_items" RESTART IDENTITY;
TRUNCATE TABLE "sales_orders" RESTART IDENTITY;
TRUNCATE TABLE "quote_items" RESTART IDENTITY;
TRUNCATE TABLE "quotes" RESTART IDENTITY;
TRUNCATE TABLE "products" RESTART IDENTITY;
TRUNCATE TABLE "internal_notes" RESTART IDENTITY;
TRUNCATE TABLE "assignments" RESTART IDENTITY;
TRUNCATE TABLE "messages" RESTART IDENTITY;
TRUNCATE TABLE "conversations" RESTART IDENTITY;
TRUNCATE TABLE "activities" RESTART IDENTITY;
TRUNCATE TABLE "leads" RESTART IDENTITY;
TRUNCATE TABLE "tasks" RESTART IDENTITY;
TRUNCATE TABLE "agent_metrics" RESTART IDENTITY;
TRUNCATE TABLE "ticket_messages" RESTART IDENTITY;
TRUNCATE TABLE "support_tickets" RESTART IDENTITY;
TRUNCATE TABLE "password_resets" RESTART IDENTITY;
TRUNCATE TABLE "audit_logs" RESTART IDENTITY;
TRUNCATE TABLE "auto_reply_flows" RESTART IDENTITY;
TRUNCATE TABLE "message_templates" RESTART IDENTITY;
-- Bazı eski veritabanlarında tablo olmayabilir
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'org_integrations'
  ) THEN
    EXECUTE 'TRUNCATE TABLE "org_integrations" RESTART IDENTITY';
  END IF;
END $$;
TRUNCATE TABLE "subscriptions" RESTART IDENTITY;
TRUNCATE TABLE "invoices" RESTART IDENTITY;
TRUNCATE TABLE "contacts" RESTART IDENTITY;
TRUNCATE TABLE "whatsapp_sessions" RESTART IDENTITY;
TRUNCATE TABLE "organizations" RESTART IDENTITY;
TRUNCATE TABLE "system_settings" RESTART IDENTITY;

COMMIT;
