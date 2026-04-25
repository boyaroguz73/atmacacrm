'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { History, Activity } from 'lucide-react';

const LINKS = [
  { href: '/reports', label: 'Özet' },
  { href: '/reports/sales', label: 'Satış trendi' },
  { href: '/reports/funnel', label: 'Huni' },
  { href: '/reports/categories', label: 'Kategori satışı' },
  { href: '/reports/products', label: 'Satılan ürünler' },
  { href: '/reports/agents', label: 'Temsilciler' },
] as const;

export default function ReportsNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
      <nav className="flex flex-wrap gap-1">
        {LINKS.map(({ href, label }) => {
          const active =
            href === '/reports'
              ? pathname === '/reports'
              : pathname === href || pathname?.startsWith(`${href}/`);
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

      <div className="flex items-center gap-1.5">
        <Link
          href="/admin/history"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <History className="w-3.5 h-3.5" />
          Konuşma Geçmişi
        </Link>
        <Link
          href="/admin/audit-log"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <Activity className="w-3.5 h-3.5" />
          Aktivite Logu
        </Link>
      </div>
    </div>
  );
}
