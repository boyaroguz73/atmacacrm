import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';
import { TsoftProductSyncService } from './tsoft-product-sync.service';
import { TsoftPushService } from './tsoft-push.service';

/**
 * T-Soft pull sync cronları.
 *  - Ürün + varyant + görsel: 30 dk
 *  - Müşteri: 60 dk
 *  - Sipariş + auto-reply: 15 dk
 *
 * Her organizasyon için OrgIntegration.config.tsoft.sync.* bayrakları kontrol edilir.
 * Enabled değilse tur atlanır. İlk açılışta 30sn gecikmeli tek ilk tur yapılır.
 */
@Injectable()
export class TsoftSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(TsoftSyncScheduler.name);
  private initialRunDone = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ecommerce: EcommerceService,
    private readonly productSync: TsoftProductSyncService,
    private readonly pushService: TsoftPushService,
  ) {}

  async onModuleInit(): Promise<void> {
    // T-Soft pull senkron zamanlayıcıları kapalı (manuel tetikleme kullanılıyor).
    this.logger.log('[TSOFT-SCHED] pull zamanlayıcıları devre dışı; senkron manuel tetiklenmeli');
  }

  private async runInitialBurst(): Promise<void> {
    if (this.initialRunDone) return;
    this.initialRunDone = true;
    this.logger.log('[TSOFT-SCHED] ilk tur başlıyor (30sn gecikme sonrası)');
    await this.runProductSync();
  }

  /** Ürün + varyant + görsel (30 dk) */
  // @Cron('0 */30 * * * *', { name: 'tsoft-product-sync' }) — pull zamanlayıcısı kapatıldı
  async runProductSync(): Promise<void> {
    const orgs = await this.listEnabledTsoftOrgs();
    for (const org of orgs) {
      const flags = this.parseProductFlags(org.config);
      if (!flags.enabled) continue;
      try {
        const r = await this.productSync.syncTsoftProducts(org.organizationId, {
          variants: flags.variants,
          images: flags.images,
          stock: flags.stock,
          price: flags.price,
          descriptions: flags.descriptions,
        });
        this.logger.log(
          `[TSOFT-SCHED][org=${org.organizationId}] ürün sync: ${r.upsertedProducts} ürün + ${r.upsertedVariants} varyant; skip=${r.skippedPendingPush} sweep=${r.sweepedInactive} err=${r.errors.length}`,
        );
      } catch (e) {
        this.logger.error(
          `[TSOFT-SCHED][org=${org.organizationId}] ürün sync hata: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** Müşteri (60 dk) */
  // @Cron(CronExpression.EVERY_HOUR, { name: 'tsoft-customer-sync' }) — pull zamanlayıcısı kapatıldı
  async runCustomerSync(): Promise<void> {
    const orgs = await this.listEnabledTsoftOrgs();
    for (const org of orgs) {
      const cfg = (org.config?.sync ?? {}) as Record<string, unknown>;
      if (cfg.customers === false) continue;
      try {
        const r = await this.ecommerce.syncTsoftCustomers(org.organizationId);
        this.logger.log(
          `[TSOFT-SCHED][org=${org.organizationId}] müşteri sync: ${JSON.stringify(r).slice(0, 200)}`,
        );
      } catch (e) {
        this.logger.error(
          `[TSOFT-SCHED][org=${org.organizationId}] müşteri sync hata: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** Push queue drenajı (her dakika) — CRM → T-Soft yazımları */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'tsoft-push-drain' })
  async drainPushQueue(): Promise<void> {
    const orgs = await this.listEnabledTsoftOrgs();
    for (const org of orgs) {
      const cfg = (org.config?.sync ?? {}) as Record<string, unknown>;
      if (cfg.push === false) continue;
      try {
        const res = await this.pushService.processQueue(org.organizationId, 20);
        if (res.claimed > 0) {
          this.logger.log(
            `[TSOFT-PUSH-DRAIN][org=${org.organizationId}] claimed=${res.claimed} done=${res.done} failed=${res.failed}`,
          );
        }
      } catch (e) {
        this.logger.error(
          `[TSOFT-PUSH-DRAIN][org=${org.organizationId}] hata: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** Sipariş (15 dk) — createdById için org'un bir admin'ini seçer */
  @Cron('0 */15 * * * *', { name: 'tsoft-order-sync' })
  async runOrderSync(): Promise<void> {
    const orgs = await this.listEnabledTsoftOrgs();
    for (const org of orgs) {
      const cfg = (org.config?.sync ?? {}) as Record<string, unknown>;
      if (cfg.orders === false) continue;
      try {
        const admin = await this.prisma.user.findFirst({
          where: {
            organizationId: org.organizationId,
            role: { in: ['SUPERADMIN', 'ADMIN'] } as any,
            isActive: true,
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!admin) {
          this.logger.warn(
            `[TSOFT-SCHED][org=${org.organizationId}] sipariş sync atlandı: admin kullanıcı yok`,
          );
          continue;
        }
        const r = await this.ecommerce.syncTsoftOrders(org.organizationId, admin.id);
        this.logger.log(
          `[TSOFT-SCHED][org=${org.organizationId}] sipariş sync: ${JSON.stringify(r).slice(0, 200)}`,
        );
      } catch (e) {
        this.logger.error(
          `[TSOFT-SCHED][org=${org.organizationId}] sipariş sync hata: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async listEnabledTsoftOrgs(): Promise<
    { organizationId: string; config: Record<string, unknown> | null }[]
  > {
    const rows = await this.prisma.orgIntegration.findMany({
      where: { integrationKey: 'tsoft', isEnabled: true },
      select: { organizationId: true, config: true },
    });
    return rows.map((r) => ({
      organizationId: r.organizationId,
      config: (r.config as Record<string, unknown> | null) ?? null,
    }));
  }

  private parseProductFlags(config: Record<string, unknown> | null): {
    enabled: boolean;
    variants: boolean;
    images: boolean;
    stock: boolean;
    price: boolean;
    descriptions: boolean;
  } {
    const sync = (config?.sync ?? {}) as Record<string, unknown>;
    const products = sync.products as Record<string, unknown> | boolean | undefined;
    // sync.products = true | false | { enabled, variants, images, ... } — hepsi kabul.
    // Ayrıca admin panelinde düz sync.variants / sync.images bayrakları da okunur.
    const flatVariants = sync.variants !== false;
    const flatImages = sync.images !== false;

    if (products === false) {
      return { enabled: false, variants: false, images: false, stock: false, price: false, descriptions: false };
    }
    if (products === true || products == null) {
      return {
        enabled: true,
        variants: flatVariants,
        images: flatImages,
        stock: true,
        price: true,
        descriptions: true,
      };
    }
    const p = products as Record<string, unknown>;
    return {
      enabled: p.enabled !== false,
      variants: p.variants !== false && flatVariants,
      images: p.images !== false && flatImages,
      stock: p.stock !== false,
      price: p.price !== false,
      descriptions: p.descriptions !== false,
    };
  }
}
