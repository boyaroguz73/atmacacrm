-- CRM'den T-Soft'a push edilen siparişler ham OrderId ile yazılıyordu;
-- pull tarafı `tsoft_<id>` formatı kullandığı için dedup kırılıyor ve duplicate oluşabiliyordu.
-- Aynı formata hizala.
UPDATE "SalesOrder"
SET "externalId" = 'tsoft_' || "externalId"
WHERE "externalId" IS NOT NULL
  AND "externalId" NOT LIKE 'tsoft\_%' ESCAPE '\'
  AND "tsoftSiteOrderId" IS NOT NULL;
