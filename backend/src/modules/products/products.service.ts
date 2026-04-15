import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ProductFeedSource } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import axios from 'axios';

function normalizeText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (Array.isArray(v)) return normalizeText(v[0]);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['#text'] === 'string') return o['#text'].trim();
    if (typeof o['__text'] === 'string') return o['__text'].trim();
  }
  return '';
}

/** Önek alanı: namespace kaldırılmış veya g: önekli anahtarlar */
function field(item: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const t = normalizeText(item[k]);
    if (t !== '') return t;
  }
  return '';
}

function parseGoogleMoney(raw: string): { amount: number; currency: string } {
  const s = (raw || '').trim();
  if (!s) return { amount: 0, currency: 'TRY' };
  const parts = s.split(/\s+/).filter(Boolean);
  const currency = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'TRY';
  const numPart = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
  const amount = parseFloat(String(numPart).replace(',', '.'));
  return { amount: Number.isFinite(amount) ? amount : 0, currency };
}

function saleWindowActive(rangeRaw: string | null | undefined, now: Date): boolean {
  const s = (rangeRaw ?? '').trim();
  if (!s) return true;
  const parts = s.split('/');
  if (parts.length < 2) return true;
  const start = new Date(parts[0].trim());
  const end = new Date(parts[1].trim());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true;
  return now >= start && now <= end;
}

/** Ana görsel: image_link / g:image_link; yoksa ilk additional_image_link */
function resolvePrimaryImageUrl(item: Record<string, unknown>): string | null {
  let main = field(item, 'image_link', 'g:image_link') || null;
  if (main && main.trim()) return main.trim();
  const add = collectAdditionalImages(item);
  return add[0]?.trim() || null;
}

function collectAdditionalImages(item: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const [k, v] of Object.entries(item)) {
    if (!k.includes('additional_image_link')) continue;
    if (Array.isArray(v)) {
      for (const x of v) {
        const u = normalizeText(x);
        if (u) urls.push(u);
      }
    } else {
      const u = normalizeText(v);
      if (u) urls.push(u);
    }
  }
  return urls;
}

function extractItems(parsed: unknown): Record<string, unknown>[] {
  const p = parsed as Record<string, unknown>;
  const rss = (p.rss ?? p) as Record<string, unknown>;
  const channel = (rss.channel ?? rss) as Record<string, unknown>;
  const items = channel.item;
  if (items == null) return [];
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [items as Record<string, unknown>];
}

function stockFromAvailability(av: string): number | null {
  const a = av.toLowerCase();
  if (a.includes('out of stock')) return 0;
  return null;
}

function activeFromAvailability(av: string): boolean {
  const a = av.toLowerCase();
  if (a.includes('out of stock')) return false;
  return true;
}

