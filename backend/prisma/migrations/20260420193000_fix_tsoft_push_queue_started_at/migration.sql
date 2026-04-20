-- Hotfix: bazı ortamlarda tsoft_push_queue tablosu startedAt kolonu olmadan kalmış olabilir.
-- Bu migration yalnızca eksik kolonu ekler, veri silmez/değiştirmez.

ALTER TABLE "tsoft_push_queue"
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
