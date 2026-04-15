import AppShell from '@/components/layout/AppShell';
import ProductsSubnav from './ProductsSubnav';

export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <ProductsSubnav />
        </div>
        {children}
      </div>
    </AppShell>
  );
}
