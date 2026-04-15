'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/products', label: 'Ürünler' },
  { href: '/products/categories', label: 'Kategoriler' },
] as const;

export default function ProductsSubnav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 pb-3 mb-6">
      {LINKS.map(({ href, label }) => {
        const active =
          href === '/products'
            ? pathname === '/products'
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
  );
}
