'use client';

import { Fragment, useEffect, useState } from 'react';
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
  ChevronRight,
  Package,
  TrendingDown,
  Banknote,
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

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Bekleyen',
  SENT: 'Gönderildi',
  PAID: 'Ödendi',
  OVERDUE: 'Vadesi geçmiş',
  CANCELLED: 'İptal',
};

const WORKFLOW = [
  {
    title: 'Sipariş',
    desc: 'Üretim / tedarik',
    href: '/orders',
    Icon: Package,
  },
  {
    title: 'Sevk',
    desc: 'İrsaliye',
    href: '/accounting/delivery-notes',
    Icon: Truck,
  },
  {
    title: 'Fatura',
    desc: 'Resmileştirme',
    href: '/accounting/invoices',
    Icon: FileText,
  },
  {
    title: 'Tahsilat',
    desc: 'Kasa hareketi',
    href: '/accounting/cash',
    Icon: Wallet,
  },
] as const;

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

  const unpaidAmt = data.unpaidReceivablesAmount ?? 0;
  const overdueAmt = data.overdueAmount ?? 0;
  const pendingBillAmt = data.pendingBillingAmount ?? 0;
  const unpaidCount = data.unpaidInvoiceCount ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Muhasebe</p>
          <h1 className="text-2xl font-bold text-gray-900">Özet pano</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Siparişten tahsilata tek hat üzerinden izleme: nakit, açık alacak ve faturalama kuyruğu.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/accounting/invoices?tab=pending"
            className="inline-flex items-center justify-center rounded-xl bg-whatsapp px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-whatsapp/90 transition-colors"
          >
            Fatura bekleyenler
          </Link>
          <Link
            href="/accounting/ledger"
            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
          >
            Cari defter
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">İş akışı</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:flex-nowrap xl:items-center">
          {WORKFLOW.map((step, i) => (
            <Fragment key={step.href}>
              <Link
                href={step.href}
                className="flex flex-1 min-w-[140px] items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 hover:border-whatsapp/25 hover:bg-whatsapp/5 transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-whatsapp shadow-sm border border-gray-100">
                  <step.Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900">{step.title}</p>
                  <p className="text-xs text-gray-500 truncate">{step.desc}</p>
                </div>
              </Link>
              {i < WORKFLOW.length - 1 ? (
                <div className="hidden xl:flex shrink-0 items-center justify-center text-gray-300 px-0.5">
                  <ChevronRight className="h-5 w-5" />
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Finansal göstergeler</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm">
              <Banknote className="w-4 h-4" />
              Açık alacak (fatura)
            </div>
            <p className="text-xl font-bold text-gray-900 mt-2 tabular-nums">{fmt(unpaidAmt)} TL</p>
            <p className="text-xs text-emerald-800/80 mt-1">
              {unpaidCount} adet ödenmemiş / açık fatura
            </p>
          </div>

          <div
            className={`rounded-xl border p-5 shadow-sm ${
              overdueAmt > 0
                ? 'border-red-200 bg-red-50/50'
                : 'border-gray-100 bg-white'
            }`}
          >
            <div
              className={`flex items-center gap-2 font-semibold text-sm ${
                overdueAmt > 0 ? 'text-red-800' : 'text-gray-700'
              }`}
            >
              <TrendingDown className="w-4 h-4" />
              Vadesi geçmiş risk
            </div>
            <p className="text-xl font-bold text-gray-900 mt-2 tabular-nums">{fmt(overdueAmt)} TL</p>
            <p className="text-xs text-gray-500 mt-1">OVERDUE veya vadesi dolmuş açık faturalar</p>
          </div>

          <Link
            href="/accounting/invoices?tab=pending"
            className="rounded-xl border border-amber-100 bg-amber-50/40 p-5 shadow-sm hover:border-amber-200 transition-colors block"
          >
            <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm">
              <Package className="w-4 h-4" />
              Faturalanacak sipariş (tutar)
            </div>
            <p className="text-xl font-bold text-gray-900 mt-2 tabular-nums">{fmt(pendingBillAmt)} TL</p>
            <p className="text-xs text-amber-900/80 mt-1">
              {data.pendingOrdersToBill} sipariş — teslim/işlemde, fatura yok
            </p>
          </Link>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-gray-700 font-semibold text-sm">
              <Wallet className="w-4 h-4 text-whatsapp" />
              Kasa net (30 gün)
            </div>
            <p className="text-xl font-bold text-gray-900 mt-2 tabular-nums">
              {fmt(data.cashLast30Days.net)} TL
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Giriş {fmt(data.cashLast30Days.in)} · Çıkış {fmt(data.cashLast30Days.out)}
            </p>
          </div>
        </div>
      </section>

      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Operasyon</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link
            href="/accounting/invoices"
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:border-whatsapp/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-whatsapp font-semibold text-sm">
              <FileText className="w-4 h-4" />
              Fatura kayıtları
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{data.invoiceTotal}</p>
            <p className="text-xs text-gray-500 mt-1">Toplam fatura adedi</p>
          </Link>

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
            <p className="text-xs text-gray-500 mt-1">Vadesi geçmiş cari kayıt</p>
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
            className={`rounded-xl border p-5 shadow-sm sm:col-span-2 lg:col-span-1 ${
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
