/**
 * WhatsApp JID tipleri
 */
export type WhatsAppJidType =
  | 'individual'
  | 'group'
  | 'lid'
  | 'broadcast'
  | 'newsletter'
  | 'status'
  | 'unknown';

/**
 * WhatsApp JID'sinin tipini belirle
 */
export function getWhatsAppJidType(jid: string): WhatsAppJidType {
  if (!jid) return 'unknown';
  const lower = jid.toLowerCase();
  
  if (lower.endsWith('@c.us')) return 'individual';
  if (lower.endsWith('@g.us')) return 'group';
  if (lower.endsWith('@lid')) return 'lid';
  if (lower.includes('@broadcast')) return 'broadcast';
  if (lower.includes('@newsletter')) return 'newsletter';
  if (lower.startsWith('status@') || lower === 'status@broadcast') return 'status';
  
  return 'unknown';
}

/**
 * Bir JID'nin bireysel sohbet (DM) olup olmadığını kontrol et
 */
export function isIndividualChat(jid: string): boolean {
  return getWhatsAppJidType(jid) === 'individual';
}

/**
 * Bir JID'nin grup sohbeti olup olmadığını kontrol et
 */
export function isGroupChat(jid: string): boolean {
  return getWhatsAppJidType(jid) === 'group';
}

/**
 * Bir JID'nin işlenmesi gereken sohbet tipi olup olmadığını kontrol et
 * (bireysel veya grup - broadcast, newsletter, status hariç)
 */
export function isProcessableChat(jid: string): boolean {
  const type = getWhatsAppJidType(jid);
  return type === 'individual' || type === 'group' || type === 'lid';
}

/** WhatsApp LID (@lid) sohbeti — kişi anahtarı `lid:<rakamlar>` */
export function isLidChat(jid: string): boolean {
  return getWhatsAppJidType(jid) === 'lid';
}

/** 123456789012345@lid → lid:123456789012345 (contact.phone için) */
export function lidJidToContactPhone(jid: string): string | null {
  if (!isLidChat(jid)) return null;
  const m = String(jid).trim().match(/^(\d+)@lid$/i);
  return m ? `lid:${m[1]}` : null;
}

/**
 * Telefon numarasının geçerli E.164 formatına yakın olup olmadığını kontrol et
 * (7-15 rakam, genellikle ülke kodu ile başlar)
 */
export function isValidPhoneNumber(phone: string): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return false;
  
  // E.164: 7-15 rakam (ülke kodu dahil)
  if (digits.length < 7 || digits.length > 15) return false;
  
  // Grup JID'leri genellikle 18+ haneli olur
  if (digits.length > 15) return false;
  
  return true;
}

/**
 * Bireysel sohbet JID'sinden (@c.us) telefon numarası çıkar
 * Sadece @c.us için çalışır, grup için null döner
 */
export function extractPhoneFromIndividualJid(jid: string): string | null {
  if (!isIndividualChat(jid)) return null;
  
  // @c.us'u kaldır ve sadece rakamları al
  const digits = jid.replace(/@c\.us$/i, '').replace(/\D/g, '');
  if (!digits) return null;
  
  // Normalize et
  const normalized = canonicalContactPhone(digits);
  
  // Geçerli telefon numarası mı kontrol et
  if (!isValidPhoneNumber(normalized)) return null;
  
  return normalized;
}

/**
 * Grup JID'sinden grup kimliğini çıkar
 * Sadece @g.us için çalışır
 */
export function extractGroupIdFromJid(jid: string): string | null {
  if (!isGroupChat(jid)) return null;
  return jid.toLowerCase(); // Tam JID'yi döndür
}

/**
 * Participant JID'sinden telefon numarası çıkar
 * Grup mesajlarında gönderenin numarasını almak için
 */
