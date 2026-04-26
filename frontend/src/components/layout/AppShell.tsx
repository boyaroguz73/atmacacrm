'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3002';

function pathRequiredMenuKey(pathname: string): string | null {
  const p = String(pathname || '/');
  if (p.startsWith('/dashboard')) return 'dashboard';
  if (p.startsWith('/inbox')) return 'inbox';
  if (p.startsWith('/contacts')) return 'contacts';
  if (p.startsWith('/kartelas')) return 'kartelas';
  if (p.startsWith('/leads')) return 'leads';
  if (p.startsWith('/quotes')) return 'quotes';
  if (p.startsWith('/orders')) return 'orders';
  if (p.startsWith('/accounting')) return 'accounting';
  if (p.startsWith('/tasks')) return 'tasks';
  if (p.startsWith('/calendar')) return 'calendar';
  if (p.startsWith('/reports')) return 'reports';
  if (p.startsWith('/admin/integrations')) return 'integrations';
  if (p.startsWith('/settings')) return 'settings';
  return null;
}

function pageTitleFromPath(pathname: string): string {
  const p = String(pathname || '/');
  if (p === '/' || p.startsWith('/dashboard')) return 'Gösterge Paneli';
  if (p.startsWith('/inbox')) return 'Gelen Kutusu';
  if (p.startsWith('/contacts/')) return 'Kişi Detayı';
  if (p.startsWith('/contacts')) return 'Kişiler';
  if (p.startsWith('/quotes/new')) return 'Yeni Teklif';
  if (p.startsWith('/quotes/')) return 'Teklif Detayı';
  if (p.startsWith('/quotes')) return 'Teklifler';
  if (p.startsWith('/orders/new')) return 'Yeni Sipariş';
  if (p.startsWith('/orders/')) return 'Sipariş Detayı';
  if (p.startsWith('/orders')) return 'Siparişler';
  if (p.startsWith('/tasks')) return 'Görevler';
  if (p.startsWith('/calendar')) return 'Takvim';
  if (p.startsWith('/reports')) return 'Raporlar';
  if (p.startsWith('/products')) return 'Ürünler';
  if (p.startsWith('/accounting')) return 'Muhasebe';
  if (p.startsWith('/leads')) return 'Potansiyel Müşteriler';
  if (p.startsWith('/settings/organization')) return 'Organizasyon Ayarları';
  if (p.startsWith('/settings')) return 'Ayarlar';
  if (p.startsWith('/profile')) return 'Profil';
  if (p.startsWith('/ecommerce')) return 'E-Ticaret';
  if (p.startsWith('/admin/integrations')) return 'Modüller';
  if (p.startsWith('/admin')) return 'Yönetim';
  if (p.startsWith('/superadmin')) return 'Süper Admin';
  return 'Atmaca Ofis';
}

function ensureFavicon(href: string) {
  if (typeof document === 'undefined') return;
  const rels = ['icon', 'shortcut icon', 'apple-touch-icon'];
  for (const rel of rels) {
    let el = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', rel);
      document.head.appendChild(el);
    }
    el.href = href;
  }
}

