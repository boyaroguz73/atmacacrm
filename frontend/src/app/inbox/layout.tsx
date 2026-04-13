import AppShell from '@/components/layout/AppShell';

export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
