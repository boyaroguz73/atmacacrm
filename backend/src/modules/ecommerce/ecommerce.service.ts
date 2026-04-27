import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TsoftApiService } from './tsoft-api.service';
import {
  TsoftProductSyncService,
  TsoftProductSyncOptions,
  TsoftProductSyncResult,
} from './tsoft-product-sync.service';
import {
  normalizeComparablePhone,
  normalizeTsoftPhone,
  formatPhoneForTsoft,
} from './phone.util';
import type { CreateTsoftSiteCustomerPayload } from './tsoft.types';
import { rowToCatalogDraft } from './tsoft-catalog.util';
import {
  extractTsoftCustomerIdFromSetCustomersResponse,
  looksLikeTsoftSuccessResponse,
} from './tsoft-customer.util';
import { OrdersService } from '../orders/orders.service';
import { AutoReplyEngineService } from '../auto-reply/auto-reply-engine.service';
import { SettingsService } from '../settings/settings.service';

const TSOFT_LABEL = 'Site müşterisi';
const TSOFT_SOURCE = 'TSOFT';

/** Müşteri senkronunda en fazla bu kadar API sayfası (REST1/v3: sayfa başına ~100 kayıt). */
const TSOFT_SYNC_CUSTOMERS_MAX_PAGES = 50;
/** Sipariş aktarımında üst sınır (çok kayıtta zaman aşımı önleme). */
const TSOFT_SYNC_ORDERS_MAX = 500;

/** Başarılı veya yapılandırma eksik: periyodik yenileme */
const STATUS_CACHE_MS_DEFAULT = 120_000;
/** T-Soft login gerçekten denendi ve başarısız: 429 / gereksiz yükü azaltmak için uzun bekleme */
const STATUS_CACHE_MS_AFTER_AUTH_FAIL = 600_000;

type EcommerceStatusResult = {
  menuVisible: boolean;
  healthy: boolean;
  provider: string | null;
  canPushCustomer: boolean;
};

type EcommerceStatusCached = EcommerceStatusResult & { tsoftAuthFailed?: boolean };

@Injectable()
export class EcommerceService {
  private readonly logger = new Logger(EcommerceService.name);
  private readonly statusCache = new Map<string, { at: number; value: EcommerceStatusCached }>();

  constructor(
    private prisma: PrismaService,
    private tsoftApi: TsoftApiService,
    private tsoftProductSync: TsoftProductSyncService,
    private readonly autoReplyEngine: AutoReplyEngineService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    private readonly settingsService: SettingsService,
  ) {}

  async getStatus(organizationId: string): Promise<EcommerceStatusResult> {
    const hit = this.statusCache.get(organizationId);
    if (hit) {
      const ttl = hit.value.tsoftAuthFailed ? STATUS_CACHE_MS_AFTER_AUTH_FAIL : STATUS_CACHE_MS_DEFAULT;
      if (Date.now() - hit.at < ttl) {
        const { tsoftAuthFailed: _a, ...rest } = hit.value;
        return rest;
      }
    }
    const value = await this.resolveStatus(organizationId);
    this.statusCache.set(organizationId, { at: Date.now(), value });
    const { tsoftAuthFailed: _b, ...rest } = value;
    return rest;
  }

  private async resolveStatus(organizationId: string): Promise<EcommerceStatusCached> {
    try {
      const int = await this.prisma.orgIntegration.findUnique({
        where: {
          organizationId_integrationKey: { organizationId, integrationKey: 'tsoft' },
        },
      });

      if (!int?.isEnabled) {
        return {
          menuVisible: false,
          healthy: false,
          provider: null as string | null,
          canPushCustomer: false,
        };
      }

      const cfg = (int.config || {}) as { baseUrl?: string; apiEmail?: string; apiPassword?: string };
      if (!cfg.baseUrl || !cfg.apiEmail || !cfg.apiPassword) {
        return {
          menuVisible: false,
          healthy: false,
          provider: 'tsoft',
          canPushCustomer: false,
        };
      }

      // Not: /ecommerce/status çağrıları sık tetiklenir (sidebar + contact panel).
      // Burada canlı login denemesi yapmak entegrasyon kapalı/ağ sorunlu durumda
      // gereksiz tekrar denemelere neden olur. Status sadece yapılandırma görünürlüğünü döner;
      // canlı doğrulama için "Bağlantıyı test et" kullanılır.
      return {
        menuVisible: true,
        healthy: true,
        provider: 'tsoft',
        canPushCustomer: true,
      };
    } catch (err) {
      this.logger.warn(`T-Soft durum kontrolü başarısız: ${(err as Error)?.message ?? err}`);
      return {
        menuVisible: false,
        healthy: false,
        provider: null,
        canPushCustomer: false,
      };
    }
  }

  async testConnection(organizationId: string) {
    this.statusCache.delete(organizationId);
    this.tsoftApi.clearTokenCache(organizationId);
    this.tsoftApi.clearRateLimitBlock(organizationId);
    await this.tsoftApi.getBearerToken(organizationId);
    this.statusCache.delete(organizationId);
    return { ok: true };
  }

  /** T-Soft giriş teşhisi (token yazılmaz; yine de istek limitine girer) */
  diagnoseTsoft(organizationId: string) {
    return this.tsoftApi.diagnoseLogin(organizationId);
  }

  async listProducts(organizationId: string, page: number, limit: number) {
    return this.tsoftApi.listProducts(organizationId, page, limit);
  }

  /**
   * T-Soft → CRM ürün pull senkronu (plan §PR-3).
   * Ürünleri `products` + `product_variants` tablolarına upsert eder;
   * sweep ile görmediğimiz TSOFT ürünlerini pasifler.
   */
  async syncTsoftProducts(
    organizationId: string,
    opts: TsoftProductSyncOptions = {},
  ): Promise<TsoftProductSyncResult> {
    return this.tsoftProductSync.syncTsoftProducts(organizationId, opts);
  }

