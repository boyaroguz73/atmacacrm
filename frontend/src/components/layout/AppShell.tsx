'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import Sidebar from './Sidebar';

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
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    loadFromStorage();
    setAuthReady(true);
  }, [loadFromStorage]);

  /** SuperAdmin panelden atanan paket vb. login anındaki localStorage’ı geçersiz kılar; API’den günceller */
  useEffect(() => {
    if (!user?.organizationId || user.role === 'SUPERADMIN') return;
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
  }, [user?.organizationId, user?.role, updateOrganization]);

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

  // Dinamik title
  useEffect(() => {
    if (organization?.name) {
      document.title = `${organization.name} CRM`;
    }
  }, [organization?.name]);

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
        <Sidebar />
      </Suspense>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
