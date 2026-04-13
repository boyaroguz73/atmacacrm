export function getEcommerceCustomerLabel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as { ecommerce?: { label?: string; provider?: string } };
  if (m.ecommerce?.label) return m.ecommerce.label;
  if (m.ecommerce?.provider === 'tsoft') return 'T-Soft Site Müşterisi';
  return null;
}