function SidebarFallback() {
  return (
    <aside className="w-64 shrink-0 bg-sidebar text-white flex flex-col h-screen sticky top-0">
      <div className="p-5 border-b border-white/10">
        <div className="h-12 w-full rounded-xl bg-white/10 animate-pulse" />
      </div>
      <nav className="flex-1 p-3 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
        ))}
      </nav>
    </aside>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, organization, loadFromStorage, updateOrganization } =
    useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [authReady, setAuthReady] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [allowedMenuKeys, setAllowedMenuKeys] = useState<Set<string> | null>(null);
  const [moduleToggles, setModuleToggles] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    loadFromStorage();
    setAuthReady(true);
  }, [loadFromStorage]);

  /** Tek firma: /organizations/my ilk org’u da döner (JWT’de org olmasa bile). */
  useEffect(() => {
    if (!user || user.role === 'AGENT') return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<{
          name: string;
          slug: string;
          logo: string | null;
          primaryColor: string;
          secondaryColor: string;
          plan: string;
        }>('/organizations/my');
        if (cancelled || !data?.plan) return;
        updateOrganization({
          name: data.name,
          slug: data.slug,
          logo: data.logo,
          primaryColor: data.primaryColor,
          secondaryColor: data.secondaryColor,
          plan: data.plan,
        });
      } catch {
        /* oturum yoksa veya ağ hatası — sessiz */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, updateOrganization]);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) {
      const token = localStorage.getItem('token');
      if (!token) {
        router.replace('/login');
      }
      return;
    }
    const socket = connectSocket();
    socket.emit('join:inbox');
    return () => {
      disconnectSocket();
    };
  }, [userId, router]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api
      .get<{ allowedKeys?: string[] }>('/organizations/my/menu-visibility')
      .then(({ data }) => {
        if (cancelled) return;
        setAllowedMenuKeys(
          Array.isArray(data?.allowedKeys) ? new Set(data.allowedKeys) : null,
        );
      })
      .catch(() => {
        if (!cancelled) setAllowedMenuKeys(null);
      });
    api
      .get<{ toggles?: Record<string, boolean> }>('/organizations/my/module-toggles')
      .then(({ data }) => {
        if (cancelled) return;
        setModuleToggles(data?.toggles || null);
      })
      .catch(() => {
        if (!cancelled) setModuleToggles(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !pathname) return;

    // Bu modüllerin detayları sadece /admin/integrations (Modüller) içinden yönetilir.
    // Direkt URL erişimini kapatıyoruz.
    if (
      pathname === '/settings/kartelas' ||
      pathname === '/settings/templates' ||
      pathname === '/settings/suppliers' ||
      pathname === '/settings/cargo-companies' ||
      pathname === '/kartelas'
    ) {
      router.replace('/admin/integrations');
      return;
    }

    const needed = pathRequiredMenuKey(pathname);
    if (needed && allowedMenuKeys && !allowedMenuKeys.has(needed)) {
      router.replace('/inbox');
      return;
    }
    if (moduleToggles) {
      if (moduleToggles.quotes === false && pathname.startsWith('/quotes')) {
        router.replace('/inbox');
        return;
      }
      if (moduleToggles.automation === false && pathname.startsWith('/admin/auto-reply')) {
        router.replace('/admin/integrations');
      }
    }
  }, [userId, pathname, allowedMenuKeys, moduleToggles, router]);

  // Sayfa başlığı standardı: {Sayfa Adı} | Atmaca Ofis
  useEffect(() => {
    const page = pageTitleFromPath(pathname || '/');
    document.title = page === 'Atmaca Ofis' ? 'Atmaca Ofis' : `${page} | Atmaca Ofis`;
  }, [pathname]);

  // Favicon: /settings/organization üzerinden yüklenen organizasyon logosu
  useEffect(() => {
    const logoPath = String(organization?.logo || '').trim();
    if (!logoPath) {
      ensureFavicon('/favicon.ico');
      return;
    }
    const href = /^https?:\/\//i.test(logoPath) ? logoPath : `${BACKEND_URL}${logoPath}`;
    ensureFavicon(href);
  }, [organization?.logo]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Dinamik CSS değişkenleri
  useEffect(() => {
    const root = document.documentElement;
    if (organization?.primaryColor) {
      root.style.setProperty('--color-primary', organization.primaryColor);
    }
    if (organization?.secondaryColor) {
      root.style.setProperty('--color-sidebar', organization.secondaryColor);
    }
    return () => {
      root.style.removeProperty('--color-primary');
      root.style.removeProperty('--color-sidebar');
    };
  }, [organization?.primaryColor, organization?.secondaryColor]);

  if (!authReady) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <div
          className="h-10 w-10 rounded-full border-2 border-[var(--color-primary,#25D366)] border-t-transparent animate-spin"
          aria-hidden
        />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Suspense fallback={<SidebarFallback />}>
        <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      </Suspense>
      <main className="flex-1 overflow-auto">
        <div className="md:hidden sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 px-3 py-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-gray-700 bg-white"
          >
            <Menu className="w-4 h-4" />
            Menü
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}