  /**
   * T-Soft admin panel durumu: kategori başına son sync zamanı, CRM'deki
   * TSOFT kaynak sayaçları ve push kuyruğu özeti.
   */
  async getTsoftSyncStatus(organizationId: string): Promise<{
    products: { total: number; active: number; lastPulledAt: string | null };
    variants: { total: number; active: number };
    orders: { lastSyncedAt: string | null; tsoftLinked: number };
    customers: { matched: number };
    pushQueue: {
      pending: number;
      running: number;
      failed: number;
      done24h: number;
      lastError: string | null;
      lastFailedAt: string | null;
    };
  }> {
    const [
      productAggregate,
      lastProductPull,
      variantAggregate,
      lastOrderTsoft,
      tsoftLinkedOrders,
      matchedContacts,
      pushPending,
      pushRunning,
      pushFailed,
      pushDone24,
      lastFailed,
    ] = await Promise.all([
      this.prisma.product.groupBy({
        by: ['isActive'],
        where: { productFeedSource: 'TSOFT' },
        _count: { _all: true },
      }),
      this.prisma.product.findFirst({
        where: { productFeedSource: 'TSOFT', tsoftLastPulledAt: { not: null } },
        orderBy: { tsoftLastPulledAt: 'desc' },
        select: { tsoftLastPulledAt: true },
      }),
      this.prisma.productVariant.groupBy({
        by: ['isActive'],
        where: { tsoftId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.salesOrder.findFirst({
        where: { contact: { organizationId }, tsoftSiteOrderId: { not: null } },
        orderBy: { tsoftPushedAt: 'desc' },
        select: { tsoftPushedAt: true, createdAt: true },
      }),
      this.prisma.salesOrder.count({
        where: { contact: { organizationId }, tsoftSiteOrderId: { not: null } },
      }),
      this.prisma.contact.count({
        where: {
          organizationId,
          metadata: { path: ['tsoftCustomerId'], not: Prisma.AnyNull },
        },
      }),
      this.prisma.tsoftPushQueue.count({ where: { organizationId, status: 'PENDING' } }),
      this.prisma.tsoftPushQueue.count({ where: { organizationId, status: 'RUNNING' } }),
      this.prisma.tsoftPushQueue.count({ where: { organizationId, status: 'FAILED' } }),
      this.prisma.tsoftPushQueue.count({
        where: {
          organizationId,
          status: 'DONE',
          doneAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.tsoftPushQueue.findFirst({
        where: { organizationId, status: { in: ['FAILED', 'PENDING'] }, lastError: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { lastError: true, updatedAt: true },
      }),
    ]);

    const productActive = productAggregate.find((r) => r.isActive)?._count._all ?? 0;
    const productInactive = productAggregate.find((r) => !r.isActive)?._count._all ?? 0;
    const variantActive = variantAggregate.find((r) => r.isActive)?._count._all ?? 0;
    const variantInactive = variantAggregate.find((r) => !r.isActive)?._count._all ?? 0;

    return {
      products: {
        total: productActive + productInactive,
        active: productActive,
        lastPulledAt: lastProductPull?.tsoftLastPulledAt?.toISOString() ?? null,
      },
      variants: {
        total: variantActive + variantInactive,
        active: variantActive,
      },
      orders: {
        lastSyncedAt:
          lastOrderTsoft?.tsoftPushedAt?.toISOString() ??
          lastOrderTsoft?.createdAt?.toISOString() ??
          null,
        tsoftLinked: tsoftLinkedOrders,
      },
      customers: { matched: matchedContacts },
      pushQueue: {
        pending: pushPending,
        running: pushRunning,
        failed: pushFailed,
        done24h: pushDone24,
        lastError: lastFailed?.lastError ?? null,
        lastFailedAt: lastFailed?.updatedAt?.toISOString() ?? null,
      },
    };
  }

  async listOrders(
    organizationId: string,
    page: number,
    limit: number,
    opts: { dateStart?: Date | string | null; dateEnd?: Date | string | null } = {},
  ) {
    return this.tsoftApi.listOrders(organizationId, page, limit, opts);
  }

  /** T-Soft site müşteri listesi (üyeler) */
  async listCustomers(organizationId: string, page: number, limit: number) {
    const result = await this.tsoftApi.listCustomersPage(organizationId, page, limit);
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const normalized = rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      const id = String(r.CustomerId ?? r.id ?? r.ID ?? r.customerId ?? '').trim();
      const name = String(r.Name ?? r.name ?? r.firstName ?? '').trim();
      const surname = String(r.Surname ?? r.surname ?? r.lastName ?? '').trim();
      const fullName = [name, surname].filter(Boolean).join(' ').trim();
      return {
        id: id || '—',
        name: fullName || String(r.CustomerName ?? r.customerName ?? '').trim() || '—',
        email: String(r.Email ?? r.email ?? '').trim() || null,
        phone:
          String(
            r.Mobile ?? r.mobilePhone ?? r.customerPhone ?? r.Phone ?? r.phone ?? '',
          ).trim() || null,
        company: String(r.CompanyName ?? r.companyName ?? r.company ?? '').trim() || null,
        city: String(r.City ?? r.city ?? r.cityName ?? '').trim() || null,
        raw,
      };
    });
    const totalPages =
      Number((result as { totalPages?: number } | undefined)?.totalPages ?? 1) || 1;
    return {
      rows: normalized,
      total: Number(result?.total ?? normalized.length) || normalized.length,
      page,
      totalPages,
    };
  }

  /**
   * Org için WORKING WhatsApp oturumu varsa kişiyle boş sohbet kaydı açar (inbox’ta görünür).
   */
  private async ensureWhatsappConversationForContact(organizationId: string, contactId: string) {
    let session = await this.prisma.whatsappSession.findFirst({
      where: { organizationId, status: 'WORKING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!session) {
      session = await this.prisma.whatsappSession.findFirst({
        where: { status: 'WORKING', organizationId: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
    }
    if (!session) return;
    await this.prisma.conversation.upsert({
      where: { contactId_sessionId: { contactId, sessionId: session.id } },
      update: {},
      create: { contactId, sessionId: session.id },
    });
  }

  /**
   * T-Soft müşterilerini çeker; eşleşen CRM kişilerini günceller, eşleşmeyenleri oluşturur.
   * Tüm sayfalar taranır (üst sınır: {@link TSOFT_SYNC_CUSTOMERS_MAX_PAGES} sayfa).
   */
  async syncTsoftCustomers(organizationId: string) {
    this.logger.log(`[TSOFT-SYNC-CUSTOMERS] Başlatılıyor orgId=${organizationId}`);
    const customers = await this.tsoftApi.fetchAllCustomers(organizationId, TSOFT_SYNC_CUSTOMERS_MAX_PAGES);
    this.logger.log(
      `[TSOFT-SYNC-CUSTOMERS] T-Soft'tan ${customers.length} müşteri çekildi (en fazla ${TSOFT_SYNC_CUSTOMERS_MAX_PAGES} sayfa)`,
    );

    if (customers.length > 0) {
      this.logger.debug(`[TSOFT-SYNC-CUSTOMERS] İlk müşteri örneği: ${JSON.stringify(customers[0]).slice(0, 500)}`);
    }

    const existingContacts = await this.prisma.contact.findMany({
      where: { organizationId },
      select: { id: true, phone: true, metadata: true },
    });
    const phoneToContact = new Map<string, typeof existingContacts[0]>();
    for (const c of existingContacts) {
      phoneToContact.set(normalizeComparablePhone(c.phone), c);
    }

    let matched = 0;
    let created = 0;
    let skipped = 0;

    for (const cust of customers) {
      // REST1: Mobile, Phone — v3: mobilePhone, customerPhone, phone
      const mobile = String(
        cust.Mobile || cust.Phone || cust.mobilePhone || cust.customerPhone || cust.phone || '',
      ).trim();
      const normalizedPhone = normalizeTsoftPhone(mobile);
      if (!normalizedPhone) {
        skipped++;
        continue;
      }
      // REST1: CustomerId — v3: id
      const externalId = String(cust.CustomerId ?? cust.id ?? '').trim();
      if (!externalId) { skipped++; continue; }

      const existing = phoneToContact.get(normalizedPhone);
      const ecommerceMeta = {
        provider: 'tsoft',
        externalId,
        label: TSOFT_LABEL,
        syncedAt: new Date().toISOString(),
      };

      if (existing) {
        const prev = existing.metadata && typeof existing.metadata === 'object'
          ? (existing.metadata as Record<string, unknown>) : {};
        await this.prisma.contact.update({
          where: { id: existing.id },
          data: { metadata: { ...prev, ecommerce: ecommerceMeta } as object },
        });
        await this.ensureWhatsappConversationForContact(organizationId, existing.id);
        matched++;
      } else {
        try {
          // REST1: Name, Surname, Email, CompanyName, City, Address
          const name = String(cust.Name || cust.name || cust.firstName || '').trim() || null;
          const surname = String(cust.Surname || cust.surname || cust.lastName || '').trim() || null;
          const email = String(cust.Email || cust.email || '').trim() || null;
          const company = String(cust.CompanyName || cust.company || cust.companyName || '').trim() || null;
          const city = String(cust.City || cust.city || cust.cityName || '').trim() || null;
          const address = String(cust.Address || cust.address || '').trim() || null;
          const taxOffice = String(cust.TaxOffice || cust.taxOffice || '').trim() || null;
          const taxNo = String(cust.TaxNo || cust.taxNo || '').trim() || null;

          const newContact = await this.prisma.contact.create({
            data: {
              phone: normalizedPhone,
              name,
              surname,
              email,
              company,
              city,
              address,
              source: TSOFT_SOURCE,
              organizationId,
              metadata: {
                ecommerce: ecommerceMeta,
                taxOffice,
                taxNo,
              } as object,
            },
          });
          phoneToContact.set(normalizedPhone, { id: newContact.id, phone: newContact.phone, metadata: newContact.metadata });
          await this.ensureWhatsappConversationForContact(organizationId, newContact.id);
          created++;
          this.logger.debug(`[TSOFT-SYNC-CUSTOMERS] Yeni kişi oluşturuldu: ${normalizedPhone} → ${name} ${surname}`);
        } catch (e: any) {
          if (e?.code === 'P2002') {
            matched++;
          } else {
            this.logger.warn(`[TSOFT-SYNC-CUSTOMERS] Kişi oluşturma hatası (${normalizedPhone}): ${e?.message}`);
          }
        }
      }
    }

    this.logger.log(`[TSOFT-SYNC-CUSTOMERS] Sonuç: ${matched} eşleşti, ${created} yeni oluşturuldu, ${skipped} atlandı (telefon yok)`);
    return {
      matched,
      created,
      skipped,
      tsoftCustomerCount: customers.length,
      crmContactCount: existingContacts.length,
      maxPerSync: customers.length,
      maxPagesScanned: TSOFT_SYNC_CUSTOMERS_MAX_PAGES,
    };
  }

  private mergeEcommerceMeta(
    existing: unknown,
    ecommerce: { provider: string; externalId: string; label: string },
  ) {
    const prev = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
    return {
      ...prev,
      ecommerce: {
        provider: ecommerce.provider,
        externalId: ecommerce.externalId,
        label: ecommerce.label,
        syncedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * setCustomers REST1 yanıtı çoğunlukla `CustomerId` veya `data[]` içinde döner; yoksa başarılı ise CustomerCode (= e-posta) kullanılır.
   */
  private extractCreatedCustomerId(res: unknown, emailForFallback: string): string {
    const fromApi = extractTsoftCustomerIdFromSetCustomersResponse(res);
    if (fromApi) return fromApi;
    if (looksLikeTsoftSuccessResponse(res) && emailForFallback.trim()) {
      this.logger.warn(
        `[TSOFT setCustomers] Yanıtta müşteri kimliği yok; metadata.externalId için e-posta kullanılıyor (CustomerCode ile uyumlu)`,
      );
      return emailForFallback.trim();
    }
    throw new BadRequestException(
      `T-Soft yanıtında müşteri ID bulunamadı. API gövdesi: ${JSON.stringify(res)?.slice(0, 700)}`,
    );
  }

  /**
   * T-Soft OrderStatus (metin/id) → CRM OrderStatus dönüşümü.
   * T-Soft panel URL'sinden gözlemlenen orderStatusId değerleri:
   *   1 = Henüz Tamamlanmadı (sepet terk)
   *   2 = Yeni Sipariş / Ödeme Bekleniyor
   *   3 = Ürün Hazırlanıyor
   *   4 = Kargoya Verildi
   *   5 = Tamamlandı
   *   6 = İptal
   *   7 = İade (→ CANCELLED)
   */
  private mapTsoftOrderStatus(
    tsoftStatusText: string,
    statusId: number,
  ): 'AWAITING_CHECKOUT' | 'AWAITING_PAYMENT' | 'PREPARING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED' {
    const s = tsoftStatusText.toLowerCase();

    // statusId kesin eşleşmeleri metin kontrolünden ÖNCE gelsin
    if (statusId === 1) return 'AWAITING_CHECKOUT';   // Henüz Tamamlanmadı (sepet terk)
    if (statusId === 2) return 'AWAITING_PAYMENT';    // Yeni Sipariş / Ödeme Bekleniyor
    if (statusId === 3) return 'PREPARING';           // Ürün Hazırlanıyor
    if (statusId === 4) return 'SHIPPED';             // Kargoya Verildi
    if (statusId === 5) return 'COMPLETED';           // Tamamlandı
    if (statusId === 6 || statusId === 7) return 'CANCELLED'; // İptal / İade

    // statusId gelmedi veya 0 → metin bazlı fallback
    if (s.includes('iptal') || s.includes('cancel') || s.includes('iade')) return 'CANCELLED';
    if (s.includes('tamamland') || s.includes('teslim') || s.includes('complet') || s.includes('deliver')) return 'COMPLETED';
    if (s.includes('kargo') || s.includes('ship')) return 'SHIPPED';
    if (s.includes('hazırla') || s.includes('process') || s.includes('onay') || s.includes('preparing')) return 'PREPARING';
    if (s.includes('henüz') || s.includes('tamamlanmadı') || s.includes('incomplete') || s.includes('abandon')) return 'AWAITING_CHECKOUT';
    if (s.includes('yeni') || s.includes('ödeme') || s.includes('payment') || s.includes('new')) return 'AWAITING_PAYMENT';

    // Son çare: statusId 0 / bilinmiyor → AWAITING_PAYMENT (en güvenli varsayılan)
    return 'AWAITING_PAYMENT';
  }

  /** Round-robin: org'daki AGENT rolündeki kullanıcılar arasında sırayla atar. */
  private async pickNextAgentRoundRobin(organizationId: string): Promise<string | null> {
    const agents = await this.prisma.user.findMany({
      where: { organizationId, role: 'AGENT', isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!agents.length) return null;

    // En az T-Soft siparişi atanmış agent'ı seç.
    const counts = await this.prisma.salesOrder.groupBy({
      by: ['createdById'],
      where: {
        source: TSOFT_SOURCE,
        contact: { organizationId },
        createdById: { in: agents.map((a) => a.id) },
      },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.createdById, c._count._all]));
    let minAgent = agents[0];
    let minCount = countMap.get(agents[0].id) ?? 0;
    for (const a of agents.slice(1)) {
      const c = countMap.get(a.id) ?? 0;
      if (c < minCount) { minCount = c; minAgent = a; }
    }
    return minAgent.id;
  }

  /**
   * T-Soft siparişlerini çeker ve CRM SalesOrder tablosuna yazar.
   * - Normal siparişler (son 30 gün)
   * - Sepet terk siparişler (orderStatusId=1, 'Henüz Tamamlanmadı')
   * - Her yeni sipariş için atanan AGENT'e görev oluşturur.
   */
  async syncTsoftOrders(
    organizationId: string,
    userId: string,
    opts: { dateStart?: Date | string | null; dateEnd?: Date | string | null } = {},
  ) {
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dateStart = opts.dateStart ? new Date(opts.dateStart) : defaultStart;
    const dateEnd = opts.dateEnd ? new Date(opts.dateEnd) : now;
    const integration = await this.prisma.orgIntegration.findUnique({
      where: {
        organizationId_integrationKey: { organizationId, integrationKey: 'tsoft' },
      },
      select: { config: true },
    });
    const syncCfg =
      integration?.config && typeof integration.config === 'object'
        ? ((integration.config as Record<string, unknown>).sync as Record<string, unknown> | undefined)
        : undefined;
    const createCartAbandonTasks = syncCfg?.cartAbandonTasks !== false;
    const autoTaskTsoftOrdersEnabled =
      (await this.settingsService.get('auto_task_tsoft_order_sync')) !== 'false';
    const autoTaskTsoftCartAbandonEnabled =
      (await this.settingsService.get('auto_task_tsoft_cart_abandon')) !== 'false';
    this.logger.log(
      `[TSOFT-SYNC-ORDERS] Başlatılıyor orgId=${organizationId} aralık=${dateStart.toISOString()}..${dateEnd.toISOString()}`,
    );

    // Normal siparişler (tüm durumlar) + sepet terk (orderStatusId=1) ayrı çekilir.
    const fetchPages = async (orderStatusId?: number): Promise<Record<string, unknown>[]> => {
      const result: Record<string, unknown>[] = [];
      for (let page = 1; page <= 50 && result.length < TSOFT_SYNC_ORDERS_MAX; page++) {
        const { rows } = await this.tsoftApi.listOrders(organizationId, page, 100, {
          dateStart,
          dateEnd,
          orderStatusId: orderStatusId ?? null,
        });
        this.logger.debug(`[TSOFT-SYNC-ORDERS] sayfa=${page} statusId=${orderStatusId ?? 'all'}: ${rows.length} sipariş`);
        if (!rows.length) break;
        for (const r of rows) {
          if (r && typeof r === 'object') result.push(r as Record<string, unknown>);
        }
        if (rows.length < 100) break;
      }
      return result;
    };

    const [regularOrders, abandonedOrders] = await Promise.all([
      fetchPages(),
      fetchPages(1), // orderStatusId=1 = "Henüz Tamamlanmadı"
    ]);

    // Birleştir, tsoftId üzerinden tekilleştir.
    // abandonedOrders ÖNCE gelsin: aynı sipariş her iki listede varsa
    // sepet terk statüsü (statusId=1) korunmuş olur.
    const seenTsoftIds = new Set<string>();
    const allOrders: Record<string, unknown>[] = [];
    for (const r of [...abandonedOrders, ...regularOrders]) {
      const id = String(r.OrderId ?? r.OrderCode ?? r.id ?? r.orderId ?? '').trim();
      if (id && !seenTsoftIds.has(id)) {
        seenTsoftIds.add(id);
        allOrders.push(r);
      }
    }

    this.logger.log(
      `[TSOFT-SYNC-ORDERS] Toplam: ${allOrders.length} sipariş (normal=${regularOrders.length}, terk=${abandonedOrders.length})`,
    );

    let imported = 0;
    let skippedExisting = 0;
    let errors = 0;

    for (const raw of allOrders) {
      const tsoftId = String(raw.OrderId ?? raw.OrderCode ?? raw.id ?? raw.orderId ?? '').trim();
      const tsoftCode = String(raw.OrderCode ?? raw.orderCode ?? tsoftId).trim();
      if (!tsoftId) {
        this.logger.warn(`[TSOFT-SYNC-ORDERS] Sipariş ID bulunamadı: ${JSON.stringify(raw).slice(0, 300)}`);
        errors++;
        continue;
      }

      const externalId = `tsoft_${tsoftId}`;
      const siteOidRaw = raw.OrderId ?? raw.orderId;
      const siteOid =
        siteOidRaw != null && String(siteOidRaw).trim() !== '' ? String(siteOidRaw).trim() : null;
      const tsoftStatusText = String(raw.OrderStatus || raw.status || raw.orderStatus || raw.OrderStatusName || '').trim();
      const statusId = Number(
        raw.OrderStatusId ?? raw.orderStatusId ?? raw.order_status_id ?? raw.StatusId ?? raw.statusId ?? 0,
      );
      const crmStatus = this.mapTsoftOrderStatus(tsoftStatusText, statusId);

      let existing = await this.prisma.salesOrder.findUnique({ where: { externalId } });
      if (!existing && siteOid) {
        existing = await this.prisma.salesOrder.findFirst({
          where: {
            OR: [{ tsoftSiteOrderId: siteOid }, { externalId: siteOid }],
            contact: { organizationId },
          },
        });
        if (existing) {
          // CRM'den push edilmiş sipariş — externalId'yi birleşik formata backfill et, tekrar oluşturma.
          // siteOrderData'yı da doldur ki detay sayfasında T-Soft alanları görünsün.
          await this.prisma.salesOrder.update({
            where: { id: existing.id },
            data: {
              externalId,
              tsoftSiteOrderId: siteOid,
            },
          });
          this.logger.debug(
            `[TSOFT-SYNC-ORDERS] Mevcut CRM siparişi T-Soft ID ile eşleşti, externalId backfill: #${tsoftCode}`,
          );
        }
      }
      if (existing) {
        const prevStatus = existing.status;
        await this.prisma.salesOrder.update({
          where: { id: existing.id },
          data: {
            externalId,
            tsoftSiteOrderId: siteOid,
            status: crmStatus as any,
          },
        });
        if (prevStatus !== crmStatus) {
          await this.autoReplyEngine.processOrderStatusEvent({
            orderId: existing.id,
            status: crmStatus as any,
            organizationId,
          });
        }
        skippedExisting++;
        continue;
      }

      try {
        const customerPhone = String(
          raw.InvoiceMobile || raw.DeliveryMobile || raw.InvoiceTel || raw.DeliveryTel ||
          raw.customerPhone || raw.customer_phone || raw.mobilePhone || raw.phone || '',
        ).trim();
        const customerEmail = String(
          raw.CustomerUsername || raw.customerEmail || raw.customer_email || raw.email || '',
        ).trim();
        const fullName = String(raw.CustomerName || raw.customerName || raw.name || '').trim();
        const nameParts = fullName.split(/\s+/);
        const customerName = nameParts[0] || '';
        const customerSurname = nameParts.slice(1).join(' ') || '';

        const normalizedPhone = normalizeTsoftPhone(customerPhone);
        if (!normalizedPhone && !customerEmail) {
          this.logger.warn(`[TSOFT-SYNC-ORDERS] Sipariş ${tsoftCode}: Müşteri telefonu/e-postası yok, atlanıyor`);
          errors++;
          continue;
        }

        let contact = normalizedPhone
          ? await this.prisma.contact.findUnique({ where: { phone: normalizedPhone } })
          : null;
        if (!contact && customerEmail) {
          contact = await this.prisma.contact.findFirst({
            where: { email: customerEmail, organizationId },
          });
        }
        if (!contact && normalizedPhone) {
          contact = await this.prisma.contact.create({
            data: {
              phone: normalizedPhone,
              name: customerName || null,
              surname: customerSurname || null,
              email: customerEmail || null,
              source: TSOFT_SOURCE,
              organizationId,
              metadata: {
                ecommerce: {
                  provider: 'tsoft',
                  externalId: String(raw.CustomerId || raw.customerId || tsoftId),
                  label: TSOFT_LABEL,
                  syncedAt: new Date().toISOString(),
                },
              } as object,
            },
          });
          this.logger.debug(`[TSOFT-SYNC-ORDERS] Sipariş ${tsoftCode} için yeni kişi oluşturuldu: ${normalizedPhone}`);
          await this.ensureWhatsappConversationForContact(organizationId, contact.id);
        }

        if (!contact) {
          this.logger.warn(`[TSOFT-SYNC-ORDERS] Sipariş ${tsoftCode}: Kişi oluşturulamadı/bulunamadı`);
          errors++;
          continue;
        }

        const grandTotal = Number(
          raw.OrderTotalPrice ?? raw.grandTotal ?? raw.total ?? raw.orderTotal ?? raw.totalPrice ?? 0,
        );
        const currency = String(raw.Currency || raw.currency || raw.currencyCode || 'TRY').trim().toUpperCase() || 'TRY';

        const shippingAddress = [
          raw.DeliveryAddress || raw.DeliveryName,
          raw.DeliveryCity,
          raw.DeliveryTown,
        ].filter(Boolean).join(', ') || String(raw.shippingAddress || raw.address || '').trim() || null;

        const orderNotes = String(raw.OrderNote || raw.notes || raw.orderNote || raw.customerNote || '').trim() || null;

        const orderItems = this.extractOrderItems(raw);
        const subtotal = orderItems.reduce((s, i) => s + i.lineTotal, 0);
        const vatTotal = Math.max(0, grandTotal - subtotal);

        const tsDate = raw.OrderDateTimeStamp || raw.OrderDate;
        let parsedDate: Date;
        if (typeof tsDate === 'number' || (typeof tsDate === 'string' && /^\d{10,}$/.test(tsDate))) {
          const ts = Number(tsDate);
          parsedDate = new Date(ts < 1e12 ? ts * 1000 : ts);
        } else {
          parsedDate = tsDate ? new Date(String(tsDate)) : new Date();
        }
        const validDate = Number.isFinite(parsedDate.getTime()) ? parsedDate : new Date();

        // Round-robin: atanacak AGENT seç (bulunamazsa senkronu başlatan kullanıcı)
        const assignedUserId = (await this.pickNextAgentRoundRobin(organizationId)) ?? userId;

        const newOrder = await this.prisma.salesOrder.create({
          data: {
            externalId,
            tsoftSiteOrderId: siteOid,
            siteOrderData: raw as Prisma.InputJsonValue,
            source: TSOFT_SOURCE,
            contactId: contact.id,
            createdById: assignedUserId,
            status: crmStatus as any,
            currency,
            subtotal: Math.round(subtotal * 100) / 100,
            vatTotal: Math.round(vatTotal * 100) / 100,
            grandTotal: Math.round(grandTotal * 100) / 100,
            shippingAddress,
            notes: orderNotes ? `[Site Siparişi #${tsoftCode}] ${orderNotes}` : `[Site Siparişi #${tsoftCode}]`,
            createdAt: validDate,
            items: {
              create: orderItems.map((item) => ({
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatRate: item.vatRate,
                priceIncludesVat: false,
                lineTotal: item.lineTotal,
                isFromStock: true,
                measurementInfo: item.measurementInfo,
              })),
            },
          } as any,
          select: { id: true, orderNumber: true },
        });

        // Otomatik görev oluştur
        try {
          if (!autoTaskTsoftOrdersEnabled) {
            imported++;
            this.logger.debug(
              `[TSOFT-SYNC-ORDERS] Otomatik T-Soft görevleri kapalı, task atlandı: ${newOrder.id}`,
            );
            continue;
          }
          if (crmStatus === 'AWAITING_CHECKOUT' && (!createCartAbandonTasks || !autoTaskTsoftCartAbandonEnabled)) {
            imported++;
            this.logger.debug(
              `[TSOFT-SYNC-ORDERS] Sepet terk görevleri kapalı, task atlandı: ${newOrder.id}`,
            );
            continue;
          }
          const dueAt = new Date(validDate.getTime() + 24 * 60 * 60 * 1000);
          const orderLabel = newOrder.orderNumber
            ? `SIP-${String(newOrder.orderNumber).padStart(5, '0')}`
            : tsoftCode;
          const taskTitle =
            crmStatus === 'AWAITING_CHECKOUT'
              ? `Sepet hatırlatması: ${orderLabel}`
              : `T-Soft siparişi işleme al: ${orderLabel}`;
          const taskDesc =
            crmStatus === 'AWAITING_CHECKOUT'
              ? `T-Soft'ta sepeti terk eden site müşterisi. Sipariş toplam: ${grandTotal} ${currency}.`
              : `T-Soft'tan gelen site siparişi. Durum: ${tsoftStatusText || crmStatus}. Toplam: ${grandTotal} ${currency}.`;
          await this.prisma.task.create({
            data: {
              userId: assignedUserId,
              contactId: contact.id,
              title: taskTitle,
              description: taskDesc,
              dueAt,
              trigger: `tsoft_order_sync:${newOrder.id}`,
            },
          });
        } catch (taskErr: any) {
          this.logger.warn(`[TSOFT-SYNC-ORDERS] Görev oluşturulamadı (sipariş=${newOrder.id}): ${taskErr?.message}`);
        }

        imported++;
        await this.autoReplyEngine.processOrderStatusEvent({
          orderId: newOrder.id,
          status: crmStatus,
          organizationId,
        });
        this.logger.debug(
          `[TSOFT-SYNC-ORDERS] Aktarıldı: T-Soft #${tsoftCode} → CRM ${newOrder.id} (${crmStatus}) agent=${assignedUserId}`,
        );
      } catch (e: any) {
        if (e?.code === 'P2002') {
          skippedExisting++;
        } else {
          this.logger.error(`[TSOFT-SYNC-ORDERS] Sipariş ${tsoftId} aktarım hatası: ${e?.message}`);
          errors++;
        }
      }
    }

    this.logger.log(`[TSOFT-SYNC-ORDERS] Sonuç: ${imported} aktarıldı, ${skippedExisting} zaten var, ${errors} hata`);
    return {
      imported,
      skippedExisting,
      errors,
      totalFetched: allOrders.length,
      maxPerSync: TSOFT_SYNC_ORDERS_MAX,
    };
  }

  /** E-ticaret ekranında CRM siparişi seçmek için (organizasyon filtresi). */
  async listCrmOrdersPicklist(organizationId: string, limit = 25) {
    const take = Math.min(50, Math.max(1, limit));
    const orders = await this.prisma.salesOrder.findMany({
      where: { contact: { organizationId } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        currency: true,
        status: true,
        source: true,
        tsoftSiteOrderId: true,
        createdAt: true,
        contact: {
          select: {
            name: true,
            surname: true,
            phone: true,
          },
        },
      },
    });
    return { orders };
  }

  private extractOrderItems(raw: Record<string, unknown>): Array<{
    name: string; quantity: number; unitPrice: number; vatRate: number; lineTotal: number; measurementInfo?: string | null;
  }> {
    const items: Array<{ name: string; quantity: number; unitPrice: number; vatRate: number; lineTotal: number; measurementInfo?: string | null }> = [];

    // REST1: OrderDetails — v3: items, orderItems, products
    const candidates = [
      raw.OrderDetails, raw.orderDetails,
      raw.items, raw.orderItems, raw.order_items, raw.products,
      raw.details, raw.order_details, raw.lines,
    ];
    let list: unknown[] = [];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) { list = c; break; }
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const inner = c as Record<string, unknown>;
        if (Array.isArray(inner.data)) { list = inner.data; break; }
        if (Array.isArray(inner.items)) { list = inner.items; break; }
      }
    }

    if (list.length === 0) {
      const grandTotal = Number(raw.OrderTotalPrice ?? raw.grandTotal ?? raw.total ?? 0);
      if (grandTotal > 0) {
        items.push({
          name: `Site Siparişi #${raw.OrderCode || raw.OrderId || raw.id || '?'}`,
          quantity: 1,
          unitPrice: grandTotal,
          vatRate: 20,
          lineTotal: grandTotal,
          measurementInfo: null,
        });
      }
      return items;
    }

    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      // REST1: ProductName, Quantity, SellingPrice, Vat
      const name = String(
        r.ProductName || r.name || r.productName || r.product_name || r.title || 'Ürün',
      ).trim();
      const quantity = Math.max(1, Number(r.Quantity || r.quantity || r.qty || r.amount || 1));
      const unitPrice = Number(
        r.SellingPrice || r.SellingPriceWithoutVat || r.unitPrice || r.unit_price || r.price || r.salePrice || 0,
      );
      const lineTotal = Number(
        r.lineTotal || r.total || r.subTotal || r.rowTotal || (unitPrice * quantity),
      );
      const vatRate = Math.round(Number(r.Vat || r.vatRate || r.vat_rate || r.taxRate || 20));
      const property2 = String(
        r.Property2 || r.property2 || r.Property_2 || r.Measurement || r.measurement || '',
      ).trim() || null;
      items.push({
        name,
        quantity,
        unitPrice: Math.round(unitPrice * 100) / 100,
        vatRate: Number.isFinite(vatRate) ? vatRate : 20,
        lineTotal: Math.round(lineTotal * 100) / 100,
        measurementInfo: property2,
      });
    }

    return items;
  }

  async createTsoftCustomerFromContact(
    organizationId: string,
    contactId: string,
    dto: {
      email: string;
      password: string;
      name: string;
      surname: string;
      address?: string;
      countryCode?: string;
      cityCode?: string;
      districtCode?: string;
      provinceCode?: string;
      townCode?: string;
      company?: string;
    },
  ) {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw new NotFoundException('Kişi bulunamadı');
    if (contact.organizationId !== organizationId) {
      throw new BadRequestException('Bu kişi organizasyonunuza ait değil');
    }

    const mobilePhone = formatPhoneForTsoft(contact.phone);
    if (!mobilePhone || mobilePhone.length < 8) {
      throw new BadRequestException('Geçerli bir cep telefonu numarası bulunamadı');
    }

    const meta = contact.metadata as Record<string, unknown> | null;
    const ec = meta?.ecommerce as Record<string, unknown> | undefined;
    if (ec?.provider === 'tsoft' && ec?.externalId) {
      throw new BadRequestException('Bu kişi zaten site müşterisi olarak işaretli');
    }

    const payload: CreateTsoftSiteCustomerPayload = {
      name: dto.name.trim(),
      surname: dto.surname.trim(),
      email: dto.email.trim(),
      password: dto.password,
      mobilePhone,
      company: dto.company?.trim() || undefined,
      address: dto.address?.trim() || undefined,
      countryCode: dto.countryCode?.trim() || 'TR',
      cityCode: dto.cityCode?.trim() || undefined,
      districtCode: dto.districtCode?.trim() || undefined,
      provinceCode: dto.provinceCode?.trim() || undefined,
      townCode: dto.townCode?.trim() || undefined,
      notification: true,
      smsNotification: true,
    };

    const res = await this.tsoftApi.createCustomer(organizationId, payload);
    const externalId = this.extractCreatedCustomerId(res, payload.email);

    const nextMeta = this.mergeEcommerceMeta(contact.metadata, {
      provider: 'tsoft',
      externalId,
      label: TSOFT_LABEL,
    });

    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        metadata: nextMeta as object,
        email: contact.email || dto.email.trim(),
        name: contact.name || dto.name.trim(),
        surname: contact.surname || dto.surname.trim(),
      },
    });

    return { ok: true, externalId, label: TSOFT_LABEL };
  }

  // ——— T-Soft katalog (DB + REST1) ———

  async syncTsoftCatalog(organizationId: string) {
    this.logger.log(`[TSOFT-CATALOG] Senkron başlıyor org=${organizationId}`);
    let upserted = 0;
    for (let start = 0; ; start += 100) {
      const { rows } = await this.tsoftApi.fetchProductsDetailed(organizationId, start, 100);
      if (!rows.length) break;
      for (const r of rows) {
        const row = r as Record<string, unknown>;
        const draft = rowToCatalogDraft(organizationId, row);
        if (!draft.productCode) continue;
        await this.prisma.tsoftCatalogProduct.upsert({
          where: {
            organizationId_productCode: {
              organizationId,
              productCode: draft.productCode,
            },
          },
          create: {
            id: randomUUID(),
            ...draft,
            subproductsJson: draft.subproductsJson as Prisma.InputJsonValue | undefined,
            rawSnapshotJson: draft.rawSnapshotJson as Prisma.InputJsonValue | undefined,
          },
          update: {
            ...draft,
            subproductsJson: draft.subproductsJson as Prisma.InputJsonValue | undefined,
            rawSnapshotJson: draft.rawSnapshotJson as Prisma.InputJsonValue | undefined,
            syncedAt: new Date(),
          },
        });
        upserted++;
      }
      if (rows.length < 100) break;
    }
    this.logger.log(`[TSOFT-CATALOG] Tamam: ${upserted} upsert`);
    return { upserted };
  }

  async listTsoftCatalog(
    organizationId: string,
    params: { page: number; limit: number; search?: string },
  ) {
    const { page, limit, search } = params;
    const skip = (page - 1) * limit;
    const where: Prisma.TsoftCatalogProductWhereInput = { organizationId };
    const q = search?.trim();
    if (q) {
      where.OR = [
        { productName: { contains: q, mode: 'insensitive' } },
        { productCode: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.tsoftCatalogProduct.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.tsoftCatalogProduct.count({ where }),
    ]);
    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getTsoftCatalogProduct(organizationId: string, id: string) {
    const p = await this.prisma.tsoftCatalogProduct.findFirst({
      where: { id, organizationId },
    });
    if (!p) throw new NotFoundException('Katalog ürünü bulunamadı');
    return p;
  }

  async updateTsoftCatalogProduct(
    organizationId: string,
    id: string,
    dto: {
      productName?: string;
      sellingPrice?: number;
      listPrice?: number | null;
      stock?: number | null;
      vatRate?: number | null;
      currency?: string;
      isActive?: boolean;
      shortDescription?: string | null;
      detailsText?: string | null;
      brand?: string | null;
      barcode?: string | null;
      buyingPrice?: number | null;
      model?: string | null;
      categoryCode?: string | null;
      categoryName?: string | null;
      pushToSite?: boolean;
    },
  ) {
    const existing = await this.getTsoftCatalogProduct(organizationId, id);
    const productName = dto.productName ?? existing.productName;
    const sellingPrice = dto.sellingPrice ?? existing.sellingPrice ?? 0;
    const stock = dto.stock !== undefined ? dto.stock : existing.stock;
    const currency = dto.currency ?? existing.currency;
    const isActive = dto.isActive ?? existing.isActive;
    const vatStr =
      dto.vatRate !== undefined && dto.vatRate !== null
        ? String(dto.vatRate)
        : existing.vatRate != null
          ? String(existing.vatRate)
          : '20';

    const listPriceVal = dto.listPrice !== undefined ? dto.listPrice : existing.listPrice;
    const buyingPriceVal = dto.buyingPrice !== undefined ? dto.buyingPrice : existing.buyingPrice;
    const modelVal = dto.model !== undefined ? dto.model : existing.model;
    const catCodeVal = dto.categoryCode !== undefined ? dto.categoryCode : existing.categoryCode;
    const catNameVal = dto.categoryName !== undefined ? dto.categoryName : existing.categoryName;

    if (dto.pushToSite !== false) {
      await this.tsoftApi.updateProducts(organizationId, {
        ProductCode: existing.productCode,
        ProductName: productName,
        SellingPrice: sellingPrice,
        ListPrice: listPriceVal ?? '',
        BuyingPrice: buyingPriceVal ?? '',
        Stock: stock ?? 0,
        StockUnit: 'Adet',
        Currency: currency,
        Vat: vatStr,
        IsActive: isActive,
        Barcode: dto.barcode ?? existing.barcode ?? '',
        Brand: dto.brand ?? existing.brand ?? '',
        Model: modelVal ?? '',
        DefaultCategoryCode: catCodeVal ?? '',
        CategoryName: catNameVal ?? '',
        ShortDescription: dto.shortDescription ?? existing.shortDescription ?? '',
        Details: dto.detailsText ?? existing.detailsText ?? '',
      });
    }

    return this.prisma.tsoftCatalogProduct.update({
      where: { id: existing.id },
      data: {
        productName,
        sellingPrice,
        listPrice: dto.listPrice !== undefined ? dto.listPrice : existing.listPrice,
        buyingPrice: dto.buyingPrice !== undefined ? dto.buyingPrice : existing.buyingPrice,
        stock,
        vatRate: dto.vatRate !== undefined ? dto.vatRate : existing.vatRate,
        currency,
        isActive,
        shortDescription: dto.shortDescription !== undefined ? dto.shortDescription : existing.shortDescription,
        detailsText: dto.detailsText !== undefined ? dto.detailsText : existing.detailsText,
        brand: dto.brand !== undefined ? dto.brand : existing.brand,
        barcode: dto.barcode !== undefined ? dto.barcode : existing.barcode,
        model: dto.model !== undefined ? dto.model : existing.model,
        categoryCode: dto.categoryCode !== undefined ? dto.categoryCode : existing.categoryCode,
        categoryName: dto.categoryName !== undefined ? dto.categoryName : existing.categoryName,
        syncedAt: new Date(),
      },
    });
  }

  async createTsoftCatalogProduct(
    organizationId: string,
    dto: {
      productCode: string;
      productName: string;
      sellingPrice: number;
      currency?: string;
      stock?: number;
      vatRate?: number;
      isActive?: boolean;
      barcode?: string;
      brand?: string;
      shortDescription?: string;
      detailsText?: string;
    },
  ) {
    const code = dto.productCode.trim();
    const dup = await this.prisma.tsoftCatalogProduct.findUnique({
      where: { organizationId_productCode: { organizationId, productCode: code } },
    });
    if (dup) throw new BadRequestException('Bu ürün kodu zaten kayıtlı');

    await this.tsoftApi.setProducts(organizationId, {
      ProductCode: code,
      ProductName: dto.productName.trim(),
      SellingPrice: dto.sellingPrice,
      Currency: dto.currency || 'TL',
      Stock: dto.stock ?? 0,
      StockUnit: 'Adet',
      Vat: String(dto.vatRate ?? 20),
      IsActive: dto.isActive !== false,
      Barcode: dto.barcode || '',
      Brand: dto.brand || '',
      ShortDescription: dto.shortDescription || '',
      Details: dto.detailsText || '',
    });

    const draft = rowToCatalogDraft(organizationId, {
      ProductCode: code,
      ProductName: dto.productName.trim(),
      SellingPrice: dto.sellingPrice,
      Currency: dto.currency || 'TRY',
      Stock: dto.stock ?? 0,
      Vat: dto.vatRate ?? 20,
      IsActive: dto.isActive !== false,
      Barcode: dto.barcode,
      Brand: dto.brand,
      ShortDescription: dto.shortDescription,
      Details: dto.detailsText,
    });

    return this.prisma.tsoftCatalogProduct.create({
      data: {
        id: randomUUID(),
        ...draft,
        subproductsJson: draft.subproductsJson as Prisma.InputJsonValue | undefined,
        rawSnapshotJson: draft.rawSnapshotJson as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async deleteTsoftCatalogProduct(organizationId: string, id: string, deleteOnSite: boolean) {
    const existing = await this.getTsoftCatalogProduct(organizationId, id);
    if (deleteOnSite) {
      await this.tsoftApi.deleteProductByCode(organizationId, existing.productCode);
    }
    await this.prisma.tsoftCatalogProduct.delete({ where: { id: existing.id } });
    return { deleted: true };
  }

  /** T-Soft sitedeki siparişi sil (numerik OrderId) */
  async deleteTsoftSiteOrderByNumericId(organizationId: string, tsoftOrderId: number) {
    return this.tsoftApi.deleteSiteOrder(organizationId, tsoftOrderId);
  }

  /** T-Soft sipariş durumu — OrderStatusId için önce getOrderStatusList kullanın */
  async setTsoftSiteOrderStatus(
    organizationId: string,
    body: { orderNumericId: number; orderStatusId: string },
  ) {
    return this.tsoftApi.updateSiteOrderStatus(organizationId, {
      OrderId: body.orderNumericId,
      OrderStatusId: body.orderStatusId,
    });
  }

  async listTsoftOrderStatuses(organizationId: string) {
    return this.tsoftApi.getOrderStatusList(organizationId);
  }

  /** Kayıtlı CRM siparişini T-Soft’a gönderir (`tsoftSiteOrderId` yazılır). */
  async pushCrmSalesOrderToTsoft(organizationId: string, salesOrderId: string) {
    return this.ordersService.pushSalesOrderToTsoftSite(salesOrderId, organizationId);
  }

  /** CRM siparişine bağlı site siparişini T-Soft’ta siler; CRM’deki `tsoftSiteOrderId` temizlenir. */
  async deleteTsoftSiteOrderLinkedToCrm(organizationId: string, salesOrderId: string) {
    const o = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, contact: { organizationId } },
      select: { id: true, tsoftSiteOrderId: true },
    });
    if (!o) throw new NotFoundException('Sipariş bulunamadı');
    if (!o.tsoftSiteOrderId?.trim()) {
      throw new BadRequestException('Bu siparişin T-Soft site kimliği yok');
    }
    const num = Number(o.tsoftSiteOrderId);
    if (!Number.isFinite(num)) {
      throw new BadRequestException('Geçersiz T-Soft sipariş numarası');
    }
    await this.tsoftApi.deleteSiteOrder(organizationId, num);
    await this.prisma.salesOrder.update({
      where: { id: o.id },
      data: { tsoftSiteOrderId: null },
    });
    return { ok: true, deletedSiteOrderId: num };
  }

  /** CRM’deki `tsoftSiteOrderId` ile site sipariş durumunu günceller. */
  async setTsoftSiteOrderStatusFromCrm(
    organizationId: string,
    salesOrderId: string,
    orderStatusId: string,
  ) {
    const o = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, contact: { organizationId } },
      select: { id: true, tsoftSiteOrderId: true },
    });
    if (!o) throw new NotFoundException('Sipariş bulunamadı');
    if (!o.tsoftSiteOrderId?.trim()) {
      throw new BadRequestException('Bu sipariş siteye bağlı değil');
    }
    const num = Number(o.tsoftSiteOrderId);
    if (!Number.isFinite(num)) {
      throw new BadRequestException('Geçersiz T-Soft sipariş numarası');
    }
    return this.setTsoftSiteOrderStatus(organizationId, {
      orderNumericId: num,
      orderStatusId,
    });
  }
}
