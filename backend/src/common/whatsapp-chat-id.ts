/**
 * WAHA / WhatsApp DM chatId (…@c.us) için yerel 0 ile başlayan TR numaralarını uluslararası forma çevirir.
 * Örn. 05551234567@c.us → 905551234567@c.us
 */
export function normalizeWhatsappChatId(chatId: string): string {
  const raw = (chatId || '').trim();
  if (!raw) return raw;
  const at = raw.lastIndexOf('@');
  if (at < 1) return raw;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1).toLowerCase();
  if (domain !== 'c.us') return raw;

  let d = local.replace(/\D/g, '');
  if (!d) return raw;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0') && d[1] === '5') d = `90${d.slice(1)}`;
  if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
  return `${d}@${domain}`;
}
