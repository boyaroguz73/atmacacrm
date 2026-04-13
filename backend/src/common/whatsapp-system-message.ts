/**
 * WAHA / whatsapp-web.js gelen payload'larında sistem ve E2E bildirimlerini ayırt etmek için.
 * Bu mesajlar gerçek kullanıcı mesajı değildir; DB'ye yazılmamalı.
 */

const ZW_SPACE = /[\u200B-\u200D\uFEFF]/g;
const BIDI = /[\u200E\u200F]/g;

/** Webhook / sync için mesaj gövdesini olası tüm alanlardan toplar. */
export function collectWhatsappMessageText(msg: any): string {
  if (!msg || typeof msg !== 'object') return '';
  const chunks: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) chunks.push(v);
  };
  push(msg.body);
  push(msg.caption);
  push(msg._data?.body);
  push(msg._data?.caption);
  // Bazı sürümlerde gövde nested gelir
  if (msg._data?.quotedMsg && typeof msg._data.quotedMsg.body === 'string') {
    push(msg._data.quotedMsg.body);
  }
  return chunks.join('\n').trim();
}

function normalizeForMatch(s: string): string {
  return s
    .replace(ZW_SPACE, '')
    .replace(BIDI, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

/**
 * Uçtan uca şifreleme / güvenlik kodu değişimi gibi sistem içerikleri.
 * (Gerçek sohbet metninde nadiren geçer; yanlış pozitif riski düşük.)
 */
export function isWhatsappE2eOrSecuritySystemText(raw: string): boolean {
  const t = normalizeForMatch(raw);
  if (!t) return false;

  // İngilizce
  if (t.includes('end-to-end encrypted')) return true;
  if (t.includes('changed their security code')) return true;
  if (t.includes('your security code with') && t.includes('changed')) return true;
  if (t.includes('security code') && t.includes('changed')) return true;

  // Türkçe (farklı WhatsApp sürüm metinleri)
  if (t.includes('mesajlar ve aramalar')) return true;
  if (t.includes('uctan uca')) return true;
  if (t.includes('sifrelidir')) return true;

  // Güvenlik kodu / numarası değişti bildirimleri (dar eşleşme; yanlış pozitif azaltılır)
  if (t.includes('guvenlik')) {
    const codeRef =
      t.includes('guvenlik kodu') ||
      t.includes('guvenlik kodunuz') ||
      t.includes('guvenlik numaraniz') ||
      t.includes('guvenlik numarasi') ||
      /\bguvenlik\s+kodu\b/.test(t) ||
      /\bguvenlik\s+numara/.test(t);
    const changed =
      t.includes('degisti') ||
      t.includes('degistirildi') ||
      /\bdegisimi\b/.test(t) ||
      t.includes('kodunu degistirdi');
    if (codeRef && changed) return true;
  }

  return false;
}

