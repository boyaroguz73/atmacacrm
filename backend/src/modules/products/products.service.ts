import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ProductFeedSource } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { join, extname as pathExtname } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { splitSearchTokens } from '../../common/search-tokens';

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

function clampVatPercent(n: number): number {
  if (!Number.isFinite(n)) return 20;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseLoosePercent(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^(\d+(?:[.,]\d+)?)%?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return clampVatPercent(n);
}

/**
 * Feed öğesinden KDV; alan yoksa org/akış varsayılanı. Böylece DB’deki product.vatRate
 * teklif, sipariş ve WhatsApp paylaşımı için tek kaynak olur.
 */
function resolveVatRateFromFeedItem(item: Record<string, unknown>, fallback: number): number {
  const fb = clampVatPercent(fallback);
  const keys = [
    'vat',
    'vat_rate',
    'tax_rate',
    'g:tax_rate',
    'g:vat_rate',
    'kdv',
    'g:kdv',
    'vat_rate_percent',
    'g:vat_rate_percent',
    'tax_percent',
    'g:tax_percent',
  ];
  for (const k of keys) {
    const t = field(item, k);
    if (t) {
      const p = parseLoosePercent(t);
      if (p != null) return p;
    }
  }
  const label0 = field(item, 'custom_label_0', 'g:custom_label_0');
  if (label0) {
    const m = label0.match(/kdv\s*[:%]?\s*(\d+(?:[.,]\d+)?)/i);
    if (m) {
      const p = parseLoosePercent(m[1]);
      if (p != null) return p;
    }
  }
  return fb;
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

/** T-Soft native <images><img_item> → image URL dizisi */
function extractTsoftImages(item: Record<string, unknown>): string[] {
  const imgs = item.images;
  if (!imgs || typeof imgs !== 'object') return [];
  const box = imgs as Record<string, unknown>;
  const raw = box.img_item;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((x) => normalizeText(x)).filter(Boolean);
}

/**
 * T-Soft native XML <product> öğesini Google Shopping benzeri yapıya dönüştürür.
 * Böylece mevcut işleme döngüsü her iki formatı da işleyebilir.
 */
function normalizeTsoftNativeItem(item: Record<string, unknown>): Record<string, unknown> {
  const wsCode = normalizeText(item.ws_code);
  const code = normalizeText(item.code);
  const sku = wsCode || (code ? `T${code}` : '');
  const name = normalizeText(item.name);
  const currency = normalizeText(item.currency) || 'TL';
  const currencyNormalized = currency === 'TL' ? 'TRY' : currency;

  const priceList = normalizeText(item.price_list);
  const priceSpecial = normalizeText(item.price_special);
  const vat = normalizeText(item.vat);
  const stock = normalizeText(item.stock);
  const stockNum = stock ? parseInt(stock, 10) : 0;

  const images = extractTsoftImages(item);
  const primaryImage = images[0] || null;
  const additionalImages = images.slice(1);

  const normalized: Record<string, unknown> = {
    id: sku,
    title: name,
    description: normalizeText(item.detail) || null,
    link: normalizeText(item.product_link) || null,
    image_link: primaryImage,
    additional_image_link: additionalImages.length > 0 ? additionalImages : undefined,
    price: priceList ? `${priceList} ${currencyNormalized}` : undefined,
    sale_price: priceSpecial && priceSpecial !== priceList
      ? `${priceSpecial} ${currencyNormalized}`
      : undefined,
    product_type: normalizeText(item.category_path) || normalizeText(item.cat1name) || null,
    brand: normalizeText(item.brand) || null,
    availability: stockNum > 0 ? 'in_stock' : 'out_of_stock',
    vat_rate: vat || null,
    // T-Soft native kodu sakla (sipariş oluşturmada kullanılır)
    _tsoft_code: code,
    _tsoft_ws_code: wsCode,
    _tsoft_unit: normalizeText(item.unit) || 'Adet',
    _tsoft_stock: stockNum,
  };

  // Subproducts'ı olduğu gibi aktar
  if (item.subproducts) {
    normalized.subproducts = item.subproducts;
  }

  return normalized;
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

type XmlFeedFormat = 'google_shopping' | 'tsoft_native';

function detectFeedFormat(parsed: Record<string, unknown>): XmlFeedFormat {
  if (parsed.products && typeof parsed.products === 'object') return 'tsoft_native';
  return 'google_shopping';
}

function extractItems(parsed: unknown): { items: Record<string, unknown>[]; format: XmlFeedFormat } {
  const p = parsed as Record<string, unknown>;

  // T-Soft native: <products><product>…</product></products>
  if (p.products && typeof p.products === 'object') {
    const box = p.products as Record<string, unknown>;
    const products = box.product;
    if (products == null) return { items: [], format: 'tsoft_native' };
    const arr = Array.isArray(products)
      ? (products as Record<string, unknown>[])
      : [products as Record<string, unknown>];
    return { items: arr, format: 'tsoft_native' };
  }

  // Google Shopping: <rss><channel><item>…
  const rss = (p.rss ?? p) as Record<string, unknown>;
  const channel = (rss.channel ?? rss) as Record<string, unknown>;
  const items = channel.item;
  if (items == null) return { items: [], format: 'google_shopping' };
  const arr = Array.isArray(items) ? (items as Record<string, unknown>[]) : [items as Record<string, unknown>];
  return { items: arr, format: 'google_shopping' };
}

type XmlSubproductRow = {
  type2: string;
  title: string;
  priceRaw: string;
  subId: string;
  stock: number | null;
  /** Alt ürün görseli (T-Soft / feed) */
  imageUrl: string;
};

function asObjectArray(v: unknown): Record<string, unknown>[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  if (typeof v === 'object') return [v as Record<string, unknown>];
  return [];
}

function mapSubproductRows(rows: Record<string, unknown>[]): XmlSubproductRow[] {
  const out: XmlSubproductRow[] = [];
  for (const r of rows) {
    const type2 = field(r, 'type2', 'g:type2', 'Type2');
    const title = field(r, 'title', 'name', 'baslik', 'g:title', 'g:name');
    const priceRaw = field(r, 'price_list', 'price_list_discount', 'price', 'g:price', 'sale_price', 'g:sale_price');
    const subId = field(r, 'code', 'id', 'g:id', 'sku', 'g:sku');
    const wsCode = field(r, 'ws_code', 'wsCode');
    const stockRaw = field(r, 'stock');
    const stock = stockRaw ? parseInt(stockRaw, 10) : null;
    const imageUrl = field(
      r,
      'image_link',
      'g:image_link',
      'image',
      'g:image',
      'picture',
      'resim',
      'thumbnail',
      'img',
    );
    if (!type2 && !title && !subId && !priceRaw) continue;
    out.push({ type2, title, priceRaw, subId: wsCode || subId, stock, imageUrl });
  }
  return out;
}

function extractSubproductRows(item: Record<string, unknown>): XmlSubproductRow[] {
  const containerKeys = ['subproducts', 'g:subproducts'];
  for (const ck of containerKeys) {
    const c = item[ck];
    if (!c || typeof c !== 'object') continue;
    const box = c as Record<string, unknown>;
    const rawList = box['subproduct'] ?? box['g:subproduct'];
    const rows = asObjectArray(rawList);
    const out = mapSubproductRows(rows);
    if (out.length) return out;
  }
  const direct = asObjectArray(item['subproduct'] ?? item['g:subproduct']);
  return mapSubproductRows(direct);
}

function buildSubproductExternalId(parentSku: string, row: XmlSubproductRow, index: number): string {
  const sid = (row.subId || '').trim();
  if (sid) return `${parentSku}-${sid}`.slice(0, 200);
  const raw = row.type2 || row.title || `v${index}`;
  const slug = raw
    .replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  return `${parentSku}-SP${index}-${slug || 'x'}`.slice(0, 200);
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
  private readonly productImagesDir = join(process.cwd(), 'uploads', 'products');

  constructor(private prisma: PrismaService) {
    if (!existsSync(this.productImagesDir)) {
      mkdirSync(this.productImagesDir, { recursive: true });
    }
  }

  private buildProxyConfig(targetUrl: string): {
    proxy?: {
      protocol: string;
      host: string;
      port: number;
      auth?: { username: string; password: string };
    };
  } {
    const isHttps = targetUrl.trim().toLowerCase().startsWith('https://');
    const raw =
      (isHttps
        ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
        : process.env.HTTP_PROXY || process.env.http_proxy) || '';
    if (!raw) return {};
    try {
      const u = new URL(raw);
      const protocol = u.protocol.replace(':', '');
      const port =
        Number(u.port) ||
        (u.protocol === 'https:' ? 443 : 80);
      const auth =
        u.username || u.password
          ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
          : undefined;
      return {
        proxy: { protocol, host: u.hostname, port, ...(auth ? { auth } : {}) },
      };
    } catch {
      return {};
    }
  }

  /**
   * Harici URL'den görseli indirir, uploads/products/ altına kaydeder.
   * Zaten yerel bir yol ise veya indirme başarısız olursa orijinal URL'yi döner.
   */
  async downloadImageToLocal(remoteUrl: string, sku: string): Promise<string> {
    if (!remoteUrl || remoteUrl.startsWith('/uploads/') || remoteUrl.startsWith('uploads/')) {
      return remoteUrl;
    }
    try {
      const lower = remoteUrl.toLowerCase();
      const ext = lower.includes('.png') ? '.png'
        : lower.includes('.webp') ? '.webp'
        : lower.includes('.gif') ? '.gif'
        : '.jpg';
      const safeSku = sku.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
      const filename = `${safeSku}${ext}`;
      const fullPath = join(this.productImagesDir, filename);

      if (existsSync(fullPath)) {
        return `/uploads/products/${filename}`;
      }

      const res = await axios.get<ArrayBuffer>(remoteUrl, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxContentLength: 12 * 1024 * 1024,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
        ...this.buildProxyConfig(remoteUrl),
      });
      writeFileSync(fullPath, Buffer.from(res.data));
      this.logger.debug(`Ürün görseli yerele kaydedildi: ${filename} (${sku})`);
      return `/uploads/products/${filename}`;
    } catch (e: any) {
      this.logger.warn(`Ürün görseli indirilemedi (${sku}): ${e?.message}`);
      return remoteUrl;
    }
  }

  /**
   * Harici görsel URL'sini indirip `imageUrl` alanını `/uploads/products/...` yapar.
   * Sohbetten ürün gönderiminde kullanılır.
   */
  async ensureProductImageLocal(productId: string): Promise<string | null> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) return null;
    let url = (product.imageUrl || '').trim();
    if (!url && product.additionalImages) {
      try {
        const images = Array.isArray(product.additionalImages)
          ? product.additionalImages
          : JSON.parse(String(product.additionalImages));
        if (Array.isArray(images) && images.length > 0) {
          url = (images[0] || '').trim();
        }
      } catch {
        /* ignore */
      }
    }
    if (!url) return null;

    const norm = (u: string) => (u.startsWith('/') ? u : `/${u}`);
    if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
      const normalized = norm(url);
      const diskPath = join(process.cwd(), normalized.replace(/^\//, ''));
      if (existsSync(diskPath)) return normalized;
    }

    const local = await this.downloadImageToLocal(url, product.sku);
    if (local.startsWith('/uploads/') || local.startsWith('uploads/')) {
      const normalized = norm(local);
      if (normalized !== (product.imageUrl || '').trim()) {
        await this.prisma.product.update({
          where: { id: productId },
          data: { imageUrl: normalized },
        });
      }
      return normalized;
    }
    return null;
  }

  async findAll(params: {
    search?: string;
    category?: string;
    page?: number;
    limit?: number;
    isActive?: boolean;
    /**
     * true: teklif/sohbet seçici modu — yalnızca ad, SKU, marka, kategori, varyant ve GTIN;
     * açıklama / ürün URL / Google alanları aranmaz (yanlış pozitifleri keser).
     * Kelimeler boşlukla ayrılır; her kelime bu alanlardan en az birinde geçmeli (AND).
     */
    matchExact?: boolean;
  }) {
    const { search, category, page = 1, limit = 50, isActive, matchExact } = params;
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive;
    if (category && category.trim()) where.category = category.trim();

    const tokens = splitSearchTokens(search);
    if (!tokens.length) {
      // arama yok
    } else if (matchExact) {
      where.AND = tokens.map((token) => ({
        OR: [
          { name: { contains: token, mode: 'insensitive' } },
          { sku: { contains: token, mode: 'insensitive' } },
          { brand: { contains: token, mode: 'insensitive' } },
          { category: { contains: token, mode: 'insensitive' } },
          { gtin: { contains: token, mode: 'insensitive' } },
          {
            variants: {
              some: {
                OR: [
                  { name: { contains: token, mode: 'insensitive' } },
                  { externalId: { contains: token, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      }));
    } else {
      where.AND = tokens.map((token) => ({
        OR: [
          { name: { contains: token, mode: 'insensitive' } },
          { sku: { contains: token, mode: 'insensitive' } },
          { brand: { contains: token, mode: 'insensitive' } },
          { category: { contains: token, mode: 'insensitive' } },
          { gtin: { contains: token, mode: 'insensitive' } },
          {
            variants: {
              some: {
                OR: [
                  { name: { contains: token, mode: 'insensitive' } },
                  { externalId: { contains: token, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      }));
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

  async getCategoriesSummary() {
    const rows = await this.prisma.$queryRaw<{ category: string | null; count: bigint }[]>`
      SELECT NULLIF(TRIM(p.category), '') AS category, COUNT(*)::bigint AS count
      FROM products p
      WHERE p.category IS NOT NULL AND TRIM(p.category) <> ''
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows
      .map((r) => ({
        category: String(r.category || '').trim(),
        count: Number(r.count || 0),
      }))
      .filter((x) => x.category !== '');
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Ürün bulunamadı');
    return product;
  }

  async findVariantsByProductId(productId: string) {
    const product = await this.findById(productId);
    const fallbackImage =
      product.imageUrl && String(product.imageUrl).trim() !== '' ? String(product.imageUrl).trim() : null;

    const variants = await this.prisma.productVariant.findMany({
      where: { productId, isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        externalId: true,
        name: true,
        unitPrice: true,
        currency: true,
        vatRate: true,
        stock: true,
        metadata: true,
        imageUrl: true,
      },
    });

    const withResolvedImages = variants.map((v) => {
      const vImg = v.imageUrl && String(v.imageUrl).trim() !== '' ? String(v.imageUrl).trim() : null;
      return { ...v, imageUrl: vImg || fallbackImage };
    });

    if (withResolvedImages.length === 0) return withResolvedImages;

    const baseName = String(product.name ?? '').trim() || 'Ürün';
    const basePrice = Number(product.unitPrice);
    const sku = String(product.sku ?? '');
    const isGoogleVariantParent = sku.startsWith('IG-') && basePrice <= 0 && product.stock == null;
    if (isGoogleVariantParent) {
      return withResolvedImages;
    }

    const hasSellableBase =
      (Number.isFinite(basePrice) && basePrice > 0) ||
      (product.stock != null && Number(product.stock) >= 0);
    if (!hasSellableBase) {
      return withResolvedImages;
    }

    const nameTaken = withResolvedImages.some((v) => String(v.name ?? '').trim() === baseName);
    if (nameTaken) {
      return withResolvedImages;
    }

    const synthetic = {
      id: null as string | null,
      externalId: null as string | null,
      name: baseName,
      unitPrice: basePrice,
      currency: product.currency ?? 'TRY',
      vatRate: product.vatRate,
      stock: product.stock,
      metadata: { source: 'product_base' } as Prisma.InputJsonValue,
      imageUrl: fallbackImage,
    };

    return [synthetic, ...withResolvedImages];
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        ...this.buildProxyConfig(feedUrl.trim()),
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
      isArray: (tagName) =>
        ['item', 'product', 'img_item', 'additional_image_link', 'subproduct', 'g:subproduct'].includes(String(tagName)),
    });

    let parsed: unknown;
    try {
      parsed = parser.parse(xml);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`XML ayrıştırılamadı: ${msg}`);
    }

    const { items: rawItems, format } = extractItems(parsed);
    const items = format === 'tsoft_native'
      ? rawItems.map(normalizeTsoftNativeItem)
      : rawItems;
    this.logger.log(`XML format algılandı: ${format}, ${rawItems.length} ürün`);
    const now = new Date();
    const seenSkus = new Set<string>();
    const seenVariantExternalIds = new Set<string>();
    const seenCategories = new Set<string>();
    let imported = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const sku = field(item, 'id', 'g:id');
      const itemGroupId = field(item, 'item_group_id', 'g:item_group_id');
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
      if (category) seenCategories.add(category);
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

      const tsoftStock = item._tsoft_stock;
      const stock = typeof tsoftStock === 'number'
        ? tsoftStock
        : googleAvailability
          ? stockFromAvailability(googleAvailability)
          : null;
      const isActive = typeof tsoftStock === 'number'
        ? tsoftStock > 0
        : googleAvailability
          ? activeFromAvailability(googleAvailability)
          : true;
      const itemVat = resolveVatRateFromFeedItem(item, vatDefault);

      const additionalImagesRaw = impImg ? collectAdditionalImages(item) : [];
      const additionalImagesJson = (impImg ? additionalImagesRaw : []) as Prisma.InputJsonValue;

      if (!sku || !name) {
        errors.push(`Öğe ${i + 1}: id veya title eksik`);
        continue;
      }

      // Google Shopping varyant satırı (item_group_id): ana ürün + ProductVariant
      if (itemGroupId) {
        const parentSku = `IG-${itemGroupId}`.slice(0, 200);
        seenSkus.add(parentSku);
        seenVariantExternalIds.add(sku);

        const parentExisting = await this.prisma.product.findUnique({ where: { sku: parentSku } });
        if (parentExisting?.productFeedSource === ProductFeedSource.MANUAL) {
          this.logger.debug(`XML sync: varyant grubu ${parentSku} elle oluşturulmuş, atlandı`);
          continue;
        }

        if (impImg && !imageUrlFromFeed) {
          errors.push(`Varyant ${sku}: görsel yok (image_link / additional_image_link)`);
        }

        try {
          const parentName = name.includes(' - ')
            ? name.split(' - ')[0].trim()
            : name.split('|')[0].trim() || name;

          await this.prisma.product.upsert({
            where: { sku: parentSku },
            create: {
              sku: parentSku,
              name: parentName,
              description: impDesc ? description : null,
              unit: 'Adet',
              unitPrice: 0,
              currency,
              vatRate: itemVat,
              stock: null,
              isActive: true,
              productFeedSource: ProductFeedSource.XML,
              category,
              productUrl,
              imageUrl: impImg ? imageUrlFromFeed : null,
              googleProductType: googleProductType || null,
              xmlSyncedAt: now,
            },
            update: {
              name: parentName,
              productFeedSource: ProductFeedSource.XML,
              category: category ?? undefined,
              productUrl: productUrl ?? undefined,
              xmlSyncedAt: now,
              vatRate: itemVat,
              ...(impDesc ? { description: description ?? undefined } : {}),
              ...(impImg && imageUrlFromFeed ? { imageUrl: imageUrlFromFeed } : {}),
            },
          });

          const parent = await this.prisma.product.findUniqueOrThrow({
            where: { sku: parentSku },
            select: { id: true },
          });

          const existingVar = await this.prisma.productVariant.findUnique({
            where: { externalId: sku },
            select: { id: true },
          });

          await this.prisma.productVariant.upsert({
            where: { externalId: sku },
            create: {
              productId: parent.id,
              externalId: sku,
              name,
              unitPrice,
              currency,
              vatRate: itemVat,
              stock,
              isActive,
              imageUrl: impImg && imageUrlFromFeed ? imageUrlFromFeed : null,
            },
            update: {
              name,
              unitPrice,
              currency,
              vatRate: itemVat,
              stock,
              isActive,
              ...(impImg && imageUrlFromFeed ? { imageUrl: imageUrlFromFeed } : {}),
            },
          });

          if (!existingVar) imported++;
          else updated++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Varyant ${sku}: ${msg}`);
        }
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

      const subRows = extractSubproductRows(item);

      try {
        const existing = await this.prisma.product.findUnique({
          where: { sku },
          select: { id: true, imageUrl: true },
        });
        const imageUrl =
          imageUrlFromFeed ||
          (existing?.imageUrl && String(existing.imageUrl).trim() ? String(existing.imageUrl).trim() : null);

        const unit = (typeof item._tsoft_unit === 'string' && item._tsoft_unit) || 'Adet';
        const createData: any = {
          sku,
          name,
          description: impDesc ? description : null,
          unit,
          unitPrice,
          currency,
          vatRate: itemVat,
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

        const updateData: any = {
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
          vatRate: itemVat,
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

        const parentRow = await this.prisma.product.findUniqueOrThrow({
          where: { sku },
          select: { id: true },
        });

        if (subRows.length > 0) {
          for (let si = 0; si < subRows.length; si++) {
            const row = subRows[si];
            const extId = buildSubproductExternalId(sku, row, si);
            seenVariantExternalIds.add(extId);

            let vPrice = unitPrice;
            let vCur = currency;
            const pr = (row.priceRaw || '').trim();
            if (pr) {
              const vp = parseGoogleMoney(pr);
              if (vp.amount > 0) {
                vPrice = vp.amount;
                vCur = vp.currency || currency;
              }
            }

            const label = row.type2 || row.title || `Varyant ${si + 1}`;
            const variantName = `${name} — ${label}`.slice(0, 480);
            const varStock = row.stock != null ? row.stock : stock;
            const varActive = row.stock != null ? row.stock > 0 : isActive;
            const rowImg = row.imageUrl?.trim() || null;

            const metadata: Prisma.InputJsonValue = {
              type2: row.type2 || null,
              title: row.title || null,
              source: 'xml_subproduct',
              index: si,
            };

            const existingVar = await this.prisma.productVariant.findUnique({
              where: { externalId: extId },
              select: { id: true },
            });

            await this.prisma.productVariant.upsert({
              where: { externalId: extId },
              create: {
                productId: parentRow.id,
                externalId: extId,
                name: variantName,
                unitPrice: vPrice,
                currency: vCur,
                vatRate: itemVat,
                stock: varStock,
                isActive: varActive,
                metadata,
                imageUrl: impImg && rowImg ? rowImg : null,
              },
              update: {
                name: variantName,
                unitPrice: vPrice,
                currency: vCur,
                vatRate: itemVat,
                stock: varStock,
                isActive: varActive,
                metadata,
                ...(impImg && rowImg ? { imageUrl: rowImg } : {}),
              },
            });

            if (!existingVar) imported++;
            else updated++;
          }
        } else {
          if (!existing) imported++;
          else updated++;
        }
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

    if (seenVariantExternalIds.size > 0) {
      await this.prisma.productVariant.updateMany({
        where: {
          externalId: { notIn: [...seenVariantExternalIds] },
          product: { productFeedSource: ProductFeedSource.XML },
        },
        data: { isActive: false },
      });
    }

    if (seenCategories.size > 0) {
      const uniqueCategories = [...seenCategories];
      for (const name of uniqueCategories) {
        const id = randomUUID();
        await this.prisma.$executeRaw`
          INSERT INTO product_categories (id, name, "createdAt", "updatedAt")
          VALUES (${id}, ${name}, NOW(), NOW())
          ON CONFLICT (name) DO NOTHING
        `;
      }
    }

    this.logger.log(
      `XML senkron: ${imported} yeni, ${updated} güncellendi, ${deactivated} pasif, ${errors.length} hata, URL=${feedUrl.slice(0, 80)}…`,
    );

    return { imported, updated, deactivated, errors };
  }

  /**
   * Harici URL'leri olan tüm aktif ürün görsellerini topluca indirir.
   * Zaten yerel yola sahip ürünler atlanır. İndirilen görsel DB'ye yazılır.
   */
  async downloadAllProductImages(): Promise<{
    total: number;
    downloaded: number;
    alreadyLocal: number;
    failed: number;
  }> {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, imageUrl: true, additionalImages: true },
    });

    let downloaded = 0;
    let alreadyLocal = 0;
    let failed = 0;

    for (const p of products) {
      const url = (p.imageUrl || '').trim();
      if (!url) continue;

      if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
        alreadyLocal++;
        continue;
      }

      const localPath = await this.downloadImageToLocal(url, p.sku);
      if (localPath !== url) {
        const updateData: Record<string, unknown> = { imageUrl: localPath };

        if (p.additionalImages && Array.isArray(p.additionalImages)) {
          const localAdditional: string[] = [];
          for (let ai = 0; ai < (p.additionalImages as string[]).length; ai++) {
            const addUrl = (p.additionalImages as string[])[ai];
            if (!addUrl || addUrl.startsWith('/uploads/')) {
              localAdditional.push(addUrl);
            } else {
              const addLocal = await this.downloadImageToLocal(addUrl, `${p.sku}_add${ai}`);
              localAdditional.push(addLocal);
            }
          }
          updateData.additionalImages = localAdditional;
        }

        await this.prisma.product.update({
          where: { id: p.id },
          data: updateData as any,
        });
        downloaded++;
        this.logger.debug(`Görsel indirildi: ${p.sku}`);
      } else {
        failed++;
      }
    }

    this.logger.log(
      `Toplu görsel indirme: ${downloaded} indirildi, ${alreadyLocal} zaten yerel, ${failed} başarısız (toplam ${products.length})`,
    );

    return { total: products.length, downloaded, alreadyLocal, failed };
  }
}
