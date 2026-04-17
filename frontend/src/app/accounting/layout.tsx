import AppShell from '@/components/layout/AppShell';
import AccountingSubnav from './AccountingSubnav';

export default function AccountingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="p-4 sm:p-6 w-full max-w-none">
        <AccountingSubnav />
        {children}
      </div>
    </AppShell>
  );
}