export function extractPhoneFromParticipant(participant: string | undefined | null): string | null {
  if (!participant) return null;

  const raw = String(participant).trim();
  // Yeni WhatsApp: gönderen @lid ile gelebilir (telefon yerine iç kimlik)
  if (/@lid$/i.test(raw)) {
    const digits = raw.replace(/@lid$/i, '').replace(/\D/g, '');
    return digits ? `lid:${digits}` : null;
  }

  // Participant genellikle 905551234567@c.us formatında
  // veya sadece 905551234567 olabilir
  const cleaned = raw.replace(/@.*$/, '').replace(/\D/g, '');
  if (!cleaned) return null;

  const normalized = canonicalContactPhone(cleaned);
  if (!isValidPhoneNumber(normalized)) return null;

  return normalized;
}

/**
 * Kişi telefonu için tek biçim (WhatsApp/WAHA ile uyumlu, TR 0 → 90).
 * Uluslararası numaralar olduğu gibi kalır.
 */
/** Kişiler listesi: yalnızca TR cep (E.164: 90 + 5XX…, 12 rakam) */
export function isTurkishMobileContactPhone(phone: string | null | undefined): boolean {
  const d = String(phone ?? '').replace(/\D/g, '');
  return /^90[5]\d{9}$/.test(d);
}

export function canonicalContactPhone(phone: string): string {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  
  // 00 ile başlayan uluslararası format
  if (d.startsWith('00')) d = d.slice(2);
  
  // Türkiye yerel formatları
  // 05551234567 (11 hane, 0 ile başlayan)
  if (d.length === 11 && d.startsWith('0') && d[1] === '5') {
    d = `90${d.slice(1)}`;
  }
  // 5551234567 (10 hane, 5 ile başlayan - TR mobil)
  else if (d.length === 10 && d.startsWith('5')) {
    d = `90${d}`;
  }
  
  return d;
}

/**
 * Veritabanında eşleşme için olası anahtarlar (eski 0555 / 555 kayıtları)
 */
export function contactPhoneLookupKeys(phone: string): string[] {
  const canonical = canonicalContactPhone(phone);
  const raw = String(phone ?? '').replace(/\D/g, '');
  const keys = new Set<string>();
  
  if (canonical) keys.add(canonical);
  if (raw && raw !== canonical) keys.add(raw);
  
  // TR numarası ise alternatif formatları ekle
  if (canonical.startsWith('90') && canonical.length === 12) {
    keys.add(`0${canonical.slice(2)}`); // 05551234567
    keys.add(canonical.slice(2)); // 5551234567
  }
  
  return [...keys];
}

/**
 * Telefon numarasını WhatsApp JID formatına çevir
 */
export function phoneToWhatsAppJid(phone: string): string {
  const canonical = canonicalContactPhone(phone);
  if (!canonical) return '';
  return `${canonical}@c.us`;
}

/**
 * İsim gerçek bir kişi adı mı yoksa fallback (telefon formatı, LID yer tutucu vb.) mi?
 * Fallback ise true → pushName/WAHA ismi ile güncellenmeli.
 */
export function isFallbackContactName(
  name: string | null | undefined,
  phone: string | null | undefined,
): boolean {
  if (!name?.trim()) return true;
  const n = name.trim();

  if (/^WhatsApp/i.test(n)) return true;

  if (/^(Grup|WhatsApp Grubu)$/i.test(n)) return true;

  const stripped = n.replace(/[\s+\-().·…]/g, '');
  if (/^\d{7,15}$/.test(stripped)) return true;

  if (phone) {
    const phoneDigits = String(phone).replace(/\D/g, '');
    if (phoneDigits && stripped === phoneDigits) return true;
    if (phoneDigits.length >= 7) {
      const formatted = formatPhoneDisplay(phone);
      if (formatted && formatted !== '—' && n === formatted) return true;
    }
  }

  return false;
}

/**
 * Telefon numarasını görüntüleme formatına çevir
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '—';
  
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '—';
  
  // TR numarası (12 hane, 90 ile başlar)
  if (digits.length === 12 && digits.startsWith('90')) {
    const rest = digits.slice(2);
    return `+90 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8)}`;
  }
  
  // Diğer uluslararası numaralar
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  
  // Geçersiz uzunluk - olduğu gibi göster
  return phone;
}
