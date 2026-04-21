'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  FileText,
  LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Item = {
  href: string;
  label: string;
  /** Özet: yalnızca /accounting kökü */
  match?: 'accounting-home';
  /** Faturalar alt sayfasında sekme (URL ?tab=) */
  invoiceTab?: 'default' | 'pending';
};

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Genel',
    items: [{ href: '/accounting', label: 'Özet pano', match: 'accounting-home' }],
  },
  {
    title: 'Faturalama',
    items: [
      { href: '/accounting/invoices', label: 'Faturalar', invoiceTab: 'default' },
      {
        href: '/accounting/invoices?tab=pending',
        label: 'Fatura bekleyenler',
        invoiceTab: 'pending',
      },
    ],
  },
];

function itemActive(
  pathname: string | null,
  searchParams: ReturnType<typeof useSearchParams>,
  item: Item,
): boolean {
  if (!pathname) return false;

  if (item.match === 'accounting-home') {
    return pathname === '/accounting' || pathname === '/accounting/';
  }

  if (item.invoiceTab) {
    const onInvoices =
      pathname === '/accounting/invoices' || pathname.startsWith('/accounting/invoices/');
    if (!onInvoices) return false;
    const tab = searchParams.get('tab');
    if (item.invoiceTab === 'pending') return tab === 'pending';
    return tab !== 'pending';
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function itemIcon(item: Item) {
  if (item.match === 'accounting-home') return LayoutDashboard;
  return FileText;
}

export default function AccountingSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <aside className="w-full lg:w-60 shrink-0 lg:border-r border-gray-100 lg:pr-5 pb-4 lg:pb-0">
      <div className="rounded-xl border border-gray-100 bg-gradient-to-b from-white to-gray-50/80 p-4 shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-whatsapp/10 text-whatsapp">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Muhasebe</p>
          </div>
        </div>

        <nav className="space-y-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = itemActive(pathname, searchParams, item);
                  const Icon = itemIcon(item);

                  return (
                    <li key={`${item.href}-${item.invoiceTab ?? ''}`}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-whatsapp/12 text-whatsapp'
                            : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0 opacity-80" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
