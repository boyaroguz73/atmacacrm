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
  logoHeight: number;
  bankQrUrl: string;
  bankInfo: string;
  bank2Info: string;
  terms: string;
  footerNote: string;
  primaryColor: string;
  showSignatureArea: boolean;
  showAuthorizedSignature: boolean;
  currencySymbolPosition: 'before' | 'after';
}

interface StyledRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

interface LineItem {
  name: string;
  description?: string;
  lineDetail?: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountText?: string;
  lineTotal: number;
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
  shippingAddress?: string;
  contactTaxOffice?: string;
  contactTaxNumber?: string;
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
  layout?: 'default' | 'order_form';
  createdByName?: string;
}

export interface OrderConfirmationPdfData {
  documentNumber: string;
  date: string;
  contactName: string;
  contactCompany?: string;
  contactPhone?: string;
  contactEmail?: string;
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

  private htmlToPlainText(html: string): string {
    if (!html) return '';
    if (!html.includes('<')) return html;
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private hasMeaningfulText(html?: string | null): boolean {
    if (html == null) return false;
    const raw = String(html);
    if (!raw.trim()) return false;
    const plain = this.htmlToPlainText(raw).replace(/\s+/g, ' ').trim();
    return plain.length > 0;
  }

  private htmlToStyledLines(html: string): StyledRun[][] {
    if (!html) return [];
    const raw = String(html);
    if (!raw.includes('<')) {
      return raw.split('\n').map((line) => [{ text: line }]);
    }

    const decodeEntities = (s: string) =>
      s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const parts = raw.split(/(<[^>]+>)/g).filter((p) => p.length > 0);
    const lines: StyledRun[][] = [[]];
    let bold = false;
    let italic = false;

    const currentLine = () => lines[lines.length - 1];
    const pushLine = () => lines.push([]);
    const pushText = (txt: string) => {
      if (!txt) return;
      const decoded = decodeEntities(txt).replace(/\r/g, '');
      const chunks = decoded.split('\n');
      chunks.forEach((chunk, i) => {
        if (chunk.length > 0) currentLine().push({ text: chunk, bold, italic });
        if (i < chunks.length - 1) pushLine();
      });
    };

    const boldStack: boolean[] = [];
    const italicStack: boolean[] = [];

    for (const token of parts) {
      if (!token.startsWith('<')) { pushText(token); continue; }
      const tag = token.toLowerCase().replace(/\s+/g, ' ').trim();
      if (tag.startsWith('<br')) { pushLine(); continue; }
      if (tag === '<p>' || tag === '<div>') continue;
      if (tag === '</p>' || tag === '</div>' || tag === '</ul>' || tag === '</ol>' || tag === '</li>') { pushLine(); continue; }
      if (tag.startsWith('<li')) {
        if (currentLine().length > 0) pushLine();
        currentLine().push({ text: '• ', bold, italic });
        continue;
      }
      if (tag === '<b>' || tag.startsWith('<b ') || tag === '<strong>' || tag.startsWith('<strong ')) { bold = true; continue; }
      if (tag === '</b>' || tag === '</strong>') { bold = false; continue; }
      if (tag === '<i>' || tag.startsWith('<i ') || tag === '<em>' || tag.startsWith('<em ')) { italic = true; continue; }
      if (tag === '</i>' || tag === '</em>') { italic = false; continue; }
      if (tag.startsWith('<span')) {
        const styleMatch = token.match(/style\s*=\s*["']([^"']+)["']/i);
        const style = styleMatch ? styleMatch[1].toLowerCase() : '';
        boldStack.push(bold);
        italicStack.push(italic);
        if (/font-weight\s*:\s*(bold|700|800|900)/.test(style)) bold = true;
        if (/font-style\s*:\s*italic/.test(style)) italic = true;
        continue;
      }
      if (tag === '</span>') {
        if (boldStack.length > 0) bold = boldStack.pop()!;
        if (italicStack.length > 0) italic = italicStack.pop()!;
        continue;
      }
    }

    return lines;
  }

  private async getSettings(): Promise<PdfSettings> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: 'pdf_' } } });
    const m = new Map(rows.map((r) => [r.key, r.value]));
    const rawLogoHeight = Number(m.get('pdf_logo_height'));
    const logoHeight = Number.isFinite(rawLogoHeight) ? Math.max(20, Math.min(120, rawLogoHeight)) : 44;
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
      logoHeight,
      bankQrUrl: m.get('pdf_bank_qr_url') || '',
      bankInfo: m.get('pdf_bank_info') || '',
      bank2Info: m.get('pdf_bank2_info') || '',
      terms: m.get('pdf_terms') || '',
      footerNote: m.get('pdf_footer_note') || '',
      primaryColor: m.get('pdf_primary_color') || '#1a7a4a',
      showSignatureArea: m.get('pdf_show_signature') !== 'false',
      showAuthorizedSignature: m.get('pdf_show_authorized_signature') !== 'false',
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

        const ML = 40;
        const MR = 40;
        const PW = doc.page.width - ML - MR;
        const PAGE_H = doc.page.height;

        // ── FIX 1: Sayfa alt rezervleri gerçekçi değerlere çıkarıldı ──
        // İmza + banka + footer için yeterli boşluk
        const FOOTER_STRIP_H = 20;           // en alttaki footer çizgisi
        const SIG_BLOCK_H = 30;             // imza çizgisi + yazı
        const SIG_TOP_GAP = 10;
        const SIG_BOTTOM_SAFE = 34;
        // Toplam rezerv: footer + imza bloğu + üst boşluk
        const signatureBottomPad = settings.showSignatureArea
          ? FOOTER_STRIP_H + SIG_BLOCK_H + SIG_TOP_GAP + SIG_BOTTOM_SAFE   // ~94
          : FOOTER_STRIP_H + 36;                                             // ~56

        // Metin akışı için: imza artık içeriğin hemen altında, sayfaya sabitli değil.
        // Sadece footer şeridi kadar rezerv yeterli.
        const textFlowBottomPad = FOOTER_STRIP_H + 12;

        // Tablo satırları için: özetler + metin akışı da alt kısımda yer tutacak
        const TABLE_ROW_BOTTOM_PAD = signatureBottomPad + 120;

        // ── Helper: txt ─────────────────────────────────────────────────
        const txt = (
          text: string, x: number, y: number,
          opts: { width?: number; align?: string; size?: number; color?: string; bold?: boolean; lineBreak?: boolean } = {},
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

        // ── FIX 2: richTxt artık doc ve primary'e erişebilir, ──────────
        //          her satır öncesi sayfa taşması kontrol edilir
        const richTxt = (
          html: string,
          x: number,
          y: number,
          opts: { width: number; size?: number; color?: string },
          bottomPad = textFlowBottomPad,
        ) => {
          const lines = this.htmlToStyledLines(html);
          let cursorY = y;
          const width = opts.width;
          const size = opts.size ?? 8;
          const color = opts.color || '#333333';

          for (const line of lines) {
            if (!line.length) {
              cursorY += Math.max(6, size * 0.8);
              continue;
            }

            // FIX: her satırdan önce sayfa taşması kontrolü
            const lineText = line.map((r) => r.text).join('');
            R();
            doc.fontSize(size);
            const lineH = doc.heightOfString(this.t(lineText), { width });
            if (cursorY + lineH > PAGE_H - bottomPad) {
              doc.addPage({ margin: 0 });
              doc.rect(0, 0, doc.page.width, 8).fill(primary);
              cursorY = 28;
            }

            doc.fillColor(color);
            doc.fontSize(size);
            doc.y = cursorY;

            line.forEach((run, idx) => {
              const content = this.t(run.text || '');
              if (run.bold) B(); else R();
              doc.text(
                content,
                idx === 0 ? x : undefined,
                idx === 0 ? cursorY : undefined,
                {
                  width,
                  continued: idx < line.length - 1,
                  lineBreak: idx === line.length - 1,
                  oblique: !!run.italic,
                },
              );
            });
            cursorY = doc.y;
          }
          return cursorY - y;
        };

        // ── drawPageTop: yeni sayfa aç, üst bant çiz, rowY sıfırla ─────
        // FIX 3: rowY closure referansıyla değil, döndürerek yönetiliyor
        const drawPageTopFn = (): number => {
          doc.addPage({ margin: 0 });
          doc.rect(0, 0, doc.page.width, 8).fill(primary);
          return 28;
        };

        // FIX 4: ensureSpace rowY'yi mutate eden closure yerine değer döndürür
        const ensureSpace = (currentRowY: number, neededHeight: number, bottomPad = signatureBottomPad): number => {
          if (currentRowY + neededHeight <= PAGE_H - bottomPad) return currentRowY;
          return drawPageTopFn();
        };

        // ── HEADER ───────────────────────────────────────────────────────
        doc.rect(0, 0, doc.page.width, 8).fill(primary);

        const titleBoxW = 190;
        const titleBoxX = doc.page.width - MR - titleBoxW;
        const rightMetaCount = 2
          + (data.validUntil   ? 1 : 0)
          + (data.deliveryDate ? 1 : 0)
          + (data.dueDate      ? 1 : 0);
        const TITLE_H = 22;
        const META_LINE_H = 13;
        const BOX_PAD = 10;
        const titleBoxH = Math.max(72, BOX_PAD + TITLE_H + rightMetaCount * META_LINE_H + BOX_PAD);
        const TITLE_BOX_Y = 10;

        const logoX = ML + 6;
        const logoY = TITLE_BOX_Y + 4;
        let logoBottom = logoY;
        if (logoBuffer) {
          try {
            const logoHeight = settings.logoHeight || 44;
            const maxLogoWidth = Math.max(80, titleBoxX - ML - 20);
            const logoWidth = Math.min(maxLogoWidth, Math.round((logoHeight * 150) / 44));
            const img = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(logoBuffer);
            const ratio = Math.min(logoWidth / img.width, logoHeight / img.height);
            const renderedH = img.height * ratio;
            doc.image(logoBuffer, logoX, logoY, { fit: [logoWidth, logoHeight] });
            logoBottom = logoY + renderedH;
          } catch { /* skip */ }
        }

        let cy = logoBottom + (logoBuffer ? 1 : 0);
        const metaW = titleBoxX - ML - 16;
        if (metaW > 40) {
          const infoLines: string[] = [];
          if (!logoBuffer && settings.companyName) infoLines.push(this.t(settings.companyName));
          if (settings.companyAddress) infoLines.push(this.t(settings.companyAddress));
          if (settings.companyPhone) infoLines.push(`Tel: ${settings.companyPhone}`);
          if (settings.companyEmail) infoLines.push(`E-posta: ${settings.companyEmail}`);
          if (settings.companyWebsite) infoLines.push(settings.companyWebsite);
          if (settings.companyTaxOffice || settings.companyTaxNumber) {
            infoLines.push(`VD: ${this.t(settings.companyTaxOffice)}  VN: ${settings.companyTaxNumber}`);
          }
          if (settings.companyMersisNo) infoLines.push(`Mersis: ${settings.companyMersisNo}`);

          R(); doc.fontSize(7.5).fillColor('#555555');
          for (const line of infoLines) {
            if (!line) continue;
            const lineH = doc.heightOfString(line, { width: metaW });
            doc.text(line, ML, cy, { width: metaW, lineBreak: true });
            cy += lineH + 3;
          }
        }

        doc.rect(titleBoxX, TITLE_BOX_Y, titleBoxW, titleBoxH).fill('#f5f5f5');
        let ry2 = TITLE_BOX_Y + BOX_PAD;
        B(); doc.fontSize(12).fillColor(primary);
        doc.text(this.t(data.title), titleBoxX + 8, ry2, { width: titleBoxW - 16, lineBreak: false });
        ry2 += TITLE_H;
        R(); doc.fontSize(8).fillColor('#444444');
        doc.text(`No: ${data.documentNumber}`, titleBoxX + 8, ry2, { width: titleBoxW - 16, lineBreak: false }); ry2 += META_LINE_H;
        doc.text(`Tarih: ${data.date}`, titleBoxX + 8, ry2, { width: titleBoxW - 16, lineBreak: false }); ry2 += META_LINE_H;
        if (data.validUntil)   { doc.text(`Gecerlilik: ${data.validUntil}`, titleBoxX + 8, ry2, { width: titleBoxW - 16, lineBreak: false }); ry2 += META_LINE_H; }
        if (data.deliveryDate) { doc.text(`Teslim: ${data.deliveryDate}`, titleBoxX + 8, ry2, { width: titleBoxW - 16, lineBreak: false }); ry2 += META_LINE_H; }
        if (data.dueDate)      { doc.text(`Vade: ${data.dueDate}`, titleBoxX + 8, ry2, { width: titleBoxW - 16, lineBreak: false }); }

        const titleBoxBottom = TITLE_BOX_Y + titleBoxH;
        const headerBottom = Math.max(cy + 6, titleBoxBottom + 6);
        doc.moveTo(ML, headerBottom).lineTo(ML + PW, headerBottom).lineWidth(1).strokeColor(primary).stroke();

        // ── CUSTOMER INFO ────────────────────────────────────────────────
        let startY = headerBottom + 8;
        startY += txt(this.t('MUSTERI BILGILERI'), ML, startY, {
          size: 8, bold: true, color: primary, width: PW, lineBreak: true,
        }) + 4;

        const infoGap = 14;
        const leftW = Math.floor((PW - infoGap) * 0.48);
        const rightW = PW - leftW - infoGap;
        const leftX = ML;
        const rightX = ML + leftW + infoGap;
        let leftY = startY;
        let rightY = startY;

        leftY += txt(this.t(data.contactName), leftX, leftY, { size: 9, bold: true, width: leftW, lineBreak: true }) + 3;
        if (data.contactCompany)  { leftY += txt(this.t(data.contactCompany), leftX, leftY, { size: 8, width: leftW, lineBreak: true }) + 2; }
        if (data.contactPhone)    { leftY += txt(`Tel: ${data.contactPhone}`, leftX, leftY, { size: 8, width: leftW, lineBreak: true }) + 2; }
        if (data.contactEmail)    { leftY += txt(`E: ${data.contactEmail}`, leftX, leftY, { size: 8, width: leftW, lineBreak: true }) + 2; }
        if (data.createdByName) {
          leftY += txt(`${this.t('Temsilci')}: ${this.t(data.createdByName)}`, leftX, leftY, { size: 8, bold: true, color: primary, width: leftW, lineBreak: true }) + 2;
        }

        rightY += txt(this.t('Adres Bilgileri'), rightX, rightY, { size: 8, bold: true, color: primary, width: rightW, lineBreak: true }) + 2;
        if (data.contactAddress) {
          rightY += txt(this.t(data.contactAddress), rightX, rightY, { size: 8, width: rightW, lineBreak: true }) + 2;
        } else {
          rightY += txt('-', rightX, rightY, { size: 8, width: rightW, lineBreak: true }) + 2;
        }
        if (data.contactTaxOffice || data.contactTaxNumber) {
          rightY += txt(`VD: ${this.t(data.contactTaxOffice || '')}  VN: ${data.contactTaxNumber || ''}`, rightX, rightY, { size: 8, width: rightW, lineBreak: true }) + 2;
        }
        if (data.contactIdentityNumber) {
          rightY += txt(`TC: ${data.contactIdentityNumber}`, rightX, rightY, { size: 8, width: rightW, lineBreak: true }) + 2;
        }

        startY = Math.max(leftY, rightY);

        // ── TABLE ────────────────────────────────────────────────────────
        const tableY = startY + 10;
        const ROW_H = 20;
        const HEADER_H = 18;

        const COL_IDX = 30;
        const COL_NAME = 196;
        const COL_QTY = 52;
        const COL_UNIT = 80;
        const COL_TOT = PW - COL_IDX - COL_NAME - COL_QTY - COL_UNIT;
        const cols = [
          { label: '#', w: COL_IDX },
          { label: this.t('Urun / Hizmet'), w: COL_NAME },
          { label: this.t('Miktar'), w: COL_QTY },
          { label: `${this.t('B.Fiyat')} (${cs})`, w: COL_UNIT },
          { label: `${this.t('Toplam KDV Haric')} (${cs})`, w: COL_TOT },
        ];

        // Tablo başlığı çiz (yeni sayfada da tekrar kullanılmak üzere fonksiyon)
        const drawTableHeader = (y: number) => {
          doc.rect(ML, y, PW, HEADER_H).fill(primary);
          let colX = ML;
          cols.forEach((col, colIdx) => {
            txt(col.label, colX + 3, y + 5, {
              size: 7.5, bold: true, color: '#ffffff', width: col.w - 6,
              align: colIdx === 1 ? 'left' : (colIdx === 4 ? 'right' : 'center'),
            });
            colX += col.w;
          });
          return y + HEADER_H;
        };

        let rowY = drawTableHeader(tableY);
        const softLayout = data.layout === 'order_form';

        data.items.forEach((item, idx) => {
          const imgBuf = itemImageBuffers[idx];
          const lineDetailRaw = (item as LineItem).lineDetail
            ? String((item as LineItem).lineDetail).trim()
            : '';

          const imageScale = 1.15;
          const thumb = Math.round(22 * imageScale);
          const thumbSz = Math.round(26 * imageScale);
          const namePadSoft = imgBuf ? thumbSz + 8 : 4;
          const namePadDefault = imgBuf ? thumb + 8 : 6;
          const nameWSoft = cols[1].w - namePadSoft - 4;
          const nameWDefault = cols[1].w - namePadDefault - 3;

          R(); doc.fontSize(9);
          const nameHSoft = doc.heightOfString(this.t(item.name), { width: nameWSoft });
          R(); doc.fontSize(8);
          const nameHDefault = doc.heightOfString(this.t(item.name), { width: nameWDefault });
          R(); doc.fontSize(7);
          const detailHSoft = lineDetailRaw ? doc.heightOfString(this.t(lineDetailRaw), { width: nameWSoft }) : 0;
          R(); doc.fontSize(7);
          const detailHDefault = lineDetailRaw ? doc.heightOfString(this.t(lineDetailRaw), { width: nameWDefault }) : 0;

          const itemH = softLayout
            ? Math.max(32, imgBuf ? 36 : 0, 6 + nameHSoft + (lineDetailRaw ? 2 + detailHSoft : 0) + 8)
            : 0;

          const rowHDefault = Math.max(
            imgBuf ? 34 : 0,
            6 + nameHDefault + (lineDetailRaw ? 2 + detailHDefault : 0) + 6,
            ROW_H,
          );

          const blockH = softLayout ? itemH + 6 : rowHDefault;

          // FIX 5: TABLE_ROW_BOTTOM_PAD gerçekçi rezervle sayfa taşmasını önler
          //        Yeni sayfada tablo başlığı da yeniden çiziliyor
          if (rowY + blockH + 8 > PAGE_H - TABLE_ROW_BOTTOM_PAD) {
            doc.addPage({ margin: 0 });
            doc.rect(0, 0, doc.page.width, 8).fill(primary);
            rowY = drawTableHeader(20);
          }

          if (softLayout) {
            doc.roundedRect(ML, rowY, PW, itemH, 3).fill(idx % 2 === 0 ? '#f4f6f9' : '#eef1f6');
            let rx = ML + 8;
            B(); doc.fontSize(8).fillColor(primary);
            doc.text(String(idx + 1), rx, rowY + 8, { width: cols[0].w - 4, align: 'center', lineBreak: false });
            rx += cols[0].w;
            const nameColLeft = rx;
            const namePad = imgBuf ? thumbSz + 8 : 4;
            if (imgBuf) {
              try { doc.image(imgBuf, nameColLeft + 2, rowY + 5, { width: thumbSz, height: thumbSz, fit: [thumbSz, thumbSz] }); } catch { /* */ }
            }
            R(); doc.fontSize(9).fillColor('#222');
            doc.text(this.t(item.name), nameColLeft + namePad, rowY + 6, { width: cols[1].w - namePad - 4, lineBreak: true });
            if (lineDetailRaw) {
              doc.fontSize(7).fillColor('#444444');
              doc.text(this.t(lineDetailRaw), nameColLeft + namePad, rowY + 6 + nameHSoft + 2, { width: cols[1].w - namePad - 4, lineBreak: true });
            }
            rx += cols[1].w;
            doc.fontSize(8).fillColor('#333');
            doc.text(String(item.quantity), rx, rowY + 10, { width: cols[2].w - 6, align: 'center', lineBreak: false });
            rx += cols[2].w;
            doc.text(item.unitPrice.toFixed(2), rx, rowY + 10, { width: cols[3].w - 6, align: 'center', lineBreak: false });
            rx += cols[3].w;
            B(); doc.fillColor(primary);
            doc.text((item.unitPrice * item.quantity).toFixed(2), rx, rowY + 10, { width: cols[4].w - 6, align: 'right', lineBreak: false });
            rowY += itemH + 6;
          } else {
            if (idx % 2 === 1) doc.rect(ML, rowY, PW, rowHDefault).fill('#f9f9f9');
            let rx = ML;
            R(); doc.fontSize(8).fillColor('#333');
            doc.text(String(idx + 1), rx + 3, rowY + 6, { width: cols[0].w - 6, align: 'center', lineBreak: false }); rx += cols[0].w;
            const nameColX = rx;
            const pad = imgBuf ? thumb + 8 : 6;
            if (imgBuf) {
              try { doc.image(imgBuf, nameColX + 3, rowY + 4, { width: thumb, height: thumb, fit: [thumb, thumb] }); } catch { /* */ }
            }
            R(); doc.fontSize(8).fillColor('#333333');
            const nameBlockWidth = cols[1].w - pad - 3;
            const detailBlockWidth = cols[1].w - pad - 3;
            const nameHeight = doc.heightOfString(this.t(item.name), { width: nameBlockWidth, align: 'center' });
            const detailHeight = lineDetailRaw ? doc.heightOfString(this.t(lineDetailRaw), { width: detailBlockWidth, align: 'center' }) : 0;
            const stackedHeight = nameHeight + (lineDetailRaw ? 2 + detailHeight : 0);
            const contentStartY = rowY + Math.max(4, (rowHDefault - stackedHeight) / 2);
            doc.text(this.t(item.name), nameColX + pad, contentStartY, { width: nameBlockWidth, align: 'left', lineBreak: true });
            if (lineDetailRaw) {
              doc.fontSize(7).fillColor('#444444');
              doc.text(this.t(lineDetailRaw), nameColX + pad, contentStartY + nameHeight + 2, { width: detailBlockWidth, align: 'left', lineBreak: true });
            }
            rx += cols[1].w;
            txt(String(item.quantity), rx + 3, rowY + 6, { size: 8, width: cols[2].w - 6, align: 'center' }); rx += cols[2].w;
            txt(item.unitPrice.toFixed(2), rx + 3, rowY + 6, { size: 8, width: cols[3].w - 6, align: 'center' }); rx += cols[3].w;
            txt((item.unitPrice * item.quantity).toFixed(2), rx + 3, rowY + 6, { size: 8, width: cols[4].w - 6, align: 'right' });
            rowY += rowHDefault;
          }
        });

        doc.moveTo(ML, rowY).lineTo(ML + PW, rowY).lineWidth(0.5).strokeColor('#cccccc').stroke();
        rowY += 12;

        // ── SUMMARY ──────────────────────────────────────────────────────
        const sumX = ML + PW - 220;
        const lblW = 125;
        const valW = 95;

        const sumRow = (label: string, value: string, y: number, bold = false, color = '#333333') => {
          const hL = txt(label, sumX, y, { size: 9, bold, color, width: lblW, lineBreak: true });
          const hR = txt(value, sumX + lblW, y, { size: 9, bold, color, width: valW, align: 'right', lineBreak: false });
          return Math.max(hL, hR, 11) + 6;
        };

        const vatAmt = Number.isFinite(data.vatTotal) ? data.vatTotal : 0;
        const subEx = Math.round((Number(data.subtotal) || 0) * 100) / 100;
        const discAmt = Math.round((Number(data.discountTotal) || 0) * 100) / 100;
        const hasGeneralDiscount = discAmt > 0.005;
        const subBeforeDiscount = Math.round((subEx + discAmt) * 100) / 100;

        // FIX 6: Özet bloğu tek parça olarak sığmıyorsa yeni sayfa aç
        const estimateSumRowH = (label: string, value: string) => {
          R(); doc.fontSize(9);
          return Math.max(
            doc.heightOfString(this.t(label), { width: lblW }),
            doc.heightOfString(value, { width: valW, align: 'right' }),
            11,
          ) + 6;
        };
        const uniqueVatRates = [
          ...new Set((data.items ?? []).map((i) => Math.round(Number((i as LineItem).vatRate) || 0))),
        ].filter((r) => r > 0);
        const singleVatPercent = uniqueVatRates.length === 1 ? uniqueVatRates[0] : null;
        const kdvLabel = singleVatPercent != null ? `KDV Tutari (%${singleVatPercent}):` : 'KDV Tutari:';

        const summaryNeeded =
          estimateSumRowH('Ara Tutar (KDV haric):', fmtMoney(hasGeneralDiscount ? subBeforeDiscount : subEx)) +
          (hasGeneralDiscount ? estimateSumRowH('Iskontolu Ara Tutar (KDV haric):', fmtMoney(subEx)) : 0) +
          estimateSumRowH(kdvLabel, fmtMoney(vatAmt)) +
          Math.max(
            doc.heightOfString(this.t('GENEL TOPLAM (KDV dahil):'), { width: lblW }),
            doc.heightOfString(fmtMoney(data.grandTotal), { width: valW }),
            12,
          ) + 16 + 10;

        rowY = ensureSpace(rowY, summaryNeeded + 4);

        rowY += sumRow(this.t('Ara Tutar (KDV haric):'), fmtMoney(hasGeneralDiscount ? subBeforeDiscount : subEx), rowY);
        if (hasGeneralDiscount) {
          rowY += sumRow(this.t('Iskontolu Ara Tutar (KDV haric):'), fmtMoney(subEx), rowY, true, primary);
        }
        rowY += sumRow(this.t(kdvLabel), fmtMoney(vatAmt), rowY);

        const labelGT = this.t('GENEL TOPLAM (KDV dahil):');
        const valGT = fmtMoney(data.grandTotal);
        B(); doc.fontSize(9); doc.fillColor('#ffffff');
        const hGTLabel = doc.heightOfString(labelGT, { width: lblW });
        const hGTVal = doc.heightOfString(valGT, { width: valW, align: 'right' });
        const innerH = Math.max(hGTLabel, hGTVal, 12);
        const boxPad = 8;
        const boxH = boxPad + innerH + boxPad;
        doc.rect(sumX - 4, rowY, lblW + valW + 8, boxH).fill(primary);
        txt(labelGT, sumX, rowY + boxPad, { size: 9, bold: true, color: '#ffffff', width: lblW, lineBreak: true });
        txt(valGT, sumX + lblW, rowY + boxPad, { size: 9, bold: true, color: '#ffffff', width: valW, align: 'right', lineBreak: false });
        rowY += boxH + 10;

        // ── NOTES / TERMS / BANK ─────────────────────────────────────────
        rowY += 6;
        const rawTermsSource = this.hasMeaningfulText(data.termsOverride)
          ? String(data.termsOverride)
          : settings.terms;
        const rawFooterSource = this.hasMeaningfulText(data.footerNoteOverride)
          ? String(data.footerNoteOverride)
          : settings.footerNote;
        const termsText = this.htmlToPlainText(rawTermsSource);
        const footerNoteText = this.htmlToPlainText(rawFooterSource);

        if (data.notes) {
          const notesRaw = data.notes;
          const notesPlain = this.htmlToPlainText(notesRaw);
          R(); doc.fontSize(8).fillColor('#444');
          if (String(notesRaw).includes('<')) {
            // FIX 7: richTxt içinde satır başı kontrolü var, direkt çağır
            rowY += richTxt(String(notesRaw), ML, rowY, { width: PW, size: 8, color: '#444' }) + 6;
          } else {
            const h = doc.heightOfString(this.t(notesPlain), { width: PW }) + 8;
            rowY = ensureSpace(rowY, h + 8, textFlowBottomPad);
            doc.text(this.t(notesPlain), ML, rowY, { width: PW, lineBreak: true });
            rowY += h + 6;
          }
        }

        if (termsText) {
          rowY += 4;
          const termsBlockWidth = PW;
          const termsIsHtml = String(rawTermsSource).includes('<');

          R(); doc.fontSize(7.5);
          const firstParagraph = this.t(termsText).split(/\n{2,}/).find((p) => p.trim().length > 0) || this.t(termsText);
          const firstParagraphH = doc.heightOfString(firstParagraph.replace(/\n/g, ' \n'), { width: termsBlockWidth });
          const htmlIntroEstimate = Math.max(doc.heightOfString(this.t(termsText), { width: termsBlockWidth }) * 0.25, 24);
          const minTermsBody = termsIsHtml ? htmlIntroEstimate : Math.max(firstParagraphH, 24);
          const termsHeaderReserve = 12 + 6 + minTermsBody + 6;

          rowY = ensureSpace(rowY, termsHeaderReserve, textFlowBottomPad);
          R(); doc.fontSize(8.5).fillColor(primary);
          doc.text(this.t('Sartlar ve Kosullar'), ML, rowY, { width: PW, lineBreak: false });
          rowY += 12;
          doc.moveTo(ML, rowY - 2).lineTo(ML + PW, rowY - 2).lineWidth(0.4).strokeColor(primary).stroke();
          rowY += 6;
          R(); doc.fontSize(7.5).fillColor('#333333');
          if (termsIsHtml) {
            rowY += richTxt(String(rawTermsSource), ML, rowY, { width: termsBlockWidth, size: 7.5, color: '#333333' }) + 3;
          } else {
            const paragraphs = this.t(termsText).split(/\n{2,}/);
            for (const p of paragraphs) {
              const block = p.replace(/\n/g, ' \n');
              const hBlock = doc.heightOfString(block, { width: termsBlockWidth }) + 3;
              rowY = ensureSpace(rowY, hBlock + 10, textFlowBottomPad);
              doc.text(block, ML, rowY, { width: termsBlockWidth, lineBreak: true });
              rowY += hBlock + 3;
            }
          }
          rowY += 6;
        }

        if (footerNoteText) {
          R(); doc.fontSize(8).fillColor('#444');
          if (String(rawFooterSource).includes('<')) {
            rowY += richTxt(String(rawFooterSource), ML, rowY, { width: PW, size: 8, color: '#444' }) + 8;
          } else {
            const h = doc.heightOfString(this.t(footerNoteText), { width: PW }) + 8;
            rowY = ensureSpace(rowY, h + 8, textFlowBottomPad);
            doc.text(this.t(footerNoteText), ML, rowY, { width: PW, lineBreak: true });
            rowY += h + 8;
          }
        }

        if (settings.bankInfo || settings.bank2Info || bankQrBuffer) {
          const qrSize = bankQrBuffer ? 110 : 0;
          const qrGap = bankQrBuffer ? 10 : 0;
          const textW = bankQrBuffer ? Math.max(160, PW - qrSize - qrGap) : PW;
          const halfW = textW > 20 ? (textW - 10) / 2 : textW;

          R(); doc.fontSize(8).fillColor('#444');
          let h1 = 0;
          let h2 = 0;
          if (settings.bankInfo) h1 = doc.heightOfString(this.t(settings.bankInfo), { width: halfW });
          if (settings.bank2Info) h2 = doc.heightOfString(this.t(settings.bank2Info), { width: halfW });
          const textH = Math.max(h1, h2);
          const blockH = Math.max(textH, qrSize);
          const approxTitle = 16;
          const bankSectionHeight = approxTitle + blockH + 10;
          const signatureReserve = settings.showSignatureArea ? SIG_TOP_GAP + SIG_BLOCK_H + 8 : 0;

          // Banka + imza aynı sayfada kalsın; sadece footer şeridi kadar rezerv tut
          rowY = ensureSpace(rowY, bankSectionHeight + signatureReserve, FOOTER_STRIP_H + 10);

          rowY += txt(this.t('Banka Bilgileri:'), ML, rowY, { size: 8.5, bold: true, width: PW, lineBreak: true }) + 2;
          const yBank = rowY;
          R(); doc.fontSize(8).fillColor('#444');
          if (settings.bankInfo) doc.text(this.t(settings.bankInfo), ML, yBank, { width: halfW, lineBreak: true });
          if (settings.bank2Info) doc.text(this.t(settings.bank2Info), ML + halfW + 10, yBank, { width: halfW, lineBreak: true });
          if (bankQrBuffer) {
            try {
              const qy = yBank + (textH > qrSize ? textH - qrSize : 0);
              doc.image(bankQrBuffer, ML + textW + qrGap, qy, { width: qrSize, height: qrSize, fit: [qrSize, qrSize] });
            } catch { /* geçersiz görsel */ }
          }
          rowY = yBank + blockH + 10;
        }

        // ── SIGNATURE ────────────────────────────────────────────────────
        if (settings.showSignatureArea) {
          // İçeriğin hemen altına yerleştir — sayfanın en altına sabitlenmez
          const sigNeeded = SIG_TOP_GAP + SIG_BLOCK_H + 16;
          rowY = ensureSpace(rowY, sigNeeded, FOOTER_STRIP_H + 10);
          const sigY = rowY + SIG_TOP_GAP;

          if (settings.showAuthorizedSignature) {
            doc.moveTo(ML, sigY).lineTo(ML + 150, sigY).lineWidth(0.4).strokeColor('#aaaaaa').stroke();
            txt(this.t('Yetkili Imza / Kase'), ML, sigY + 4, { size: 8, color: '#666' });
          }
          doc.moveTo(ML + PW - 150, sigY).lineTo(ML + PW, sigY).lineWidth(0.4).strokeColor('#aaaaaa').stroke();
          txt(this.t('Musteri Imza / Kase'), ML + PW - 150, sigY + 4, { size: 8, color: '#666' });
          rowY = sigY + SIG_BLOCK_H;
        }

        // ── FOOTER ───────────────────────────────────────────────────────
        const footerY = PAGE_H - 20;
        doc.moveTo(ML, footerY - 8).lineTo(ML + PW, footerY - 8).lineWidth(0.3).strokeColor('#dddddd').stroke();

        doc.end();
      } catch (err: any) {
        this.logger.error(`PDF olusturma hatasi: ${err.message}`, err.stack);
        done(err);
      }
    });
  }

  async generateOrderConfirmationPdf(data: OrderConfirmationPdfData): Promise<string> {
    const discountLine =
      data.discountTotal > 0.005
        ? data.discountLabel
          ? `${this.t('Genel iskonto uygulandi')}: ${this.t(data.discountLabel)}`
          : this.t('Genel iskonto uygulandi')
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