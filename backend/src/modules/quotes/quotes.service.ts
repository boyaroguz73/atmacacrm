import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { WahaService } from '../waha/waha.service';
import { MailService } from '../mail/mail.service';
import { Prisma, QuoteStatus, DiscountType, QuotePaymentMode, LeadStatus } from '@prisma/client';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { normalizeWhatsappChatId } from '../../common/whatsapp-chat-id';
import { splitSearchTokens } from '../../common/search-tokens';

interface CreateQuoteItem {
  productId?: string;
  productVariantId?: string;
  lineImageUrl?: string;
  colorFabricInfo?: string;
  measurementInfo?: string;
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
    const gross = item.quantity * item.unitPrice;
    let lineDiscount = 0;
    if (item.discountValue && item.discountValue > 0) {
      if (item.discountType === 'AMOUNT') lineDiscount = item.discountValue;
      else lineDiscount = gross * (item.discountValue / 100);
    }
    const grossAfterDiscount = Math.max(0, gross - lineDiscount);
    return Math.round(grossAfterDiscount * 100) / 100;
  }

  private calcTotals(
    items: CreateQuoteItem[],
    discountType: DiscountType,
    discountValue: number,
  ) {
    let netSubtotalBeforeGeneralDiscount = 0;
    let vatTotalBeforeGeneralDiscount = 0;
    let grossSubtotalBeforeGeneralDiscount = 0;
    const calculated = items.map((item) => {
      const lineGross = item.quantity * item.unitPrice;
      let lineDiscount = 0;
      if (item.discountValue && item.discountValue > 0) {
        lineDiscount = item.discountType === 'AMOUNT'
          ? item.discountValue
          : lineGross * (item.discountValue / 100);
      }
      const grossAfterLineDiscount = Math.max(0, lineGross - lineDiscount);
      const divider = 1 + (item.vatRate / 100);
      const lineNet = divider > 0 ? grossAfterLineDiscount / divider : grossAfterLineDiscount;
      const lineVat = grossAfterLineDiscount - lineNet;
      grossSubtotalBeforeGeneralDiscount += grossAfterLineDiscount;
      netSubtotalBeforeGeneralDiscount += lineNet;
      vatTotalBeforeGeneralDiscount += lineVat;
      return { ...item, lineTotal: Math.round(grossAfterLineDiscount * 100) / 100 };
    });

    let discountTotal = 0;
    if (discountValue > 0) {
      discountTotal = discountType === 'AMOUNT'
        ? discountValue
        : grossSubtotalBeforeGeneralDiscount * (discountValue / 100);
    }
    const grossAfterGeneralDiscount = Math.max(0, grossSubtotalBeforeGeneralDiscount - discountTotal);
    const discountRatio =
      grossSubtotalBeforeGeneralDiscount > 0
        ? grossAfterGeneralDiscount / grossSubtotalBeforeGeneralDiscount
        : 1;
    const adjustedNetSubtotal = netSubtotalBeforeGeneralDiscount * discountRatio;
    const adjustedVatTotal = vatTotalBeforeGeneralDiscount * discountRatio;
    const grandTotal = Math.round(grossAfterGeneralDiscount * 100) / 100;

    return {
      items: calculated,
      subtotal: Math.round(adjustedNetSubtotal * 100) / 100,
      discountTotal: Math.round(discountTotal * 100) / 100,
      vatTotal: Math.round(adjustedVatTotal * 100) / 100,
      grandTotal,
    };
  }

  private readonly includeRelations = {
    contact: {
      select: {
        id: true,
        name: true,
        surname: true,
        phone: true,
        email: true,
        company: true,
        city: true,
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
        productVariant: {
          select: {
            id: true,
            externalId: true,
            name: true,
            unitPrice: true,
            product: { select: { imageUrl: true } },
          },
        },
      },
      orderBy: { id: 'asc' as const },
    },
    order: { select: { id: true } },
  };

  async findAll(params: { 
    status?: QuoteStatus; 
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
            ...(Number.isFinite(parsedNumber) ? [{ quoteNumber: parsedNumber }] : []),
            { contact: { name: { equals: token, mode: 'insensitive' } } },
            { contact: { surname: { equals: token, mode: 'insensitive' } } },
            ...(numericToken ? [{ contact: { phone: { startsWith: numericToken } } }] : []),
            { contact: { company: { equals: token, mode: 'insensitive' } } },
          ],
        };
      });
    }

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
    termsOverride?: string;
    footerNoteOverride?: string;
    agentInfo?: string;
    colorFabricInfo?: string;
    measurementInfo?: string;
    grandTotalOverride?: number;
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
        termsOverride:
          data.termsOverride != null && String(data.termsOverride).trim() !== ''
            ? String(data.termsOverride)
            : null,
        footerNoteOverride:
          data.footerNoteOverride != null && String(data.footerNoteOverride).trim() !== ''
            ? String(data.footerNoteOverride)
            : null,
        agentInfo: data.agentInfo?.trim() || null,
        colorFabricInfo: null,
        measurementInfo: null,
        grandTotalOverride: typeof data.grandTotalOverride === 'number' && data.grandTotalOverride > 0 
          ? data.grandTotalOverride 
          : null,
        items: {
          create: totals.items.map((item) => ({
            productId: item.productId || null,
            productVariantId: item.productVariantId || null,
            lineImageUrl:
              item.lineImageUrl != null && String(item.lineImageUrl).trim() !== ''
                ? String(item.lineImageUrl).trim()
                : null,
            colorFabricInfo:
              item.colorFabricInfo != null && String(item.colorFabricInfo).trim() !== ''
                ? String(item.colorFabricInfo).trim()
                : null,
            measurementInfo:
              item.measurementInfo != null && String(item.measurementInfo).trim() !== ''
                ? String(item.measurementInfo).trim()
                : null,
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
    dto: { 
      status: QuoteStatus; 
      paymentMode?: QuotePaymentMode; 
      partialPaymentAmount?: number;
      documentKind?: string;
    },
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
      if (dto.partialPaymentAmount != null && dto.partialPaymentAmount > 0) {
        data.partialPaymentAmount = dto.partialPaymentAmount;
      }
      
      // Teklif kabul edildiğinde Lead'i WON olarak işaretle
      try {
        const lead = await this.prisma.lead.findUnique({
          where: { contactId: q.contactId },
        });
        if (lead && lead.status !== LeadStatus.WON && lead.status !== LeadStatus.LOST) {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { 
              status: LeadStatus.WON, 
              closedAt: new Date(),
            },
          });
          this.logger.log(`Teklif kabul edildi, Lead ${lead.id} WON olarak işaretlendi`);
        }
      } catch (err: any) {
        this.logger.warn(`Lead WON güncellemesi başarısız: ${err.message}`);
      }
    } else if (prevStatus === QuoteStatus.ACCEPTED) {
      data.acceptedAt = null;
    }
    return this.prisma.quote.update({
      where: { id },
      data: { ...data, panelEditedAt: new Date() },
      include: this.includeRelations,
    });
  }

  /** Geçerlilik, teslim ve notlar — kalemleri değiştirmez; PDF varsa yeniden üretilmelidir. */
  async updateMeta(
    id: string,
    data: {
      currency?: string | null;
      discountType?: DiscountType | null;
      discountValue?: number | null;
      validUntil?: string | null;
      deliveryDate?: string | null;
      notes?: string | null;
      termsOverride?: string | null;
      footerNoteOverride?: string | null;
      documentKind?: string | null;
      agentInfo?: string | null;
      colorFabricInfo?: string | null;
      measurementInfo?: string | null;
      grandTotalOverride?: number | null;
      items?: CreateQuoteItem[] | null;
    },
  ) {
    const current = await this.findById(id);
    if (current.order) {
      throw new BadRequestException('Siparişe dönüşmüş teklif düzenlenemez');
    }

    const hasItemsPayload = 'items' in data;
    const hasFinancialPayload =
      'discountType' in data || 'discountValue' in data || 'currency' in data;

    const recalcSourceItems: CreateQuoteItem[] = hasItemsPayload
      ? (data.items || [])
      : (current.items || []).map((it) => ({
          productId: it.productId || undefined,
          productVariantId: it.productVariantId || undefined,
          lineImageUrl: it.lineImageUrl || undefined,
          colorFabricInfo: (it as any).colorFabricInfo || undefined,
          measurementInfo: (it as any).measurementInfo || undefined,
          name: it.name,
          description: it.description || undefined,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          vatRate: it.vatRate,
          discountType: (it.discountType as DiscountType | null) || undefined,
          discountValue: it.discountValue || 0,
        }));

    if (hasItemsPayload && recalcSourceItems.length === 0) {
      throw new BadRequestException('En az bir kalem gerekli');
    }

    const effectiveDiscountType =
      (data.discountType as DiscountType | null | undefined) ?? current.discountType;
    const effectiveDiscountValue =
      typeof data.discountValue === 'number' ? data.discountValue : current.discountValue;

    const shouldRecalc = hasItemsPayload || hasFinancialPayload;
    const totals = shouldRecalc
      ? this.calcTotals(recalcSourceItems, effectiveDiscountType, effectiveDiscountValue)
      : null;

    const patch: {
      currency?: string;
      discountType?: DiscountType;
      discountValue?: number;
      discountTotal?: number;
      subtotal?: number;
      vatTotal?: number;
      grandTotal?: number;
      validUntil?: Date | null;
      deliveryDate?: Date | null;
      notes?: string | null;
      termsOverride?: string | null;
      footerNoteOverride?: string | null;
      documentKind?: string;
      agentInfo?: string | null;
      colorFabricInfo?: string | null;
      measurementInfo?: string | null;
      grandTotalOverride?: number | null;
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
    if ('currency' in data && data.currency != null && data.currency !== '') {
      patch.currency = String(data.currency).toUpperCase();
    }
    if ('discountType' in data && data.discountType != null) {
      patch.discountType = data.discountType;
    }
    if ('discountValue' in data && typeof data.discountValue === 'number') {
      patch.discountValue = data.discountValue;
    }
    if (totals) {
      patch.discountTotal = totals.discountTotal;
      patch.subtotal = totals.subtotal;
      patch.vatTotal = totals.vatTotal;
      patch.grandTotal = totals.grandTotal;
    }
    if ('notes' in data) patch.notes = data.notes == null ? null : String(data.notes);
    if ('termsOverride' in data) {
      patch.termsOverride =
        data.termsOverride == null || String(data.termsOverride).trim() === ''
          ? null
          : String(data.termsOverride);
    }
    if ('footerNoteOverride' in data) {
      patch.footerNoteOverride =
        data.footerNoteOverride == null || String(data.footerNoteOverride).trim() === ''
          ? null
          : String(data.footerNoteOverride);
    }
    if ('documentKind' in data && data.documentKind != null && data.documentKind !== '') {
      const dk = String(data.documentKind).toUpperCase();
      if (dk === 'PROFORMA' || dk === 'QUOTE') patch.documentKind = dk;
    }
    if ('agentInfo' in data) {
      patch.agentInfo = data.agentInfo == null || String(data.agentInfo).trim() === '' 
        ? null 
        : String(data.agentInfo).trim();
    }
    if ('colorFabricInfo' in data) {
      patch.colorFabricInfo = data.colorFabricInfo == null || String(data.colorFabricInfo).trim() === '' 
        ? null 
        : String(data.colorFabricInfo).trim();
    }
    if ('measurementInfo' in data) {
      patch.measurementInfo = data.measurementInfo == null || String(data.measurementInfo).trim() === '' 
        ? null 
        : String(data.measurementInfo).trim();
    }
    if ('grandTotalOverride' in data) {
      patch.grandTotalOverride = typeof data.grandTotalOverride === 'number' && data.grandTotalOverride > 0 
        ? data.grandTotalOverride 
        : null;
    }
    if (hasItemsPayload) {
      patch.colorFabricInfo = null;
      patch.measurementInfo = null;
    }

    return this.prisma.quote.update({
      where: { id },
      data: {
        ...patch,
        panelEditedAt: new Date(),
        ...(hasItemsPayload
          ? {
              items: {
                deleteMany: {},
                create: (totals?.items || recalcSourceItems).map((item: any) => ({
                  productId: item.productId || null,
                  productVariantId: item.productVariantId || null,
                  lineImageUrl:
                    item.lineImageUrl != null && String(item.lineImageUrl).trim() !== ''
                      ? String(item.lineImageUrl).trim()
                      : null,
                  colorFabricInfo:
                    item.colorFabricInfo != null && String(item.colorFabricInfo).trim() !== ''
                      ? String(item.colorFabricInfo).trim()
                      : null,
                  measurementInfo:
                    item.measurementInfo != null && String(item.measurementInfo).trim() !== ''
                      ? String(item.measurementInfo).trim()
                      : null,
                  name: item.name,
                  description: item.description,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  vatRate: item.vatRate,
                  discountType: item.discountType || null,
                  discountValue: item.discountValue || 0,
                  lineTotal:
                    typeof item.lineTotal === 'number'
                      ? item.lineTotal
                      : this.calcLineTotal(item),
                })),
              },
            }
          : {}),
      },
      include: this.includeRelations,
    });
  }

  /** Sadece taslak teklif silinebilir */
  async remove(id: string) {
    const q = await this.prisma.quote.findUnique({
      where: { id },
      include: { order: { select: { id: true } } },
    });
    if (!q) throw new NotFoundException('Teklif bulunamadı');
    if (q.status !== 'DRAFT') {
      throw new BadRequestException('Sadece taslak teklifler silinebilir');
    }
    if (q.order) {
      throw new BadRequestException('Siparişe dönüşmüş teklif silinemez');
    }
    await this.prisma.quote.delete({ where: { id } });
    return { deleted: true };
  }

  async generatePdf(id: string): Promise<string> {
    const quote = await this.findById(id);
    const c = quote.contact;
    const fmt = (d: Date | null) => d ? new Date(d).toLocaleDateString('tr-TR') : undefined;

    const docKind =
      quote.documentKind === 'QUOTE' ? 'QUOTE' : 'PROFORMA';
    const title = docKind === 'QUOTE' ? 'SATIŞ TEKLİFİ' : 'PROFORMA TEKLİF';

    const addr =
      (c.billingAddress && String(c.billingAddress).trim()) ||
      (c.address && String(c.address).trim()) ||
      undefined;

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
      contactAddress: addr,
      contactTaxOffice: c.taxOffice?.trim() || undefined,
      contactTaxNumber: c.taxNumber?.trim() || undefined,
      contactIdentityNumber: c.identityNumber?.trim() || undefined,
      items: quote.items.map((i) => {
        const cf = i.colorFabricInfo;
        const ms = i.measurementInfo;
        const lineDetail = [cf, ms].map((x) => (x != null ? String(x).trim() : '')).filter(Boolean).join(' · ');
        return {
          name: i.name,
          lineDetail: lineDetail || undefined,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          vatRate: i.vatRate,
          discountText: i.discountValue
            ? (i.discountType === 'AMOUNT' ? `${i.discountValue} ${quote.currency}` : `%${i.discountValue}`)
            : undefined,
          lineTotal: i.lineTotal,
          imageUrl:
            i.lineImageUrl ||
            i.productVariant?.product?.imageUrl ||
            i.product?.imageUrl ||
            undefined,
        };
      }),
      currency: quote.currency,
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      vatTotal: quote.vatTotal,
      grandTotal: (quote as any).grandTotalOverride ?? quote.grandTotal,
      notes: quote.notes || undefined,
      termsOverride: quote.termsOverride || undefined,
      footerNoteOverride: quote.footerNoteOverride || undefined,
      createdByName: quote.createdBy?.name || undefined,
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
    const caption = `Değerli müşterimiz, teklifiniz ektedir. (TKL-${String(quote.quoteNumber).padStart(5, '0')})`;

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

  async convertToOrder(
    id: string,
    userId: string,
    options?: {
      manual?: boolean;
      payment?: {
        mode?: 'FULL' | 'DEPOSIT_50' | 'CUSTOM';
        customValue?: number | null;
      };
      itemSources?: Array<{
        quoteItemId?: string;
        source: 'STOCK' | 'SUPPLIER' | 'EXISTING_CUSTOMER';
        supplierId?: string | null;
        supplierOrderNo?: string | null;
      }>;
    },
  ) {
    const quote = await this.findById(id);
    if (!options?.manual && quote.status !== 'ACCEPTED') {
      throw new BadRequestException('Sadece kabul edilmiş teklifler siparişe dönüştürülebilir');
    }

    const existing = await this.prisma.salesOrder.findUnique({ where: { quoteId: id } });
    if (existing) throw new BadRequestException('Bu teklif zaten siparişe dönüştürülmüş');

    const noteParts: string[] = [];
    const requestedPaymentMode = options?.payment?.mode;
    if (requestedPaymentMode === 'DEPOSIT_50') {
      noteParts.push('Ödeme planı: %50 ön ödeme (kalan tutar teslim öncesi tahsil edilecek).');
    } else if (
      requestedPaymentMode === 'CUSTOM' &&
      options?.payment?.customValue != null &&
      options.payment.customValue > 0
    ) {
      noteParts.push(`Ödeme planı: Özel ön ödeme (%${options.payment.customValue}).`);
    } else if (quote.paymentMode === QuotePaymentMode.DEPOSIT_50) {
      noteParts.push('Ödeme planı: %50 ön ödeme (kalan tutar teslim öncesi tahsil edilecek).');
    } else {
      noteParts.push('Ödeme planı: Tam ödeme.');
    }
    if (quote.notes) noteParts.push(String(quote.notes));
    const mergedNotes = noteParts.length ? noteParts.join('\n\n') : undefined;

    const sourceByItemId = new Map(
      (options?.itemSources || [])
        .filter((x) => x?.quoteItemId)
        .map((x) => [String(x.quoteItemId), x]),
    );

    const orderItemCreates = quote.items.map((item) => {
      const cfg = sourceByItemId.get(String(item.id));
      const source = cfg?.source || 'STOCK';
      if (source === 'SUPPLIER') {
        if (!cfg?.supplierId || !cfg?.supplierOrderNo?.trim()) {
          throw new BadRequestException(`${item.name} için tedarikçi ve sipariş no zorunludur`);
        }
      }
      if (source === 'EXISTING_CUSTOMER') {
        if (!cfg?.supplierOrderNo?.trim()) {
          throw new BadRequestException(`${item.name} için eski müşteri referansı/sipariş no zorunludur`);
        }
      }
      return {
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        lineTotal: item.lineTotal,
        isFromStock: source === 'STOCK',
        supplierId: source === 'SUPPLIER' ? cfg?.supplierId || null : null,
        supplierOrderNo:
          source === 'SUPPLIER' || source === 'EXISTING_CUSTOMER'
            ? cfg?.supplierOrderNo?.trim() || null
            : null,
      };
    });

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
        shippingAddress: quote.contact?.address ?? undefined,
        depositBalanceReminderSent: false,
        expectedDeliveryDate: quote.deliveryDate ?? undefined,
        items: {
          create: orderItemCreates,
        },
      },
      include: {
        items: true,
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
        quote: { select: { id: true, quoteNumber: true } },
      },
    });

    const orderFull = await this.prisma.salesOrder.findUnique({
      where: { id: order.id },
      include: {
        items: { include: { product: { select: { imageUrl: true } } } },
        contact: true,
        createdBy: { select: { id: true, name: true } },
        quote: {
          select: {
            quoteNumber: true,
            discountTotal: true,
            discountType: true,
            discountValue: true,
            currency: true,
          },
        },
      },
    });
    if (orderFull) {
      const discLabel =
        quote.discountTotal > 0
          ? quote.discountType === DiscountType.PERCENT
            ? `İskonto (%${quote.discountValue})`
            : `İskonto (${quote.discountValue} ${quote.currency})`
          : undefined;
      try {
        const pdfUrl = await this.pdfService.generateOrderConfirmationPdf({
          documentNumber: `SIP-${String(orderFull.orderNumber).padStart(5, '0')}`,
          date: new Date().toLocaleDateString('tr-TR'),
          contactName:
            [orderFull.contact.name, orderFull.contact.surname].filter(Boolean).join(' ') ||
            orderFull.contact.phone,
          contactCompany: orderFull.contact.company || undefined,
          contactPhone: orderFull.contact.phone,
          contactEmail: orderFull.contact.email || undefined,
          shippingAddress: orderFull.contact.address || undefined,
          expectedDelivery: orderFull.expectedDeliveryDate
            ? new Date(orderFull.expectedDeliveryDate).toLocaleDateString('tr-TR')
            : undefined,
          quoteRef:
            quote.quoteNumber != null ? `TKL-${String(quote.quoteNumber).padStart(5, '0')}` : undefined,
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
          discountTotal: quote.discountTotal,
          discountLabel: discLabel,
          vatTotal: orderFull.vatTotal,
          grandTotal: orderFull.grandTotal,
          orderNotes: orderFull.notes || undefined,
          createdByName: orderFull.createdBy?.name || undefined,
        });
        await this.prisma.salesOrder.update({
          where: { id: order.id },
          data: { confirmationPdfUrl: pdfUrl },
        });
        return { ...order, confirmationPdfUrl: pdfUrl };
      } catch (e: any) {
        this.logger.warn(`Sipariş onay PDF oluşturulamadı: ${e?.message}`);
      }
    }
    return order;
  }

  /** Teklif versiyonu oluştur (mevcut durumu kaydet) */
  async createVersion(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true },
    });
    if (!quote) throw new NotFoundException('Teklif bulunamadı');

    // Mevcut durumu JSON olarak kaydet
    const snapshot = {
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      currency: quote.currency,
      subtotal: quote.subtotal,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      discountTotal: quote.discountTotal,
      vatTotal: quote.vatTotal,
      grandTotal: quote.grandTotal,
      validUntil: quote.validUntil,
      deliveryDate: quote.deliveryDate,
      notes: quote.notes,
      termsOverride: quote.termsOverride,
      footerNoteOverride: quote.footerNoteOverride,
      paymentMode: quote.paymentMode,
      documentKind: quote.documentKind,
      items: quote.items.map((i) => ({
        name: i.name,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        vatRate: i.vatRate,
        discountType: i.discountType,
        discountValue: i.discountValue,
        lineTotal: i.lineTotal,
      })),
      createdAt: quote.createdAt,
    };

    const version = await this.prisma.quoteVersion.create({
      data: {
        quoteId,
        version: quote.currentVersion,
        snapshot: snapshot as any,
        pdfUrl: quote.pdfUrl,
      },
    });

    // Versiyon numarasını artır
    await this.prisma.quote.update({
      where: { id: quoteId },
      data: { currentVersion: quote.currentVersion + 1 },
    });

    return version;
  }

  /** Teklif versiyonlarını getir */
  async getVersions(quoteId: string) {
    return this.prisma.quoteVersion.findMany({
      where: { quoteId },
      orderBy: { version: 'desc' },
    });
  }

  /** Belirli bir versiyonu getir */
  async getVersion(versionId: string) {
    const version = await this.prisma.quoteVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('Versiyon bulunamadı');
    return version;
  }
}
