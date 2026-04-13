'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Organizasyon yönetimi Ayarlar → Organizasyon sayfasına taşındı. */
export default function AdminOrganizationRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/organization');
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[40vh] text-sm text-gray-500">
      Yönlendiriliyor…
    </div>
  );
}
