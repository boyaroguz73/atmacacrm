import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TsoftApiService } from './tsoft-api.service';

/**
 * T-Soft REST1 ürün satırlarını CRM `products` + `product_variants` tablolarına
 * upsert eden servis. Amaç: chat / teklif / sipariş tek DB kaynağından
 * (productFeedSource=TSOFT veya MANUAL karışık) ürünleri tüketir.
 *
 * Çakışma kuralı (plan §PR-4):
 *   products.pendingPushOp IS NOT NULL olan kayıtlar pull sync tarafından
 *   ATLANIR — yerel düzenleme T-Soft push ile teyit edilene dek korunur.
 */
export interface TsoftProductSyncOptions {
  variants?: boolean;
  images?: boolean;
  stock?: boolean;
  price?: boolean;
  descriptions?: boolean;
}

export interface TsoftProductSyncResult {
  fetched: number;
  upsertedProducts: number;
  upsertedVariants: number;
  skippedPendingPush: number;
  sweepedInactive: number;
  errors: { productCode?: string; message: string }[];
}

const TRUE_LIKE = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

function toNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNullableInt(v: unknown): number | null {
  const n = toNullableNumber(v);
  return n == null ? null : Math.round(n);
}

function pickString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return null;
}

function looksLikeImageUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^\/\//.test(s)) return true;
  if (/^\/[^/]/.test(s)) return true;
  if (/^[\w./-]+\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i.test(s)) return true;
  return false;
}

function normalizeRemoteImageUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (s.startsWith('//')) return `https:${s}`;
  return s;
}

function extractImageUrls(row: Record<string, unknown>): string[] {
  const urls = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === 'string') {
      const normalized = normalizeRemoteImageUrl(v);
      if (looksLikeImageUrl(normalized)) urls.add(normalized);
    }
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const u = pickString(
        o['ImageUrl'],
        o['Url'],
        o['url'],
        o['ImagePath'],
        o['PicturePath'],
        o['PictureUrl'],
        o['VariantImage'],
        o['Photo'],
        o['Resim'],
      );
      if (u) {
        const normalized = normalizeRemoteImageUrl(u);
        if (looksLikeImageUrl(normalized)) urls.add(normalized);
      }
    }
  };
  // Ana görsel anahtarları
  push(row['ImageUrl']);
  push(row['Image']);
  push(row['MainImage']);
  push(row['Thumbnail']);
  push(row['PicturePath']);
  push(row['PictureUrl']);
  push(row['VariantImage']);
  push(row['Photo']);
  push(row['Resim']);
  // Çoklu görsel dizileri
  for (const key of ['ImageUrls', 'Images', 'ImageList', 'AdditionalImages', 'Pictures', 'PhotoList']) {
    const arr = row[key];
    if (Array.isArray(arr)) arr.forEach(push);
  }
  return Array.from(urls);
}

function buildVariantName(v: Record<string, unknown>, fallbackCode?: string | null): string {
  const direct = pickString(
    v.ProductName,
    v.VariantName,
    v.Name,
    v.OptionValue,
    v.OptionName,
    v.VariantTitle,
    v.Title,
    v.Type1,
    v.Type2,
    v.ColorName,
    v.SizeName,
  );
  if (direct) return direct;

  const pieces = [
    pickString(v.ColorName, v.Color, v.Renk),
    pickString(v.SizeName, v.Size, v.Beden),
    pickString(v.PatternName, v.Pattern, v.Desen),
    pickString(v.Type1),
    pickString(v.Type2),
    pickString(v.Option1Value),
    pickString(v.Option2Value),
    pickString(v.Option3Value),
  ].filter((x): x is string => !!x && x.trim().length > 0);
  if (pieces.length) return pieces.join(' / ');

  const code =
    pickString(v.VariantCode, v.SubProductCode, v.ProductCode, v.Barcode, v.Sku) ||
    (fallbackCode ? String(fallbackCode) : '');
  if (code.trim()) return code.trim();

  return 'Varyant';
}

@Injectable()
export class TsoftProductSyncService {
  private readonly logger = new Logger(TsoftProductSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tsoftApi: TsoftApiService,
  ) {}

