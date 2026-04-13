/**
 * Kişi telefonu için tek biçim (WhatsApp/WAHA ile uyumlu, TR 0 → 90).
 */
export function canonicalContactPhone(phone: string): string {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0') && d[1] === '5') d = `90${d.slice(1)}`;
  if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
  return d;
}

/** Veritabanında eşleşme için olası anahtarlar (eski 0555 / 555 kayıtları) */
export function contactPhoneLookupKeys(phone: string): string[] {
  const canonical = canonicalContactPhone(phone);
  const raw = String(phone ?? '').replace(/\D/g, '');
  const keys = new Set<string>();
  if (canonical) keys.add(canonical);
  if (raw) keys.add(raw);
  if (canonical.startsWith('90') && canonical.length === 12) {
    keys.add(`0${canonical.slice(2)}`);
    keys.add(canonical.slice(2));
  }
  return [...keys];
}
