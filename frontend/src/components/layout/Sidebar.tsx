'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useState, useEffect, useMemo } from 'react';
import api from '@/lib/api';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Target,
  Settings,
  LogOut,
  Smartphone,
  CalendarCheck,
  CalendarDays,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Inbox,
  MessageCircleReply,
  Clock,
  UserX,
  TrendingDown,
  History,
  ShieldAlert,
  FileText,
  Zap,
  Activity,
  Building2,
  Shield,
  Package,
  LifeBuoy,
  HeadphonesIcon,
  Plug,
  ShoppingCart,
  ShoppingBag,
  Receipt,
  ClipboardList,
  Calculator,
  Truck,
} from 'lucide-react';

interface SubItem {
  href: string;
  label: string;
  icon: any;
  param?: string;
  adminOnly?: boolean;
  /** Yalnızca AGENT rolünde göster */
  agentOnly?: boolean;
}

interface MenuItem {
  href: string;
  label: string;
  icon: any;
  adminOnly?: boolean;
  superOnly?: boolean;
  accountantVisible?: boolean;
  separator?: boolean;
  children?: SubItem[];
}

const menuItems: MenuItem[] = [
  { href: '/dashboard', label: 'Gösterge Paneli', icon: LayoutDashboard, adminOnly: true },
  {
    href: '/inbox',
    label: 'Mesajlar',
    icon: MessageSquare,
    children: [
      { href: '/inbox', label: 'Gelen kutusu', icon: Inbox },
      { href: '/inbox?filter=unanswered', label: 'Cevapsızlar', icon: Clock, param: 'unanswered' },
      { href: '/inbox?filter=answered', label: 'Cevaplananlar', icon: MessageCircleReply, param: 'answered' },
      { href: '/inbox?filter=followup', label: 'Takiptekiler', icon: CalendarCheck, param: 'followup' },
    ],
  },
  { href: '/contacts', label: 'Kişiler', icon: Users },
  { href: '/leads', label: 'Potansiyel Müşteriler', icon: Target },
  { href: '/products', label: 'Ürünler', icon: ShoppingBag, adminOnly: true },
  {
    href: '/quotes',
    label: 'Teklifler',
    icon: ClipboardList,
    children: [
      { href: '/quotes', label: 'Teklif Listesi', icon: ClipboardList },
      { href: '/quotes/new', label: 'Yeni Teklif', icon: Receipt, adminOnly: true },
    ],
  },
  { href: '/orders', label: 'Siparişler', icon: Truck },
  {
    href: '/accounting',
    label: 'Muhasebe',
    icon: Calculator,
    accountantVisible: true,
    children: [
      { href: '/accounting/invoices', label: 'Faturalar', icon: Receipt },
    ],
  },
  { href: '/tasks', label: 'Görevler', icon: CalendarCheck },
  { href: '/calendar', label: 'Takvim', icon: CalendarDays },
  {
    href: '/admin',
    label: 'Yönetim',
    icon: ShieldAlert,
    adminOnly: true,
    children: [
      { href: '/inbox?filter=unassigned', label: 'Atanmamış', icon: UserX, param: 'unassigned' },
      { href: '/leads?status=LOST', label: 'Kaçırılan Müşteriler', icon: TrendingDown },
      { href: '/admin/history', label: 'Konuşma Geçmişi', icon: History },
      { href: '/admin/templates', label: 'Mesaj Şablonları', icon: FileText },
      { href: '/admin/auto-reply', label: 'Otomatik Yanıt', icon: Zap },
      { href: '/admin/audit-log', label: 'Aktivite Logu', icon: Activity },
    ],
  },
  { href: '/reports', label: 'Raporlar', icon: BarChart3, adminOnly: true },
  { href: '/admin/integrations', label: 'Entegrasyonlar', icon: Plug, adminOnly: true },
  { href: '/settings', label: 'Ayarlar', icon: Settings, adminOnly: true },
  { href: '/admin/support', label: 'Destek', icon: HeadphonesIcon, adminOnly: true },
  {
    href: '/superadmin',
    label: 'SaaS Panel',
    icon: Shield,
    superOnly: true,
    children: [
      { href: '/superadmin', label: 'Genel Bakış', icon: LayoutDashboard },
      { href: '/superadmin/users', label: 'Kullanıcılar', icon: Users },
      { href: '/superadmin/plans', label: 'Paketler', icon: Package },
      { href: '/superadmin/tickets', label: 'Destek Talepleri', icon: LifeBuoy },
      { href: '/superadmin/system', label: 'Sistem Sağlığı', icon: Activity },
    ],
  },
];

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3002';

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, organization, logout } = useAuthStore();
  const currentFilter = searchParams.get('filter');
  const currentStatus = searchParams.get('status');
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const [ecommerceMenuVisible, setEcommerceMenuVisible] = useState(false);

  useEffect(() => {
    if (!isAdmin || isSuperAdmin) {
      setEcommerceMenuVisible(false);
      return;
    }
    let cancelled = false;
    api
      .get('/ecommerce/status')
      .then(({ data }) => {
        if (!cancelled) setEcommerceMenuVisible(!!data?.menuVisible);
      })
      .catch(() => {
        if (!cancelled) setEcommerceMenuVisible(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, isSuperAdmin]);

  const isAccountant = user?.role === 'ACCOUNTANT';

  const visibleMenuItems = useMemo(() => {
    const filtered = menuItems.filter((item) => {
      if (isSuperAdmin) return !!item.superOnly;
      if (item.superOnly) return false;
      if (item.adminOnly) return isAdmin;
      if (item.accountantVisible) return isAdmin || isAccountant;
      return true;
    });
    if (!isSuperAdmin && isAdmin && ecommerceMenuVisible) {
      const idx = filtered.findIndex((i) => i.href === '/admin/integrations');
      const ecommerceBlock: MenuItem = {
        href: '/ecommerce',
        label: 'E-Ticaret',
        icon: ShoppingCart,
        adminOnly: true,
        children: [
          { href: '/ecommerce/products', label: 'Ürünler', icon: Package },
          { href: '/ecommerce/orders', label: 'Siparişler', icon: ShoppingBag },
        ],
      };
      if (idx >= 0) {
        return [...filtered.slice(0, idx), ecommerceBlock, ...filtered.slice(idx)];
      }
      return [...filtered, ecommerceBlock];
    }
    return filtered;
  }, [isAdmin, isSuperAdmin, ecommerceMenuVisible]);

  const getInitialExpanded = () => {
    const active: string[] = [];
    if (pathname.startsWith('/ecommerce')) active.push('/ecommerce');
    for (const item of menuItems) {
      if (item.children?.some((c) => {
        if (c.param) return pathname === '/inbox' && currentFilter === c.param;
        if (c.href.includes('?status=')) {
          const s = new URL(c.href, 'http://x').searchParams.get('status');
          return pathname === '/leads' && currentStatus === s;
        }
        if (c.href === '/inbox' && !c.param) return pathname === '/inbox' && !currentFilter;
        return pathname === c.href || pathname.startsWith(c.href);
      })) {
        active.push(item.href);
      }
    }
    if (pathname === '/inbox' && !currentFilter && !active.includes('/inbox')) {
      active.push('/inbox');
    }
    return active;
  };

  const [expandedMenus, setExpandedMenus] = useState<string[]>(getInitialExpanded);

  useEffect(() => {
    const activeParent = visibleMenuItems.find((item) =>
      item.children?.some((c) => {
        if (c.param) return pathname === '/inbox' && currentFilter === c.param;
        if (c.href.includes('?status=')) return false;
        if (c.href === '/inbox' && !c.param) return pathname === '/inbox' && !currentFilter;
        return pathname === c.href || pathname.startsWith(c.href + '/');
      }),
    );
    if (activeParent) {
      setExpandedMenus((prev) =>
        prev.includes(activeParent.href) ? prev : [...prev, activeParent.href],
      );
    }
  }, [pathname, currentFilter, visibleMenuItems]);

  useEffect(() => {
    if (pathname.startsWith('/ecommerce') && ecommerceMenuVisible) {
      setExpandedMenus((prev) => (prev.includes('/ecommerce') ? prev : [...prev, '/ecommerce']));
    }
  }, [pathname, ecommerceMenuVisible]);

  /** SuperAdmin: sadece SaaS Panel ve alt menüleri; CRM sayfaları sidebar’da gösterilmez */

  const toggleExpand = (href: string) => {
    setExpandedMenus((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href],
    );
  };

  const isSubItemActive = (child: SubItem) => {
    if (child.param) {
      return pathname === '/inbox' && currentFilter === child.param;
    }
    if (child.href.includes('?status=')) {
      const status = new URL(child.href, 'http://x').searchParams.get('status');
      return pathname === '/leads' && currentStatus === status;
    }
    if (child.href === '/inbox' && !child.param) {
      return pathname === '/inbox' && !currentFilter;
    }
    if (child.href === '/superadmin') {
      return pathname === '/superadmin';
    }
    return pathname === child.href || pathname.startsWith(child.href + '/');
  };

  const isParentActive = (item: MenuItem) => {
    if (item.children) {
      return item.children.some((c) => isSubItemActive(c));
    }
    return pathname.startsWith(item.href);
  };

  return (
    <aside className="w-64 bg-sidebar text-white flex flex-col h-screen sticky top-0">
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          {organization?.logo ? (
            <img
              src={`${BACKEND_URL}${organization.logo}`}
              alt={organization.name}
              className="w-10 h-10 rounded-xl object-cover"
            />
          ) : (
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
              style={{ backgroundColor: organization?.primaryColor || '#25D366' }}
            >
              {organization?.name?.charAt(0) || 'W'}
            </div>
          )}
          <div>
            <h1 className="font-bold text-lg leading-tight">
              {organization?.name || 'WA CRM'}
            </h1>
            <p className="text-xs text-gray-400">
              {isSuperAdmin
                ? 'Platform yönetimi'
                : organization?.plan === 'ENTERPRISE'
                  ? 'Enterprise'
                  : organization?.plan === 'PROFESSIONAL'
                    ? 'Profesyonel'
                    : organization?.plan === 'STARTER'
                      ? 'Başlangıç'
                      : 'Müşteri Yönetimi'}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto scrollbar-thin">
        {visibleMenuItems.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            const isExpanded = expandedMenus.includes(item.href);
            const parentActive = isParentActive(item);

            if (hasChildren) {
              return (
                <div key={item.href}>
                  {item.separator && <div className="my-2 border-t border-white/10" />}
                  <button
                    onClick={() => toggleExpand(item.href)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                      parentActive
                        ? 'text-white bg-white/5'
                        : 'text-gray-400 hover:text-white hover:bg-white/5',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" />
                      {item.label}
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                      {item.children!
                        .filter(
                          (c) =>
                            (!c.adminOnly || isAdmin) &&
                            (!c.agentOnly || user?.role === 'AGENT'),
                        )
                        .map((child) => {
                          const active = isSubItemActive(child);
                          return (
                            <Link
                              key={child.href + (child.param || '')}
                              href={child.href}
                              className={cn(
                                'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all',
                                active
                                  ? 'bg-whatsapp text-white'
                                  : 'text-gray-400 hover:text-white hover:bg-white/5',
                              )}
                            >
                              <child.icon className="w-4 h-4" />
                              {child.label}
                            </Link>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            }

            const isActive = pathname.startsWith(item.href);
            return (
              <div key={item.href}>
                {item.separator && <div className="my-2 border-t border-white/10" />}
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                    isActive
                      ? 'bg-whatsapp text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5',
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </Link>
              </div>
            );
          })}
      </nav>

      <div className="p-4 border-t border-white/10">
        <Link
          href="/profile"
          className={cn(
            'flex items-center gap-3 mb-3 p-2 rounded-lg transition-all',
            pathname === '/profile' ? 'bg-white/10' : 'hover:bg-white/5',
          )}
        >
          <div className="w-9 h-9 bg-whatsapp/20 rounded-full flex items-center justify-center text-sm font-bold text-whatsapp">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {user?.role === 'SUPERADMIN'
                ? 'Süper yönetici'
                : user?.role === 'ADMIN'
                  ? 'Yönetici'
                  : 'Temsilci'}
            </p>
          </div>
        </Link>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors w-full px-2"
        >
          <LogOut className="w-4 h-4" />
          Çıkış Yap
        </button>
      </div>
    </aside>
  );
}
