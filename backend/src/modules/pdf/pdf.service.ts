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
  /** Banka QR (FAST/EFT); PDF’te banka metinleriyle hizalı sağ alt */
  bankQrUrl: string;
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
  /** Renk/kumaş · ölçü (satır altı) */
  lineDetail?: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountText?: string;
  lineTotal: number;
  /** Uzak ürün görseli; PDF oluşturulurken küçük önizleme için indirilir */
  imageUrl?: string;
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
  /** TC Kimlik No (şahıs / fatura) */
  contactIdentityNumber?: string;
  items: LineItem[];
  currency: string;
  subtotal: number;
  discountTotal: number;
  vatTotal: number;
  grandTotal: number;
  notes?: string;
  termsOverride?: string;
  footerNoteOverride?: string;
  /** order_form: kalem satırları çizgisiz yumuşak bloklar */
  layout?: 'default' | 'order_form';
  /** Belgeyi oluşturan temsilci adı */
  createdByName?: string;
}

/** Teklif → sipariş onay formu (tablo çizgileri yumuşak, kurumsal düzen) */
export interface OrderConfirmationPdfData {
  documentNumber: string;
  date: string;
  contactName: string;
  contactCompany?: string;
  contactPhone?: string;
  contactEmail?: string;
  /** Fatura / firma adresi (öncelikli) */
  billingAddress?: string;
  shippingAddress?: string;
  contactTaxOffice?: string;
  contactTaxNumber?: string;
  contactIdentityNumber?: string;
  expectedDelivery?: string;
  quoteRef?: string;
  items: LineItem[];
  currency: string;
  subtotal: number;
  discountTotal: number;
  discountLabel?: string;
  vatTotal: number;
  grandTotal: number;
  orderNotes?: string;
  /** Belgeyi oluşturan temsilci adı */
  createdByName?: string;
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
      bankQrUrl: m.get('pdf_bank_qr_url') || '',
      bankInfo: m.get('pdf_bank_info') || '',
      bank2Info: m.get('pdf_bank2_info') || '',
      terms: m.get('pdf_terms') || '',
      footerNote: m.get('pdf_footer_note') || '',
      primaryColor: m.get('pdf_primary_color') || '#1a7a4a',
      showSignatureArea: m.get('pdf_show_signature') !== 'false',
      currencySymbolPosition: (m.get('pdf_currency_position') as any) || 'after',
    };
  }

  private async fetchItemImageBuffer(url?: string | null): Promise<Buffer | null> {
    const u = (url || '').trim();
    if (!u) return null;
    try {
      if (u.startsWith('http://') || u.startsWith('https://')) {
        const resp = await axios.get(u, {
          responseType: 'arraybuffer',
          timeout: 12_000,
          maxContentLength: 2 * 1024 * 1024,
          validateStatus: (s) => s >= 200 && s < 400,
          headers: { 'User-Agent': 'AtmacaCRM-PDF/1.0' },
        });
        return Buffer.from(resp.data);
      }
      /** `/uploads/...` (`POST /messages/upload`) — axios göreli yolu indiremez; diskten oku */
      let diskRef = u;
      if (diskRef.startsWith('/api/uploads/')) diskRef = diskRef.replace(/^\/api/, '');
      const localPath = diskRef.startsWith('/')
        ? join(process.cwd(), diskRef.slice(1))
        : join(process.cwd(), diskRef);
      if (existsSync(localPath)) return readFileSync(localPath);
      this.logger.warn(`Kalem gorseli dosya bulunamadi: ${localPath} (url: ${u})`);
    } catch (err: any) {
      this.logger.warn(`Kalem gorseli yuklenemedi: ${err.message}`);
    }
    return null;
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
    const bankQrBuffer = await this.fetchLogoBuffer(settings.bankQrUrl);
    const itemImageBuffers = await Promise.all(
      data.items.map((it) => this.fetchItemImageBuffer((it as LineItem).imageUrl)),
    );
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
          opts: {
            width?: number;
            align?: string;
            size?: number;
            color?: string;
            bold?: boolean;
            lineBreak?: boolean;
          } = {},
        ) => {
          if (opts.bold) B(); else R();
          if (opts.size) doc.fontSize(opts.size);
          doc.fillColor(opts.color || '#333333');
          const content = text || '';
          const maxWidth = opts.width ?? 200;
          const h = doc.heightOfString(content, { width: maxWidth, align: (opts.align as any) || 'left' });
          doc.text(text, x, y, {
            width: opts.width,
            align: (opts.align as any) || 'left',
            lineBreak: opts.lineBreak ?? false,
          });
          return h;
        };

        const ML = 40; // margin left
        const MR = 40; // margin right
        const PW = doc.page.width - ML - MR; // 515
        const PAGE_H = doc.page.height; // 841.89

        // ── HEADER BOX ──────────────────────────────────────────────────
        // Colored top bar
        doc.rect(0, 0, doc.page.width, 8).fill(primary);

        let logoW = 0;
        let logoBottom = 18;
        if (logoBuffer) {
          try {
            doc.image(logoBuffer, ML, 16, { fit: [250, 56] });
            logoW = 250;
            logoBottom = 72;
          } catch { /* skip */ }
        }

        // Company info (right of logo)
        const titleBoxW = 190;
        const titleBoxX = doc.page.width - MR - titleBoxW;
        let firmX = ML + logoW + (logoW ? 10 : 0);
        let companyInfoW = Math.max(120, titleBoxX - firmX - 12);
        let cy = 15;
        if (companyInfoW < 150) {
          firmX = ML;
          companyInfoW = titleBoxX - ML - 12;
          cy = logoBottom + 4;
        }
        cy += txt(this.t(settings.companyName), firmX, cy, { size: 12, bold: true, color: primary, width: companyInfoW, lineBreak: true }) + 3;
        if (settings.companyAddress) { cy += txt(this.t(settings.companyAddress), firmX, cy, { size: 7.5, color: '#555', width: companyInfoW, lineBreak: true }) + 2; }
        if (settings.companyPhone)   { cy += txt(`Tel: ${settings.companyPhone}`, firmX, cy, { size: 7.5, color: '#555', width: companyInfoW, lineBreak: true }) + 2; }
        if (settings.companyEmail)   { cy += txt(`E-posta: ${settings.companyEmail}`, firmX, cy, { size: 7.5, color: '#555', width: companyInfoW, lineBreak: true }) + 2; }
        if (settings.companyWebsite) { cy += txt(settings.companyWebsite, firmX, cy, { size: 7.5, color: '#555', width: companyInfoW, lineBreak: true }) + 2; }
        if (settings.companyTaxOffice || settings.companyTaxNumber) {
          cy += txt(`VD: ${this.t(settings.companyTaxOffice)}  VN: ${settings.companyTaxNumber}`, firmX, cy, { size: 7.5, color: '#555', width: companyInfoW, lineBreak: true }) + 2;
        }
        if (settings.companyMersisNo) { cy += txt(`Mersis: ${settings.companyMersisNo}`, firmX, cy, { size: 7.5, color: '#555', width: companyInfoW, lineBreak: true }) + 2; }

        // Document title box (right side)
        doc.rect(titleBoxX, 12, titleBoxW, 68).fill('#f5f5f5');
        txt(this.t(data.title), titleBoxX + 8, 18, { size: 14, bold: true, color: primary, width: titleBoxW - 16 });
        let ry2 = 38;
        txt(`No: ${data.documentNumber}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: titleBoxW - 16 }); ry2 += 11;
        txt(`Tarih: ${data.date}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: titleBoxW - 16 }); ry2 += 11;
        if (data.validUntil)   { txt(`Gecerlilik: ${data.validUntil}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: titleBoxW - 16 }); ry2 += 11; }
        if (data.deliveryDate) { txt(`Teslim: ${data.deliveryDate}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: titleBoxW - 16 }); ry2 += 11; }
        if (data.dueDate)      { txt(`Vade: ${data.dueDate}`, titleBoxX + 8, ry2, { size: 8, color: '#444', width: titleBoxW - 16 }); }

        // ── DIVIDER ─────────────────────────────────────────────────────
        const headerBottom = Math.max(cy, logoBottom, 82) + 8;
        doc.moveTo(ML, headerBottom).lineTo(ML + PW, headerBottom).lineWidth(1).strokeColor(primary).stroke();

        // ── CUSTOMER INFO ────────────────────────────────────────────────
        let startY = headerBottom + 8;
        startY += txt(this.t('MUSTERI BILGILERI'), ML, startY, { size: 8, bold: true, color: primary, width: PW, lineBreak: true }) + 3;
        startY += txt(this.t(data.contactName), ML, startY, { size: 9, bold: true, width: PW, lineBreak: true }) + 3;
        if (data.contactCompany) { startY += txt(this.t(data.contactCompany), ML, startY, { size: 8, width: PW, lineBreak: true }) + 2; }
        if (data.contactPhone)   { startY += txt(`Tel: ${data.contactPhone}`, ML, startY, { size: 8, width: PW, lineBreak: true }) + 2; }
        if (data.contactEmail)   { startY += txt(`E: ${data.contactEmail}`, ML, startY, { size: 8, width: PW, lineBreak: true }) + 2; }
        if (data.contactAddress) { startY += txt(this.t(data.contactAddress), ML, startY, { size: 8, width: PW, lineBreak: true }) + 2; }
        if (data.contactTaxOffice || data.contactTaxNumber) {
          startY += txt(`VD: ${this.t(data.contactTaxOffice || '')}  VN: ${data.contactTaxNumber || ''}`, ML, startY, { size: 8, width: PW, lineBreak: true }) + 2;
        }
        if (data.contactIdentityNumber) {
          startY += txt(`TC: ${data.contactIdentityNumber}`, ML, startY, { size: 8, width: PW, lineBreak: true }) + 2;
        }
        // Temsilci bilgisi
        if (data.createdByName) {
          startY += txt(`${this.t('Temsilci')}: ${this.t(data.createdByName)}`, ML, startY, { size: 8, bold: true, color: primary, width: PW, lineBreak: true }) + 2;
        }

        // ── TABLE ────────────────────────────────────────────────────────
        const tableY = startY + 10;
        const ROW_H = 20;
        const HEADER_H = 18;

        /* Sütun genişlikleri toplamı PW olmalı; son sütun (toplam) dar kalınca başlık taşması önlenir */
        const COL_IDX = 30;
        const COL_NAME = 196;
        const COL_QTY = 52;
        const COL_UNIT = 80;
        const COL_DISC = 48;
        const COL_TOT = PW - COL_IDX - COL_NAME - COL_QTY - COL_UNIT - COL_DISC;
        const cols = [
          { label: '#', w: COL_IDX },
          { label: this.t('Urun / Hizmet'), w: COL_NAME },
          { label: this.t('Miktar'), w: COL_QTY },
          { label: `${this.t('B.Fiyat')} (${cs})`, w: COL_UNIT },
          { label: this.t('Indirim'), w: COL_DISC },
          { label: `${this.t('Toplam')} (${cs})`, w: COL_TOT },
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
        const softLayout = data.layout === 'order_form';
        data.items.forEach((item, idx) => {
          const imgBuf = itemImageBuffers[idx];
          const lineDetailRaw = (item as LineItem).lineDetail
            ? String((item as LineItem).lineDetail).trim()
            : '';

          // Kalem satırı yüksekliği: ürün adı + renk/kumaş & ölçü (çok satır) — sabit 16px taşmayı önler
          const thumb = 22;
          const namePadSoft = imgBuf ? 26 + 8 : 4;
          const namePadDefault = imgBuf ? thumb + 8 : 6;
          const nameWSoft = cols[1].w - namePadSoft - 4;
          const nameWDefault = cols[1].w - namePadDefault - 3;

          R(); doc.fontSize(9);
          const nameHSoft = doc.heightOfString(this.t(item.name), { width: nameWSoft });
          R(); doc.fontSize(8);
          const nameHDefault = doc.heightOfString(this.t(item.name), { width: nameWDefault });

          R(); doc.fontSize(7);
          const detailHSoft = lineDetailRaw
            ? doc.heightOfString(this.t(lineDetailRaw), { width: nameWSoft })
            : 0;
          R(); doc.fontSize(7);
          const detailHDefault = lineDetailRaw
            ? doc.heightOfString(this.t(lineDetailRaw), { width: nameWDefault })
            : 0;

          const itemH = softLayout
            ? Math.max(
                32,
                imgBuf ? 36 : 0,
                6 + nameHSoft + (lineDetailRaw ? 2 + detailHSoft : 0) + 8,
              )
            : 0;

          const rowHDefault = Math.max(
            imgBuf ? 34 : 0,
            6 + nameHDefault + (lineDetailRaw ? 2 + detailHDefault : 0) + 6,
            ROW_H,
          );

          const blockH = softLayout ? itemH + 6 : rowHDefault;
          // Sayfa taşması
          if (rowY + blockH + 8 > PAGE_H - 120) {
            doc.addPage({ margin: 0 });
            doc.rect(0, 0, doc.page.width, 8).fill(primary);
            rowY = 30;
          }
          if (softLayout) {
            doc.roundedRect(ML, rowY, PW, itemH, 3).fill(idx % 2 === 0 ? '#f4f6f9' : '#eef1f6');
            let rx = ML + 8;
            B(); doc.fontSize(8).fillColor(primary);
            doc.text(String(idx + 1), rx, rowY + 8, { width: cols[0].w - 4, align: 'center', lineBreak: false });
            rx += cols[0].w;
            const nameColLeft = rx;
            const thumbSz = 26;
            const namePad = imgBuf ? thumbSz + 8 : 4;
            if (imgBuf) {
              try {
                doc.image(imgBuf, nameColLeft + 2, rowY + 5, { width: thumbSz, height: thumbSz, fit: [thumbSz, thumbSz] });
              } catch { /* gecersiz goruntu */ }
            }
            R(); doc.fontSize(9).fillColor('#222');
            doc.text(this.t(item.name), nameColLeft + namePad, rowY + 6, {
              width: cols[1].w - namePad - 4,
              lineBreak: true,
            });
            if (lineDetailRaw) {
              doc.fontSize(7).fillColor('#444444');
              doc.text(this.t(lineDetailRaw), nameColLeft + namePad, rowY + 6 + nameHSoft + 2, {
                width: cols[1].w - namePad - 4,
                lineBreak: true,
              });
            }
            rx += cols[1].w;
            doc.fontSize(8).fillColor('#333');
            doc.text(String(item.quantity), rx, rowY + 10, { width: cols[2].w - 6, align: 'right', lineBreak: false });
            rx += cols[2].w;
            doc.text(item.unitPrice.toFixed(2), rx, rowY + 10, { width: cols[3].w - 6, align: 'right', lineBreak: false });
            rx += cols[3].w;
            doc.text(item.discountText ? this.t(item.discountText) : '-', rx, rowY + 10, { width: cols[4].w - 6, align: 'right', lineBreak: false });
            rx += cols[4].w;
            B(); doc.fillColor(primary);
            doc.text(item.lineTotal.toFixed(2), rx, rowY + 10, { width: cols[5].w - 6, align: 'right', lineBreak: false });
            rowY += itemH + 6;
          } else {
            if (idx % 2 === 1) {
              doc.rect(ML, rowY, PW, rowHDefault).fill('#f9f9f9');
            }
            let rx = ML;
            R(); doc.fontSize(8).fillColor('#333');
            doc.text(String(idx + 1), rx + 3, rowY + 6, { width: cols[0].w - 6, align: 'center', lineBreak: false }); rx += cols[0].w;
            const nameColX = rx;
            const pad = imgBuf ? thumb + 8 : 6;
            if (imgBuf) {
              try {
                doc.image(imgBuf, nameColX + 3, rowY + 4, { width: thumb, height: thumb, fit: [thumb, thumb] });
              } catch { /* */ }
            }
            R(); doc.fontSize(8).fillColor('#333333');
            doc.text(this.t(item.name), nameColX + pad, rowY + 6, {
              width: cols[1].w - pad - 3,
              lineBreak: true,
            });
            if (lineDetailRaw) {
              doc.fontSize(7).fillColor('#444444');
              doc.text(this.t(lineDetailRaw), nameColX + pad, rowY + 6 + nameHDefault + 2, {
                width: cols[1].w - pad - 3,
                lineBreak: true,
              });
            }
            rx += cols[1].w;
            txt(String(item.quantity), rx + 3, rowY + 6, { size: 8, width: cols[2].w - 6, align: 'right' }); rx += cols[2].w;
            txt(item.unitPrice.toFixed(2), rx + 3, rowY + 6, { size: 8, width: cols[3].w - 6, align: 'right' }); rx += cols[3].w;
            txt(item.discountText ? this.t(item.discountText) : '-', rx + 3, rowY + 6, { size: 8, width: cols[4].w - 6, align: 'right' }); rx += cols[4].w;
            txt(item.lineTotal.toFixed(2), rx + 3, rowY + 6, { size: 8, width: cols[5].w - 6, align: 'right' });
            rowY += rowHDefault;
          }
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

        const vatAmt = Number.isFinite(data.vatTotal) ? data.vatTotal : 0;
        // KDV dahil brut = ara toplam + KDV (indirimden once)
        const grossVatIncluded = (data.subtotal || 0) + vatAmt;
        sumRow(this.t('Ara Toplam (KDV haric):'), fmtMoney(data.subtotal), rowY); rowY += 14;
        sumRow(this.t('KDV Tutari:'), fmtMoney(vatAmt), rowY); rowY += 14;
        if (data.discountTotal > 0) {
          // Indirim oncesi brut satiri, ardindan indirim kirilimi
          sumRow(this.t('Toplam (KDV dahil):'), fmtMoney(grossVatIncluded), rowY); rowY += 14;
          sumRow(this.t('Indirim:'), `-${fmtMoney(data.discountTotal)}`, rowY, false, '#cc0000'); rowY += 14;
        }

        // Grand total box — genel toplam KDV dahil (kalem fiyatlari da KDV dahil)
        doc.rect(sumX - 4, rowY - 2, lblW + valW + 8, 22).fill(primary);
        sumRow(this.t('GENEL TOPLAM (KDV dahil):'), fmtMoney(data.grandTotal), rowY + 5, true, '#ffffff');
        rowY += 32;
        rowY += txt(
          this.t('* Tablodaki birim fiyat ve satir toplamlari KDV dahildir.'),
          sumX,
          rowY,
          { size: 7, color: '#666666', width: lblW + valW, align: 'right', lineBreak: true },
        ) + 2;

        // ── NOTES / TERMS / BANK ─────────────────────────────────────────
        rowY += 6;
        const termsText = data.termsOverride?.trim() || settings.terms;
        const footerNoteText = data.footerNoteOverride?.trim() || settings.footerNote;
        const ensureSpace = (neededHeight: number) => {
          if (rowY + neededHeight <= PAGE_H - 95) return;
          doc.addPage({ margin: 0 });
          doc.rect(0, 0, doc.page.width, 8).fill(primary);
          rowY = 28;
        };
        if (data.notes) {
          R(); doc.fontSize(8).fillColor('#444');
          const h = doc.heightOfString(this.t(data.notes), { width: PW }) + 8;
          ensureSpace(h);
          doc.text(this.t(data.notes), ML, rowY, { width: PW, lineBreak: true });
          rowY += h + 6;
        }
        if (termsText) {
          // Sartlar ve Kosullar: belge okunakliligi icin her zaman yeni sayfada
          // ve basliklandirilmis bir sekilde gosterilir ("2. sayfa sartlar sablonu").
          doc.addPage({ margin: 0 });
          doc.rect(0, 0, doc.page.width, 8).fill(primary);
          rowY = 28;

          R(); doc.fontSize(13).fillColor('#111');
          doc.text(this.t('Sartlar ve Kosullar'), ML, rowY, { width: PW });
          rowY += 22;
          doc
            .moveTo(ML, rowY - 4)
            .lineTo(ML + PW, rowY - 4)
            .lineWidth(0.5)
            .strokeColor(primary)
            .stroke();

          R(); doc.fontSize(9).fillColor('#333');
          const termsBlockWidth = PW;
          // Her paragraf arasi 4pt bosluk
          const paragraphs = this.t(termsText).split(/\n{2,}/);
          for (const p of paragraphs) {
            const block = p.replace(/\n/g, ' \n');
            const hBlock = doc.heightOfString(block, { width: termsBlockWidth }) + 4;
            // Sayfa sonuna yaklasirsa yeni sayfaya tas
            if (rowY + hBlock > PAGE_H - 90) {
              doc.addPage({ margin: 0 });
              doc.rect(0, 0, doc.page.width, 8).fill(primary);
              rowY = 28;
            }
            doc.text(block, ML, rowY, { width: termsBlockWidth, lineBreak: true });
            rowY += hBlock + 4;
          }
          rowY += 6;
        }
        if (footerNoteText) {
          R(); doc.fontSize(8).fillColor('#444');
          const h = doc.heightOfString(this.t(footerNoteText), { width: PW }) + 8;
          ensureSpace(h);
          doc.text(this.t(footerNoteText), ML, rowY, { width: PW, lineBreak: true });
          rowY += h + 8;
        }
        if (settings.bankInfo || settings.bank2Info || bankQrBuffer) {
          const qrSize = bankQrBuffer ? 82 : 0;
          const qrGap = bankQrBuffer ? 10 : 0;
          const textW = bankQrBuffer ? Math.max(160, PW - qrSize - qrGap) : PW;
          const halfW = textW > 20 ? (textW - 10) / 2 : textW;

          R(); doc.fontSize(8).fillColor('#444');
          let h1 = 0;
          let h2 = 0;
          if (settings.bankInfo) {
            h1 = doc.heightOfString(this.t(settings.bankInfo), { width: halfW });
          }
          if (settings.bank2Info) {
            h2 = doc.heightOfString(this.t(settings.bank2Info), { width: halfW });
          }
          const textH = Math.max(h1, h2);
          const blockH = Math.max(textH, qrSize);
          const approxTitle = 16;
          if (rowY + approxTitle + blockH + 24 > PAGE_H - 95) {
            doc.addPage({ margin: 0 });
            doc.rect(0, 0, doc.page.width, 8).fill(primary);
            rowY = 28;
          }

          rowY += txt(this.t('Banka Bilgileri:'), ML, rowY, { size: 8.5, bold: true, width: PW, lineBreak: true }) + 2;
          const yBank = rowY;

          R(); doc.fontSize(8).fillColor('#444');
          if (settings.bankInfo) {
            doc.text(this.t(settings.bankInfo), ML, yBank, { width: halfW, lineBreak: true });
          }
          if (settings.bank2Info) {
            doc.text(this.t(settings.bank2Info), ML + halfW + 10, yBank, { width: halfW, lineBreak: true });
          }
          if (bankQrBuffer) {
            try {
              const qy = yBank + (textH > qrSize ? textH - qrSize : 0);
              doc.image(bankQrBuffer, ML + textW + qrGap, qy, {
                width: qrSize,
                height: qrSize,
                fit: [qrSize, qrSize],
              });
            } catch {
              /* geçersiz görsel */
            }
          }
          rowY = yBank + blockH + 10;
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
        const sigBottomPad = settings.showSignatureArea ? 92 : 56;
        if (rowY > PAGE_H - sigBottomPad) rowY = PAGE_H - sigBottomPad;
        doc.moveTo(ML, footerY - 8).lineTo(ML + PW, footerY - 8).lineWidth(0.3).strokeColor('#dddddd').stroke();
        R(); doc.fontSize(7).fillColor('#aaaaaa');
        doc.text(`Sayfa 1`, ML, footerY - 4, { width: PW, align: 'right', lineBreak: false });

        doc.end();
      } catch (err: any) {
        this.logger.error(`PDF olusturma hatasi: ${err.message}`, err.stack);
        done(err);
      }
    });
  }

  /** Tekliften oluşan sipariş için onay PDF’i (logo, banka, şartlar, imza alanları — yumuşak kalem blokları) */
  async generateOrderConfirmationPdf(data: OrderConfirmationPdfData): Promise<string> {
    const discountLine =
      data.discountTotal > 0 && data.discountLabel
        ? `${data.discountLabel} (-${data.discountTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${data.currency})`
        : data.discountTotal > 0
          ? `Iskonto (-${data.discountTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${data.currency})`
          : '';
    const noteParts = [
      data.quoteRef ? `Teklif referansi: ${data.quoteRef}` : '',
      discountLine,
      data.orderNotes || '',
    ].filter(Boolean);
    const bill = data.billingAddress?.trim();
    const ship = data.shippingAddress?.trim();
    let mergedAddr: string | undefined;
    if (bill && ship && bill !== ship) {
      mergedAddr = `${bill}\n\n${this.t('Teslimat')}: ${ship}`;
    } else {
      mergedAddr = bill || ship || undefined;
    }

    return this.generateDocument({
      title: this.t('SIPARIS ONAY FORMU'),
      documentNumber: data.documentNumber,
      date: data.date,
      deliveryDate: data.expectedDelivery,
      contactName: data.contactName,
      contactCompany: data.contactCompany,
      contactPhone: data.contactPhone,
      contactEmail: data.contactEmail,
      contactAddress: mergedAddr,
      contactTaxOffice: data.contactTaxOffice,
      contactTaxNumber: data.contactTaxNumber,
      contactIdentityNumber: data.contactIdentityNumber,
      items: data.items,
      currency: data.currency,
      subtotal: data.subtotal,
      discountTotal: data.discountTotal,
      vatTotal: data.vatTotal,
      grandTotal: data.grandTotal,
      notes: noteParts.join('\n\n') || undefined,
      layout: 'order_form',
      createdByName: data.createdByName,
    });
  }
}
