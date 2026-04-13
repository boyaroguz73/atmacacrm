#!/usr/bin/env bash
# Repo kökünde (docker-compose.yml'in olduğu dizin) çalıştırın:
#   bash backend/scripts/delivery-reset-database.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

echo "==> public şeması DROP + yeniden oluşturuluyor"
docker compose exec -T postgres psql -U crm_user -d whatsapp_crm < "$SCRIPT_DIR/delivery-reset-database.sql"

echo "==> Prisma migrasyonları uygulanıyor (boş tablolar)"
docker compose exec backend npx prisma migrate deploy

echo "Tamam. İlk kullanıcı için (varsa): docker compose exec backend npx prisma db seed"
echo "Servisleri yenilemek için: docker compose restart backend frontend"
