/** WhatsApp JID veya ham numaradan karşılaştırma için normalize edilmiş rakamlar (ülke kodu ile, örn. 90532...) */
export function waPhoneToDigits(phone: string): string {
  const base = phone.split('@')[0] || phone;
  return base.replace(/\D/g, '');
}

export function normalizeComparablePhone(phone: string): string {
  let d = waPhoneToDigits(phone);
  if (d.length === 10 && d.startsWith('5')) d = '90' + d;
  return d;
}

/** T-Soft API için mobil alan (+905321234567) */
export function formatPhoneForTsoft(phone: string): string {
  const d = normalizeComparablePhone(phone);
  if (!d) return '';
  return `+${d}`;
}

export function normalizeTsoftPhone(mobile: string | null | undefined): string {
  if (!mobile) return '';
  return normalizeComparablePhone(mobile);
}
