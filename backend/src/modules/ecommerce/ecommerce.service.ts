import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TsoftApiService } from './tsoft-api.service';
import {
  normalizeComparablePhone,
  normalizeTsoftPhone,
  formatPhoneForTsoft,
} from './phone.util';
import type { CreateTsoftSiteCustomerPayload } from './tsoft.types';

const TSOFT_LABEL = 'T-Soft Site Müşterisi';
const TSOFT_SOURCE = 'TSOFT';

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

  async listOrders(organizationId: string, page: number, limit: number) {
    return this.tsoftApi.listOrders(organizationId, page, limit);
  }

  /**
   * T-Soft müşterilerini çeker; eşleşen CRM kişilerini günceller, eşleşmeyenleri oluşturur.
   */
  async syncTsoftCustomers(organizationId: string) {
    this.logger.log(`[TSOFT-SYNC-CUSTOMERS] Başlatılıyor orgId=${organizationId}`);
    const customers = await this.tsoftApi.fetchAllCustomers(organizationId);
    this.logger.log(`[TSOFT-SYNC-CUSTOMERS] T-Soft'tan ${customers.length} müşteri çekildi`);

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
    return { matched, created, skipped, tsoftCustomerCount: customers.length, crmContactCount: existingContacts.length };
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

  /**
   * T-Soft siparişlerini çeker ve CRM SalesOrder tablosuna yazar.
   */
  async syncTsoftOrders(organizationId: string, userId: string) {
    this.logger.log(`[TSOFT-SYNC-ORDERS] Başlatılıyor orgId=${organizationId}`);

    let allOrders: Record<string, unknown>[] = [];
    for (let page = 1; page <= 50; page++) {
      const { rows } = await this.tsoftApi.listOrders(organizationId, page, 100);
      this.logger.debug(`[TSOFT-SYNC-ORDERS] Sayfa ${page}: ${rows.length} sipariş`);
      if (!rows.length) break;
      for (const r of rows) {
        if (r && typeof r === 'object') allOrders.push(r as Record<string, unknown>);
      }
      if (rows.length < 100) break;
    }

    this.logger.log(`[TSOFT-SYNC-ORDERS] T-Soft'tan toplam ${allOrders.length} sipariş çekildi`);
    if (allOrders.length > 0) {
      this.logger.debug(`[TSOFT-SYNC-ORDERS] İlk sipariş örneği: ${JSON.stringify(allOrders[0]).slice(0, 1000)}`);
    }

    let imported = 0;
    let skippedExisting = 0;
    let errors = 0;

    for (const raw of allOrders) {
      // REST1: OrderId, OrderCode — v3: id, orderId
      const tsoftId = String(raw.OrderId ?? raw.OrderCode ?? raw.id ?? raw.orderId ?? '').trim();
      const tsoftCode = String(raw.OrderCode ?? raw.orderCode ?? tsoftId).trim();
      if (!tsoftId) {
        this.logger.warn(`[TSOFT-SYNC-ORDERS] Sipariş ID bulunamadı: ${JSON.stringify(raw).slice(0, 300)}`);
        errors++;
        continue;
      }

      const externalId = `tsoft_${tsoftId}`;

      const existing = await this.prisma.salesOrder.findUnique({ where: { externalId } });
      if (existing) {
        skippedExisting++;
        continue;
      }

      try {
        // REST1: InvoiceMobile, DeliveryMobile, CustomerName — v3: customerPhone, mobilePhone
        const customerPhone = String(
          raw.InvoiceMobile || raw.DeliveryMobile || raw.InvoiceTel || raw.DeliveryTel ||
          raw.customerPhone || raw.customer_phone || raw.mobilePhone || raw.phone || '',
        ).trim();
        const customerEmail = String(
          raw.CustomerUsername || raw.customerEmail || raw.customer_email || raw.email || '',
        ).trim();
        // REST1: CustomerName = "Ad Soyad"
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
        }

        if (!contact) {
          this.logger.warn(`[TSOFT-SYNC-ORDERS] Sipariş ${tsoftCode}: Kişi oluşturulamadı/bulunamadı`);
          errors++;
          continue;
        }

        // REST1: OrderTotalPrice — v3: grandTotal, total
        const grandTotal = Number(
          raw.OrderTotalPrice ?? raw.grandTotal ?? raw.total ?? raw.orderTotal ?? raw.totalPrice ?? 0,
        );
        const currency = String(raw.Currency || raw.currency || raw.currencyCode || 'TRY').trim().toUpperCase() || 'TRY';

        // REST1: DeliveryAddress — v3: shippingAddress
        const shippingAddress = [
          raw.DeliveryAddress || raw.DeliveryName,
          raw.DeliveryCity,
          raw.DeliveryTown,
        ].filter(Boolean).join(', ') || String(raw.shippingAddress || raw.address || '').trim() || null;

        const orderNotes = String(raw.OrderNote || raw.notes || raw.orderNote || raw.customerNote || '').trim() || null;

        // REST1: OrderStatus (string), OrderStatusId — v3: status
        const tsoftStatus = String(raw.OrderStatus || raw.status || raw.orderStatus || '').trim().toLowerCase();
        const statusId = Number(raw.OrderStatusId || 0);

        let crmStatus: 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' = 'PENDING';
        if (tsoftStatus.includes('iptal') || tsoftStatus.includes('cancel') || statusId === 6) crmStatus = 'CANCELLED';
        else if (tsoftStatus.includes('teslim') || tsoftStatus.includes('deliver') || tsoftStatus.includes('complet') || statusId === 5) crmStatus = 'DELIVERED';
        else if (tsoftStatus.includes('kargo') || tsoftStatus.includes('ship') || statusId === 4) crmStatus = 'SHIPPED';
        else if (tsoftStatus.includes('hazırla') || tsoftStatus.includes('process') || tsoftStatus.includes('onay') || statusId === 2 || statusId === 3) crmStatus = 'PROCESSING';

        const orderItems = this.extractOrderItems(raw);

        const subtotal = orderItems.reduce((s, i) => s + i.lineTotal, 0);
        const vatTotal = Math.max(0, grandTotal - subtotal);

        // REST1: OrderDate veya OrderDateTimeStamp
        const tsDate = raw.OrderDateTimeStamp || raw.OrderDate;
        let parsedDate: Date;
        if (typeof tsDate === 'number' || (typeof tsDate === 'string' && /^\d{10,}$/.test(tsDate))) {
          const ts = Number(tsDate);
          parsedDate = new Date(ts < 1e12 ? ts * 1000 : ts);
        } else {
          parsedDate = tsDate ? new Date(String(tsDate)) : new Date();
        }
        const validDate = Number.isFinite(parsedDate.getTime()) ? parsedDate : new Date();

        await this.prisma.salesOrder.create({
          data: {
            externalId,
            source: TSOFT_SOURCE,
            contactId: contact.id,
            createdById: userId,
            status: crmStatus,
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
                lineTotal: item.lineTotal,
                isFromStock: true,
              })),
            },
          },
        });

        imported++;
        this.logger.debug(`[TSOFT-SYNC-ORDERS] Sipariş aktarıldı: T-Soft #${tsoftCode} → CRM (${crmStatus}), ${orderItems.length} kalem, ${grandTotal} ${currency}`);
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
    return { imported, skippedExisting, errors, totalFetched: allOrders.length };
  }

  private extractOrderItems(raw: Record<string, unknown>): Array<{
    name: string; quantity: number; unitPrice: number; vatRate: number; lineTotal: number;
  }> {
    const items: Array<{ name: string; quantity: number; unitPrice: number; vatRate: number; lineTotal: number }> = [];

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
      items.push({
        name,
        quantity,
        unitPrice: Math.round(unitPrice * 100) / 100,
        vatRate: Number.isFinite(vatRate) ? vatRate : 20,
        lineTotal: Math.round(lineTotal * 100) / 100,
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
