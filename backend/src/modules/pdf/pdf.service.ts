import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';

interface PdfSettings {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyTaxOffice: string;
  companyTaxNumber: string;
  logoUrl: string;
  bankInfo: string;
  terms: string;
  footerNote: string;
}

interface LineItem {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountText?: string;
  lineTotal: number;
}

interface PdfData {
  title: string;
  documentNumber: string;
  date: string;
  validUntil?: string;
  deliveryDate?: string;
  dueDate?: string;
  contactName: string;
  contactCompany?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactAddress?: string;
  items: LineItem[];
  currency: string;
  subtotal: number;
  discountTotal: number;
  vatTotal: number;
  grandTotal: number;
  notes?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly outDir = join(process.cwd(), 'uploads', 'pdfs');

  constructor(private prisma: PrismaService) {
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
  }

  private async getSettings(): Promise<PdfSettings> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'pdf_' } },
    });
    const m = new Map(rows.map((r) => [r.key, r.value]));
    return {
      companyName: m.get('pdf_company_name') || 'Firma Adı',
      companyAddress: m.get('pdf_company_address') || '',
      companyPhone: m.get('pdf_company_phone') || '',
      companyEmail: m.get('pdf_company_email') || '',
      companyTaxOffice: m.get('pdf_company_tax_office') || '',
      companyTaxNumber: m.get('pdf_company_tax_number') || '',
      logoUrl: m.get('pdf_logo_url') || '',
      bankInfo: m.get('pdf_bank_info') || '',
      terms: m.get('pdf_terms') || '',
      footerNote: m.get('pdf_footer_note') || '',
    };
  }

  async generateQuotePdf(data: PdfData): Promise<string> {
    return this.generateDocument({ ...data, title: data.title || 'PROFORMA TEKLİF' });
  }

  async generateInvoicePdf(data: PdfData): Promise<string> {
    return this.generateDocument({ ...data, title: data.title || 'FATURA' });
  }

  private async generateDocument(data: PdfData): Promise<string> {
    const settings = await this.getSettings();
    const filename = `${uuid()}.pdf`;
    const filePath = join(this.outDir, filename);
    const cs = CURRENCY_SYMBOLS[data.currency] || data.currency;

    return new Promise<string>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = createWriteStream(filePath);
      doc.pipe(stream);

      const pw = doc.page.width - 80;

      doc.fontSize(18).font('Helvetica-Bold').text(settings.companyName, 40, 40);
      doc.fontSize(8).font('Helvetica');
      let cy = 62;
      if (settings.companyAddress) { doc.text(settings.companyAddress, 40, cy); cy += 12; }
      if (settings.companyPhone) { doc.text(`Tel: ${settings.companyPhone}`, 40, cy); cy += 12; }
      if (settings.companyEmail) { doc.text(`E-posta: ${settings.companyEmail}`, 40, cy); cy += 12; }
      if (settings.companyTaxOffice || settings.companyTaxNumber) {
        doc.text(`VD: ${settings.companyTaxOffice}  VN: ${settings.companyTaxNumber}`, 40, cy);
        cy += 12;
      }

      doc.fontSize(14).font('Helvetica-Bold').text(data.title, 350, 40, { width: pw - 310, align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.documentNumber}`, 350, 58, { width: pw - 310, align: 'right' });
      doc.text(`Tarih: ${data.date}`, 350, 70, { width: pw - 310, align: 'right' });
      if (data.validUntil) doc.text(`Geçerlilik: ${data.validUntil}`, 350, 82, { width: pw - 310, align: 'right' });
      if (data.deliveryDate) doc.text(`Teslim: ${data.deliveryDate}`, 350, 94, { width: pw - 310, align: 'right' });
      if (data.dueDate) doc.text(`Vade: ${data.dueDate}`, 350, 94, { width: pw - 310, align: 'right' });

      const clientY = Math.max(cy + 10, 110);
      doc.moveTo(40, clientY).lineTo(40 + pw, clientY).lineWidth(0.5).stroke('#cccccc');

      doc.fontSize(10).font('Helvetica-Bold').text('Müşteri Bilgileri', 40, clientY + 8);
      doc.fontSize(9).font('Helvetica');
      let ccy = clientY + 22;
      doc.text(data.contactName, 40, ccy); ccy += 12;
      if (data.contactCompany) { doc.text(data.contactCompany, 40, ccy); ccy += 12; }
      if (data.contactPhone) { doc.text(`Tel: ${data.contactPhone}`, 40, ccy); ccy += 12; }
      if (data.contactEmail) { doc.text(`E-posta: ${data.contactEmail}`, 40, ccy); ccy += 12; }
      if (data.contactAddress) { doc.text(data.contactAddress, 40, ccy); ccy += 12; }

      const tableY = ccy + 14;
      doc.moveTo(40, tableY).lineTo(40 + pw, tableY).lineWidth(0.5).stroke('#cccccc');

      const cols = [
        { label: '#', w: 25 },
        { label: 'Ürün / Hizmet', w: 190 },
        { label: 'Miktar', w: 50 },
        { label: `Birim Fiyat (${cs})`, w: 80 },
        { label: 'KDV %', w: 45 },
        { label: 'İndirim', w: 55 },
        { label: `Toplam (${cs})`, w: pw - 445 },
      ];

      doc.fontSize(8).font('Helvetica-Bold');
      let cx = 40;
      const headerY = tableY + 6;
      for (const col of cols) {
        doc.text(col.label, cx, headerY, { width: col.w, align: col.label === '#' ? 'center' : 'left' });
        cx += col.w;
      }

      doc.moveTo(40, headerY + 14).lineTo(40 + pw, headerY + 14).lineWidth(0.3).stroke('#dddddd');

      doc.font('Helvetica').fontSize(8);
      let ry = headerY + 18;
      data.items.forEach((item, idx) => {
        if (ry > 720) { doc.addPage(); ry = 40; }
        let rx = 40;
        doc.text(String(idx + 1), rx, ry, { width: cols[0].w, align: 'center' }); rx += cols[0].w;
        const nameBlock = item.description ? `${item.name}\n${item.description}` : item.name;
        doc.text(nameBlock, rx, ry, { width: cols[1].w }); rx += cols[1].w;
        doc.text(String(item.quantity), rx, ry, { width: cols[2].w }); rx += cols[2].w;
        doc.text(item.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 }), rx, ry, { width: cols[3].w }); rx += cols[3].w;
        doc.text(`%${item.vatRate}`, rx, ry, { width: cols[4].w }); rx += cols[4].w;
        doc.text(item.discountText || '-', rx, ry, { width: cols[5].w }); rx += cols[5].w;
        doc.text(item.lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 }), rx, ry, { width: cols[6].w, align: 'right' });
        ry += item.description ? 26 : 16;
      });

      ry += 8;
      doc.moveTo(40, ry).lineTo(40 + pw, ry).lineWidth(0.5).stroke('#cccccc');
      ry += 8;

      const fmt = (v: number) => `${cs} ${v.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
      const summaryX = 350;
      const valX = 460;
      doc.fontSize(9).font('Helvetica');
      doc.text('Ara Toplam:', summaryX, ry); doc.text(fmt(data.subtotal), valX, ry, { width: pw - valX + 40, align: 'right' }); ry += 14;
      if (data.discountTotal > 0) {
        doc.text('İndirim:', summaryX, ry); doc.text(`-${fmt(data.discountTotal)}`, valX, ry, { width: pw - valX + 40, align: 'right' }); ry += 14;
      }
      doc.text('KDV Toplam:', summaryX, ry); doc.text(fmt(data.vatTotal), valX, ry, { width: pw - valX + 40, align: 'right' }); ry += 14;
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text('GENEL TOPLAM:', summaryX, ry); doc.text(fmt(data.grandTotal), valX, ry, { width: pw - valX + 40, align: 'right' }); ry += 20;

      doc.font('Helvetica').fontSize(8);
      if (data.notes) {
        ry += 4;
        doc.font('Helvetica-Bold').text('Notlar:', 40, ry); ry += 12;
        doc.font('Helvetica').text(data.notes, 40, ry, { width: pw }); ry += 20;
      }
      if (settings.terms) {
        doc.font('Helvetica-Bold').text('Ödeme Koşulları:', 40, ry); ry += 12;
        doc.font('Helvetica').text(settings.terms, 40, ry, { width: pw }); ry += 20;
      }
      if (settings.bankInfo) {
        doc.font('Helvetica-Bold').text('Banka Bilgileri:', 40, ry); ry += 12;
        doc.font('Helvetica').text(settings.bankInfo, 40, ry, { width: pw }); ry += 20;
      }

      if (ry < 700) {
        const sigY = 700;
        doc.moveTo(40, sigY).lineTo(200, sigY).lineWidth(0.3).stroke('#cccccc');
        doc.text('Yetkili İmza / Kaşe', 40, sigY + 4);
        doc.moveTo(350, sigY).lineTo(40 + pw, sigY).lineWidth(0.3).stroke('#cccccc');
        doc.text('Müşteri İmza / Kaşe', 350, sigY + 4);
      }

      if (settings.footerNote) {
        doc.fontSize(7).text(settings.footerNote, 40, 780, { width: pw, align: 'center' });
      }

      doc.end();
      stream.on('finish', () => resolve(`/uploads/pdfs/${filename}`));
      stream.on('error', reject);
    });
  }
}
