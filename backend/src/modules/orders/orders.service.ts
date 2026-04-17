import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { OrderStatus, DiscountType } from '@prisma/client';
import { splitSearchTokens } from '../../common/search-tokens';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  private formatPaymentNote(payment?: {
    mode?: 'FULL' | 'DEPOSIT_50' | 'CUSTOM';
    customValue?: number | null;
  }): string | null {
    if (!payment?.mode || payment.mode === 'FULL') return 'Ödeme planı: Tam ödeme.';
    if (payment.mode === 'DEPOSIT_50') {
      return 'Ödeme planı: %50 ön ödeme (kalan tutar teslim öncesi tahsil edilecek).';
    }
    if (payment.mode === 'CUSTOM' && payment.customValue != null && payment.customValue > 0) {
      return `Ödeme planı: Özel ön ödeme (%${payment.customValue}).`;
    }
    return null;
  }

  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
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
  };

  async findAll(params: { 
    status?: OrderStatus; 
    contactId?: string; 
    from?: string;
    to?: string;
    search?: string;
    page?: number; 
    limit?: number;
  }) {
    const { status, contactId, from, to, search, page = 1, limit = 50 } = params;
    const where: any = {};
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;
    
    // Tarih filtresi
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
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
    return order;
  }

  async create(userId: string, data: {
    contactId: string;
    currency?: string;
    shippingAddress?: string;
    notes?: string;
    expectedDeliveryDate?: string;
    payment?: {
      mode?: 'FULL' | 'DEPOSIT_50' | 'CUSTOM';
      customValue?: number | null;
    };
    items: {
      productId?: string;
      name: string;
      quantity: number;
      unitPrice: number;
      vatRate: number;
      supplierId?: string | null;
      supplierOrderNo?: string | null;
      isFromStock?: boolean;
    }[];
  }) {
    if (!data.items?.length) throw new BadRequestException('En az bir kalem gerekli');

    let subtotal = 0; // KDV hariç toplam
    let vatTotal = 0;
    let grossTotal = 0;
    const items = data.items.map((item) => {
      const isFromStock = !!item.isFromStock;
      const supplierId = item.supplierId || null;
      const supplierOrderNo = item.supplierOrderNo?.trim() || null;
      if (!isFromStock && !supplierOrderNo) {
        throw new BadRequestException(
          `${item.name || 'Kalem'} için stok dışı seçimde sipariş no/referans zorunludur`,
        );
      }
      const lineGross = item.quantity * item.unitPrice;
      const divider = 1 + (item.vatRate / 100);
      const base = divider > 0 ? lineGross / divider : lineGross;
      const vat = lineGross - base;
      subtotal += base;
      vatTotal += vat;
      grossTotal += lineGross;
      return {
        ...item,
        supplierId,
        supplierOrderNo,
        isFromStock,
        lineTotal: Math.round(lineGross * 100) / 100,
      };
    });

    const paymentNote = this.formatPaymentNote(data.payment);
    const normalizedNotes = [
      paymentNote,
      data.notes?.trim() || null,
    ].filter(Boolean).join('\n\n') || undefined;

    return this.prisma.salesOrder.create({
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
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            vatRate: i.vatRate,
            lineTotal: i.lineTotal,
            supplierId: i.supplierId || null,
            supplierOrderNo: i.supplierOrderNo || null,
            isFromStock: !!i.isFromStock,
          })),
        },
      },
      include: this.includeRelations,
    });
  }

  async updateStatus(id: string, status: OrderStatus) {
    await this.findById(id);
    return this.prisma.salesOrder.update({
      where: { id },
      data: { status, panelEditedAt: new Date() },
      include: this.includeRelations,
    });
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
    if (o.status !== 'PENDING') {
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
        items: orderFull.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          vatRate: i.vatRate,
          lineTotal: i.lineTotal,
          imageUrl: i.product?.imageUrl || undefined,
        })),
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

  /** Sipariş kaleminin tedarikçi bilgilerini güncelle */
  async updateOrderItem(
    itemId: string,
    data: {
      supplierId?: string | null;
      supplierOrderNo?: string | null;
      isFromStock?: boolean;
    },
  ) {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: itemId },
    });
    if (!item) throw new NotFoundException('Sipariş kalemi bulunamadı');

    const patch: any = {};
    if ('supplierId' in data) {
      patch.supplierId = data.supplierId || null;
    }
    if ('supplierOrderNo' in data) {
      patch.supplierOrderNo = data.supplierOrderNo?.trim() || null;
    }
    if ('isFromStock' in data) {
      patch.isFromStock = !!data.isFromStock;
    }
    const nextIsFromStock =
      patch.isFromStock !== undefined ? !!patch.isFromStock : !!item.isFromStock;
    const nextSupplierId =
      patch.supplierId !== undefined ? patch.supplierId : item.supplierId;
    const nextSupplierOrderNo =
      patch.supplierOrderNo !== undefined ? patch.supplierOrderNo : item.supplierOrderNo;
    if (!nextIsFromStock && !nextSupplierOrderNo) {
      throw new BadRequestException('Stok dışı kalem için sipariş no/referans zorunludur');
    }

    const updated = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: patch,
      include: {
        supplier: true,
        product: { select: { id: true, sku: true, name: true, imageUrl: true } },
      },
    });

    await this.prisma.salesOrder.update({
      where: { id: item.orderId },
      data: { panelEditedAt: new Date() },
    });

    return updated;
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
}
