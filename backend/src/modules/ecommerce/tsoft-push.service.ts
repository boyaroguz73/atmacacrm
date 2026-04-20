import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TsoftApiService } from './tsoft-api.service';

/**
 * T-Soft push kuyruğu — CRM → T-Soft yazımları için dayanıklı iş kuyruğu.
 * Entity: PRODUCT | VARIANT | ORDER | IMAGE
 * Op:     CREATE | UPDATE | DELETE
 *
 * Worker `processQueue(organizationId?)` her dakika tetiklenir (scheduler tarafından).
 * Başarısızlıkta exp. backoff ile yeniden denenir (attemptCount < 5).
 */
export type PushEntity = 'PRODUCT' | 'VARIANT' | 'ORDER' | 'IMAGE';
export type PushOp = 'CREATE' | 'UPDATE' | 'DELETE';

export interface PushEnqueueInput {
  organizationId: string;
  entity: PushEntity;
  entityId: string;
  op: PushOp;
  payload: Prisma.InputJsonValue;
  /** İleri zamana planlamak için (retry sonrası backoff). */
  scheduledAt?: Date;
}

export interface PushResult {
  claimed: number;
  done: number;
  failed: number;
}

const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 180, 600, 1800, 3600]; // 1dk, 3dk, 10dk, 30dk, 1sa

@Injectable()
export class TsoftPushService {
  private readonly logger = new Logger(TsoftPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tsoftApi: TsoftApiService,
  ) {}

  /**
   * Kuyruğa yeni iş ekler. Aynı entityId + op PENDING halde varsa yenisini eklemez
   * (duplicate push guard — son payload'ı günceller).
   */
  async enqueue(input: PushEnqueueInput): Promise<void> {
    const existing = await this.prisma.tsoftPushQueue.findFirst({
      where: {
        organizationId: input.organizationId,
        entity: input.entity,
        entityId: input.entityId,
        op: input.op,
        status: { in: ['PENDING', 'FAILED'] },
      },
    });
    if (existing) {
      await this.prisma.tsoftPushQueue.update({
        where: { id: existing.id },
        data: {
          payload: input.payload,
          status: 'PENDING',
          scheduledAt: input.scheduledAt ?? new Date(),
          lastError: null,
        },
      });
      return;
    }
    await this.prisma.tsoftPushQueue.create({
      data: {
        organizationId: input.organizationId,
        entity: input.entity,
        entityId: input.entityId,
        op: input.op,
        payload: input.payload,
        scheduledAt: input.scheduledAt ?? new Date(),
      },
    });
  }

