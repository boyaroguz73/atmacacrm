import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import axios from 'axios';

interface PdfSettings {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyTaxOffice: string;
  companyTaxNumber: string;
  companyMersisNo: string;
  logoUrl: string;
  bankInfo: string;
  bank2Info: string;
  terms: string;
  footerNote: string;
  primaryColor: string;
  showSignatureArea: boolean;
  currencySymbolPosition: 'before' | 'after';
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

export interface PdfData {
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
  contactTaxOffice?: string;
  contactTaxNumber?: string;
  items: LineItem[];
  currency: string;
  subtotal: number;
  discountTotal: number;
  vatTotal: number;
  grandTotal: number;
  notes?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = { TRY: 'TL', USD: 'USD', EUR: 'EUR' };

function tr(text: string): string {
  if (!text) return '';
  return text
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C');
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly outDir = join(process.cwd(), 'uploads', 'pdfs');
  private fontPath: string | null = null;
  private fontBoldPath: string | null = null;

  constructor(private prisma: PrismaService) {
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });

    const candidates = [
      { r: join(process.cwd(), 'fonts', 'DejaVuSans.ttf'), b: join(process.cwd(), 'fonts', 'DejaVuSans-Bold.ttf') },
      { r: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', b: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
      { r: '/usr/share/fonts/dejavu/DejaVuSans.ttf', b: '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf' },
    ];
    for (const c of candidates) {
      if (existsSync(c.r)) {
        this.fontPath = c.r;
        this.fontBoldPath = existsSync(c.b) ? c.b : c.r;
        this.logger.log(`PDF font: ${this.fontPath}`);
        break;
      }
    }
    if (!this.fontPath) this.logger.warn('Turkce font bulunamadi, ASCII donusumu kullanilacak');
  }

  private t(text: string): string {
    return this.fontPath ? (text || '') : tr(text || '');
  }

