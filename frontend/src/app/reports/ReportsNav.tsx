'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/reports', label: 'Özet' },
  { href: '/reports/messages', label: 'Mesajlar' },
  { href: '/reports/cash', label: 'Kasa' },
  { href: '/reports/funnel', label: 'Huni' },
  { href: '/reports/categories', label: 'Kategori satışı' },
  { href: '/reports/products', label: 'Satılan ürünler' },
  { href: '/reports/invoices', label: 'Faturalar' },
  { href: '/reports/contacts', label: 'Konuşulan kişiler' },
  { href: '/reports/agents', label: 'Temsilciler' },
] as const;

export default function ReportsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 pb-3 mb-6">
      {LINKS.map(({ href, label }) => {
        const active = href === '/reports' ? pathname === '/reports' : pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              active ? 'bg-whatsapp text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