export type XmlSyncOptions = {
  defaultVatRate?: number;
  importDescription?: boolean;
  importImages?: boolean;
  importMerchantMeta?: boolean;
};

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(params: { search?: string; page?: number; limit?: number; isActive?: boolean }) {
    const { search, page = 1, limit = 50, isActive } = params;
    const where: Prisma.ProductWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { googleProductCategory: { contains: search, mode: 'insensitive' } },
        { googleProductType: { contains: search, mode: 'insensitive' } },
        { productUrl: { contains: search, mode: 'insensitive' } },
        { gtin: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Ürün bulunamadı');
    return product;
  }

  async create(data: {
    sku: string;
    name: string;
    description?: string;
    unit?: string;
    unitPrice: number;
    currency?: string;
    vatRate?: number;
    stock?: number;
    category?: string;
  }) {
    return this.prisma.product.create({
      data: { ...data, productFeedSource: ProductFeedSource.MANUAL },
    });
  }

  async update(id: string, data: Prisma.ProductUpdateInput) {
    await this.findById(id);
    return this.prisma.product.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.product.delete({ where: { id } });
  }

  /**
   * Google Shopping RSS 2.0 (g: namespace) ürün akışını çeker; SKU = g:id ile upsert.
   * Akışta artık bulunmayan XML kaynaklı ürünler pasifleştirilir (MANUAL ürünlere dokunulmaz).
   */
  async syncFromGoogleShoppingXml(
    feedUrl: string,
    options?: XmlSyncOptions,
  ): Promise<{
    imported: number;
    updated: number;
    deactivated: number;
    errors: string[];
  }> {
    if (!feedUrl?.trim()) throw new BadRequestException('XML feed URL gerekli');

    const vatDefault = options?.defaultVatRate ?? 20;
    const impDesc = options?.importDescription !== false;
    const impImg = options?.importImages !== false;
    const impMerch = options?.importMerchantMeta !== false;

    let xml: string;
    try {
      const res = await axios.get<string>(feedUrl.trim(), {
        responseType: 'text',
        timeout: 180_000,
        maxContentLength: 50 * 1024 * 1024,
        headers: {
          Accept: 'application/xml, text/xml, */*',
          'User-Agent': 'AtmacaCRM-ProductSync/1.0',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      xml = typeof res.data === 'string' ? res.data : String(res.data);
    } catch (e: unknown) {
      const msg = axios.isAxiosError(e)
        ? `${e.message}${e.response ? ` (HTTP ${e.response.status})` : ''}`
        : e instanceof Error
          ? e.message
          : String(e);
      throw new BadRequestException(`XML indirilemedi: ${msg}`);
    }

    const parser = new XMLParser({
      ignoreAttributes: true,
      removeNSPrefix: true,
      trimValues: false,
      isArray: (tagName) => ['item', 'additional_image_link'].includes(String(tagName)),
    });

    let parsed: unknown;
    try {
      parsed = parser.parse(xml);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`XML ayrıştırılamadı: ${msg}`);
    }

    const items = extractItems(parsed);
    const now = new Date();
    const seenSkus = new Set<string>();
    let imported = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const sku = field(item, 'id', 'g:id');
      const name = field(item, 'title', 'g:title');
      const descriptionRaw = field(item, 'description', 'g:description') || null;
      const description = impDesc ? descriptionRaw : null;
      const productUrl = field(item, 'link', 'g:link') || null;
      const imageUrlFromFeed = impImg ? resolvePrimaryImageUrl(item) : null;
      const googleCondition = impMerch ? field(item, 'condition', 'g:condition') || null : null;
      const googleAvailability = field(item, 'availability', 'g:availability') || null;
      const googleIdentifierExists = impMerch
        ? field(item, 'identifier_exists', 'g:identifier_exists') || null
        : null;
      const brand = impMerch ? field(item, 'brand', 'g:brand') || null : null;
      const googleProductCategory = impMerch
        ? field(item, 'google_product_category', 'g:google_product_category') || null
        : null;
      const googleProductType = field(item, 'product_type', 'g:product_type') || null;
      const category = googleProductType?.trim() || null;
      const googleCustomLabel0 = impMerch
        ? field(item, 'custom_label_0', 'g:custom_label_0') || null
        : null;
      const gtin = impMerch ? field(item, 'gtin', 'g:gtin') || null : null;
      const salePriceEffectiveRange =
        field(item, 'sale_price_effective_date', 'g:sale_price_effective_date') || null;

      const listParsed = parseGoogleMoney(field(item, 'price', 'g:price'));
      const saleParsed = parseGoogleMoney(field(item, 'sale_price', 'g:sale_price'));

      const listPrice = listParsed.amount > 0 ? listParsed.amount : null;
      const salePriceAmount = saleParsed.amount > 0 ? saleParsed.amount : null;
      const currency = listParsed.currency || saleParsed.currency || 'TRY';

      const useSale =
        salePriceAmount != null &&
        salePriceAmount > 0 &&
        saleWindowActive(salePriceEffectiveRange, now);
      const unitPrice = useSale && salePriceAmount != null ? salePriceAmount : listParsed.amount || saleParsed.amount || 0;

      const stock = googleAvailability ? stockFromAvailability(googleAvailability) : null;
      const isActive = googleAvailability ? activeFromAvailability(googleAvailability) : true;

      const additionalImages = impImg ? collectAdditionalImages(item) : [];
      const additionalImagesJson = (impImg ? additionalImages : []) as Prisma.InputJsonValue;

      if (!sku || !name) {
        errors.push(`Öğe ${i + 1}: id veya title eksik`);
        continue;
      }

      if (impImg && !imageUrlFromFeed) {
        errors.push(`SKU ${sku}: görsel yok (image_link / additional_image_link)`);
      }

      seenSkus.add(sku);

      const existingFull = await this.prisma.product.findUnique({ where: { sku } });
      if (existingFull?.productFeedSource === ProductFeedSource.MANUAL) {
        this.logger.debug(`XML sync: SKU ${sku} elle oluşturulmuş, akış satırı atlandı`);
        continue;
      }

      try {
        const existing = await this.prisma.product.findUnique({
          where: { sku },
          select: { id: true, imageUrl: true },
        });
        const imageUrl =
          imageUrlFromFeed ||
          (existing?.imageUrl && String(existing.imageUrl).trim() ? String(existing.imageUrl).trim() : null);

        const createData: Prisma.ProductCreateInput = {
          sku,
          name,
          description: impDesc ? description : null,
          unit: 'Adet',
          unitPrice,
          currency,
          vatRate: vatDefault,
          stock,
          isActive,
          productFeedSource: ProductFeedSource.XML,
          category,
          productUrl,
          imageUrl: impImg ? imageUrl : null,
          googleCondition,
          googleAvailability,
          googleIdentifierExists,
          listPrice,
          salePriceAmount,
          salePriceEffectiveRange,
          brand,
          googleProductCategory,
          googleProductType: googleProductType || null,
          googleCustomLabel0,
          gtin,
          additionalImages: additionalImagesJson,
          xmlSyncedAt: now,
        };

        const updateData: Prisma.ProductUpdateInput = {
          name,
          unitPrice,
          currency,
          stock,
          isActive,
          productFeedSource: ProductFeedSource.XML,
          category: category ?? undefined,
          productUrl,
          listPrice,
          salePriceAmount,
          salePriceEffectiveRange,
          googleAvailability,
          googleProductType: googleProductType || undefined,
          xmlSyncedAt: now,
          vatRate: vatDefault,
        };
        if (impDesc) updateData.description = description;
        if (impImg) updateData.imageUrl = imageUrl ?? undefined;
        if (impMerch) {
          updateData.googleCondition = googleCondition;
          updateData.googleIdentifierExists = googleIdentifierExists;
          updateData.brand = brand;
          updateData.googleProductCategory = googleProductCategory;
          updateData.googleProductType = googleProductType;
          updateData.googleCustomLabel0 = googleCustomLabel0;
          updateData.gtin = gtin;
          updateData.additionalImages = additionalImagesJson;
        }

        await this.prisma.product.upsert({
          where: { sku },
          create: createData,
          update: updateData,
        });

        if (!existing) imported++;
        else updated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`SKU ${sku}: ${msg}`);
      }
    }

    let deactivated = 0;
    if (seenSkus.size > 0) {
      const res = await this.prisma.product.updateMany({
        where: {
          productFeedSource: ProductFeedSource.XML,
          sku: { notIn: [...seenSkus] },
        },
        data: { isActive: false },
      });
      deactivated = res.count;
    }

    this.logger.log(
      `XML senkron: ${imported} yeni, ${updated} güncellendi, ${deactivated} pasif, ${errors.length} hata, URL=${feedUrl.slice(0, 80)}…`,
    );

    return { imported, updated, deactivated, errors };
  }
}
