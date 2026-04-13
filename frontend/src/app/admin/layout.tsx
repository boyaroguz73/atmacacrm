'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.role === 'SUPERADMIN' || u.role === 'ADMIN') {
          setAllowed(true);
          return;
        }
      }
    } catch {}
    router.replace('/inbox');
  }, [router]);

  if (!allowed) return null;
  return <AppShell>{children}</AppShell>;
}
