import AppShell from '@/components/layout/AppShell';

export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
