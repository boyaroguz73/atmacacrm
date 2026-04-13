import { getEcommerceCustomerLabel } from '@/lib/ecommerceBadge';

export default function EcommerceCustomerBadge({ metadata }: { metadata: unknown }) {
  const label = getEcommerceCustomerLabel(metadata);
  if (!label) return null;
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-200/80"
      title="E-ticaret sitesinde kayıtlı müşteri"
    >
      {label}
    </span>
  );
}
