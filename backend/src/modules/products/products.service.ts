import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ProductFeedSource } from '@prisma/client';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { join, extname as pathExtname } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { splitSearchTokens } from '../../common/search-tokens';

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

  /**
   * Varyant için yerel görsel URL'si. Öncelik sırası:
   *   1. variant.imageUrl
   *   2. variant.additionalImages[0]
   *   3. product.imageUrl  (variant kendi görseli yoksa parent'a düşer)
   * Kayıtta URL güncellenir (başarılı indirme sonrası).
   */
  async ensureVariantImageLocal(productVariantId: string): Promise<string | null> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
      include: { product: { select: { id: true, sku: true, imageUrl: true } } },
    });
    if (!variant) return null;

    const norm = (u: string) => (u.startsWith('/') ? u : `/${u}`);

    const tryLocal = (u: string): string | null => {
      if (!u) return null;
      if (u.startsWith('/uploads/') || u.startsWith('uploads/')) {
        const normalized = norm(u);
        const diskPath = join(process.cwd(), normalized.replace(/^\//, ''));
        if (existsSync(diskPath)) return normalized;
      }
      return null;
    };

    let url = (variant.imageUrl || '').trim();
    const pre = tryLocal(url);
    if (pre) return pre;

    if (!url && variant.additionalImages) {
      try {
        const images = Array.isArray(variant.additionalImages)
          ? (variant.additionalImages as unknown[])
          : JSON.parse(String(variant.additionalImages));
        if (Array.isArray(images) && images.length > 0 && typeof images[0] === 'string') {
          url = (images[0] as string).trim();
        }
      } catch {
        /* ignore */
      }
    }

    if (url) {
      const local = await this.downloadImageToLocal(
        url,
        variant.sku || variant.externalId || variant.product.sku,
      );
      if (local.startsWith('/uploads/') || local.startsWith('uploads/')) {
        const normalized = norm(local);
        if (normalized !== (variant.imageUrl || '').trim()) {
          await this.prisma.productVariant.update({
            where: { id: productVariantId },
            data: { imageUrl: normalized },
          });
        }
        return normalized;
      }
    }

    // Varyantın kendi görseli yok — parent'a düş
    return this.ensureProductImageLocal(variant.product.id);
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
    const productBaseName = String(product.name ?? '').trim() || 'Ürün';

    const variants = await this.prisma.productVariant.findMany({
      where: { productId, isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        externalId: true,
        tsoftId: true,
        sku: true,
        name: true,
        description: true,
        unitPrice: true,
        listPrice: true,
        salePriceAmount: true,
        currency: true,
        vatRate: true,
        priceIncludesVat: true,
        stock: true,
        metadata: true,
        imageUrl: true,
        additionalImages: true,
      },
    });

    const withResolvedImages = variants.map((v) => {
      const directImage = v.imageUrl && String(v.imageUrl).trim() !== '' ? String(v.imageUrl).trim() : null;
      let extraImage: string | null = null;
      if (!directImage && v.additionalImages) {
        try {
          const parsed = Array.isArray(v.additionalImages)
            ? v.additionalImages
            : JSON.parse(String(v.additionalImages));
          if (Array.isArray(parsed)) {
            const first = parsed.find((x) => typeof x === 'string' && String(x).trim() !== '');
            if (typeof first === 'string') extraImage = first.trim();
          }
        } catch {
          /* ignore malformed additionalImages payload */
        }
      }

      const rawName = String(v.name ?? '').trim();
      const fallbackName =
        String(v.externalId ?? '').trim() ||
        String(v.sku ?? '').trim() ||
        productBaseName;
      const resolvedName = rawName || fallbackName;

      return { ...v, name: resolvedName, imageUrl: directImage || extraImage || fallbackImage };
    });

    if (withResolvedImages.length === 0) return withResolvedImages;

    const baseName = productBaseName;
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
      tsoftId: null as string | null,
      sku: product.sku ?? null,
      name: baseName,
      description: null as string | null,
      unitPrice: basePrice,
      listPrice: product.listPrice ?? null,
      salePriceAmount: product.salePriceAmount ?? null,
      currency: product.currency ?? 'TRY',
      vatRate: product.vatRate,
      priceIncludesVat: product.priceIncludesVat,
      stock: product.stock,
      metadata: { source: 'product_base' } as Prisma.InputJsonValue,
      imageUrl: fallbackImage,
      additionalImages: null as unknown,
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
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ürün bulunamadı');

    const { productFeedSource: _ignoreFeed, ...rest } = data as Prisma.ProductUpdateInput & {
      productFeedSource?: unknown;
    };
    const patch: Prisma.ProductUpdateInput = { ...rest };

    if (existing.tsoftId || existing.productFeedSource === ProductFeedSource.TSOFT) {
      patch.productFeedSource = ProductFeedSource.TSOFT;
    }

    return this.prisma.product.update({ where: { id }, data: patch });
  }

  async updateVariant(productId: string, variantId: string, data: Prisma.ProductVariantUpdateInput) {
    const v = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!v || v.productId !== productId) throw new NotFoundException('Varyant bulunamadı');
    return this.prisma.productVariant.update({ where: { id: variantId }, data });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.product.delete({ where: { id } });
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
