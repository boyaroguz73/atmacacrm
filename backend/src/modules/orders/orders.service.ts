import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { OrderStatus, DiscountType } from '@prisma/client';
import { splitSearchTokens } from '../../common/search-tokens';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TsoftApiService } from '../ecommerce/tsoft-api.service';
import { TsoftPushService } from '../ecommerce/tsoft-push.service';
import { extractTsoftNumericOrderIdFromApiResult } from '../ecommerce/tsoft-order.util';
import { Prisma } from '@prisma/client';
import { WahaService } from '../waha/waha.service';
import { normalizeWhatsappChatId } from '../../common/whatsapp-chat-id';
import { queryDateFromGte, queryDateToLte } from '../../common/query-date-range';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  private formatPaymentNote(payment?: {
    mode?: 'FULL' | 'DEPOSIT_50' | 'CUSTOM';
    customValue?: number | null;
  }, currency: string = 'TRY'): string | null {
    if (!payment?.mode || payment.mode === 'FULL') return 'Ödeme planı: Tam ödeme.';
    if (payment.mode === 'DEPOSIT_50') {
      return 'Ödeme planı: %50 ön ödeme (kalan tutar teslim öncesi tahsil edilecek).';
    }
    if (payment.mode === 'CUSTOM' && payment.customValue != null && payment.customValue > 0) {
      return `Ödeme planı: Özel ön ödeme (${payment.customValue} ${currency}).`;
    }
    return null;
  }

  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
    private auditLog: AuditLogService,
    private tsoftApi: TsoftApiService,
    private tsoftPush: TsoftPushService,
    private waha: WahaService,
  ) {}

  private readonly includeRelations = {
    contact: {
      select: {
        id: true,
        name: true,
        surname: true,
        phone: true,
        email: true,
        company: true,
        address: true,
        billingAddress: true,
        shippingAddress: true,
        taxOffice: true,
        taxNumber: true,
        identityNumber: true,
      },
    },
    createdBy: { select: { id: true, name: true } },
    items: {
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            imageUrl: true,
            category: true,
            googleProductType: true,
          },
        },
        productVariant: {
          select: {
            id: true,
            sku: true,
            name: true,
            tsoftId: true,
            externalId: true,
          },
        },
        supplier: { select: { id: true, name: true, phone: true } },
      },
    },
    quote: {
      select: {
        id: true,
        quoteNumber: true,
        discountTotal: true,
        discountType: true,
        discountValue: true,
        currency: true,
      },
    },
    invoice: { select: { id: true } },
    cargoCompany: { select: { id: true, name: true, isAmbar: true } },
  };

  async findAll(params: { 
    status?: OrderStatus; 
    contactId?: string; 
    from?: string;
    to?: string;
    search?: string;
    source?: string;
    page?: number; 
    limit?: number;
  }) {
    const { status, contactId, from, to, search, source, page = 1, limit = 50 } = params;
    const where: any = {};
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;
    const src = typeof source === 'string' ? source.trim().toUpperCase() : '';
    if (src === 'TSOFT') where.source = 'TSOFT';
    
    // Tarih filtresi (YYYY-MM-DD → UTC günü başı / gün sonu; tek anlık lte hatası önlenir)
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = queryDateFromGte(from);
      if (to) where.createdAt.lte = queryDateToLte(to);
    }

    const tokens = splitSearchTokens(search);
    if (tokens.length) {
      where.AND = tokens.map((token) => {
        const numericToken = token.replace(/\D/g, '');
        const parsedNumber = Number.parseInt(token, 10);
        return {
          OR: [
            ...(Number.isFinite(parsedNumber) ? [{ orderNumber: parsedNumber }] : []),
            { contact: { name: { equals: token, mode: 'insensitive' } } },
            { contact: { surname: { equals: token, mode: 'insensitive' } } },
            ...(numericToken ? [{ contact: { phone: { startsWith: numericToken } } }] : []),
            { contact: { company: { equals: token, mode: 'insensitive' } } },
          ],
        };
      });
    }

    const [orders, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: this.includeRelations,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { orders, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: this.includeRelations,
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    const summary = await this.getPaymentSummary(id, order.grandTotal);
    return {
      ...order,
      payments: summary.payments,
      paidTotal: summary.paidTotal,
      refundedTotal: summary.refundedTotal,
      remainingTotal: summary.remainingTotal,
      isFullyPaid: summary.isFullyPaid,
    };
  }

  /**
   * Sipariş tahsilat özeti: CashBookEntry üzerinden INCOME toplamı ödenen,
   * EXPENSE toplamı iade sayılır; grandTotal - (ödenen - iade) = kalan bakiye.
   */
  async getPaymentSummary(
    orderId: string,
    grandTotalHint?: number,
  ): Promise<{
    payments: Array<{
      id: string;
      amount: number;
      direction: 'INCOME' | 'EXPENSE';
      method: 'CASH' | 'TRANSFER' | 'CARD' | 'CHECK' | 'OTHER';
      description: string;
      reference: string | null;
      occurredAt: Date;
      user: { id: string; name: string | null } | null;
    }>;
    paidTotal: number;
    refundedTotal: number;
    remainingTotal: number;
    isFullyPaid: boolean;
  }> {
    const grandTotal =
      grandTotalHint ??
      (
        await this.prisma.salesOrder.findUnique({
          where: { id: orderId },
          select: { grandTotal: true },
        })
      )?.grandTotal ??
      0;

    const entries = await this.prisma.cashBookEntry.findMany({
      where: { orderId },
      orderBy: { occurredAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });

    let paid = 0;
    let refunded = 0;
    for (const e of entries) {
      if (e.direction === 'INCOME') paid += e.amount;
      else refunded += e.amount;
    }

    const paidTotal = Math.round(paid * 100) / 100;
    const refundedTotal = Math.round(refunded * 100) / 100;
    const net = paidTotal - refundedTotal;
    const remainingTotal = Math.round((grandTotal - net) * 100) / 100;
    const isFullyPaid = remainingTotal <= 0.009 && grandTotal > 0;

    return {
      payments: entries.map((e) => ({
        id: e.id,
        amount: e.amount,
        direction: e.direction,
        method: e.method,
        description: e.description,
        reference: e.reference,
        occurredAt: e.occurredAt,
        user: e.user,
      })),
      paidTotal,
      refundedTotal,
      remainingTotal,
      isFullyPaid,
    };
  }

  /**
   * Sipariş için yeni tahsilat kaydeder (CashBookEntry).
   * direction: INCOME (ön ödeme/tahsilat) veya EXPENSE (iade).
   */
  async addPayment(
    userId: string,
    orderId: string,
    body: {
      amount: number;
      direction?: 'INCOME' | 'EXPENSE';
      method?: 'CASH' | 'TRANSFER' | 'CARD' | 'CHECK' | 'OTHER';
      description?: string;
      reference?: string | null;
      occurredAt?: string | null;
    },
  ) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, grandTotal: true },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Tutar 0’dan büyük olmalıdır');
    }
    const direction = body.direction === 'EXPENSE' ? 'EXPENSE' : 'INCOME';
    const method = body.method ?? 'OTHER';
    const description =
      body.description?.trim() ||
      (direction === 'INCOME'
        ? `Sipariş tahsilatı (SIP-${String(order.orderNumber).padStart(5, '0')})`
        : `Sipariş iadesi (SIP-${String(order.orderNumber).padStart(5, '0')})`);

    // INCOME ise kalan bakiyeyi aşma kontrolü (iadeler sınırsız)
    if (direction === 'INCOME') {
      const summary = await this.getPaymentSummary(orderId, order.grandTotal);
      // 1 kr tolerans
      if (amount - summary.remainingTotal > 0.01) {
        throw new BadRequestException(
          `Tahsilat tutarı (${amount.toFixed(2)}) kalan bakiyeyi (${summary.remainingTotal.toFixed(
            2,
          )}) aşamaz`,
        );
      }
    }

    return this.prisma.cashBookEntry.create({
      data: {
        userId,
        orderId,
        amount,
        direction,
        method,
        description,
        reference: body.reference?.trim() || null,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  /**
   * Sipariş tahsilatını iptal eder (entry silinir).
   */
  async removePayment(orderId: string, entryId: string) {
    const entry = await this.prisma.cashBookEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.orderId !== orderId) {
      throw new NotFoundException('Tahsilat kaydı bulunamadı');
    }
    await this.prisma.cashBookEntry.delete({ where: { id: entryId } });
    return { ok: true };
  }

  async create(userId: string, data: {
    contactId: string;
    currency?: string;
    shippingAddress?: string;
    notes?: string;
    expectedDeliveryDate?: string;
    /** Eski yol: senkron T-Soft push (deprecate). */
    sendToTsoft?: boolean;
    /** Yeni yol: push kuyruğuna ekler (retry + tsoftPushedAt/tsoftLastError alanlarıyla). */
    pushToTsoft?: boolean;
    organizationId?: string;
    payment?: {
      mode?: 'FULL' | 'DEPOSIT_50' | 'CUSTOM';
      customValue?: number | null;
    };
    items: {
      productId?: string;
      productVariantId?: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
      /** true: unitPrice KDV dahil (varsayılan) | false: KDV hariç */
      priceIncludesVat?: boolean;
      supplierId?: string | null;
      supplierOrderNo?: string | null;
      isFromStock?: boolean;
      colorFabricInfo?: string | null;
      measurementInfo?: string | null;
    }[];
  }) {
    if (!data.items?.length) throw new BadRequestException('En az bir kalem gerekli');
    if (
      data.payment?.mode === 'CUSTOM' &&
      data.payment.customValue != null &&
      !(data.payment.customValue > 0)
    ) {
      throw new BadRequestException('Özel ödeme tutarı 0’dan büyük olmalıdır');
    }

    let subtotal = 0; // KDV hariç toplam
    let vatTotal = 0;
    let grossTotal = 0;
    const items = data.items.map((item) => {
      const isFromStock = !!item.isFromStock;
      const supplierId = isFromStock ? null : item.supplierId || null;
      const supplierOrderNo = isFromStock ? null : item.supplierOrderNo?.trim() || null;
      if (!isFromStock && !supplierId) {
        throw new BadRequestException(`${item.name} için tedarikçi seçimi zorunludur`);
      }
      const priceIncludesVat = item.priceIncludesVat !== false;
      const r = Math.max(0, Number(item.vatRate) || 0) / 100;
      // priceIncludesVat=true  -> unitPrice KDV dahil, KDV hariç = unitPrice/(1+r)
      // priceIncludesVat=false -> unitPrice KDV hariç, KDV dahil = unitPrice*(1+r)
      const lineGross = priceIncludesVat
        ? item.quantity * item.unitPrice
        : item.quantity * item.unitPrice * (1 + r);
      const divider = 1 + r;
      const base = divider > 0 ? lineGross / divider : lineGross;
      const vat = lineGross - base;
      subtotal += base;
      vatTotal += vat;
      grossTotal += lineGross;
      return {
        ...item,
        priceIncludesVat,
        supplierId,
        supplierOrderNo,
        isFromStock,
        lineTotal: Math.round(lineGross * 100) / 100,
      };
    });

    const paymentNote = this.formatPaymentNote(data.payment, data.currency || 'TRY');
    if (
      data.payment?.mode === 'CUSTOM' &&
      data.payment.customValue != null &&
      data.payment.customValue > Math.round(grossTotal * 100) / 100
    ) {
      throw new BadRequestException('Özel ödeme tutarı sipariş toplamını aşamaz');
    }
    const normalizedNotes = [
      paymentNote,
      data.notes?.trim() || null,
    ].filter(Boolean).join('\n\n') || undefined;

    const order = await this.prisma.salesOrder.create({
      data: {
        contactId: data.contactId,
        createdById: userId,
        currency: data.currency || 'TRY',
        subtotal: Math.round(subtotal * 100) / 100,
        vatTotal: Math.round(vatTotal * 100) / 100,
        grandTotal: Math.round(grossTotal * 100) / 100,
        shippingAddress: data.shippingAddress,
        notes: normalizedNotes,
        expectedDeliveryDate:
          data.expectedDeliveryDate && String(data.expectedDeliveryDate).trim() !== ''
            ? new Date(data.expectedDeliveryDate)
            : undefined,
        items: {
          create: items.map((i) => ({
            productId: i.productId || null,
            productVariantId: i.productVariantId || null,
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            vatRate: i.vatRate,
            priceIncludesVat: i.priceIncludesVat,
            lineTotal: i.lineTotal,
            supplierId: i.supplierId || null,
            supplierOrderNo: i.supplierOrderNo || null,
            isFromStock: !!i.isFromStock,
            colorFabricInfo:
              i.colorFabricInfo != null && String(i.colorFabricInfo).trim() !== ''
                ? String(i.colorFabricInfo).trim()
                : null,
            measurementInfo:
              i.measurementInfo != null && String(i.measurementInfo).trim() !== ''
                ? String(i.measurementInfo).trim()
                : null,
          })),
        },
      },
      include: this.includeRelations,
    });
    this.auditLog.log({
      userId,
      action: 'CREATE',
      entity: 'SalesOrder',
      entityId: order.id,
      details: { grandTotal: order.grandTotal, itemCount: items.length },
    });

    if (data.pushToTsoft && data.organizationId) {
      // Yeni yol: kuyruğa al. Worker başarılı olursa `tsoftSiteOrderId` dolar.
      await this.prisma.salesOrder.update({
        where: { id: order.id },
        data: { pushToTsoft: true },
      });
      try {
        const payload = this.buildTsoftOrderPayload(order);
        await this.tsoftPush.enqueueOrderOperation({
          organizationId: data.organizationId,
          orderId: order.id,
          op: 'CREATE',
          payload: payload as Prisma.InputJsonValue,
        });
        this.logger.log(`Sipariş T-Soft kuyruğuna alındı: #${order.orderNumber}`);
      } catch (e: any) {
        this.logger.warn(`Sipariş T-Soft kuyruğuna alınamadı: ${e?.message}`);
        await this.prisma.salesOrder.update({
          where: { id: order.id },
          data: { tsoftLastError: String(e?.message ?? 'bilinmeyen hata').slice(0, 500) },
        });
      }
    } else if (data.sendToTsoft && data.organizationId) {
      // Geriye dönük uyumluluk: senkron push (deprecate; kuyruğu kullanın).
      try {
        await this.pushOrderToTsoft(order, data.organizationId);
        this.logger.log(`Sipariş T-Soft'a (senkron) gönderildi: #${order.orderNumber}`);
      } catch (e: any) {
        this.logger.warn(`Sipariş T-Soft'a gönderilemedi: ${e?.message}`);
      }
    }

    return this.findById(order.id);
  }

  /**
   * Mevcut `pushOrderToTsoft`'un REST1 payload kurgusunu kuyruk için ayrı metod olarak sunar.
   * (Detay: `pushOrderToTsoft` hem build hem dispatch yapıyor; burada sadece payload istiyoruz.)
   */
  private buildTsoftOrderPayload(order: any): Record<string, unknown> {
    const contact = order.contact;
    const phone = contact?.phone ? String(contact.phone).replace(/\D/g, '') : '';
    const items = (order.items ?? []).map((i: any) => ({
      ProductCode: i.product?.sku ?? '',
      Quantity: i.quantity,
      SellingPrice: i.unitPrice,
      Vat: i.vatRate,
      // Renk/kumaş ve ölçü bilgileri sipariş satır notuna eklenir.
      Note: [
        i.colorFabricInfo ? `Renk/Kumaş: ${i.colorFabricInfo}` : '',
        i.measurementInfo ? `Ölçü: ${i.measurementInfo}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    }));
    return {
      CustomerName: [contact?.name, contact?.surname].filter(Boolean).join(' ').trim() || 'Müşteri',
      CustomerPhone: phone,
      CustomerEmail: contact?.email ?? '',
      ShippingAddress: order.shippingAddress ?? contact?.address ?? '',
      BillingAddress: contact?.billingAddress ?? order.shippingAddress ?? '',
      TaxOffice: contact?.taxOffice ?? '',
      TaxNumber: contact?.taxNumber ?? contact?.identityNumber ?? '',
      Currency: order.currency,
      OrderSource: 'CRM',
      Note: order.notes ?? '',
      Products: items,
      SubTotal: order.subtotal,
      VatTotal: order.vatTotal,
      GrandTotal: order.grandTotal,
    };
  }

  /**
   * CRM’deki siparişi T-Soft sitesinde oluşturur; dönen numerik OrderId `tsoftSiteOrderId` alanına yazılır.
   */
  async pushSalesOrderToTsoftSite(orderId: string, organizationId: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: orderId, contact: { organizationId } },
      include: this.includeRelations,
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    if (order.tsoftSiteOrderId) {
      throw new BadRequestException('Bu sipariş zaten siteye gönderilmiş');
    }
    return this.pushOrderToTsoft(order, organizationId);
  }

  private async pushOrderToTsoft(order: any, organizationId: string) {
    const contact = order.contact;
    const orderItems = order.items || [];

    const tsoftProducts: Record<string, unknown>[] = [];
    for (const item of orderItems) {
      const product = item.product;
      const cf = item.colorFabricInfo != null ? String(item.colorFabricInfo).trim() : '';
      const ms = item.measurementInfo != null ? String(item.measurementInfo).trim() : '';
      const noteParts: string[] = [];
      if (cf) noteParts.push(`Renk/Kumaş: ${cf}`);
      if (ms) noteParts.push(`Ölçü: ${ms}`);
      const entry: Record<string, unknown> = {
        ProductCode: product?.sku || item.name,
        Quantity: item.quantity,
        OrderNote: noteParts.join(' | '),
      };
      tsoftProducts.push(entry);
    }

    const orderCode = `CRM-${String(order.orderNumber).padStart(5, '0')}`;
    const customerName = [contact?.name, contact?.surname].filter(Boolean).join(' ') || 'CRM Müşteri';
    const nameParts = customerName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const currencyMap: Record<string, string> = { TRY: 'TL', USD: 'USD', EUR: 'EUR', GBP: 'GBP' };
    const tsoftCurrency = currencyMap[order.currency] || order.currency;

    const tsoftOrder: Record<string, unknown> = {
      OrderCode: orderCode,
      Currency: tsoftCurrency,
      OrderStatusId: '1',
      OrderTotalPrice: String(order.grandTotal),
      GeneralOrderNote: order.notes || `CRM Sipariş #${order.orderNumber}`,
      OrderDate: new Date().toISOString().replace('T', ' ').slice(0, 19),

      InvoiceName: customerName,
      InvoiceTitle: contact?.company || customerName,
      InvoiceMobile: contact?.phone || '',
      InvoiceCity: '',
      InvoiceTown: '',
      InvoiceAddress: contact?.billingAddress || contact?.address || '-',
      InvoiceCountry: 'Türkiye',
      InvoiceTaxOffice: contact?.taxOffice || '',
      InvoiceTaxNumber: contact?.taxNumber || '',
      InvoiceIdentityNumber: contact?.identityNumber || '',

      DeliveryName: customerName,
      DeliveryTitle: contact?.company || customerName,
      DeliveryMobile: contact?.phone || '',
      DeliveryCity: '',
      DeliveryTown: '',
      DeliveryAddress: order.shippingAddress || contact?.address || '-',
      DeliveryCountry: 'Türkiye',

      ...Object.fromEntries(
        tsoftProducts.flatMap((p, i) => [
          [`ProductCode[${i}]`, p.ProductCode],
          [`Quantity[${i}]`, p.Quantity],
          [`OrderNote[${i}]`, p.OrderNote || ''],
        ]),
      ),
    };

    const result = await this.tsoftApi.createOrder(organizationId, tsoftOrder);
    this.logger.debug(`T-Soft sipariş yanıtı: ${JSON.stringify(result)?.slice(0, 500)}`);
    const siteId = extractTsoftNumericOrderIdFromApiResult(result);
    if (siteId) {
      await this.prisma.salesOrder.update({
        where: { id: order.id },
        data: { tsoftSiteOrderId: siteId },
      });
    } else {
      this.logger.warn(
        `T-Soft sipariş yanıtında OrderId bulunamadı (CRM kaydı güncellenmedi): ${JSON.stringify(result)?.slice(0, 400)}`,
      );
    }
    return { result, tsoftSiteOrderId: siteId };
  }

  async updateStatus(id: string, status: OrderStatus) {
    const prev = await this.findById(id);
    const order = await this.prisma.salesOrder.update({
      where: { id },
      data: { status, panelEditedAt: new Date() },
      include: this.includeRelations,
    });
    this.auditLog.log({
      action: 'UPDATE',
      entity: 'SalesOrder',
      entityId: id,
      details: { from: prev.status, to: status },
    });
    return order;
  }

  async updateMeta(
    id: string,
    data: {
      expectedDeliveryDate?: string | null;
      notes?: string | null;
      shippingAddress?: string | null;
    },
  ) {
    await this.findById(id);
    const patch: {
      expectedDeliveryDate?: Date | null;
      notes?: string | null;
      shippingAddress?: string | null;
    } = {};
    if ('expectedDeliveryDate' in data) {
      const v = data.expectedDeliveryDate;
      patch.expectedDeliveryDate =
        v == null || String(v).trim() === '' ? null : new Date(String(v));
    }
    if ('notes' in data) patch.notes = data.notes == null ? null : String(data.notes);
    if ('shippingAddress' in data) {
      patch.shippingAddress =
        data.shippingAddress == null ? null : String(data.shippingAddress);
    }
    return this.prisma.salesOrder.update({
      where: { id },
      data: { ...patch, panelEditedAt: new Date() },
      include: this.includeRelations,
    });
  }

  /** Bekleyen ve faturası olmayan sipariş silinebilir */
  async remove(id: string) {
    const o = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { invoice: { select: { id: true } } },
    });
    if (!o) throw new NotFoundException('Sipariş bulunamadı');
    if (o.status !== 'AWAITING_PAYMENT' && o.status !== 'AWAITING_CHECKOUT') {
      throw new BadRequestException('Sadece beklemedeki siparişler silinebilir');
    }
    if (o.invoice) {
      throw new BadRequestException('Faturası oluşturulmuş sipariş silinemez');
    }
    await this.prisma.salesOrder.delete({ where: { id } });
    return { deleted: true };
  }

  /** Sipariş onay PDF’ini (logo, banka, şartlar) yeniden üretir */
  async regenerateConfirmationPdf(orderId: string) {
    const orderFull = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { select: { imageUrl: true } } } },
        contact: true,
        createdBy: { select: { id: true, name: true } },
        quote: true,
      },
    });
    if (!orderFull) throw new NotFoundException('Sipariş bulunamadı');

    const quote = orderFull.quote;
    const discLabel =
      quote && quote.discountTotal > 0
        ? quote.discountType === DiscountType.PERCENT
          ? `İskonto (%${quote.discountValue})`
          : `İskonto (${quote.discountValue} ${quote.currency})`
        : undefined;

    try {
      const co = orderFull.contact;
      const pdfUrl = await this.pdfService.generateOrderConfirmationPdf({
        documentNumber: `SIP-${String(orderFull.orderNumber).padStart(5, '0')}`,
        date: new Date().toLocaleDateString('tr-TR'),
        contactName:
          [co.name, co.surname].filter(Boolean).join(' ') ||
          co.phone,
        contactCompany: co.company || undefined,
        contactPhone: co.phone,
        contactEmail: co.email || undefined,
        billingAddress:
          co.billingAddress?.trim() || co.address?.trim() || undefined,
        shippingAddress: orderFull.shippingAddress || undefined,
        contactTaxOffice: co.taxOffice?.trim() || undefined,
        contactTaxNumber: co.taxNumber?.trim() || undefined,
        contactIdentityNumber: co.identityNumber?.trim() || undefined,
        expectedDelivery: orderFull.expectedDeliveryDate
          ? new Date(orderFull.expectedDeliveryDate).toLocaleDateString('tr-TR')
          : undefined,
        quoteRef:
          quote?.quoteNumber != null ? `TKL-${String(quote.quoteNumber).padStart(5, '0')}` : undefined,
        items: orderFull.items.map((i) => {
          const cf = i.colorFabricInfo != null ? String(i.colorFabricInfo).trim() : '';
          const ms = i.measurementInfo != null ? String(i.measurementInfo).trim() : '';
          const lineParts: string[] = [];
          if (cf) lineParts.push(`Renk/Kumaş: ${cf}`);
          if (ms) lineParts.push(`Ölçü: ${ms}`);
          const lineDetail = lineParts.length ? lineParts.join('\n') : undefined;
          return {
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            vatRate: i.vatRate,
            lineTotal: i.lineTotal,
            lineDetail,
            imageUrl: i.product?.imageUrl || undefined,
          };
        }),
        currency: orderFull.currency,
        subtotal: orderFull.subtotal,
        discountTotal: quote?.discountTotal ?? 0,
        discountLabel: discLabel,
        vatTotal: orderFull.vatTotal,
        grandTotal: orderFull.grandTotal,
        orderNotes: orderFull.notes || undefined,
        createdByName: orderFull.createdBy?.name || undefined,
      });
      return this.prisma.salesOrder.update({
        where: { id: orderId },
        data: { confirmationPdfUrl: pdfUrl },
        include: this.includeRelations,
      });
    } catch (e: any) {
      this.logger.error(`Sipariş PDF: ${e?.message}`);
      throw new BadRequestException(e?.message || 'PDF oluşturulamadı');
    }
  }

  /** Sipariş kalemini güncelle; miktar/fiyat/KDV değişince satır ve sipariş toplamları yeniden hesaplanır */
  async updateOrderItem(
    itemId: string,
    data: {
      name?: string;
      quantity?: number;
      unitPrice?: number;
      vatRate?: number;
      /** true: unitPrice KDV dahil | false: KDV hariç */
      priceIncludesVat?: boolean;
      colorFabricInfo?: string | null;
      measurementInfo?: string | null;
      supplierId?: string | null;
      supplierOrderNo?: string | null;
      isFromStock?: boolean;
    },
  ) {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: itemId },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            invoice: { select: { id: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Sipariş kalemi bulunamadı');
    if (item.order.invoice) {
      throw new BadRequestException('Faturalı siparişin kalemleri değiştirilemez');
    }
    if (item.order.status === 'COMPLETED' || item.order.status === 'CANCELLED') {
      throw new BadRequestException('Teslim edilmiş veya iptal sipariş düzenlenemez');
    }

    const patch: Record<string, unknown> = {};
    if ('name' in data && data.name !== undefined) {
      const n = String(data.name).trim();
      if (!n) throw new BadRequestException('Ürün adı boş olamaz');
      patch.name = n;
    }
    if ('quantity' in data && data.quantity !== undefined) {
      const q = Number(data.quantity);
      if (!(q > 0) || !Number.isFinite(q)) {
        throw new BadRequestException('Miktar 0’dan büyük olmalıdır');
      }
      patch.quantity = q;
    }
    if ('unitPrice' in data && data.unitPrice !== undefined) {
      const p = Number(data.unitPrice);
      if (!Number.isFinite(p) || p < 0) {
        throw new BadRequestException('Birim fiyat geçersiz');
      }
      patch.unitPrice = p;
    }
    if ('vatRate' in data && data.vatRate !== undefined) {
      const vr = Math.round(Number(data.vatRate));
      if (!Number.isFinite(vr) || vr < 0) {
        throw new BadRequestException('KDV oranı geçersiz');
      }
      patch.vatRate = vr;
    }
    if ('priceIncludesVat' in data && data.priceIncludesVat !== undefined) {
      patch.priceIncludesVat = !!data.priceIncludesVat;
    }
    if ('colorFabricInfo' in data) {
      patch.colorFabricInfo =
        data.colorFabricInfo == null || String(data.colorFabricInfo).trim() === ''
          ? null
          : String(data.colorFabricInfo).trim();
    }
    if ('measurementInfo' in data) {
      patch.measurementInfo =
        data.measurementInfo == null || String(data.measurementInfo).trim() === ''
          ? null
          : String(data.measurementInfo).trim();
    }
    if ('supplierId' in data) {
      patch.supplierId = data.supplierId || null;
    }
    if ('supplierOrderNo' in data) {
      patch.supplierOrderNo = data.supplierOrderNo?.trim() || null;
    }
    if ('isFromStock' in data) {
      patch.isFromStock = !!data.isFromStock;
    }

    const nextQty = patch.quantity !== undefined ? Number(patch.quantity) : item.quantity;
    const nextPrice = patch.unitPrice !== undefined ? Number(patch.unitPrice) : item.unitPrice;
    const nextVatRate =
      patch.vatRate !== undefined ? Number(patch.vatRate) : item.vatRate;
    const nextIncl =
      patch.priceIncludesVat !== undefined
        ? !!patch.priceIncludesVat
        : item.priceIncludesVat;
    const r = Math.max(0, nextVatRate) / 100;
    const lineGross = nextIncl
      ? nextQty * nextPrice
      : nextQty * nextPrice * (1 + r);
    patch.lineTotal = Math.round(lineGross * 100) / 100;

    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: patch as any,
    });

    await this.recalculateOrderTotals(item.orderId);

    return this.prisma.orderItem.findUnique({
      where: { id: itemId },
      include: {
        supplier: true,
        product: { select: { id: true, sku: true, name: true, imageUrl: true } },
      },
    });
  }

  private async recalculateOrderTotals(orderId: string) {
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    let subtotal = 0;
    let vatTotal = 0;
    let grandTotal = 0;
    for (const row of items) {
      const r = Math.max(0, row.vatRate) / 100;
      // priceIncludesVat=true -> unitPrice KDV dahil; false -> KDV hariç.
      const lineGross = row.priceIncludesVat
        ? row.quantity * row.unitPrice
        : row.quantity * row.unitPrice * (1 + r);
      const divider = 1 + r;
      const base = divider > 0 ? lineGross / divider : lineGross;
      const vat = lineGross - base;
      subtotal += base;
      vatTotal += vat;
      grandTotal += lineGross;
    }
    await this.prisma.salesOrder.update({
      where: { id: orderId },
      data: {
        subtotal: Math.round(subtotal * 100) / 100,
        vatTotal: Math.round(vatTotal * 100) / 100,
        grandTotal: Math.round(grandTotal * 100) / 100,
        panelEditedAt: new Date(),
      },
    });
  }

  /** Sipariş kalemlerini tedarikçi ile birlikte getir */
  async getOrderItems(orderId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
      include: {
        supplier: true,
        product: { select: { id: true, sku: true, name: true, imageUrl: true } },
      },
      orderBy: { id: 'asc' },
    });
    return items;
  }

  /** Kargo takip bilgilerini kaydet */
  async updateShippingInfo(
    orderId: string,
    data: { cargoCompanyId?: string | null; cargoTrackingNo?: string | null },
  ) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    const updated = await this.prisma.salesOrder.update({
      where: { id: orderId },
      data: {
        cargoCompanyId: data.cargoCompanyId ?? order.cargoCompanyId,
        cargoTrackingNo:
          data.cargoTrackingNo !== undefined
            ? data.cargoTrackingNo?.trim() || null
            : order.cargoTrackingNo,
      },
      include: this.includeRelations,
    });

    const summary = await this.getPaymentSummary(orderId, updated.grandTotal);
    return { ...updated, ...summary };
  }

  /** Kargo bildirimini WhatsApp ile müşteriye gönder */
  async sendShippingNotification(orderId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        contact: { select: { phone: true, name: true, surname: true } },
        cargoCompany: { select: { name: true, isAmbar: true } },
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    if (order.status !== 'SHIPPED') {
      throw new BadRequestException('Bildirim yalnızca "Kargoda" durumundaki siparişler için gönderilebilir');
    }

    const contactPhone = order.contact.phone.replace(/\D/g, '');
    const chatId = normalizeWhatsappChatId(`${contactPhone}@c.us`);

    // Organizasyona bağlı ilk aktif oturumu bul
    const session = await this.prisma.whatsappSession.findFirst({
      where: { status: 'WORKING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!session) {
      throw new BadRequestException('Aktif WhatsApp oturumu bulunamadı');
    }

    let messageText: string;
    const isAmbar = order.cargoCompany?.isAmbar ?? false;

    if (isAmbar) {
      messageText = 'Siparişiniz ambar ile sizlere iletilmek üzere kargoya verilmiştir.';
    } else {
      const trackingNo = order.cargoTrackingNo?.trim() || '—';
      const companyName = order.cargoCompany?.name || '—';
      messageText =
        `Değerli müşterimiz, siparişiniz kargoya verilmiştir.\nTakip kodunuz: ${trackingNo}\nFirmanız: ${companyName}`;
    }

    await this.waha.sendText(session.name, chatId, messageText);

    await this.prisma.salesOrder.update({
      where: { id: orderId },
      data: { cargoNotificationSentAt: new Date() },
    });

    return { ok: true, message: messageText };
  }
}
