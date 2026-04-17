import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Statik dosya / medya için API HTTP kökü (`NEXT_PUBLIC_API_URL` içinden `/api` kırpılır). */
export function backendPublicUrl(): string {
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (api) {
    const base = api.replace(/\/api\/?$/, '').trim();
    if (base) return base;
  }
  const ws = process.env.NEXT_PUBLIC_WS_URL || '';
  if (ws.startsWith('wss://')) return `https://${ws.slice(6)}`;
  if (ws.startsWith('ws://')) return `http://${ws.slice(5)}`;
  if (ws.startsWith('http')) return ws.replace(/\/api\/?$/, '');
  return 'http://localhost:4000';
}

/**
 * Veritabanında `http://localhost:4000/uploads/...` gibi kayıtlı URL'leri,
 * tarayıcıda gerçek sunucu adresine çevirir (Docker / uzak kurulum).
 */
export function rewriteMediaUrlForClient(url: string): string {
  try {
    if (!url.startsWith('http')) return url;
    const u = new URL(url);
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return url;
    const baseStr = backendPublicUrl();
    const b = new URL(baseStr.startsWith('http') ? baseStr : `http://${baseStr}`);
    return `${b.origin}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Sadece rakamlar (ülke kodu ile birlikte, örn. 905551234567) */
export function digitsOnlyPhone(phone: string | null | undefined): string {
  if (phone == null) return '';
  return String(phone).replace(/\D/g, '');
}

/** TR yerel formatını WAHA chatId rakamlarına çevirir (0555… → 90555…) */
export function normalizePhoneDigitsForWaha(
  phone: string | null | undefined,
): string {
  let d = digitsOnlyPhone(phone);
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0') && d[1] === '5') d = `90${d.slice(1)}`;
  if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
  return d;
}

/** Kişi telefonundan WhatsApp DM chatId (905551234567@c.us) */
export function phoneToWhatsappChatId(phone: string | null | undefined): string {
  const d = normalizePhoneDigitsForWaha(phone);
  return d ? `${d}@c.us` : '';
}

export function formatPhone(phone: string | null | undefined): string {
  if (phone == null || phone === '') return '—';
  const raw = String(phone).trim();
  if (raw.toLowerCase().startsWith('lid:')) {
    const id = raw.slice(4).replace(/\D/g, '');
    return id.length ? `WhatsApp · …${id.slice(-4)}` : 'WhatsApp (LID)';
  }
  if (raw.toLowerCase().startsWith('group:')) {
    return 'WhatsApp Grubu';
  }

  const digits = digitsOnlyPhone(phone);
  if (!digits) return raw.startsWith('+') ? raw : `+${raw}`;

  let d = digits;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0') && d[1] === '5') d = `90${d.slice(1)}`;
  if (d.length === 10 && d.startsWith('5')) d = `90${d}`;

  if (d.length === 12 && d.startsWith('90')) {
    const rest = d.slice(2);
    return `+90 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8)}`;
  }

  // Çok uzun rakam dizileri (yanlışlıkla LID / iç kimlik gibi kayıtlı) okunaklı kısalt
  if (d.length > 15) {
    return `Kimlik · …${d.slice(-4)}`;
  }

  return `+${d}`;
}

export function formatTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return formatTime(date);
  if (days === 1) return 'Dün';
  if (days < 7) return d.toLocaleDateString('tr-TR', { weekday: 'short' });
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

function looksLikeFallbackName(name: string, phone: string | null | undefined): boolean {
  if (/^WhatsApp/i.test(name)) return true;
  const stripped = name.replace(/[\s+\-().·…]/g, '');
  if (/^\d{7,15}$/.test(stripped)) return true;
  if (phone) {
    const pd = String(phone).replace(/\D/g, '');
    if (pd && stripped === pd) return true;
  }
  return false;
}

/** Başlık: ad+soyad; yoksa formatlı telefon */
export function getContactDisplayTitle(contact: {
  name?: string | null;
  surname?: string | null;
  phone?: string | null;
}): string {
  const parts = [contact.name, contact.surname].filter(Boolean).map(s => (s as string).trim()).filter(Boolean);
  const t = parts.join(' ');
  if (t && !looksLikeFallbackName(t, contact.phone)) return t;
  return formatPhone(contact.phone);
}

const normLabel = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Alt satırda telefon: başlık telefon metniyle aynı değilse göster */
export function getContactSecondaryPhoneLine(contact: {
  name?: string | null;
  surname?: string | null;
  phone?: string | null;
}): string | null {
  const phone = formatPhone(contact.phone);
  if (!phone || phone === '—') return null;
  const title = getContactDisplayTitle(contact);
  if (normLabel(title) === normLabel(phone)) return null;
  return phone;
}