  /**
   * T-Soft'tan tüm ürünleri çeker; CRM DB'sine upsert eder.
   * Sweep: görmediğimiz TSOFT kaynaklı ürünleri `isActive=false` yapar (silmez).
   */
  async syncTsoftProducts(
    organizationId: string,
    opts: TsoftProductSyncOptions = {},
  ): Promise<TsoftProductSyncResult> {
    const includeVariants = opts.variants ?? true;
    const includeImages = opts.images ?? true;
    const includeStock = opts.stock ?? true;
    const includePrice = opts.price ?? true;
    const includeDescriptions = opts.descriptions ?? true;

    this.logger.log(`[TSOFT-PRODUCT-SYNC] başlıyor org=${organizationId}`);

    const rows = await this.tsoftApi.fetchAllProducts(organizationId, {
      detailed: true,
      pageSize: 50,
      delayMs: 200,
    });
    this.logger.log(`[TSOFT-PRODUCT-SYNC] ${rows.length} ürün alındı`);

    const result: TsoftProductSyncResult = {
      fetched: rows.length,
      upsertedProducts: 0,
      upsertedVariants: 0,
      skippedPendingPush: 0,
      sweepedInactive: 0,
      errors: [],
    };

    const seenTsoftIds = new Set<string>();

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      try {
        const upserted = await this.upsertOneProduct(organizationId, row, {
          includeVariants,
          includeImages,
          includeStock,
          includePrice,
          includeDescriptions,
        });
        if (upserted.skipped) {
          result.skippedPendingPush++;
          // Yine de sweep'e dahil olmaması için ID'yi kaydet.
          if (upserted.tsoftId) seenTsoftIds.add(upserted.tsoftId);
        } else if (upserted.tsoftId) {
          seenTsoftIds.add(upserted.tsoftId);
          result.upsertedProducts++;
          result.upsertedVariants += upserted.variantCount;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `[TSOFT-PRODUCT-SYNC] upsert hatası: ${msg} (row=${JSON.stringify(row).slice(0, 200)})`,
        );
        result.errors.push({
          productCode: pickString(row.ProductCode, row.productCode) || undefined,
          message: msg.slice(0, 240),
        });
      }
    }

    // Sweep: görmediğimiz TSOFT ürünleri pasifle.
    if (seenTsoftIds.size > 0) {
      const swept = await this.prisma.product.updateMany({
        where: {
          productFeedSource: 'TSOFT',
          tsoftId: { notIn: Array.from(seenTsoftIds) },
          isActive: true,
        },
        data: { isActive: false },
      });
      result.sweepedInactive = swept.count;
      if (swept.count) {
        this.logger.log(
          `[TSOFT-PRODUCT-SYNC] sweep: ${swept.count} ürün isActive=false yapıldı`,
        );
      }
    }

