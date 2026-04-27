/**
 * URL/query’de gelen `YYYY-MM-DD` değerleri için UTC takvim günü sınırları.
 * `new Date('2026-04-28')` yalnızca o günün 00:00 UTC anına denk gelir; `lte` ile
 * aynı takvim günündeki kayıtların çoğu dışarıda kalır — bu yüzden bitiş için gün sonu kullanılır.
 */
export function queryDateFromGte(input: string): Date {
  const s = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  return new Date(s);
}

export function queryDateToLte(input: string): Date {
  const s = String(input || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  }
  return new Date(s);
}
