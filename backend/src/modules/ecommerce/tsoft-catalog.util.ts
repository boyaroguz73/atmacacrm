/** Görsel URL / img etiketlerini DB kaydından çıkarır (isteğe uygun: görseller ayrı). */
export function stripHtmlImages(html: string | null | undefined): string | null {
  if (html == null || String(html).trim() === '') return null;
  return String(html)
    .replace(/<img[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scrubImageFields(obj: unknown): unknown {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(scrubImageFields);
  if (typeof obj !== 'object') return obj;
  const o = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (/^(image|img|photo|thumbnail)/i.test(k)) continue;
    if (k.toLowerCase().includes('imageurl')) continue;
    if (k === 'Images' || k === 'ImageList') continue;
    out[k] = scrubImageFields(v);
  }
  return out;
}

export function rowToCatalogDraft(
  organizationId: string,
  row: Record<string, unknown>,
): {
  organizationId: string;
  tsoftProductId: string | null;
  productCode: string;
  barcode: string | null;
  productName: string;
  sellingPrice: number | null;
  listPrice: number | null;
  buyingPrice: number | null;
  currency: string;
  stock: number | null;
  vatRate: number | null;
  brand: string | null;
  model: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  isActive: boolean;
  shortDescription: string | null;
  detailsText: string | null;
  subproductsJson: object | null;
  rawSnapshotJson: object | null;
} {
  const productCode = String(row.ProductCode ?? row.productCode ?? '').trim();
  const productName = String(row.ProductName ?? row.name ?? 'İsimsiz').trim() || 'İsimsiz';

  const selling = row.SellingPrice ?? row.sellingPrice ?? row.SalePrice;
  const listP = row.ListPrice ?? row.listPrice ?? row.PriceList;
  const buying = row.BuyingPrice ?? row.buyingPrice;

  const stockRaw = row.Stock ?? row.stock;
  const stock =
    stockRaw === null || stockRaw === undefined || stockRaw === ''
      ? null
      : Math.round(Number(stockRaw));

  const vatRaw = row.Vat ?? row.vat ?? row.VatRate;
  const vatRate =
    vatRaw === null || vatRaw === undefined || vatRaw === ''
      ? null
      : Math.round(Number(vatRaw));

  const cur = String(row.Currency ?? row.currency ?? 'TRY').trim() || 'TRY';

  const shortDesc = stripHtmlImages(String(row.ShortDescription ?? row.shortDescription ?? ''));
  const details = stripHtmlImages(String(row.Details ?? row.details ?? row.Description ?? ''));

  let subJson: object | null = null;
  const subs = row.SubProducts ?? row.subProducts;
  if (Array.isArray(subs) && subs.length > 0) {
    subJson = scrubImageFields(subs) as object;
  }

  const rawScrubbed = scrubImageFields(row) as object;

  const isActive =
    row.IsActive === true ||
    row.IsActive === 1 ||
    row.IsActive === '1' ||
    row.isActive === true ||
    row.isActive === 1;

  return {
    organizationId,
    tsoftProductId: row.ProductId != null ? String(row.ProductId) : null,
    productCode: productCode || String(row.ProductId ?? ''),
    barcode: row.Barcode != null ? String(row.Barcode).trim() || null : null,
    productName,
    sellingPrice: selling != null && selling !== '' ? Number(selling) : null,
    listPrice: listP != null && listP !== '' ? Number(listP) : null,
    buyingPrice: buying != null && buying !== '' ? Number(buying) : null,
    currency: cur.slice(0, 12),
    stock,
    vatRate: vatRate != null && Number.isFinite(vatRate) ? vatRate : null,
    brand: row.Brand != null ? String(row.Brand).trim() || null : null,
    model: row.Model != null ? String(row.Model).trim() || null : null,
    categoryCode:
      row.DefaultCategoryCode != null ? String(row.DefaultCategoryCode).trim() || null : null,
    categoryName: row.CategoryName != null ? String(row.CategoryName).trim() || null : null,
    isActive: isActive !== false,
    shortDescription: shortDesc,
    detailsText: details,
    subproductsJson: subJson,
    rawSnapshotJson: rawScrubbed,
  };
}
