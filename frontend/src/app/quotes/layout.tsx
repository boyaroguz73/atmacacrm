import AppShell from '@/components/layout/AppShell';

export default function QuotesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
