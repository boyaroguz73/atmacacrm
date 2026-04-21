'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useState, useEffect, useMemo, useCallback } from 'react';
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
  MessagesSquare,
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
  Warehouse,
  X,
} from 'lucide-react';

interface SubItem {
  href: string;
  label: string;
  icon: any;
  key?: string;
  param?: string;
  adminOnly?: boolean;
  /** Yalnızca AGENT rolünde göster */
  agentOnly?: boolean;
}

interface MenuItem {
  href: string;
  label: string;
  icon: any;
  /** Sunucu menü görünürlüğü filtresi — [MENU_KEYS] */
  menuKey: string;
  adminOnly?: boolean;
  superOnly?: boolean;
  accountantVisible?: boolean;
  separator?: boolean;
  children?: SubItem[];
}

const menuItems: MenuItem[] = [
  { href: '/dashboard', label: 'Gösterge Paneli', icon: LayoutDashboard, adminOnly: true, menuKey: 'dashboard' },
  {
    href: '/inbox',
    label: 'Mesajlar',
    icon: MessageSquare,
    menuKey: 'inbox',
    children: [
      { href: '/inbox', label: 'Gelen kutusu', icon: Inbox, key: 'inbox_main' },
      { href: '/inbox/groups', label: 'Gruplar', icon: MessagesSquare, key: 'groups' },
      { href: '/inbox?filter=unanswered', label: 'Cevapsızlar', icon: Clock, key: 'unanswered', param: 'unanswered' },
      { href: '/inbox?filter=answered', label: 'Cevaplananlar', icon: MessageCircleReply, key: 'answered', param: 'answered' },
      { href: '/inbox?filter=followup', label: 'Takiptekiler', icon: CalendarCheck, key: 'followup', param: 'followup' },
    ],
  },
  { href: '/contacts', label: 'Kişiler', icon: Users, menuKey: 'contacts' },
  { href: '/leads', label: 'Potansiyel Müşteriler', icon: Target, menuKey: 'leads' },
  {
    href: '/quotes',
    label: 'Teklifler',
    icon: ClipboardList,
    menuKey: 'quotes',
    children: [
      { href: '/quotes', label: 'Teklif Listesi', icon: ClipboardList, key: 'quotes_list' },
      { href: '/quotes/new', label: 'Yeni Teklif', icon: Receipt, key: 'quotes_new', adminOnly: true },
    ],
  },
  { href: '/orders', label: 'Siparişler', icon: Truck, menuKey: 'orders' },
  {
    href: '/accounting',
    label: 'Muhasebe',
    icon: Calculator,
    accountantVisible: true,
    menuKey: 'accounting',
    children: [
      { href: '/accounting/invoices', label: 'Faturalar', icon: Receipt, key: 'accounting_invoices' },
    ],
  },
  { href: '/tasks', label: 'Görevler', icon: CalendarCheck, menuKey: 'tasks' },
  { href: '/admin/auto-reply', label: 'Otomasyon', icon: Zap, adminOnly: true, menuKey: 'admin' },
  { href: '/calendar', label: 'Takvim', icon: CalendarDays, menuKey: 'calendar' },
  {
    href: '/admin',
    label: 'Yönetim',
    icon: ShieldAlert,
    adminOnly: true,
    menuKey: 'admin',
    children: [
      { href: '/inbox?filter=unassigned', label: 'Atanmamış', icon: UserX, key: 'unassigned', param: 'unassigned' },
      { href: '/leads?status=LOST', label: 'Kaçırılan Müşteriler', icon: TrendingDown, key: 'lost_leads' },
      { href: '/admin/history', label: 'Konuşma Geçmişi', icon: History, key: 'admin_history' },
      { href: '/admin/templates', label: 'Mesaj Şablonları', icon: FileText, key: 'admin_templates' },
      { href: '/admin/audit-log', label: 'Aktivite Logu', icon: Activity, key: 'admin_audit_log' },
      { href: '/admin/suppliers', label: 'Tedarikçiler', icon: Warehouse, key: 'admin_suppliers' },
      { href: '/admin/cargo-companies', label: 'Kargo Firmaları', icon: Truck, key: 'admin_cargo_companies' },
    ],
  },
  { href: '/reports', label: 'Raporlar', icon: BarChart3, adminOnly: true, menuKey: 'reports' },
  { href: '/admin/integrations', label: 'Entegrasyonlar', icon: Plug, adminOnly: true, menuKey: 'integrations' },
  { href: '/settings', label: 'Ayarlar', icon: Settings, adminOnly: true, menuKey: 'settings' },
  { href: '/admin/support', label: 'Destek', icon: HeadphonesIcon, adminOnly: true, menuKey: 'support' },
  {
    href: '/superadmin',
    label: 'SaaS Panel',
    icon: Shield,
    superOnly: true,
    menuKey: 'superadmin',
    children: [
      { href: '/superadmin', label: 'Genel Bakış', icon: LayoutDashboard, key: 'sa_overview' },
      { href: '/superadmin/users', label: 'Kullanıcılar', icon: Users, key: 'sa_users' },
      { href: '/superadmin/plans', label: 'Paketler', icon: Package, key: 'sa_plans' },
      { href: '/superadmin/tickets', label: 'Destek Talepleri', icon: LifeBuoy, key: 'sa_tickets' },
      { href: '/superadmin/system', label: 'Sistem Sağlığı', icon: Activity, key: 'sa_system' },
    ],
  },
];

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3002';

