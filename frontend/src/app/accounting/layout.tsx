import { Suspense } from 'react';
import AppShell from '@/components/layout/AppShell';
import AccountingSidebar from './AccountingSidebar';

export default function AccountingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="p-4 sm:p-6 w-full max-w-none min-h-[calc(100vh-3.5rem)] bg-gray-50/40">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 max-w-[1920px] mx-auto">
          <Suspense
            fallback={
              <div className="w-full lg:w-60 shrink-0 rounded-xl border border-gray-100 bg-white h-48 animate-pulse" />
            }
          >
            <AccountingSidebar />
          </Suspense>
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </AppShell>
  );
}
