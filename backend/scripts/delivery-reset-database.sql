-- Müşteriye / temiz kuruluma hazır BOŞ veritabanı: tüm tablolar + migration geçmişi silinir.
-- Sonrasında mutlaka: docker compose exec backend npx prisma migrate deploy
-- (İsteğe bağlı) docker compose exec backend npx prisma db seed
--
-- psql ile çalıştırın; dosya SUNUCUDA repo içinde olmalı (önce git pull).
-- Örnek (compose kökünden, örn. /opt/atmaca-crm):
--   docker compose exec -T postgres psql -U crm_user -d whatsapp_crm < backend/scripts/delivery-reset-database.sql
--
-- Not: crm_user süper kullanıcı değilse DROP SCHEMA yetkisi verilemez; o zaman postgres süperuser ile çalıştırın.

BEGIN;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Docker Compose varsayılanı: POSTGRES_USER=crm_user
ALTER SCHEMA public OWNER TO crm_user;
GRANT ALL ON SCHEMA public TO crm_user;
GRANT USAGE ON SCHEMA public TO public;

COMMIT;