  private async getSettings(): Promise<PdfSettings> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: 'pdf_' } } });
    const m = new Map(rows.map((r) => [r.key, r.value]));
    return {
      companyName: m.get('pdf_company_name') || 'Firma',
      companyAddress: m.get('pdf_company_address') || '',
      companyPhone: m.get('pdf_company_phone') || '',
      companyEmail: m.get('pdf_company_email') || '',
      companyWebsite: m.get('pdf_company_website') || '',
      companyTaxOffice: m.get('pdf_company_tax_office') || '',
      companyTaxNumber: m.get('pdf_company_tax_number') || '',
      companyMersisNo: m.get('pdf_company_mersis_no') || '',
      logoUrl: m.get('pdf_logo_url') || '',
      bankInfo: m.get('pdf_bank_info') || '',
      bank2Info: m.get('pdf_bank2_info') || '',
      terms: m.get('pdf_terms') || '',
      footerNote: m.get('pdf_footer_note') || '',
      primaryColor: m.get('pdf_primary_color') || '#1a7a4a',
      showSignatureArea: m.get('pdf_show_signature') !== 'false',
      currencySymbolPosition: (m.get('pdf_currency_position') as any) || 'after',
    };
  }

  private async fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
    if (!logoUrl) return null;
    try {
      if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
        const resp = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 5000 });
        return Buffer.from(resp.data);
      }
      const localPath = logoUrl.startsWith('/') ? join(process.cwd(), logoUrl.slice(1)) : join(process.cwd(), logoUrl);
      if (existsSync(localPath)) return readFileSync(localPath);
    } catch (err: any) {
      this.logger.warn(`Logo yuklenemedi: ${err.message}`);
    }
    return null;
  }

  async generateQuotePdf(data: PdfData): Promise<string> {
    return this.generateDocument({ ...data, title: data.title || this.t('PROFORMA TEKLIF') });
  }

  async generateInvoicePdf(data: PdfData): Promise<string> {
    return this.generateDocument({ ...data, title: data.title || this.t('FATURA') });
  }

  private async generateDocument(data: PdfData): Promise<string> {
    const settings = await this.getSettings();
    const logoBuffer = await this.fetchLogoBuffer(settings.logoUrl);
    const filename = `${uuid()}.pdf`;
    const filePath = join(this.outDir, filename);
    const cs = CURRENCY_SYMBOLS[data.currency] || data.currency;
    const primary = settings.primaryColor || '#1a7a4a';

    const fmtMoney = (v: number) => {
      const n = v.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
      return settings.currencySymbolPosition === 'before' ? `${cs} ${n}` : `${n} ${cs}`;
    };

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const done = (err?: any) => {
        if (settled) return;
        settled = true;
        if (err) reject(err); else resolve(`/uploads/pdfs/${filename}`);
      };

      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
        const stream = createWriteStream(filePath);
        doc.pipe(stream);
        stream.on('finish', () => done());
        stream.on('error', done);
        doc.on('error', done);

        // ── Font setup ──────────────────────────────────────────────────
        if (this.fontPath) {
          doc.registerFont('R', this.fontPath);
          doc.registerFont('B', this.fontBoldPath!);
        }
        const R = () => doc.font(this.fontPath ? 'R' : 'Helvetica');
        const B = () => doc.font(this.fontPath ? 'B' : 'Helvetica-Bold');

        // ── Helper: draw text at absolute position, no cursor side effects ──
        const txt = (
          text: string, x: number, y: number,
          opts: { width?: number; align?: string; size?: number; color?: string; bold?: boolean } = {},
        ) => {
          if (opts.bold) B(); else R();
          if (opts.size) doc.fontSize(opts.size);
          doc.fillColor(opts.color || '#333333');
          doc.text(text, x, y, {
            width: opts.width,
            align: (opts.align as any) || 'left',
            lineBreak: false,
          });
        };

        const ML = 40; // margin left
        const MR = 40; // margin right
        const PW = doc.page.width - ML - MR; // 515
        const PAGE_H = doc.page.height; // 841.89

        // ── HEADER BOX ──────────────────────────────────────────────────
        // Colored top bar
        doc.rect(0, 0, doc.page.width, 8).fill(primary);

        let logoW = 0;
        if (logoBuffer) {
          try {
            doc.image(logoBuffer, ML, 18, { height: 48, fit: [150, 48] });
            logoW = 160;
          } catch { /* skip */ }
        }

        // Company info (right of logo)
        const firmX = ML + logoW + (logoW ? 10 : 0);
        let cy = 15;
        txt(this.t(settings.companyName), firmX, cy, { size: 12, bold: true, color: primary });
        cy += 15;
        if (settings.companyAddress) { txt(this.t(settings.companyAddress), firmX, cy, { size: 7.5, color: '#555' }); cy += 10; }
        if (settings.companyPhone)   { txt(`Tel: ${settings.companyPhone}`, firmX, cy, { size: 7.5, color: '#555' }); cy += 10; }
        if (settings.companyEmail)   { txt(`E-posta: ${settings.companyEmail}`, firmX, cy, { size: 7.5, color: '#555' }); cy += 10; }
        if (settings.companyWebsite) { txt(settings.companyWebsite, firmX, cy, { size: 7.5, color: '#555' }); cy += 10; }
        if (settings.companyTaxOffice || settings.companyTaxNumber) {
          txt(`VD: ${this.t(settings.companyTaxOffice)}  VN: ${settings.companyTaxNumber}`, firmX, cy, { size: 7.5, color: '#555' }); cy += 10;
        }
        if (settings.companyMersisNo) { txt(`Mersis: ${settings.companyMersisNo}`, firmX, cy, { size: 7.5, color: '#555' }); cy += 10; }

        // Document title box (right side)
        const titleBoxX = doc.page.width - MR - 170;
        doc.rect(titleBoxX, 12, 170, 60).fill('#f5f5f5');
        txt(this.t(data.title), titleBoxX + 8, 18, { size: 14, bold: true, color: primary, width: 154 });
        let ry2 = 38;
        txt(`No: ${data.documentNumber}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: 154 }); ry2 += 11;
        txt(`Tarih: ${data.date}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: 154 }); ry2 += 11;
        if (data.validUntil)   { txt(`Gecerlilik: ${data.validUntil}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: 154 }); ry2 += 11; }
        if (data.deliveryDate) { txt(`Teslim: ${data.deliveryDate}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: 154 }); ry2 += 11; }
        if (data.dueDate)      { txt(`Vade: ${data.dueDate}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: 154 }); }

        // ── DIVIDER ─────────────────────────────────────────────────────
        const headerBottom = Math.max(cy, 80) + 8;
        doc.moveTo(ML, headerBottom).lineTo(ML + PW, headerBottom).lineWidth(1).strokeColor(primary).stroke();

        // ── CUSTOMER INFO ────────────────────────────────────────────────
        let startY = headerBottom + 8;
        txt(this.t('MUSTERI BILGILERI'), ML, startY, { size: 8, bold: true, color: primary });
        startY += 13;
        txt(this.t(data.contactName), ML, startY, { size: 9, bold: true });
        startY += 13;
        if (data.contactCompany) { txt(this.t(data.contactCompany), ML, startY, { size: 8 }); startY += 11; }
        if (data.contactPhone)   { txt(`Tel: ${data.contactPhone}`, ML, startY, { size: 8 }); startY += 11; }
        if (data.contactEmail)   { txt(`E: ${data.contactEmail}`, ML, startY, { size: 8 }); startY += 11; }
        if (data.contactTaxOffice || data.contactTaxNumber) {
          txt(`VD: ${this.t(data.contactTaxOffice || '')}  VN: ${data.contactTaxNumber || ''}`, ML, startY, { size: 8 }); startY += 11;
        }

        // ── TABLE ────────────────────────────────────────────────────────
        const tableY = startY + 10;
        const ROW_H = 20;
        const HEADER_H = 18;

        const cols = [
          { label: '#',                          w: 22  },
          { label: this.t('Urun / Hizmet'),      w: 182 },
          { label: this.t('Miktar'),             w: 45  },
          { label: `${this.t('B.Fiyat')} (${cs})`, w: 78 },
          { label: 'KDV%',                       w: 38  },
          { label: this.t('Indirim'),            w: 52  },
          { label: `${this.t('Toplam')} (${cs})`, w: PW - 417 },
        ];

        // Header row
        doc.rect(ML, tableY, PW, HEADER_H).fill(primary);
        let colX = ML;
        cols.forEach((col) => {
          txt(col.label, colX + 3, tableY + 5, { size: 7.5, bold: true, color: '#ffffff', width: col.w - 6 });
          colX += col.w;
        });

        // Data rows
        let rowY = tableY + HEADER_H;
        data.items.forEach((item, idx) => {
          // Sayfa taşması
          if (rowY + ROW_H > PAGE_H - 120) {
            doc.addPage({ margin: 0 });
            doc.rect(0, 0, doc.page.width, 8).fill(primary);
            rowY = 30;
          }
          // Zebra
          if (idx % 2 === 1) {
            doc.rect(ML, rowY, PW, ROW_H).fill('#f9f9f9');
          }
          let rx = ML;
          R(); doc.fontSize(8).fillColor('#333');
          doc.text(String(idx + 1), rx + 3, rowY + 6, { width: cols[0].w - 6, align: 'center', lineBreak: false }); rx += cols[0].w;
          // Ürün adı + açıklama
          const hasDesc = !!(item.description);
          txt(this.t(item.name), rx + 3, rowY + (hasDesc ? 3 : 6), { size: 8, width: cols[1].w - 6 });
          if (hasDesc) txt(this.t(item.description!), rx + 3, rowY + 13, { size: 7, color: '#777', width: cols[1].w - 6 });
          rx += cols[1].w;
          const itemH = hasDesc ? 24 : ROW_H;
          txt(String(item.quantity), rx + 3, rowY + 6, { size: 8, width: cols[2].w - 6, align: 'right' }); rx += cols[2].w;
          txt(item.unitPrice.toFixed(2), rx + 3, rowY + 6, { size: 8, width: cols[3].w - 6, align: 'right' }); rx += cols[3].w;
          txt(`%${item.vatRate}`, rx + 3, rowY + 6, { size: 8, width: cols[4].w - 6, align: 'right' }); rx += cols[4].w;
          txt(item.discountText ? this.t(item.discountText) : '-', rx + 3, rowY + 6, { size: 8, width: cols[5].w - 6, align: 'right' }); rx += cols[5].w;
          txt(item.lineTotal.toFixed(2), rx + 3, rowY + 6, { size: 8, width: cols[6].w - 6, align: 'right' });
          rowY += itemH;
        });

        // Table bottom line
        doc.moveTo(ML, rowY).lineTo(ML + PW, rowY).lineWidth(0.5).strokeColor('#cccccc').stroke();
        rowY += 12;

        // ── SUMMARY ──────────────────────────────────────────────────────
        const sumX = ML + PW - 220;
        const lblW = 110;
        const valW = 110;

        const sumRow = (label: string, value: string, y: number, bold = false, color = '#333333') => {
          txt(label, sumX, y, { size: 9, bold, color, width: lblW });
          txt(value, sumX + lblW, y, { size: 9, bold, color, width: valW, align: 'right' });
        };

        sumRow(this.t('Ara Toplam:'), fmtMoney(data.subtotal), rowY); rowY += 14;
        if (data.discountTotal > 0) {
          sumRow(this.t('Indirim:'), `-${fmtMoney(data.discountTotal)}`, rowY, false, '#cc0000'); rowY += 14;
        }
        sumRow(this.t('KDV Toplam:'), fmtMoney(data.vatTotal), rowY); rowY += 14;

        // Grand total box
        doc.rect(sumX - 4, rowY - 2, lblW + valW + 8, 22).fill(primary);
        sumRow(this.t('GENEL TOPLAM:'), fmtMoney(data.grandTotal), rowY + 5, true, '#ffffff');
        rowY += 32;

        // ── NOTES / TERMS / BANK ─────────────────────────────────────────
        rowY += 6;
        if (data.notes) {
          txt(this.t('Notlar:'), ML, rowY, { size: 8.5, bold: true }); rowY += 12;
          R(); doc.fontSize(8).fillColor('#444');
          doc.text(this.t(data.notes), ML, rowY, { width: PW, lineBreak: true }); rowY += doc.currentLineHeight(true) + 14;
        }
        if (settings.terms) {
          txt(this.t('Odeme Kosullari:'), ML, rowY, { size: 8.5, bold: true }); rowY += 12;
          R(); doc.fontSize(8).fillColor('#444');
          doc.text(this.t(settings.terms), ML, rowY, { width: PW, lineBreak: true }); rowY += doc.currentLineHeight(true) + 14;
        }
        if (settings.bankInfo || settings.bank2Info) {
          txt(this.t('Banka Bilgileri:'), ML, rowY, { size: 8.5, bold: true }); rowY += 12;
          const halfW = (PW - 10) / 2;
          R(); doc.fontSize(8).fillColor('#444');
          if (settings.bankInfo)  { doc.text(this.t(settings.bankInfo),  ML,           rowY, { width: halfW, lineBreak: true }); }
          if (settings.bank2Info) { doc.text(this.t(settings.bank2Info), ML + halfW + 10, rowY, { width: halfW, lineBreak: true }); }
          rowY += 36;
        }

        // ── SIGNATURE ────────────────────────────────────────────────────
        if (settings.showSignatureArea) {
          const sigY = Math.max(rowY + 10, PAGE_H - 100);
          if (sigY < PAGE_H - 30) {
            doc.moveTo(ML, sigY).lineTo(ML + 150, sigY).lineWidth(0.4).strokeColor('#aaaaaa').stroke();
            txt(this.t('Yetkili Imza / Kase'), ML, sigY + 4, { size: 8, color: '#666' });
            doc.moveTo(ML + PW - 150, sigY).lineTo(ML + PW, sigY).lineWidth(0.4).strokeColor('#aaaaaa').stroke();
            txt(this.t('Musteri Imza / Kase'), ML + PW - 150, sigY + 4, { size: 8, color: '#666' });
          }
        }

        // ── FOOTER ───────────────────────────────────────────────────────
        const footerY = PAGE_H - 20;
        doc.moveTo(ML, footerY - 8).lineTo(ML + PW, footerY - 8).lineWidth(0.3).strokeColor('#dddddd').stroke();
        R(); doc.fontSize(7).fillColor('#aaaaaa');
        if (settings.footerNote) {
          doc.text(this.t(settings.footerNote), ML, footerY - 4, { width: PW - 60, align: 'left', lineBreak: false });
        }
        doc.text(`Sayfa 1`, ML, footerY - 4, { width: PW, align: 'right', lineBreak: false });

        doc.end();
      } catch (err: any) {
        this.logger.error(`PDF olusturma hatasi: ${err.message}`, err.stack);
        done(err);
      }
    });
  }
}
