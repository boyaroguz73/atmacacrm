'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';

export default function SuperAdminLayout({
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
        if (u.role === 'SUPERADMIN') {
          setAllowed(true);
          return;
        }
      }
    } catch {}
    router.replace('/dashboard');
  }, [router]);

  if (!allowed) return null;

  return <AppShell>{children}</AppShell>;
}
