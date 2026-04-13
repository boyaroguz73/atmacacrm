import AppShell from '@/components/layout/AppShell';

export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
