'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem('token');
    router.replace(token ? '/dashboard' : '/login');
  }, [router]);
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
