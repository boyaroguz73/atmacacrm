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
  showStamp: boolean;
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

// Türkçe karakter dönüşüm tablosu (PDFKit built-in font için)
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

  constructor(private prisma: PrismaService) {
    if (!existsSync(this.outDir)) mkdirSync(this.outDir, { recursive: true });
    // DejaVu font varsa kullan (Türkçe tam destek)
    const candidates = [
      join(process.cwd(), 'fonts', 'DejaVuSans.ttf'),
      join(process.cwd(), 'fonts', 'NotoSans-Regular.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    ];
    for (const p of candidates) {
      if (existsSync(p)) { this.fontPath = p; break; }
    }
    if (this.fontPath) {
      this.logger.log(`PDF font: ${this.fontPath}`);
    } else {
      this.logger.warn('Türkçe font bulunamadı, ASCII dönüşümü kullanılacak');
    }
  }

  private async getSettings(): Promise<PdfSettings> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'pdf_' } },
    });
    const m = new Map(rows.map((r) => [r.key, r.value]));
    return {
      companyName: m.get('pdf_company_name') || 'Firma Adi',
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
      showStamp: m.get('pdf_show_stamp') !== 'false',
      currencySymbolPosition: (m.get('pdf_currency_position') as any) || 'after',
    };
  }

  private t(text: string): string {
    return this.fontPath ? text : tr(text);
  }

  private async fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
    if (!logoUrl) return null;
    try {
      if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
        const resp = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 5000 });
        return Buffer.from(resp.data);
      } else {
        // Local path
        const localPath = logoUrl.startsWith('/') ? join(process.cwd(), logoUrl.slice(1)) : join(process.cwd(), logoUrl);
        if (existsSync(localPath)) return readFileSync(localPath);
      }
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

    const fmtMoney = (v: number) =>
      settings.currencySymbolPosition === 'before'
        ? `${cs} ${v.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
        : `${v.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${cs}`;

    const primaryColor = settings.primaryColor || '#1a7a4a';

    return new Promise<string>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const stream = createWriteStream(filePath);
      doc.pipe(stream);

      // Font kayıt
      if (this.fontPath) {
        doc.registerFont('Regular', this.fontPath);
        // Bold için aynı fontu kullan (fallback)
        const boldPath = this.fontPath.replace('Regular', 'Bold').replace('.ttf', 'Bold.ttf');
        if (existsSync(boldPath)) {
          doc.registerFont('Bold', boldPath);
        } else {
          doc.registerFont('Bold', this.fontPath);
        }
      }

      const useFont = (bold = false) => {
        if (this.fontPath) {
          doc.font(bold ? 'Bold' : 'Regular');
        } else {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
        }
      };

      const pw = doc.page.width - 80; // usable width

      // ── HEADER ──────────────────────────────────────────────────────────
      let headerRightX = 40;
      let headerBottomY = 40;

      // Logo
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, 40, 35, { height: 50, fit: [160, 50] });
          headerRightX = 220;
        } catch {
          // logo yüklenemedi
        }
      }

      // Firma bilgileri (logo yoksa solda, varsa logonun yanında)
      const firmX = logoBuffer ? headerRightX : 40;
      useFont(true);
      doc.fontSize(13).fillColor(primaryColor).text(this.t(settings.companyName), firmX, 38);
      useFont(false);
      doc.fontSize(8).fillColor('#444444');
      let cy = 55;
      if (settings.companyAddress) { doc.text(this.t(settings.companyAddress), firmX, cy, { width: 200 }); cy += 10; }
      if (settings.companyPhone) { doc.text(`Tel: ${settings.companyPhone}`, firmX, cy); cy += 10; }
      if (settings.companyEmail) { doc.text(`E: ${settings.companyEmail}`, firmX, cy); cy += 10; }
      if (settings.companyWebsite) { doc.text(settings.companyWebsite, firmX, cy); cy += 10; }
      if (settings.companyTaxOffice || settings.companyTaxNumber) {
        doc.text(`VD: ${this.t(settings.companyTaxOffice)}  VN: ${settings.companyTaxNumber}`, firmX, cy); cy += 10;
      }
      if (settings.companyMersisNo) { doc.text(`Mersis: ${settings.companyMersisNo}`, firmX, cy); cy += 10; }
      headerBottomY = Math.max(cy, 90);

      // Belge başlığı (sağ üst)
      useFont(true);
      doc.fontSize(16).fillColor(primaryColor).text(this.t(data.title), 350, 38, { width: pw - 310, align: 'right' });
      useFont(false);
      doc.fontSize(9).fillColor('#333333');
      let ry2 = 60;
      doc.text(`${this.t('No')}: ${data.documentNumber}`, 350, ry2, { width: pw - 310, align: 'right' }); ry2 += 12;
      doc.text(`${this.t('Tarih')}: ${data.date}`, 350, ry2, { width: pw - 310, align: 'right' }); ry2 += 12;
      if (data.validUntil) { doc.text(`${this.t('Gecerlilik')}: ${data.validUntil}`, 350, ry2, { width: pw - 310, align: 'right' }); ry2 += 12; }
      if (data.deliveryDate) { doc.text(`${this.t('Teslim')}: ${data.deliveryDate}`, 350, ry2, { width: pw - 310, align: 'right' }); ry2 += 12; }
      if (data.dueDate) { doc.text(`${this.t('Vade')}: ${data.dueDate}`, 350, ry2, { width: pw - 310, align: 'right' }); ry2 += 12; }

      // ── AYRAÇ ───────────────────────────────────────────────────────────
      const divY = headerBottomY + 8;
      doc.moveTo(40, divY).lineTo(40 + pw, divY).lineWidth(1).strokeColor(primaryColor).stroke();

      // ── MÜŞTERİ BİLGİLERİ ───────────────────────────────────────────────
      const clientY = divY + 8;
      useFont(true);
      doc.fontSize(9).fillColor(primaryColor).text(this.t('MUSTERI BILGILERI'), 40, clientY);
      useFont(false);
      doc.fillColor('#333333');
      let ccy = clientY + 14;
      doc.fontSize(9);
      useFont(true);
      doc.text(this.t(data.contactName), 40, ccy); ccy += 12;
      useFont(false);
      if (data.contactCompany) { doc.text(this.t(data.contactCompany), 40, ccy); ccy += 12; }
      if (data.contactPhone) { doc.text(`Tel: ${data.contactPhone}`, 40, ccy); ccy += 12; }
      if (data.contactEmail) { doc.text(`E: ${data.contactEmail}`, 40, ccy); ccy += 12; }
      if (data.contactAddress) { doc.text(this.t(data.contactAddress), 40, ccy, { width: 250 }); ccy += 12; }
      if (data.contactTaxOffice || data.contactTaxNumber) {
        doc.text(`VD: ${this.t(data.contactTaxOffice || '')}  VN: ${data.contactTaxNumber || ''}`, 40, ccy); ccy += 12;
      }

      // ── ÜRÜN TABLOSU ────────────────────────────────────────────────────
      const tableY = ccy + 10;
      // Tablo başlık arka planı
      doc.rect(40, tableY, pw, 18).fill(primaryColor);

      const cols = [
        { label: '#', w: 22, align: 'center' as const },
        { label: this.t('Urun / Hizmet'), w: 185, align: 'left' as const },
        { label: this.t('Miktar'), w: 45, align: 'right' as const },
        { label: `${this.t('Birim Fiyat')} (${cs})`, w: 80, align: 'right' as const },
        { label: 'KDV %', w: 40, align: 'right' as const },
        { label: this.t('Indirim'), w: 55, align: 'right' as const },
        { label: `${this.t('Toplam')} (${cs})`, w: pw - 427, align: 'right' as const },
      ];

      useFont(true);
      doc.fontSize(8).fillColor('#ffffff');
      let cx = 40;
      for (const col of cols) {
        doc.text(col.label, cx + 3, tableY + 5, { width: col.w - 6, align: col.align });
        cx += col.w;
      }

      useFont(false);
      doc.fillColor('#333333');
      let ry = tableY + 22;
      data.items.forEach((item, idx) => {
        if (ry > 700) { doc.addPage(); ry = 40; }
        // Zebra satır
        if (idx % 2 === 0) {
          doc.rect(40, ry - 2, pw, 18).fill('#f7f7f7');
        }
        doc.fillColor('#333333');
        let rx = 40;
        doc.fontSize(8);
        doc.text(String(idx + 1), rx + 3, ry, { width: cols[0].w - 6, align: 'center' }); rx += cols[0].w;
        const nameBlock = item.description ? `${this.t(item.name)}\n${this.t(item.description)}` : this.t(item.name);
        doc.text(nameBlock, rx + 3, ry, { width: cols[1].w - 6 }); rx += cols[1].w;
        doc.text(String(item.quantity), rx + 3, ry, { width: cols[2].w - 6, align: 'right' }); rx += cols[2].w;
        doc.text(item.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 }), rx + 3, ry, { width: cols[3].w - 6, align: 'right' }); rx += cols[3].w;
        doc.text(`%${item.vatRate}`, rx + 3, ry, { width: cols[4].w - 6, align: 'right' }); rx += cols[4].w;
        doc.text(item.discountText ? this.t(item.discountText) : '-', rx + 3, ry, { width: cols[5].w - 6, align: 'right' }); rx += cols[5].w;
        doc.text(item.lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 }), rx + 3, ry, { width: cols[6].w - 6, align: 'right' });
        ry += item.description ? 26 : 18;
      });

      // Tablo alt çizgisi
      doc.moveTo(40, ry).lineTo(40 + pw, ry).lineWidth(0.5).strokeColor('#cccccc').stroke();
      ry += 10;

      // ── ÖZET ────────────────────────────────────────────────────────────
      const summaryX = 350;
      const valX = 460;
      const valW = pw - (valX - 40);
      useFont(false);
      doc.fontSize(9).fillColor('#555555');
      doc.text(this.t('Ara Toplam:'), summaryX, ry);
      doc.text(fmtMoney(data.subtotal), valX, ry, { width: valW, align: 'right' }); ry += 14;
      if (data.discountTotal > 0) {
        doc.fillColor('#cc0000');
        doc.text(this.t('Indirim:'), summaryX, ry);
        doc.text(`-${fmtMoney(data.discountTotal)}`, valX, ry, { width: valW, align: 'right' });
        doc.fillColor('#555555'); ry += 14;
      }
      doc.text(this.t('KDV Toplam:'), summaryX, ry);
      doc.text(fmtMoney(data.vatTotal), valX, ry, { width: valW, align: 'right' }); ry += 14;

      // Genel toplam kutusu
      doc.rect(summaryX - 5, ry - 2, pw - (summaryX - 45), 20).fill(primaryColor);
      useFont(true);
      doc.fontSize(11).fillColor('#ffffff');
      doc.text(this.t('GENEL TOPLAM:'), summaryX, ry + 2);
      doc.text(fmtMoney(data.grandTotal), valX, ry + 2, { width: valW, align: 'right' });
      ry += 28;

      // ── NOTLAR / KOŞULLAR / BANKA ────────────────────────────────────────
      useFont(false);
      doc.fillColor('#333333');
      if (data.notes) {
        ry += 4;
        useFont(true); doc.fontSize(9).text(this.t('Notlar:'), 40, ry); ry += 12;
        useFont(false); doc.fontSize(8).text(this.t(data.notes), 40, ry, { width: pw }); ry += 20;
      }
      if (settings.terms) {
        useFont(true); doc.fontSize(9).text(this.t('Odeme Kosullari:'), 40, ry); ry += 12;
        useFont(false); doc.fontSize(8).text(this.t(settings.terms), 40, ry, { width: pw }); ry += 20;
      }
      if (settings.bankInfo || settings.bank2Info) {
        useFont(true); doc.fontSize(9).text(this.t('Banka Bilgileri:'), 40, ry); ry += 12;
        useFont(false); doc.fontSize(8);
        if (settings.bankInfo) { doc.text(this.t(settings.bankInfo), 40, ry, { width: pw / 2 - 10 }); }
        if (settings.bank2Info) { doc.text(this.t(settings.bank2Info), 40 + pw / 2, ry, { width: pw / 2 }); }
        ry += 30;
      }

      // ── İMZA ALANI ───────────────────────────────────────────────────────
      if (settings.showSignatureArea && ry < 700) {
        const sigY = Math.max(ry + 10, 700);
        doc.moveTo(40, sigY).lineTo(200, sigY).lineWidth(0.5).strokeColor('#aaaaaa').stroke();
        useFont(false); doc.fontSize(8).fillColor('#666666').text(this.t('Yetkili Imza / Kase'), 40, sigY + 4);
        doc.moveTo(360, sigY).lineTo(40 + pw, sigY).lineWidth(0.5).strokeColor('#aaaaaa').stroke();
        doc.text(this.t('Musteri Imza / Kase'), 360, sigY + 4);
      }

      // ── FOOTER ───────────────────────────────────────────────────────────
      const footerY = doc.page.height - 40;
      doc.moveTo(40, footerY - 8).lineTo(40 + pw, footerY - 8).lineWidth(0.3).strokeColor('#dddddd').stroke();
      useFont(false);
      doc.fontSize(7).fillColor('#999999');
      if (settings.footerNote) {
        doc.text(this.t(settings.footerNote), 40, footerY - 4, { width: pw, align: 'center' });
      }
      // Sayfa numarası
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor('#aaaaaa').text(
          `${i + 1} / ${pages.count}`,
          40, doc.page.height - 20, { width: pw, align: 'right' },
        );
      }

      doc.end();
      stream.on('finish', () => resolve(`/uploads/pdfs/${filename}`));
      stream.on('error', (err) => reject(err));
      doc.on('error', (err: any) => reject(err));
    });
  }
}
