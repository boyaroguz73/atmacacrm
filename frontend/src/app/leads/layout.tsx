import AppShell from '@/components/layout/AppShell';

export default function LeadsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
