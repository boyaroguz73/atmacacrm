const SITE_CUSTOMER_LABEL = 'Site müşterisi';

export function getEcommerceCustomerLabel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as { ecommerce?: { label?: string; provider?: string } };
  if (m.ecommerce?.label) {
    const raw = String(m.ecommerce.label).trim();
    if (raw === 'T-Soft Site Müşterisi') return SITE_CUSTOMER_LABEL;
    return raw;
  }
  if (m.ecommerce?.provider === 'tsoft') return SITE_CUSTOMER_LABEL;
  return null;
}
