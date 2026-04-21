'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  FileText,
  Loader2,
  Package,
} from 'lucide-react';

interface AccountingSummary {
  invoiceTotal: number;
  invoicesByStatus: Record<string, number>;
  pendingOrdersToBill: number;
  cashLast30Days: { in: number; out: number; net: number };
  ledgerEntriesWithOverdueDueDate: number;
  deliveryNotesShippedLast30Days: number;
  invoicesWithoutPdf: number;
  unpaidReceivablesAmount?: number;
  unpaidInvoiceCount?: number;
  overdueAmount?: number;
  pendingBillingAmount?: number;
}

export default function AccountingOverviewPage() {
  const [data, setData] = useState<AccountingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: d } = await api.get<AccountingSummary>('/accounting/summary');
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          toast.error(getApiErrorMessage(e, 'Özet yüklenemedi'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 text-whatsapp animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-gray-500 text-center py-12">
        Muhasebe özeti alınamadı. Yetkinizi veya ağ bağlantınızı kontrol edin.
      </p>
    );
  }

  const fmt = (n: number) =>
    n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const pendingBillAmt = data.pendingBillingAmount ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Muhasebe</p>
          <h1 className="text-2xl font-bold text-gray-900">Fatura Yönetimi</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Bu ekranda yalnızca fatura listesi ve faturalanmayı bekleyen siparişler gösterilir.
          </p>
        </div>
      </div>

      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/accounting/invoices"
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:border-whatsapp/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-whatsapp font-semibold text-sm">
              <FileText className="w-4 h-4" />
              Faturalar
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{data.invoiceTotal}</p>
            <p className="text-xs text-gray-500 mt-1">Toplam fatura adedi</p>
          </Link>

          <Link
            href="/accounting/invoices?tab=pending"
            className="rounded-xl border border-amber-100 bg-amber-50/40 p-5 shadow-sm hover:border-amber-200 transition-colors block"
          >
            <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm">
              <Package className="w-4 h-4" />
              Bekleyenler
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{fmt(pendingBillAmt)} TL</p>
            <p className="text-xs text-amber-900/80 mt-1">
              {data.pendingOrdersToBill} sipariş — fatura bekliyor
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}
