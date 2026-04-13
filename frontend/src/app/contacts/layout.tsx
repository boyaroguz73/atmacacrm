import AppShell from '@/components/layout/AppShell';

export default function ContactsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
