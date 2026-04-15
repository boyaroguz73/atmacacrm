import AppShell from '@/components/layout/AppShell';
import AccountingSubnav from './AccountingSubnav';

export default function AccountingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <AccountingSubnav />
        {children}
      </div>
    </AppShell>
  );
}
