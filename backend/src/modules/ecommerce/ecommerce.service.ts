import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TsoftApiService } from './tsoft-api.service';
import { WahaService } from '../waha/waha.service';
import {
  normalizeComparablePhone,
  normalizeTsoftPhone,
  formatPhoneForTsoft,
} from './phone.util';
import type { CreateTsoftSiteCustomerPayload } from './tsoft.types';

const TSOFT_LABEL = 'T-Soft Site Müşterisi';

const STATUS_CACHE_MS_DEFAULT = 120_000;
const STATUS_CACHE_MS_AFTER_AUTH_FAIL = 600_000;

export const TSOFT_AUTO_REPLY_EVENTS = [
  'order_created',
  'order_confirmed',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'order_returned',
] as const;

export type TsoftAutoReplyEvent = (typeof TSOFT_AUTO_REPLY_EVENTS)[number];

export const TSOFT_AUTO_REPLY_EVENT_LABELS: Record<TsoftAutoReplyEvent, string> = {
  order_created: 'Yeni Sipariş Alındı',
  order_confirmed: 'Sipariş Onaylandı',
  order_shipped: 'Sipariş Kargoya Verildi',
  order_delivered: 'Sipariş Teslim Edildi',
  order_cancelled: 'Sipariş İptal Edildi',
  order_returned: 'Sipariş İade Edildi',
};

type EcommerceStatusResult = {
  menuVisible: boolean;
  healthy: boolean;
  provider: string | null;
  canPushCustomer: boolean;
};

type EcommerceStatusCached = EcommerceStatusResult & { tsoftAuthFailed?: boolean };

/** T-Soft sipariş ham verisinden CRM alanlarını çıkar */
function extractOrderFields(raw: Record<string, unknown>) {
  const tsoftId = String(raw.id ?? raw.orderId ?? '');
  const orderNumber = String(raw.orderNumber ?? raw.order_number ?? raw.orderNo ?? raw.id ?? '');
  const status = String(raw.orderStatus ?? raw.status ?? raw.order_status ?? 'Yeni');
  const grandTotal =
    Number(raw.orderTotal ?? raw.order_total ?? raw.totalPrice ?? raw.total ?? 0) || 0;
  const shippingTotal = Number(raw.cargoPrice ?? raw.shippingTotal ?? raw.shipping_total ?? 0) || 0;
  const subtotal = grandTotal - shippingTotal;
  const currency = String(raw.currency ?? 'TRY');
  const notes = raw.orderNote != null ? String(raw.orderNote) : raw.note != null ? String(raw.note) : undefined;

  const rawDateStr =
    raw.createDate ?? raw.created_at ?? raw.createdAt ?? raw.orderDate ?? raw.order_date;
  let tsoftCreatedAt: Date | undefined;
  if (rawDateStr) {
    const d = new Date(String(rawDateStr));
    if (!isNaN(d.getTime())) tsoftCreatedAt = d;
  }

  const billing =
    (raw.billingAddress ?? raw.billing_address ?? raw.invoiceAddress ?? raw.invoiceInfo) as
      | Record<string, unknown>
      | undefined;
  const shipping =
    (raw.deliveryAddress ?? raw.shippingAddress ?? raw.shipping_address ?? raw.shipmentAddress) as
      | Record<string, unknown>
      | undefined;

  const phoneRaw =
    billing?.gsm ?? billing?.phone ?? billing?.mobilePhone ??
    shipping?.gsm ?? shipping?.phone ?? shipping?.mobilePhone ??
    raw.customerPhone ?? raw.customer_phone ?? raw.gsm;
  const customerPhone = normalizeTsoftPhone(phoneRaw as string | undefined) || undefined;

  const firstName = String(
    billing?.name ?? billing?.firstName ?? shipping?.name ?? raw.customerName ?? '',
  ).trim();
  const lastName = String(
    billing?.surname ?? billing?.lastName ?? shipping?.surname ?? raw.customerSurname ?? '',
  ).trim();
  const customerName = [firstName, lastName].filter(Boolean).join(' ') || undefined;
  const customerEmail = String(
    billing?.email ?? shipping?.email ?? raw.customerEmail ?? raw.customer_email ?? '',
  ).trim() || undefined;

  // Ürün kalemleri
  const rawItems = (
    raw.orderProducts ?? raw.products ?? raw.items ?? raw.orderItems ?? []
  ) as Record<string, unknown>[];
  const items = Array.isArray(rawItems)
    ? rawItems.map((p) => ({
        tsoftItemId: p.id != null ? String(p.id) : undefined,
        name: String(p.productName ?? p.name ?? p.title ?? 'Ürün'),
        sku: p.productCode != null ? String(p.productCode) : p.sku != null ? String(p.sku) : undefined,
        quantity: Number(p.quantity ?? p.qty ?? 1) || 1,
        unitPrice: Number(p.unitPrice ?? p.price ?? p.salePrice ?? 0) || 0,
        lineTotal: Number(p.lineTotal ?? p.total ?? p.totalPrice ?? 0) || 0,
        imageUrl: p.imageUrl != null ? String(p.imageUrl) : p.image != null ? String(p.image) : undefined,
      }))
    : [];

  return {
    tsoftId,
    orderNumber,
    status,
    grandTotal,
    shippingTotal,
    subtotal,
    currency,
    notes,
    tsoftCreatedAt,
    billing,
    shipping,
    customerPhone,
    customerName,
    customerEmail,
    items,
  };
}

