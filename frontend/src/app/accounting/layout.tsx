import AppShell from '@/components/layout/AppShell';

export default function AccountingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