    this.logger.log(
      `[TSOFT-PRODUCT-SYNC] bitti: ${result.upsertedProducts} ürün + ${result.upsertedVariants} varyant; skip=${result.skippedPendingPush} sweep=${result.sweepedInactive} err=${result.errors.length}`,
    );
    return result;
  }

  // ─── Tek kayıt upsert ──────────────────────────────────────────────────

  private async upsertOneProduct(
    _organizationId: string,
    row: Record<string, unknown>,
    flags: {
      includeVariants: boolean;
      includeImages: boolean;
      includeStock: boolean;
      includePrice: boolean;
      includeDescriptions: boolean;
    },
  ): Promise<{ skipped: boolean; tsoftId: string | null; variantCount: number }> {
    const tsoftId = pickString(row.ProductId, row.productId);
    const productCode = pickString(row.ProductCode, row.productCode);
    const barcode = pickString(row.Barcode, row.barcode);
    const productName =
      pickString(row.ProductName, row.name) || `T-Soft ürünü ${tsoftId ?? ''}`.trim();

    if (!tsoftId && !productCode) {
      return { skipped: true, tsoftId: null, variantCount: 0 };
    }

    // SKU (benzersiz) seçimi: productCode > barcode > tsoftId fallback
    const sku = productCode || barcode || (tsoftId ? `TSOFT-${tsoftId}` : null);
    if (!sku) return { skipped: true, tsoftId, variantCount: 0 };

    // Önce aynı tsoftId veya sku ile eşleşen ürünü bul; pendingPushOp varsa atla
    const existing = tsoftId
      ? await this.prisma.product.findUnique({ where: { tsoftId } })
      : await this.prisma.product.findUnique({ where: { sku } });

    if (existing?.pendingPushOp) {
      this.logger.debug(
        `[TSOFT-PRODUCT-SYNC] pending push var, atlanıyor sku=${existing.sku} op=${existing.pendingPushOp}`,
      );
      return { skipped: true, tsoftId, variantCount: 0 };
    }

    const priceSelling = toNullableNumber(row.SellingPrice ?? row.sellingPrice ?? row.SalePrice);
    const priceList = toNullableNumber(row.ListPrice ?? row.listPrice);
    const unitPrice = priceSelling ?? priceList ?? 0;
    const currency = (pickString(row.Currency, row.currency) || 'TRY').slice(0, 12);
    const vatRate = toNullableInt(row.Vat ?? row.vat ?? row.VatRate) ?? 20;
    const stock = flags.includeStock
      ? toNullableInt(row.Stock ?? row.stock)
      : existing?.stock ?? null;
    const isActive = !(
      row.IsActive === false ||
      row.IsActive === 0 ||
      row.IsActive === '0' ||
      row.isActive === false ||
      row.isActive === 0
    );

    const images = flags.includeImages ? extractImageUrls(row) : [];
    const mainImage = images[0] ?? null;
    const additionalImages = images.length > 1 ? images.slice(1) : null;

    const description = flags.includeDescriptions
      ? pickString(row.ShortDescription, row.Description, row.Details) ?? null
      : existing?.description ?? null;

    const brand = pickString(row.Brand) ?? null;
    const categoryName = pickString(row.CategoryName, row.DefaultCategoryName) ?? null;

    const baseData: Prisma.ProductUncheckedCreateInput = {
      sku,
      name: productName,
      description,
      unit: 'Adet',
      unitPrice,
      currency,
      vatRate,
      priceIncludesVat: false, // T-Soft fiyatları genelde KDV hariç; ürün bazlı override edilebilir.
      stock,
      isActive,
      productFeedSource: 'TSOFT',
      tsoftId: tsoftId ?? undefined,
      tsoftLastPulledAt: new Date(),
      pendingPushOp: null,
      imageUrl: mainImage,
      additionalImages: (additionalImages ?? undefined) as Prisma.InputJsonValue | undefined,
      brand,
      category: categoryName,
      listPrice: flags.includePrice ? priceList : existing?.listPrice ?? null,
      salePriceAmount: flags.includePrice ? priceSelling : existing?.salePriceAmount ?? null,
    };

    const product = await this.prisma.product.upsert({
      where: tsoftId ? { tsoftId } : { sku },
      create: baseData,
      update: {
        name: productName,
        description: baseData.description,
        unitPrice,
        currency,
        vatRate,
        priceIncludesVat: false,
        ...(flags.includeStock ? { stock } : {}),
        isActive,
        tsoftId: tsoftId ?? undefined,
        tsoftLastPulledAt: new Date(),
        imageUrl: mainImage,
        additionalImages: (additionalImages ?? Prisma.JsonNull) as
          | Prisma.InputJsonValue
          | typeof Prisma.JsonNull,
        brand,
        category: categoryName,
        ...(flags.includePrice
          ? { listPrice: priceList, salePriceAmount: priceSelling }
          : {}),
        productFeedSource: 'TSOFT',
      },
    });

    let variantCount = 0;
    if (flags.includeVariants) {
      variantCount = await this.upsertVariants(product.id, row, flags);
    }

    return { skipped: false, tsoftId, variantCount };
  }

  // ─── Varyantlar ────────────────────────────────────────────────────────

  private async upsertVariants(
    productId: string,
    row: Record<string, unknown>,
    flags: { includeImages: boolean; includeStock: boolean; includePrice: boolean },
  ): Promise<number> {
    const subs = row.SubProducts ?? row.subProducts;
    if (!Array.isArray(subs) || subs.length === 0) return 0;

    const seenTsoftIds = new Set<string>();
    let count = 0;

    for (const raw of subs) {
      if (!raw || typeof raw !== 'object') continue;
      const v = raw as Record<string, unknown>;
      const vTsoftId = pickString(v.SubProductId, v.ProductId, v.VariantId, v.Id);
      const vExternal =
        pickString(v.ProductCode, v.VariantCode, v.Barcode, v.Sku) || vTsoftId;
      if (!vExternal) continue;

      const vSku = pickString(v.ProductCode, v.VariantCode, v.Barcode);
      const vName = buildVariantName(v, vExternal);
      const vUnitPrice =
        toNullableNumber(v.SellingPrice ?? v.sellingPrice ?? v.SalePrice ?? v.ListPrice) ?? 0;
      const vList = toNullableNumber(v.ListPrice ?? v.listPrice);
      const vSale = toNullableNumber(v.SellingPrice ?? v.sellingPrice ?? v.SalePrice);
      const vStock = flags.includeStock
        ? toNullableInt(v.Stock ?? v.stock)
        : null;
      const vCurrency = (pickString(v.Currency) || 'TRY').slice(0, 12);
      const vVat = toNullableInt(v.Vat ?? v.VatRate) ?? 20;
      const vIsActive = !(
        v.IsActive === false ||
        v.IsActive === 0 ||
        v.IsActive === '0'
      );

      const vImages = flags.includeImages ? extractImageUrls(v) : [];
      const vImage = vImages[0] ?? null;
      const vAdditional = vImages.length > 1 ? vImages.slice(1) : null;

      const vDescription = pickString(v.ShortDescription, v.Description) ?? null;

      // Benzersizlik: önce tsoftId, sonra externalId
      const existingVariant = vTsoftId
        ? await this.prisma.productVariant.findUnique({ where: { tsoftId: vTsoftId } })
        : await this.prisma.productVariant.findUnique({ where: { externalId: vExternal } });

      // externalId çakışması olabilir (aynı productCode başka ürüne ait) — bu durumda at
      if (existingVariant && existingVariant.productId !== productId) {
        this.logger.warn(
          `[TSOFT-PRODUCT-SYNC] varyant externalId çakıştı, atlanıyor: ${vExternal}`,
        );
        continue;
      }

      await this.prisma.productVariant.upsert({
        where: vTsoftId
          ? { tsoftId: vTsoftId }
          : { externalId: vExternal },
        create: {
          productId,
          externalId: vExternal,
          tsoftId: vTsoftId,
          sku: vSku,
          name: vName,
          description: vDescription,
          unitPrice: vUnitPrice,
          listPrice: flags.includePrice ? vList : null,
          salePriceAmount: flags.includePrice ? vSale : null,
          currency: vCurrency,
          vatRate: vVat,
          priceIncludesVat: false,
          stock: vStock,
          isActive: vIsActive,
          imageUrl: vImage,
          additionalImages: (vAdditional ?? undefined) as Prisma.InputJsonValue | undefined,
          metadata: v as Prisma.InputJsonValue,
        },
        update: {
          externalId: vExternal,
          tsoftId: vTsoftId,
          sku: vSku,
          name: vName,
          description: vDescription,
          unitPrice: vUnitPrice,
          ...(flags.includePrice
            ? { listPrice: vList, salePriceAmount: vSale }
            : {}),
          currency: vCurrency,
          vatRate: vVat,
          priceIncludesVat: false,
          ...(flags.includeStock ? { stock: vStock } : {}),
          isActive: vIsActive,
          imageUrl: vImage,
          additionalImages: (vAdditional ?? Prisma.JsonNull) as
            | Prisma.InputJsonValue
            | typeof Prisma.JsonNull,
          metadata: v as Prisma.InputJsonValue,
        },
      });

      if (vTsoftId) seenTsoftIds.add(vTsoftId);
      count++;
    }

    // Ürün altında artık olmayan varyantları pasifle.
    if (seenTsoftIds.size > 0) {
      await this.prisma.productVariant.updateMany({
        where: {
          productId,
          tsoftId: { notIn: Array.from(seenTsoftIds) },
          isActive: true,
        },
        data: { isActive: false },
      });
    }

    return count;
  }
}