/** Şablon değişkenlerini gerçek değerlerle doldur */
function renderTemplate(
  template: string,
  vars: {
    musteri_adi: string;
    siparis_no: string;
    siparis_tutari: string;
    urunler: string;
    tarih: string;
  },
): string {
  return template
    .replace(/\{\{musteri_adi\}\}/g, vars.musteri_adi)
    .replace(/\{\{siparis_no\}\}/g, vars.siparis_no)
    .replace(/\{\{siparis_tutari\}\}/g, vars.siparis_tutari)
    .replace(/\{\{urunler\}\}/g, vars.urunler)
    .replace(/\{\{tarih\}\}/g, vars.tarih);
}

@Injectable()
export class EcommerceService {
  private readonly logger = new Logger(EcommerceService.name);
  private readonly statusCache = new Map<string, { at: number; value: EcommerceStatusCached }>();

  constructor(
    private prisma: PrismaService,
    private tsoftApi: TsoftApiService,
    private wahaService: WahaService,
  ) {}

  // ─── Status ───────────────────────────────────────────────────────────────

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
        return { menuVisible: false, healthy: false, provider: null as string | null, canPushCustomer: false };
      }
      const cfg = (int.config || {}) as { baseUrl?: string; apiEmail?: string; apiPassword?: string };
      if (!cfg.baseUrl || !cfg.apiEmail || !cfg.apiPassword) {
        return { menuVisible: false, healthy: false, provider: 'tsoft', canPushCustomer: false };
      }
      try {
        await this.tsoftApi.getBearerToken(organizationId);
        return { menuVisible: true, healthy: true, provider: 'tsoft', canPushCustomer: true };
      } catch {
        return { menuVisible: false, healthy: false, provider: 'tsoft', canPushCustomer: false, tsoftAuthFailed: true };
      }
    } catch (err) {
      this.logger.warn(`T-Soft durum kontrolü başarısız: ${(err as Error)?.message ?? err}`);
      return { menuVisible: false, healthy: false, provider: null, canPushCustomer: false };
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

  diagnoseTsoft(organizationId: string) {
    return this.tsoftApi.diagnoseLogin(organizationId);
  }

  async listProducts(organizationId: string, page: number, limit: number) {
    return this.tsoftApi.listProducts(organizationId, page, limit);
  }

  async listOrders(organizationId: string, page: number, limit: number) {
    return this.tsoftApi.listOrders(organizationId, page, limit);
  }

  // ─── Customer Sync ────────────────────────────────────────────────────────

  async syncTsoftCustomers(organizationId: string) {
    const customers = await this.tsoftApi.fetchAllCustomers(organizationId);
    const phoneToCustomer = new Map<string, Record<string, unknown>>();

    for (const c of customers) {
      const mobile = (c.mobilePhone as string) || (c.customerPhone as string) || (c.gsm as string) || '';
      const key = normalizeTsoftPhone(mobile);
      const id = c.id != null ? String(c.id) : '';
      if (key && id) phoneToCustomer.set(key, c);
    }

    const contacts = await this.prisma.contact.findMany({
      where: { organizationId },
      select: { id: true, phone: true, metadata: true, name: true, email: true },
    });

    let matched = 0;
    let created = 0;

    for (const [normalizedPhone, customer] of phoneToCustomer.entries()) {
      const contact = contacts.find(
        (ct) => normalizeComparablePhone(ct.phone) === normalizedPhone,
      );
      const externalId = String(customer.id);
      const firstName = String(customer.name ?? customer.firstName ?? '').trim();
      const lastName = String(customer.surname ?? customer.lastName ?? '').trim();
      const customerEmail = String(customer.email ?? '').trim() || undefined;
      const customerName = [firstName, lastName].filter(Boolean).join(' ') || undefined;

      if (contact) {
        const prev = contact.metadata && typeof contact.metadata === 'object'
          ? (contact.metadata as Record<string, unknown>)
          : {};
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: {
            metadata: {
              ...prev,
              ecommerce: { provider: 'tsoft', externalId, label: TSOFT_LABEL, syncedAt: new Date().toISOString() },
            } as object,
            name: contact.name || customerName || contact.name,
            email: contact.email || customerEmail || contact.email,
          },
        });
        matched++;
      } else {
        // Yeni kişi oluştur
        try {
          await this.prisma.contact.create({
            data: {
              phone: normalizedPhone,
              name: customerName,
              email: customerEmail,
              organizationId,
              source: 'tsoft',
              metadata: {
                ecommerce: { provider: 'tsoft', externalId, label: TSOFT_LABEL, syncedAt: new Date().toISOString() },
              } as object,
            },
          });
          created++;
        } catch {
          // Telefon benzersiz çakışması veya başka nedenle zaten var
        }
      }
    }

    return {
      matched,
      created,
      tsoftCustomerCount: customers.length,
      crmContactCount: contacts.length,
    };
  }

  // ─── Order Sync ───────────────────────────────────────────────────────────

  async syncTsoftOrders(organizationId: string): Promise<{
    synced: number;
    created: number;
    updated: number;
    autoRepliesSent: number;
  }> {
    const rawOrders = await this.tsoftApi.fetchAllOrders(organizationId);
    let created = 0;
    let updated = 0;
    const newOrderIds: string[] = [];

    for (const raw of rawOrders) {
      const f = extractOrderFields(raw);
      if (!f.tsoftId) continue;

      let contactId: string | undefined;
      if (f.customerPhone) {
        contactId = await this.findOrCreateContactByPhone(organizationId, f.customerPhone, f.customerName, f.customerEmail);
      }

      const existing = await this.prisma.tsoftOrder.findUnique({
        where: { organizationId_tsoftId: { organizationId, tsoftId: f.tsoftId } },
        select: { id: true, sentAutoReply: true, status: true },
      });

      const existingOrder = existing;
      if (!existingOrder) {
        const order = await this.prisma.tsoftOrder.create({
          data: {
            organizationId,
            tsoftId: f.tsoftId,
            orderNumber: f.orderNumber,
            status: f.status,
            customerName: f.customerName,
            customerEmail: f.customerEmail,
            customerPhone: f.customerPhone,
            billingAddress: f.billing as object | undefined,
            shippingAddress: f.shipping as object | undefined,
            currency: f.currency,
            subtotal: f.subtotal,
            shippingTotal: f.shippingTotal,
            grandTotal: f.grandTotal,
            notes: f.notes,
            tsoftCreatedAt: f.tsoftCreatedAt,
            contactId: contactId ?? null,
            rawData: raw as object,
            items: {
              create: f.items.map((item) => ({
                tsoftItemId: item.tsoftItemId,
                name: item.name,
                sku: item.sku,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal || item.unitPrice * item.quantity,
                imageUrl: item.imageUrl,
              })),
            },
          },
        });
        newOrderIds.push(order.id);
        created++;
      } else {
        // Durum değişikliği varsa güncelle
        if (existing.status !== f.status) {
          const updateData: any = { status: f.status };
          if (contactId) updateData.contactId = contactId;
          await this.prisma.tsoftOrder.update({
            where: { id: existing.id },
            data: updateData,
          });

          // Durum değişikliği auto-reply tetikle
          const eventMap: Record<string, TsoftAutoReplyEvent> = {
            'Onaylandı': 'order_confirmed',
            'Kargoya Verildi': 'order_shipped',
            'Teslim Edildi': 'order_delivered',
            'İptal': 'order_cancelled',
            'İade': 'order_returned',
          };
          const event = eventMap[f.status];
          if (event && contactId) {
            await this.sendAutoReplyForOrder(organizationId, existing.id, event, {
              customerName: f.customerName,
              orderNumber: f.orderNumber,
              grandTotal: f.grandTotal,
              currency: f.currency,
              items: f.items,
              tsoftCreatedAt: f.tsoftCreatedAt,
            }).catch(() => {});
          }
        }
        updated++;
      }
    }

    // Yeni siparişler için order_created auto-reply gönder
    let autoRepliesSent = 0;
    for (const orderId of newOrderIds) {
      const sent = await this.sendAutoReplyForOrderById(organizationId, orderId, 'order_created').catch(() => false);
      if (sent) autoRepliesSent++;
    }

    this.logger.log(`T-Soft sipariş sync [${organizationId}]: ${created} yeni, ${updated} güncellendi, ${autoRepliesSent} otomatik yanıt`);
    return { synced: rawOrders.length, created, updated, autoRepliesSent };
  }

  private async findOrCreateContactByPhone(
    organizationId: string,
    normalizedPhone: string,
    customerName?: string,
    customerEmail?: string,
  ): Promise<string | undefined> {
    const existing = await this.prisma.contact.findFirst({
      where: {
        phone: normalizedPhone,
        organizationId,
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    try {
      const created = await this.prisma.contact.create({
        data: {
          phone: normalizedPhone,
          name: customerName,
          email: customerEmail,
          organizationId,
          source: 'tsoft',
        },
      });
      return created.id;
    } catch {
      const retry = await this.prisma.contact.findFirst({
        where: { phone: normalizedPhone, organizationId },
        select: { id: true },
      });
      return retry?.id;
    }
  }

  // ─── Auto Reply ───────────────────────────────────────────────────────────

  async getAutoReplies(organizationId: string) {
    const rows = await this.prisma.tsoftAutoReply.findMany({
      where: { organizationId },
    });
    return TSOFT_AUTO_REPLY_EVENTS.map((eventType) => {
      const existing = rows.find((r) => r.eventType === eventType);
      return {
        eventType,
        label: TSOFT_AUTO_REPLY_EVENT_LABELS[eventType],
        template: existing?.template ?? '',
        isActive: existing?.isActive ?? false,
        id: existing?.id ?? null,
      };
    });
  }

  async saveAutoReply(organizationId: string, eventType: string, template: string, isActive: boolean) {
    if (!TSOFT_AUTO_REPLY_EVENTS.includes(eventType as TsoftAutoReplyEvent)) {
      throw new BadRequestException(`Geçersiz olay tipi: ${eventType}`);
    }
    await this.prisma.tsoftAutoReply.upsert({
      where: { organizationId_eventType: { organizationId, eventType } },
      update: { template, isActive },
      create: { organizationId, eventType, template, isActive },
    });
    return { ok: true };
  }

  private async sendAutoReplyForOrderById(
    organizationId: string,
    orderId: string,
    event: TsoftAutoReplyEvent,
  ): Promise<boolean> {
    const order = await this.prisma.tsoftOrder.findUnique({
      where: { id: orderId },
      include: { items: { take: 5 } },
    });
    if (!order) return false;

    return this.sendAutoReplyForOrder(organizationId, orderId, event, {
      customerName: order.customerName ?? undefined,
      orderNumber: order.orderNumber ?? undefined,
      grandTotal: order.grandTotal,
      currency: order.currency,
      items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })),
      tsoftCreatedAt: order.tsoftCreatedAt ?? undefined,
    });
  }

  private async sendAutoReplyForOrder(
    organizationId: string,
    orderId: string,
    event: TsoftAutoReplyEvent,
    orderData: {
      customerName?: string;
      orderNumber?: string;
      grandTotal: number;
      currency: string;
      items: { name: string; quantity: number; unitPrice: number }[];
      tsoftCreatedAt?: Date;
    },
  ): Promise<boolean> {
    const reply = await this.prisma.tsoftAutoReply.findUnique({
      where: { organizationId_eventType: { organizationId, eventType: event } },
    });
    if (!reply?.isActive || !reply.template) return false;

    const order = await this.prisma.tsoftOrder.findUnique({
      where: { id: orderId },
      select: { contactId: true, customerPhone: true, sentAutoReply: true },
    });
    if (!order) return false;
    if (event === 'order_created' && order.sentAutoReply) return false;

    const phone = order.customerPhone;
    if (!phone) return false;

    // WORKING session bul
    const session = await this.prisma.whatsappSession.findFirst({
      where: { organizationId, status: 'WORKING' },
      select: { name: true },
    });
    if (!session) return false;

    const itemsText = orderData.items
      .slice(0, 5)
      .map((i) => `• ${i.name} × ${i.quantity}`)
      .join('\n');

    const text = renderTemplate(reply.template, {
      musteri_adi: orderData.customerName || 'Değerli Müşteri',
      siparis_no: orderData.orderNumber || orderId,
      siparis_tutari: `${orderData.grandTotal.toFixed(2)} ${orderData.currency}`,
      urunler: itemsText || '—',
      tarih: orderData.tsoftCreatedAt
        ? orderData.tsoftCreatedAt.toLocaleDateString('tr-TR')
        : new Date().toLocaleDateString('tr-TR'),
    });

    try {
      await this.wahaService.sendText(session.name, `${phone}@c.us`, text);
      if (event === 'order_created') {
        await this.prisma.tsoftOrder.update({
          where: { id: orderId },
          data: { sentAutoReply: true },
        });
      }
      return true;
    } catch (err) {
      this.logger.warn(`Auto-reply gönderilemedi [${phone}]: ${(err as Error)?.message}`);
      return false;
    }
  }

  // ─── Synced Orders (DB) ───────────────────────────────────────────────────

  async getSyncedOrders(
    organizationId: string,
    page: number,
    limit: number,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { organizationId };
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.tsoftOrder.findMany({
        where,
        orderBy: [{ tsoftCreatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
          items: { take: 3 },
        },
      }),
      this.prisma.tsoftOrder.count({ where }),
    ]);

    return { orders, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getSyncedOrderById(organizationId: string, id: string) {
    const order = await this.prisma.tsoftOrder.findFirst({
      where: { id, organizationId },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true, email: true } },
        items: true,
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    return order;
  }

  // ─── Create Order ─────────────────────────────────────────────────────────

  async createTsoftOrder(
    organizationId: string,
    dto: {
      contactId?: string;
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      shippingAddress?: string;
      notes?: string;
      items: { name: string; sku?: string; quantity: number; unitPrice: number; tsoftProductId?: number }[];
      currency?: string;
    },
  ) {
    let contact: { id: string; name: string | null; email: string | null; phone: string; metadata: any; organizationId: string | null } | null = null;
    if (dto.contactId) {
      contact = await this.prisma.contact.findUnique({
        where: { id: dto.contactId },
        select: { id: true, name: true, email: true, phone: true, metadata: true, organizationId: true },
      });
      if (!contact) throw new NotFoundException('Kişi bulunamadı');
      if (contact.organizationId !== organizationId) {
        throw new BadRequestException('Bu kişi organizasyonunuza ait değil');
      }
    }

    const ec = (contact?.metadata as any)?.ecommerce;
    const customerId = ec?.provider === 'tsoft' ? ec.externalId : undefined;

    const phone = dto.customerPhone || (contact ? formatPhoneForTsoft(contact.phone) : undefined);
    const name = dto.customerName || contact?.name || '';
    const email = dto.customerEmail || contact?.email || undefined;

    const [firstName, ...rest] = name.split(' ');
    const lastName = rest.join(' ');

    const tsoftPayload: Record<string, unknown> = {
      customerId: customerId ? Number(customerId) : undefined,
      billingAddress: {
        name: firstName,
        surname: lastName,
        email,
        gsm: phone,
        address: dto.shippingAddress,
      },
      deliveryAddress: {
        name: firstName,
        surname: lastName,
        email,
        gsm: phone,
        address: dto.shippingAddress,
      },
      orderNote: dto.notes,
      orderProducts: dto.items.map((item) => ({
        productId: item.tsoftProductId,
        productName: item.name,
        productCode: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    };

    const result = await this.tsoftApi.createOrder(organizationId, tsoftPayload);
    const r = result as Record<string, unknown>;
    const d = r?.data as Record<string, unknown> | undefined;
    const newId = String(d?.id ?? r?.id ?? '');

    this.logger.log(`T-Soft sipariş oluşturuldu: ${newId} [org=${organizationId}]`);

    // DB'ye de kaydet
    if (newId) {
      const grandTotal = dto.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      await this.prisma.tsoftOrder.upsert({
        where: { organizationId_tsoftId: { organizationId, tsoftId: newId } },
        update: {},
        create: {
          organizationId,
          tsoftId: newId,
          orderNumber: newId,
          status: 'Yeni',
          customerName: name || undefined,
          customerEmail: email,
          customerPhone: dto.customerPhone ? normalizeTsoftPhone(dto.customerPhone) : undefined,
          currency: dto.currency || 'TRY',
          grandTotal,
          notes: dto.notes,
          contactId: contact?.id ?? null,
          rawData: tsoftPayload as object,
          items: {
            create: dto.items.map((item) => ({
              name: item.name,
              sku: item.sku,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.quantity * item.unitPrice,
            })),
          },
        },
      });
    }

    return { ok: true, tsoftOrderId: newId, result };
  }

  // ─── Customer Creation ────────────────────────────────────────────────────

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

  private extractCreatedCustomerId(res: unknown): string {
    const r = res as Record<string, unknown>;
    const d = r?.data as Record<string, unknown> | undefined;
    const inner = d?.data as Record<string, unknown> | undefined;
    const id = (inner?.id ?? d?.id ?? r?.id) as string | number | undefined;
    if (id == null || id === '') {
      throw new BadRequestException('T-Soft yanıtında müşteri ID bulunamadı');
    }
    return String(id);
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
      throw new BadRequestException('Bu kişi zaten T-Soft site müşterisi olarak işaretli');
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
    const externalId = this.extractCreatedCustomerId(res);

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
}
