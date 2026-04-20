-- CRM→T-Soft push edilen siparişler ham OrderId ile yazılıyordu;
-- pull tarafı `tsoft_<id>` formatı kullandığı için dedup kırılıyor ve duplicate oluşabiliyordu.
-- Yalnızca prefix'siz + `tsoft_<id>` karşılığı HENÜZ yoksa güvenle güncelle (unique çakışmasını atla).
UPDATE "sales_orders" s
SET "externalId" = 'tsoft_' || s."externalId"
WHERE s."externalId" IS NOT NULL
  AND s."tsoftSiteOrderId" IS NOT NULL
  AND left(s."externalId", 6) <> 'tsoft_'
  AND NOT EXISTS (
    SELECT 1 FROM "sales_orders" t
    WHERE t."externalId" = 'tsoft_' || s."externalId"
  );
