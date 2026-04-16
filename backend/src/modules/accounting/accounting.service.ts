import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { WahaService } from '../waha/waha.service';
import { MailService } from '../mail/mail.service';
import { AccInvoiceStatus, CashDirection, LedgerKind, Prisma } from '@prisma/client';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { normalizeWhatsappChatId } from '../../common/whatsapp-chat-id';

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
    private wahaService: WahaService,
    private mailService: MailService,
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
    order: { select: { id: true, orderNumber: true } },
    quote: { select: { id: true, quoteNumber: true } },
  };

  async findAll(params: { status?: AccInvoiceStatus; contactId?: string; page?: number; limit?: number }) {
    const { status, contactId, page = 1, limit = 50 } = params;
    const where: any = {};
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;

    const [invoices, total] = await Promise.all([
      this.prisma.accountingInvoice.findMany({
        where,
        include: this.includeRelations,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accountingInvoice.count({ where }),
    ]);
    return { invoices, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const inv = await this.prisma.accountingInvoice.findUnique({
      where: { id },
      include: this.includeRelations,
    });
    if (!inv) throw new NotFoundException('Fatura bulunamadı');
    return inv;
  }

  async pendingBilling(page = 1, limit = 50) {
    const where = {
      status: { in: ['DELIVERED' as any, 'PROCESSING' as any] },
      invoice: null,
    };
    const [orders, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              phone: true,
              company: true,
              address: true,
              billingAddress: true,
              taxOffice: true,
              taxNumber: true,
              identityNumber: true,
            },
          },
          items: true,
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { orders, total, page, totalPages: Math.ceil(total / limit) };
  }

  async createFromOrder(orderId: string, userId: string, dueDate?: string, notes?: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: { invoice: true },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    if (order.invoice) throw new BadRequestException('Bu sipariş için zaten fatura kesilmiş');
    if (order.status === 'CANCELLED') {
      throw new BadRequestException('İptal edilmiş siparişten fatura oluşturulamaz');
    }

    const due =
      dueDate != null && String(dueDate).trim() !== ''
        ? new Date(dueDate)
        : (() => {
            const d = new Date();
            d.setDate(d.getDate() + 30);
            return d;
          })();

    return this.prisma.accountingInvoice.create({
      data: {
        orderId,
        contactId: order.contactId,
        createdById: userId,
        currency: order.currency,
        subtotal: order.subtotal,
        vatTotal: order.vatTotal,
        grandTotal: order.grandTotal,
        dueDate: due,
        notes,
      },
      include: this.includeRelations,
    });
  }

  async createManual(userId: string, data: {
    contactId: string;
    quoteId?: string;
    currency?: string;
    subtotal: number;
    vatTotal: number;
    grandTotal: number;
    dueDate?: string;
    notes?: string;
  }) {
    return this.prisma.accountingInvoice.create({
      data: {
        contactId: data.contactId,
        quoteId: data.quoteId || null,
        createdById: userId,
        currency: data.currency || 'TRY',
        subtotal: data.subtotal,
        vatTotal: data.vatTotal,
        grandTotal: data.grandTotal,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        notes: data.notes,
      },
      include: this.includeRelations,
    });
  }

  async updateStatus(id: string, status: AccInvoiceStatus) {
    const inv = await this.findById(id);
    const data: any = { status, panelEditedAt: new Date() };
    if (status === 'PAID') {
      data.paidAt = new Date();
      // Otomatik kasa kaydı oluştur
      const existingCash = await this.prisma.cashBookEntry.findFirst({
        where: { invoiceId: id },
      });
      if (!existingCash) {
        await this.prisma.cashBookEntry.create({
          data: {
            userId: inv.createdById,
            amount: inv.grandTotal,
            direction: 'INCOME',
            description: `Fatura #FTR-${String(inv.invoiceNumber).padStart(5, '0')} ödeme`,
            invoiceId: id,
            occurredAt: new Date(),
          },
        });
        this.logger.log(`Fatura ödeme kasa kaydı oluşturuldu: ${id}`);
      }
    }
    return this.prisma.accountingInvoice.update({
      where: { id },
      data,
      include: this.includeRelations,
    });
  }

  async updateMeta(id: string, data: { dueDate?: string | null; notes?: string | null }) {
    await this.findById(id);
    const patch: { dueDate?: Date | null; notes?: string | null; panelEditedAt: Date } = {
      panelEditedAt: new Date(),
    };
    if ('dueDate' in data) {
      const v = data.dueDate;
      patch.dueDate = v == null || String(v).trim() === '' ? null : new Date(String(v));
    }
    if ('notes' in data) patch.notes = data.notes == null ? null : String(data.notes);
    return this.prisma.accountingInvoice.update({
      where: { id },
      data: patch,
      include: this.includeRelations,
    });
  }

  async uploadPdf(id: string, pdfUrl: string) {
    await this.findById(id);
    return this.prisma.accountingInvoice.update({
      where: { id },
      data: { uploadedPdfUrl: pdfUrl, panelEditedAt: new Date() },
      include: this.includeRelations,
    });
  }

  async removeInvoice(id: string) {
    const inv = await this.prisma.accountingInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Fatura bulunamadı');
    if (inv.status !== 'PENDING') {
      throw new BadRequestException('Sadece bekleyen (taslak) faturalar silinebilir');
    }
    const cashN = await this.prisma.cashBookEntry.count({ where: { invoiceId: id } });
    if (cashN > 0) {
      throw new BadRequestException('Kasa hareketine bağlı fatura silinemez');
    }
    await this.prisma.accountingInvoice.delete({ where: { id } });
    return { deleted: true };
  }

  async send(id: string, sessionName?: string, templateBody?: string) {
    const inv = await this.findById(id);
    const pdfPath = inv.uploadedPdfUrl || inv.pdfUrl;
    if (!pdfPath) throw new BadRequestException('Gönderilecek PDF yok. Önce fatura PDF yükleyin.');

    const c = inv.contact;

    // Session belirtilmemişse kişiyle konuşan session'ı bul
    if (!sessionName) {
      sessionName = await this.wahaService.getWorkingSessionForContact(c.id) ?? undefined;
    }
    if (!sessionName) {
      throw new BadRequestException('Aktif WhatsApp oturumu bulunamadı. Lütfen Ayarlar > WhatsApp bölümünden oturum açın.');
    }

    const chatId = normalizeWhatsappChatId(`${c.phone.replace(/\D/g, '')}@c.us`);
    const invNo = `FTR-${String(inv.invoiceNumber).padStart(5, '0')}`;
    const text = templateBody
      || `Değerli müşterimiz, faturanız ektedir. (${invNo})`;

    const localPath = join(process.cwd(), pdfPath.replace(/^\//, ''));
    if (!existsSync(localPath)) {
      throw new BadRequestException(`PDF dosyası bulunamadı. Lütfen faturayı tekrar yükleyin. (${pdfPath})`);
    }
    const buf = readFileSync(localPath);
    // WAHA WEBJS engine saf base64 bekliyor, data: prefix olmadan
    const base64Data = buf.toString('base64');

    await this.wahaService.sendFile(sessionName, chatId, {
      mimetype: 'application/pdf',
      data: base64Data,
      filename: `Fatura-${inv.invoiceNumber}.pdf`,
    }, text);

    if (c.email) {
      try {
        await (this.mailService as any).transporter?.sendMail({
          from: `"CRM" <${process.env.SMTP_FROM || 'noreply@crm.com'}>`,
          to: c.email,
          subject: `Fatura #${invNo}`,
          text,
          attachments: [{ filename: `Fatura-${inv.invoiceNumber}.pdf`, path: localPath }],
        });
      } catch (err: any) {
        this.logger.warn(`Fatura e-posta gönderilemedi: ${err.message}`);
      }
    }

    await this.updateStatus(id, AccInvoiceStatus.SENT);
    return { message: 'Fatura gönderildi' };
  }

  // ─── Kasa defteri ───

  async listCashBookEntries(params: { page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 200);
    const [items, total] = await Promise.all([
      this.prisma.cashBookEntry.findMany({
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true } },
          order: { select: { id: true, orderNumber: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
      this.prisma.cashBookEntry.count(),
    ]);
    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  async createCashBookEntry(
    userId: string,
    body: {
      amount: number;
      direction: CashDirection;
      description: string;
      occurredAt?: string;
      orderId?: string;
      invoiceId?: string;
      pdfUrl?: string;
    },
  ) {
    if (!body.description?.trim()) throw new BadRequestException('Açıklama gerekli');
    if (body.amount == null || Number.isNaN(Number(body.amount))) {
      throw new BadRequestException('Geçerli tutar girin');
    }
    return this.prisma.cashBookEntry.create({
      data: {
        userId,
        amount: Number(body.amount),
        direction: body.direction,
        description: String(body.description).trim(),
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        orderId: body.orderId || null,
        invoiceId: body.invoiceId || null,
        pdfUrl: body.pdfUrl?.trim() || null,
      },
      include: {
        user: { select: { id: true, name: true } },
        order: { select: { id: true, orderNumber: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
    });
  }

  // ─── Gelen / giden cari ───

  async listLedgerEntries(params: { page?: number; limit?: number; contactId?: string }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 200);
    const where: Prisma.LedgerEntryWhereInput = {};
    if (params.contactId) where.contactId = params.contactId;
    const [items, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true } },
          contact: {
            select: {
              id: true,
              name: true,
              phone: true,
              company: true,
              address: true,
              billingAddress: true,
              taxOffice: true,
              taxNumber: true,
              identityNumber: true,
            },
          },
        },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  async createLedgerEntry(
    userId: string,
    body: {
      kind: LedgerKind;
      title: string;
      amount: number;
      currency?: string;
      dueDate?: string | null;
      notes?: string | null;
      contactId?: string | null;
      pdfUrl?: string | null;
    },
  ) {
    if (!body.title?.trim()) throw new BadRequestException('Başlık gerekli');
    if (body.amount == null || Number.isNaN(Number(body.amount))) {
      throw new BadRequestException('Geçerli tutar girin');
    }
    return this.prisma.ledgerEntry.create({
      data: {
        userId,
        kind: body.kind,
        title: String(body.title).trim(),
        amount: Number(body.amount),
        currency: body.currency?.trim() || 'TRY',
        dueDate:
          body.dueDate == null || String(body.dueDate).trim() === ''
            ? null
            : new Date(String(body.dueDate)),
        notes: body.notes == null ? null : String(body.notes),
        contactId: body.contactId || null,
        pdfUrl: body.pdfUrl?.trim() || null,
      },
      include: {
        user: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            company: true,
            billingAddress: true,
            address: true,
            taxOffice: true,
            taxNumber: true,
            identityNumber: true,
          },
        },
      },
    });
  }

  // ─── İrsaliye ───

  async listDeliveryNotes(params: { page?: number; limit?: number; orderId?: string }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 200);
    const where: Prisma.DeliveryNoteWhereInput = {};
    if (params.orderId) where.orderId = params.orderId;
    const [items, total] = await Promise.all([
      this.prisma.deliveryNote.findMany({
        where,
        orderBy: { shippedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true } },
          order: {
            select: {
              id: true,
              orderNumber: true,
              shippingAddress: true,
              contact: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  company: true,
                  address: true,
                  billingAddress: true,
                  taxOffice: true,
                  taxNumber: true,
                  identityNumber: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.deliveryNote.count({ where }),
    ]);
    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  async createDeliveryNote(
    userId: string,
    body: { orderId: string; notes?: string | null; shippedAt?: string | null },
  ) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: body.orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    const itemsSnapshot = order.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      vatRate: i.vatRate,
      lineTotal: i.lineTotal,
    }));

    return this.prisma.deliveryNote.create({
      data: {
        orderId: order.id,
        userId,
        notes: body.notes == null ? null : String(body.notes),
        shippedAt:
          body.shippedAt == null || String(body.shippedAt).trim() === ''
            ? new Date()
            : new Date(String(body.shippedAt)),
        itemsSnapshot: itemsSnapshot as object,
      },
      include: {
        user: { select: { id: true, name: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            shippingAddress: true,
            contact: {
              select: {
                id: true,
                name: true,
                phone: true,
                company: true,
                billingAddress: true,
                address: true,
                taxOffice: true,
                taxNumber: true,
                identityNumber: true,
              },
            },
          },
        },
      },
    });
  }

  async uploadDeliveryNotePdf(id: string, pdfUrl: string) {
    const row = await this.prisma.deliveryNote.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('İrsaliye bulunamadı');
    return this.prisma.deliveryNote.update({
      where: { id },
      data: { pdfUrl },
      include: {
        user: { select: { id: true, name: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    });
  }

  /** Muhasebe hub: özet sayılar ve hızlı durum */
  async getDashboardSummary() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      invoiceTotal,
      invoicesByStatus,
      pendingOrdersToBill,
      cashIn30,
      cashOut30,
      ledgerOverdue,
      deliveryNotesRecent,
      invoicesMissingPdf,
    ] = await Promise.all([
      this.prisma.accountingInvoice.count(),
      this.prisma.accountingInvoice.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.salesOrder.count({
        where: {
          status: { in: ['DELIVERED' as any, 'PROCESSING' as any] },
          invoice: null,
        },
      }),
      this.prisma.cashBookEntry.aggregate({
        where: {
          direction: 'INCOME' as any,
          occurredAt: { gte: thirtyDaysAgo },
        },
        _sum: { amount: true },
      }),
      this.prisma.cashBookEntry.aggregate({
        where: {
          direction: 'EXPENSE' as any,
          occurredAt: { gte: thirtyDaysAgo },
        },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.count({
        where: { dueDate: { lt: new Date() } },
      }),
      this.prisma.deliveryNote.count({
        where: { shippedAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.accountingInvoice.count({
        where: {
          status: { not: 'CANCELLED' as any },
          pdfUrl: null,
          uploadedPdfUrl: null,
        },
      }),
    ]);

    const statusMap = Object.fromEntries(
      invoicesByStatus.map((r) => [r.status, r._count.id]),
    );

    return {
      invoiceTotal,
      invoicesByStatus: statusMap,
      pendingOrdersToBill,
      cashLast30Days: {
        in: cashIn30._sum.amount ?? 0,
        out: cashOut30._sum.amount ?? 0,
        net: (cashIn30._sum.amount ?? 0) - (cashOut30._sum.amount ?? 0),
      },
      ledgerEntriesWithOverdueDueDate: ledgerOverdue,
      deliveryNotesShippedLast30Days: deliveryNotesRecent,
      invoicesWithoutPdf: invoicesMissingPdf,
    };
  }
}
