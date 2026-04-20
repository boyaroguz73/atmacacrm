-- Eski XML / Google Shopping içe aktarım kalıntıları (T-Soft bağlantısı olmayan, teklif/siparişe bağlı olmayan)
DELETE FROM "product_variants" pv
USING "products" p
WHERE pv."productId" = p.id
  AND p."tsoftId" IS NULL
  AND p."productFeedSource" = 'MANUAL'
  AND (
    p."sku" LIKE 'IG-%'
    OR (COALESCE(NULLIF(TRIM(p."googleProductCategory"), ''), '') <> '')
    OR (COALESCE(NULLIF(TRIM(p."googleProductType"), ''), '') <> '')
  )
  AND NOT EXISTS (SELECT 1 FROM "quote_items" qi WHERE qi."productId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."productId" = p.id);

DELETE FROM "products" p
WHERE p."tsoftId" IS NULL
  AND p."productFeedSource" = 'MANUAL'
  AND (
    p."sku" LIKE 'IG-%'
    OR (COALESCE(NULLIF(TRIM(p."googleProductCategory"), ''), '') <> '')
    OR (COALESCE(NULLIF(TRIM(p."googleProductType"), ''), '') <> '')
  )
  AND NOT EXISTS (SELECT 1 FROM "quote_items" qi WHERE qi."productId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."productId" = p.id);
