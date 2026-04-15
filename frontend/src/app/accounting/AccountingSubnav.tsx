'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/accounting', label: 'Özet' },
  { href: '/accounting/invoices', label: 'Faturalar' },
  { href: '/accounting/cash', label: 'Kasa' },
  { href: '/accounting/ledger', label: 'Gelen / Giden' },
  { href: '/accounting/delivery-notes', label: 'İrsaliyeler' },
] as const;

export default function AccountingSubnav() {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === '/accounting') {
      return pathname === '/accounting' || pathname === '/accounting/';
    }
    return pathname === href || pathname?.startsWith(`${href}/`);
  };
  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-100 pb-3 mb-6">
      {LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            isActive(href)
              ? 'bg-whatsapp/10 text-whatsapp'
              : 'text-gray-600 hover:bg-gray-50',
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
