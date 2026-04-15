'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  FileText,
  Wallet,
  ArrowLeftRight,
  Truck,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

interface AccountingSummary {
  invoiceTotal: number;
  invoicesByStatus: Record<string, number>;
  pendingOrdersToBill: number;
  cashLast30Days: { in: number; out: number; net: number };
  ledgerEntriesWithOverdueDueDate: number;
  deliveryNotesShippedLast30Days: number;
  invoicesWithoutPdf: number;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Bekleyen',
  SENT: 'Gönderildi',
  PAID: 'Ödendi',
  OVERDUE: 'Vadesi geçmiş',
  CANCELLED: 'İptal',
};

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Muhasebe özeti</h1>
        <p className="text-sm text-gray-500 mt-1">
          Son 30 gün kasa hareketi, faturalama kuyruğu ve eksik belgeler tek ekranda.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link
          href="/accounting/invoices"
          className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:border-whatsapp/30 transition-colors"
        >
          <div className="flex items-center gap-2 text-whatsapp font-semibold text-sm">
            <FileText className="w-4 h-4" />
            Faturalar
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{data.invoiceTotal}</p>
          <p className="text-xs text-gray-500 mt-1">Kayıtlı fatura sayısı</p>
        </Link>

        <Link
          href="/accounting/invoices"
          className="rounded-xl border border-amber-100 bg-amber-50/40 p-5 shadow-sm hover:border-amber-200 transition-colors"
        >
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
            <Truck className="w-4 h-4" />
            Faturalanacak sipariş
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{data.pendingOrdersToBill}</p>
          <p className="text-xs text-gray-600 mt-1">Teslim / işlemde, faturası yok</p>
        </Link>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-gray-700 font-semibold text-sm">
            <Wallet className="w-4 h-4 text-whatsapp" />
            Kasa (30 gün)
          </div>
          <div className="mt-3 space-y-1 text-sm tabular-nums">
            <p className="text-green-700">
              Giriş: <span className="font-semibold">{fmt(data.cashLast30Days.in)} TL</span>
            </p>
            <p className="text-red-700">
              Çıkış: <span className="font-semibold">{fmt(data.cashLast30Days.out)} TL</span>
            </p>
            <p className="text-gray-900 pt-1 border-t border-gray-100">
              Net: <span className="font-bold">{fmt(data.cashLast30Days.net)} TL</span>
            </p>
          </div>
        </div>

        <Link
          href="/accounting/ledger"
          className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:border-whatsapp/30 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <ArrowLeftRight className="w-4 h-4 text-whatsapp" />
            Gelen / giden
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">
            {data.ledgerEntriesWithOverdueDueDate}
          </p>
          <p className="text-xs text-gray-500 mt-1">Vadesi geçmiş kayıt sayısı</p>
        </Link>

        <Link
          href="/accounting/delivery-notes"
          className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:border-whatsapp/30 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Truck className="w-4 h-4 text-whatsapp" />
            İrsaliye (30 gün)
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">
            {data.deliveryNotesShippedLast30Days}
          </p>
          <p className="text-xs text-gray-500 mt-1">Sevk edilen irsaliye</p>
        </Link>

        <div
          className={`rounded-xl border p-5 shadow-sm ${
            data.invoicesWithoutPdf > 0
              ? 'border-orange-200 bg-orange-50/50'
              : 'border-gray-100 bg-white'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <AlertTriangle
              className={`w-4 h-4 ${data.invoicesWithoutPdf > 0 ? 'text-orange-600' : 'text-gray-400'}`}
            />
            PDF eksik fatura
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{data.invoicesWithoutPdf}</p>
          <p className="text-xs text-gray-500 mt-1">Yüklenmiş veya üretilmiş PDF yok</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Faturalar — durum dağılımı</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.invoicesByStatus).map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-100"
            >
              {STATUS_LABELS[k] || k}
              <span className="tabular-nums text-whatsapp font-bold">{v}</span>
            </span>
          ))}
          {Object.keys(data.invoicesByStatus).length === 0 ? (
            <span className="text-xs text-gray-400">Henüz fatura yok</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
