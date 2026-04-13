import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import { WahaService } from '../waha/waha.service';
import { MailService } from '../mail/mail.service';
import { AccInvoiceStatus } from '@prisma/client';
import { join } from 'path';
import { readFileSync } from 'fs';
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
    contact: { select: { id: true, name: true, surname: true, phone: true, email: true, company: true } },
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
          contact: { select: { id: true, name: true, phone: true, company: true } },
          items: true,
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

    return this.prisma.accountingInvoice.create({
      data: {
        orderId,
        contactId: order.contactId,
        createdById: userId,
        currency: order.currency,
        subtotal: order.subtotal,
        vatTotal: order.vatTotal,
        grandTotal: order.grandTotal,
        dueDate: dueDate ? new Date(dueDate) : null,
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
    await this.findById(id);
    const data: any = { status };
    if (status === 'PAID') data.paidAt = new Date();
    return this.prisma.accountingInvoice.update({
      where: { id },
      data,
      include: this.includeRelations,
    });
  }

  async uploadPdf(id: string, pdfUrl: string) {
    await this.findById(id);
    return this.prisma.accountingInvoice.update({
      where: { id },
      data: { uploadedPdfUrl: pdfUrl },
      include: this.includeRelations,
    });
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
      || `Sayin ${c.name || 'Musteri'}, ${invNo} numarali faturaniz ektedir.`;

    const localPath = join(process.cwd(), pdfPath.replace(/^\//, ''));
    const buf = readFileSync(localPath);
    const base64Data = `data:application/pdf;base64,${buf.toString('base64')}`;

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
}
