import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { WahaService } from '../waha/waha.service';
import { MailService } from '../mail/mail.service';
import { Prisma, QuoteStatus, DiscountType, QuotePaymentMode } from '@prisma/client';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { normalizeWhatsappChatId } from '../../common/whatsapp-chat-id';

interface CreateQuoteItem {
  productId?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountType?: DiscountType;
  discountValue?: number;
}

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
    private wahaService: WahaService,
    private mailService: MailService,
  ) {}

  private calcLineTotal(item: CreateQuoteItem): number {
    let base = item.quantity * item.unitPrice;
    if (item.discountValue && item.discountValue > 0) {
      if (item.discountType === 'AMOUNT') base -= item.discountValue;
      else base -= base * (item.discountValue / 100);
    }
    const vat = base * (item.vatRate / 100);
    return Math.round((base + vat) * 100) / 100;
  }

  private calcTotals(
    items: CreateQuoteItem[],
    discountType: DiscountType,
    discountValue: number,
  ) {
    let subtotal = 0;
    let vatTotal = 0;
    const calculated = items.map((item) => {
      let base = item.quantity * item.unitPrice;
      let lineDiscount = 0;
      if (item.discountValue && item.discountValue > 0) {
        lineDiscount = item.discountType === 'AMOUNT'
          ? item.discountValue
          : base * (item.discountValue / 100);
      }
      base -= lineDiscount;
      const vat = base * (item.vatRate / 100);
      subtotal += base;
      vatTotal += vat;
      return { ...item, lineTotal: Math.round((base + vat) * 100) / 100 };
    });

    let discountTotal = 0;
    if (discountValue > 0) {
      discountTotal = discountType === 'AMOUNT'
        ? discountValue
        : subtotal * (discountValue / 100);
    }
    const afterDiscount = subtotal - discountTotal;
    const adjustedVat = vatTotal * (afterDiscount / (subtotal || 1));
    const grandTotal = Math.round((afterDiscount + adjustedVat) * 100) / 100;

    return {
      items: calculated,
      subtotal: Math.round(subtotal * 100) / 100,
      discountTotal: Math.round(discountTotal * 100) / 100,
      vatTotal: Math.round(adjustedVat * 100) / 100,
      grandTotal,
    };
  }

  private readonly includeRelations = {
    contact: { select: { id: true, name: true, surname: true, phone: true, email: true, company: true, city: true } },
    createdBy: { select: { id: true, name: true } },
    items: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { id: 'asc' as const } },
  };

  async findAll(params: { status?: QuoteStatus; contactId?: string; page?: number; limit?: number }) {
    const { status, contactId, page = 1, limit = 50 } = params;
    const where: any = {};
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;

    const [quotes, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        include: this.includeRelations,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.quote.count({ where }),
    ]);
    return { quotes, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: this.includeRelations,
    });
    if (!quote) throw new NotFoundException('Teklif bulunamadı');
    return quote;
  }

  async create(userId: string, data: {
    contactId: string;
    currency?: string;
    discountType?: DiscountType;
    discountValue?: number;
    validUntil?: string;
    deliveryDate?: string;
    notes?: string;
    items: CreateQuoteItem[];
  }) {
    if (!data.items?.length) throw new BadRequestException('En az bir kalem gerekli');

    const totals = this.calcTotals(
      data.items,
      data.discountType || DiscountType.PERCENT,
      data.discountValue || 0,
    );

    const quote = await this.prisma.quote.create({
      data: {
        contactId: data.contactId,
        createdById: userId,
        currency: data.currency || 'TRY',
        discountType: data.discountType || DiscountType.PERCENT,
        discountValue: data.discountValue || 0,
        discountTotal: totals.discountTotal,
        subtotal: totals.subtotal,
        vatTotal: totals.vatTotal,
        grandTotal: totals.grandTotal,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        notes: data.notes,
        items: {
          create: totals.items.map((item) => ({
            productId: item.productId || null,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            vatRate: item.vatRate,
            discountType: item.discountType || null,
            discountValue: item.discountValue || 0,
            lineTotal: item.lineTotal,
          })),
        },
      },
      include: this.includeRelations,
    });
    return quote;
  }

  async updateStatus(
    id: string,
    dto: { status: QuoteStatus; paymentMode?: QuotePaymentMode; documentKind?: string },
  ) {
    const q = await this.findById(id);
    const prevStatus = q.status;
    const data: Prisma.QuoteUpdateInput = { status: dto.status };
    if (dto.documentKind === 'PROFORMA' || dto.documentKind === 'QUOTE') {
      data.documentKind = dto.documentKind;
    }
    if (dto.status === QuoteStatus.ACCEPTED) {
      data.acceptedAt = new Date();
      if (dto.paymentMode) data.paymentMode = dto.paymentMode;
    } else if (prevStatus === QuoteStatus.ACCEPTED) {
      data.acceptedAt = null;
    }
    return this.prisma.quote.update({
      where: { id },
      data,
      include: this.includeRelations,
    });
  }

  /** Geçerlilik, teslim ve notlar — kalemleri değiştirmez; PDF varsa yeniden üretilmelidir. */
  async updateMeta(
    id: string,
    data: {
      validUntil?: string | null;
      deliveryDate?: string | null;
      notes?: string | null;
      documentKind?: string | null;
    },
  ) {
    await this.findById(id);
    const patch: {
      validUntil?: Date | null;
      deliveryDate?: Date | null;
      notes?: string | null;
      documentKind?: string;
    } = {};
    if ('validUntil' in data) {
      const v = data.validUntil;
      patch.validUntil =
        v == null || String(v).trim() === '' ? null : new Date(String(v));
    }
    if ('deliveryDate' in data) {
      const v = data.deliveryDate;
      patch.deliveryDate =
        v == null || String(v).trim() === '' ? null : new Date(String(v));
    }
    if ('notes' in data) patch.notes = data.notes == null ? null : String(data.notes);
    if ('documentKind' in data && data.documentKind != null && data.documentKind !== '') {
      const dk = String(data.documentKind).toUpperCase();
      if (dk === 'PROFORMA' || dk === 'QUOTE') patch.documentKind = dk;
    }

    return this.prisma.quote.update({
      where: { id },
      data: patch,
      include: this.includeRelations,
    });
  }

  async generatePdf(id: string): Promise<string> {
    const quote = await this.findById(id);
    const c = quote.contact;
    const fmt = (d: Date | null) => d ? new Date(d).toLocaleDateString('tr-TR') : undefined;

    const docKind =
      quote.documentKind === 'QUOTE' ? 'QUOTE' : 'PROFORMA';
    const title = docKind === 'QUOTE' ? 'SATIŞ TEKLİFİ' : 'PROFORMA TEKLİF';

    const pdfUrl = await this.pdfService.generateQuotePdf({
      title,
      documentNumber: `TKL-${String(quote.quoteNumber).padStart(5, '0')}`,
      date: new Date(quote.createdAt).toLocaleDateString('tr-TR'),
      validUntil: fmt(quote.validUntil),
      deliveryDate: fmt(quote.deliveryDate),
      contactName: [c.name, c.surname].filter(Boolean).join(' ') || c.phone,
      contactCompany: c.company || undefined,
      contactPhone: c.phone,
      contactEmail: c.email || undefined,
      items: quote.items.map((i) => ({
        name: i.name,
        description: i.description || undefined,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        vatRate: i.vatRate,
        discountText: i.discountValue
          ? (i.discountType === 'AMOUNT' ? `${i.discountValue} ${quote.currency}` : `%${i.discountValue}`)
          : undefined,
        lineTotal: i.lineTotal,
      })),
      currency: quote.currency,
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      vatTotal: quote.vatTotal,
      grandTotal: quote.grandTotal,
      notes: quote.notes || undefined,
    });

    await this.prisma.quote.update({ where: { id }, data: { pdfUrl } });
    return pdfUrl;
  }

  async send(id: string, sessionName?: string) {
    const quote = await this.findById(id);
    let pdfUrl = quote.pdfUrl;
    // PDF yoksa veya fiziksel dosya kayıpsa yeniden oluştur
    if (!pdfUrl || !existsSync(join(process.cwd(), pdfUrl.replace(/^\//, '')))) {
      pdfUrl = await this.generatePdf(id);
    }

    const c = quote.contact;

    // Session belirtilmemişse kişiyle konuşan session'ı bul
    if (!sessionName) {
      sessionName = await this.wahaService.getWorkingSessionForContact(c.id) ?? undefined;
    }
    if (!sessionName) {
      throw new BadRequestException('Aktif WhatsApp oturumu bulunamadı. Lütfen Ayarlar > WhatsApp bölümünden oturum açın.');
    }

    const chatId = normalizeWhatsappChatId(`${c.phone.replace(/\D/g, '')}@c.us`);
    const caption = `Sayin ${c.name || 'Musteri'}, TKL-${String(quote.quoteNumber).padStart(5, '0')} numarali teklifiniz ektedir.`;

    const localPath = join(process.cwd(), pdfUrl!.replace(/^\//, ''));
    const buf = readFileSync(localPath);
    // WAHA WEBJS engine saf base64 bekliyor, data: prefix olmadan
    const base64Data = buf.toString('base64');

    await this.wahaService.sendFile(sessionName, chatId, {
      mimetype: 'application/pdf',
      data: base64Data,
      filename: `Teklif-${quote.quoteNumber}.pdf`,
    }, caption);

    if (c.email) {
      try {
        await (this.mailService as any).transporter?.sendMail({
          from: `"CRM" <${process.env.SMTP_FROM || 'noreply@crm.com'}>`,
          to: c.email,
          subject: `Teklif #TKL-${String(quote.quoteNumber).padStart(5, '0')}`,
          text: caption,
          attachments: [{ filename: `Teklif-${quote.quoteNumber}.pdf`, path: localPath }],
        });
      } catch (err: any) {
        this.logger.warn(`Teklif e-posta gönderilemedi: ${err.message}`);
      }
    }

    await this.updateStatus(id, { status: QuoteStatus.SENT });
    return { message: 'Teklif gönderildi', pdfUrl };
  }

  async convertToOrder(id: string, userId: string) {
    const quote = await this.findById(id);
    if (quote.status !== 'ACCEPTED') throw new BadRequestException('Sadece kabul edilmiş teklifler siparişe dönüştürülebilir');

    const existing = await this.prisma.salesOrder.findUnique({ where: { quoteId: id } });
    if (existing) throw new BadRequestException('Bu teklif zaten siparişe dönüştürülmüş');

    const noteParts: string[] = [];
    if (quote.paymentMode === QuotePaymentMode.DEPOSIT_50) {
      noteParts.push('Ödeme planı: %50 ön ödeme (kalan tutar teslim öncesi tahsil edilecek).');
    }
    if (quote.notes) noteParts.push(String(quote.notes));
    const mergedNotes = noteParts.length ? noteParts.join('\n\n') : undefined;

    const order = await this.prisma.salesOrder.create({
      data: {
        quoteId: id,
        contactId: quote.contactId,
        createdById: userId,
        currency: quote.currency,
        subtotal: quote.subtotal,
        vatTotal: quote.vatTotal,
        grandTotal: quote.grandTotal,
        notes: mergedNotes,
        depositBalanceReminderSent: false,
        expectedDeliveryDate: quote.deliveryDate ?? undefined,
        items: {
          create: quote.items.map((item) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            vatRate: item.vatRate,
            lineTotal: item.lineTotal,
          })),
        },
      },
      include: {
        items: true,
        contact: { select: { id: true, name: true, surname: true, phone: true, email: true, company: true } },
        createdBy: { select: { id: true, name: true } },
        quote: { select: { id: true, quoteNumber: true } },
      },
    });
    return order;
  }
}