/** Alt menü `href` değeri query içeriyorsa (örn. /orders?tsoft=1) pathname + search ile eşleştirir */
function childHrefMatches(pathname: string, searchParams: URLSearchParams, href: string): boolean {
  if (!href.includes('?')) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  let url: URL;
  try {
    url = new URL(href, 'http://localhost');
  } catch {
    return pathname === href;
  }
  if (pathname !== url.pathname) return false;
  const keys = Array.from(url.searchParams.keys());
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (url.searchParams.get(key) !== searchParams.get(key)) return false;
  }
  return true;
}

/** E-Ticaret altındaki bazı linkler redirect ile farklı route'a gider; aktif eşleşmede alias desteği */
function childHrefMatchesWithAliases(
  pathname: string,
  searchParams: URLSearchParams,
  href: string,
): boolean {
  if (childHrefMatches(pathname, searchParams, href)) return true;

  if (href === '/ecommerce/products') {
    return pathname === '/products' || pathname.startsWith('/products/');
  }

  return false;
}

export default function Sidebar({
  mobileOpen = false,
  onClose,
}: {
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, organization, logout } = useAuthStore();
  const currentFilter = searchParams.get('filter');
  const currentStatus = searchParams.get('status');
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const [ecommerceMenuVisible, setEcommerceMenuVisible] = useState(false);
  /** Sunucudan gelen izinli menü anahtarları; null = filtre yok (yüklenemedi veya süper admin) */
  const [allowedMenuKeys, setAllowedMenuKeys] = useState<Set<string> | null>(null);
  const [orderedMenuKeys, setOrderedMenuKeys] = useState<string[] | null>(null);
  const [submenuOrder, setSubmenuOrder] = useState<Record<string, string[]>>({});
  const [submenuHidden, setSubmenuHidden] = useState<Record<string, string[]>>({});
  const [menuVisibilityEpoch, setMenuVisibilityEpoch] = useState(0);

  const refreshMenuVisibility = useCallback(() => {
    if (isSuperAdmin) {
      setAllowedMenuKeys(null);
      return;
    }
    api
      .get<{ allowedKeys: string[] }>('/organizations/my/menu-visibility')
      .then(({ data }) => {
        if (Array.isArray(data?.allowedKeys)) {
          setAllowedMenuKeys(new Set(data.allowedKeys));
          setOrderedMenuKeys(data.allowedKeys);
        }
      })
      .catch(() => setAllowedMenuKeys(null));
    api
      .get<{ suborder?: Record<string, string[]> }>('/organizations/my/menu-suborder')
      .then(({ data }) => setSubmenuOrder(data?.suborder || {}))
      .catch(() => setSubmenuOrder({}));
    api
      .get<{ subHidden?: Record<string, string[]> }>('/organizations/my/menu-sub-hidden')
      .then(({ data }) => setSubmenuHidden(data?.subHidden || {}))
      .catch(() => setSubmenuHidden({}));
  }, [isSuperAdmin]);

  useEffect(() => {
    refreshMenuVisibility();
  }, [refreshMenuVisibility, user?.id, menuVisibilityEpoch]);

  useEffect(() => {
    const onMenuChanged = () => setMenuVisibilityEpoch((e) => e + 1);
    window.addEventListener('crm-menu-visibility-changed', onMenuChanged);
    return () => window.removeEventListener('crm-menu-visibility-changed', onMenuChanged);
  }, []);

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
    let filtered = menuItems.filter((item) => {
      // SUPERADMIN: SaaS paneli + tenant CRM (entegrasyonlar, ayarlar vb.) — eskiden yalnızca superOnly
      // kalıyordu; /admin/integrations menüde yoktu ve sayfa “erişilemiyor” gibi görünüyordu.
      if (isSuperAdmin) return true;
      if (item.superOnly) return false;
      if (item.adminOnly) return isAdmin;
      if (item.accountantVisible) return isAdmin || isAccountant;
      return true;
    });
    if (!isSuperAdmin && allowedMenuKeys) {
      filtered = filtered.filter((item) => allowedMenuKeys.has(item.menuKey));
    }
    if (!isSuperAdmin && orderedMenuKeys?.length) {
      const orderIndex = new Map(orderedMenuKeys.map((k, i) => [k, i]));
      filtered = [...filtered].sort((a, b) => {
        const ia = orderIndex.has(a.menuKey) ? (orderIndex.get(a.menuKey) as number) : 10_000;
        const ib = orderIndex.has(b.menuKey) ? (orderIndex.get(b.menuKey) as number) : 10_000;
        return ia - ib;
      });
    }
    const showEcommerce =
      !isSuperAdmin &&
      isAdmin &&
      ecommerceMenuVisible &&
      (!allowedMenuKeys || allowedMenuKeys.has('ecommerce'));
    if (showEcommerce) {
      const idx = filtered.findIndex((i) => i.href === '/admin/integrations');
      const ecommerceBlock: MenuItem = {
        href: '/ecommerce',
        label: 'E-Ticaret',
        icon: ShoppingCart,
        adminOnly: true,
        menuKey: 'ecommerce',
        children: [
          { href: '/ecommerce/products', label: 'Ürünler', icon: Package, key: 'ecom_products' },
          { href: '/ecommerce/customers', label: 'Üyeler', icon: Users, key: 'ecom_customers' },
          { href: '/orders?tsoft=1', label: 'Mağaza (T-Soft)', icon: ShoppingBag, key: 'ecom_orders' },
        ],
      };
      if (idx >= 0) {
        filtered = [...filtered.slice(0, idx), ecommerceBlock, ...filtered.slice(idx)];
      } else {
        filtered = [...filtered, ecommerceBlock];
      }
    }
    const isAgent = user?.role === 'AGENT';
    return filtered.map((item) => {
      let children = item.children;
      if (isAgent && item.menuKey === 'inbox' && children?.length) {
        children = children.map((c) =>
          c.key === 'inbox_main'
            ? { ...c, href: '/inbox?filter=mine', param: 'mine', label: 'Bana Atananlar' }
            : c,
        );
      }
      if (!children?.length) return item;
      const desired = submenuOrder[item.menuKey] || [];
      if (!desired.length) return { ...item, children };
      const idx = new Map(desired.map((k, i) => [k, i]));
      return {
        ...item,
        children: [...children].sort((a, b) => {
          const ka = a.key || a.href;
          const kb = b.key || b.href;
          const ia = idx.has(ka) ? (idx.get(ka) as number) : 10_000;
          const ib = idx.has(kb) ? (idx.get(kb) as number) : 10_000;
          return ia - ib;
        }),
      };
    });
  }, [isAdmin, isSuperAdmin, isAccountant, ecommerceMenuVisible, allowedMenuKeys, orderedMenuKeys, submenuOrder, user?.role]);

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
        return childHrefMatchesWithAliases(pathname, searchParams, c.href);
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
        return childHrefMatchesWithAliases(pathname, searchParams, c.href);
      }),
    );
    if (activeParent) {
      setExpandedMenus((prev) =>
        prev.includes(activeParent.href) ? prev : [...prev, activeParent.href],
      );
    }
  }, [pathname, currentFilter, searchParams, visibleMenuItems]);

  useEffect(() => {
    if (pathname.startsWith('/ecommerce') && ecommerceMenuVisible) {
      setExpandedMenus((prev) => (prev.includes('/ecommerce') ? prev : [...prev, '/ecommerce']));
    }
  }, [pathname, ecommerceMenuVisible]);

  useEffect(() => {
    if (pathname === '/orders' && searchParams.get('tsoft') === '1' && ecommerceMenuVisible) {
      setExpandedMenus((prev) => (prev.includes('/ecommerce') ? prev : [...prev, '/ecommerce']));
    }
  }, [pathname, searchParams, ecommerceMenuVisible]);

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
    return childHrefMatchesWithAliases(pathname, searchParams, child.href);
  };

  const isParentActive = (item: MenuItem) => {
    if (item.children) {
      return item.children.some((c) => isSubItemActive(c));
    }
    return pathname.startsWith(item.href);
  };

  const handleMobileNavigate = () => {
    if (onClose) onClose();
  };

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'w-64 bg-sidebar text-white flex flex-col h-screen md:sticky top-0 z-50 fixed md:relative left-0',
          'transition-transform md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
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
          <button
            type="button"
            onClick={onClose}
            className="ml-auto md:hidden p-2 rounded-lg hover:bg-white/10"
            aria-label="Menüyü kapat"
          >
            <X className="w-4 h-4" />
          </button>
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
                            (!c.agentOnly || user?.role === 'AGENT') &&
                            !(c.key && (submenuHidden[item.menuKey] || []).includes(c.key)),
                        )
                        .map((child) => {
                          const active = isSubItemActive(child);
                          return (
                            <Link
                              key={child.href + (child.param || '')}
                              href={child.href}
                              onClick={handleMobileNavigate}
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
                  onClick={handleMobileNavigate}
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
                  : user?.role === 'ACCOUNTANT'
                    ? 'Muhasebe'
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
    </>
  );
}