  /**
   * Ürün operasyonu için kısa yol — product.pendingPushOp alanını da set eder
   * (çakışma kuralı: pending push olan kayıtlar pull sync tarafından atlanır).
   */
  async enqueueProductOperation(input: {
    organizationId: string;
    productId: string;
    op: PushOp;
    payload: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.product.update({
      where: { id: input.productId },
      data: { pendingPushOp: input.op },
    });
    await this.enqueue({
      organizationId: input.organizationId,
      entity: 'PRODUCT',
      entityId: input.productId,
      op: input.op,
      payload: input.payload,
    });
  }

  /**
   * Varyant operasyonu kısa yolu.
   */
  async enqueueVariantOperation(input: {
    organizationId: string;
    variantId: string;
    op: PushOp;
    payload: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.enqueue({
      organizationId: input.organizationId,
      entity: 'VARIANT',
      entityId: input.variantId,
      op: input.op,
      payload: input.payload,
    });
  }

  /**
   * Sipariş operasyonu kısa yolu.
   */
  async enqueueOrderOperation(input: {
    organizationId: string;
    orderId: string;
    op: PushOp;
    payload: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.enqueue({
      organizationId: input.organizationId,
      entity: 'ORDER',
      entityId: input.orderId,
      op: input.op,
      payload: input.payload,
    });
  }

  /**
   * Kuyruğu tüketir. Her seferde en fazla `limit` iş alır (varsayılan 10).
   * Uzun süreli RUNNING kayıtlar (ör. kill edilmiş worker) 10 dakika sonra
   * tekrar PENDING'e döner — ayrı bir bakım işi; burada sadece scheduledAt<=now
   * ve status=PENDING filtreliyoruz.
   */
  async processQueue(organizationId?: string, limit = 10): Promise<PushResult> {
    const where: Prisma.TsoftPushQueueWhereInput = {
      status: 'PENDING',
      scheduledAt: { lte: new Date() },
      ...(organizationId ? { organizationId } : {}),
    };

    const batch = await this.prisma.tsoftPushQueue.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });

    const result: PushResult = { claimed: batch.length, done: 0, failed: 0 };
    if (!batch.length) return result;

    for (const job of batch) {
      // Optimistik lock: status=PENDING iken RUNNING'e çek.
      const claimed = await this.prisma.tsoftPushQueue.updateMany({
        where: { id: job.id, status: 'PENDING' },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count === 0) continue; // başka worker aldı

      try {
        await this.executeJob(job);
        await this.prisma.tsoftPushQueue.update({
          where: { id: job.id },
          data: { status: 'DONE', doneAt: new Date(), lastError: null },
        });
        result.done++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const attempts = job.attemptCount + 1;
        const final = attempts >= MAX_ATTEMPTS;
        const backoffSec =
          BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
        const next = new Date(Date.now() + backoffSec * 1000);
        await this.prisma.tsoftPushQueue.update({
          where: { id: job.id },
          data: {
            status: final ? 'FAILED' : 'PENDING',
            lastError: msg.slice(0, 500),
            scheduledAt: final ? job.scheduledAt : next,
          },
        });
        if (final) {
          this.logger.error(
            `[TSOFT-PUSH] iş kalıcı FAIL: id=${job.id} entity=${job.entity} op=${job.op} err=${msg.slice(0, 240)}`,
          );
        } else {
          this.logger.warn(
            `[TSOFT-PUSH] iş retry ${attempts}/${MAX_ATTEMPTS} +${backoffSec}s: id=${job.id} err=${msg.slice(0, 160)}`,
          );
        }
        result.failed++;
      }
    }
    return result;
  }

  // ─── Dispatch ──────────────────────────────────────────────────────────

  private async executeJob(job: {
    id: string;
    organizationId: string;
    entity: string;
    entityId: string;
    op: string;
    payload: unknown;
  }): Promise<void> {
    const payload = (job.payload as Record<string, unknown>) ?? {};
    switch (job.entity) {
      case 'PRODUCT':
        return this.executeProductJob(job.organizationId, job.entityId, job.op, payload);
      case 'VARIANT':
        return this.executeVariantJob(job.organizationId, job.entityId, job.op, payload);
      case 'ORDER':
        return this.executeOrderJob(job.organizationId, job.entityId, job.op, payload);
      case 'IMAGE':
        return this.executeImageJob(job.organizationId, job.entityId, job.op, payload);
      default:
        throw new Error(`Bilinmeyen entity: ${job.entity}`);
    }
  }

  private async executeProductJob(
    organizationId: string,
    productId: string,
    op: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    // DELETE: ürün zaten tombstone olabilir; payload'dan productCode al
    if (op === 'DELETE') {
      const code =
        (payload['ProductCode'] as string) ||
        (payload['productCode'] as string) ||
        product?.sku;
      if (!code) throw new Error('DELETE için ProductCode gerekli');
      await this.tsoftApi.deleteProductByCode(organizationId, code);
      if (product) {
        // Tombstone'u gerçek silmeye çevir — pull teyit etti varsay.
        await this.prisma.product.delete({ where: { id: productId } }).catch(() => null);
      }
      return;
    }

    if (!product) throw new Error('Ürün bulunamadı (CREATE/UPDATE sırasında)');

    if (op === 'CREATE') {
      const res = (await this.tsoftApi.setProducts(organizationId, payload)) as
        | Record<string, unknown>
        | undefined;
      // T-Soft setProducts yanıtından yeni ProductId'yi çıkar (API sürümüne göre değişir)
      const newTsoftId = this.extractTsoftIdFromSetResponse(res);
      await this.prisma.product.update({
        where: { id: productId },
        data: {
          tsoftId: newTsoftId ?? product.tsoftId,
          tsoftLastPulledAt: new Date(),
          pendingPushOp: null,
        },
      });
      return;
    }

    if (op === 'UPDATE') {
      await this.tsoftApi.updateProducts(organizationId, payload);
      await this.prisma.product.update({
        where: { id: productId },
        data: { pendingPushOp: null, tsoftLastPulledAt: new Date() },
      });
      return;
    }

    throw new Error(`PRODUCT için desteklenmeyen op: ${op}`);
  }

  private async executeVariantJob(
    organizationId: string,
    variantId: string,
    op: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (op === 'DELETE') {
      const code =
        (payload['ProductCode'] as string) ||
        (payload['productCode'] as string) ||
        variant?.sku ||
        variant?.externalId;
      if (!code) throw new Error('Varyant DELETE için ProductCode gerekli');
      await this.tsoftApi.deleteSubProducts(organizationId, code);
      if (variant) {
        await this.prisma.productVariant.delete({ where: { id: variantId } }).catch(() => null);
      }
      return;
    }
    if (!variant) throw new Error('Varyant bulunamadı (CREATE/UPDATE sırasında)');

    if (op === 'CREATE') {
      await this.tsoftApi.setSubProducts(organizationId, payload);
      return;
    }
    if (op === 'UPDATE') {
      await this.tsoftApi.updateSubProducts(organizationId, payload);
      return;
    }
    throw new Error(`VARIANT için desteklenmeyen op: ${op}`);
  }

  private async executeOrderJob(
    organizationId: string,
    orderId: string,
    op: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (op === 'CREATE') {
      const res = (await this.tsoftApi.createOrder(organizationId, payload)) as
        | Record<string, unknown>
        | undefined;
      const tsoftOrderId = this.extractOrderIdFromResponse(res);
      const upd: Prisma.SalesOrderUpdateInput = {
        tsoftPushedAt: new Date(),
        tsoftLastError: null,
      };
      if (tsoftOrderId) {
        // externalId formatı pull ile aynı olmalı (`tsoft_<id>`), aksi halde sync duplicate yaratır.
        upd.externalId = `tsoft_${String(tsoftOrderId)}`;
        upd.tsoftSiteOrderId = String(tsoftOrderId);
        upd.source = 'TSOFT';
      }
      await this.prisma.salesOrder.update({ where: { id: orderId }, data: upd });
      return;
    }
    if (op === 'UPDATE') {
      // Sipariş güncellemeleri çoğunlukla sadece durum olur; updateSiteOrderStatus ayrı endpoint.
      await this.tsoftApi.updateSiteOrderStatus(organizationId, payload);
      await this.prisma.salesOrder.update({
        where: { id: orderId },
        data: { tsoftPushedAt: new Date(), tsoftLastError: null },
      });
      return;
    }
    if (op === 'DELETE') {
      const numericId = Number(payload['OrderId'] ?? payload['tsoftOrderId']);
      if (!Number.isFinite(numericId)) throw new Error('Sipariş DELETE için numerik OrderId gerekli');
      await this.tsoftApi.deleteSiteOrder(organizationId, numericId);
      return;
    }
    throw new Error(`ORDER için desteklenmeyen op: ${op}`);
  }

  private async executeImageJob(
    organizationId: string,
    _imageId: string,
    op: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (op === 'CREATE') {
      await this.tsoftApi.uploadProductImage(organizationId, {
        productCode: String(payload['productCode'] ?? ''),
        imageUrl: payload['imageUrl'] ? String(payload['imageUrl']) : undefined,
        imageBase64: payload['imageBase64']
          ? String(payload['imageBase64'])
          : undefined,
        sortOrder:
          payload['sortOrder'] != null ? Number(payload['sortOrder']) : undefined,
      });
      return;
    }
    if (op === 'DELETE') {
      await this.tsoftApi.deleteProductImage(organizationId, {
        productCode: String(payload['productCode'] ?? ''),
        imageId: payload['imageId'] as string | number | undefined,
        imageUrl: payload['imageUrl'] as string | undefined,
      });
      return;
    }
    throw new Error(`IMAGE için desteklenmeyen op: ${op}`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private extractTsoftIdFromSetResponse(
    res: Record<string, unknown> | undefined,
  ): string | null {
    if (!res) return null;
    const data = res.data;
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      const first = data[0] as Record<string, unknown>;
      const id = first.ProductId ?? first.productId ?? first.Id;
      if (id != null) return String(id);
    }
    const id = (res as Record<string, unknown>).ProductId ?? (res as Record<string, unknown>).productId;
    return id != null ? String(id) : null;
  }

  private extractOrderIdFromResponse(
    res: Record<string, unknown> | undefined,
  ): string | null {
    if (!res) return null;
    const data = res.data;
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      const first = data[0] as Record<string, unknown>;
      const id = first.OrderId ?? first.orderId ?? first.Id;
      if (id != null) return String(id);
    }
    const id = res.OrderId ?? res.orderId;
    return id != null ? String(id) : null;
  }
}
