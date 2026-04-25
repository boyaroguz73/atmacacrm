'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import DateRangePicker from '@/components/ui/DateRangePicker';
import {
  Package,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  Trash2,
  Plus,
  Store,
} from 'lucide-react';
import PanelEditedBadge from '@/components/ui/PanelEditedBadge';

type OrderStatus = 'AWAITING_CHECKOUT' | 'AWAITING_PAYMENT' | 'PREPARING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';

interface OrderItemRow {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  lineTotal: number;
  product?: { id: string; sku: string; name: string; imageUrl?: string | null } | null;
}

interface SalesOrder {
  id: string;
  orderNumber: number;
  /** T-Soft upsert anahtarı: tsoft_… */
  externalId?: string | null;
  source?: string;
  quoteId: string | null;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  shippingAddress: string | null;
  notes: string | null;
  expectedDeliveryDate?: string | null;
  createdAt: string;
  updatedAt: string;
  panelEditedAt?: string | null;
  pushToTsoft?: boolean;
  tsoftSiteOrderId?: string | null;
  tsoftPushedAt?: string | null;
  tsoftLastError?: string | null;
  siteOrderData?: Record<string, unknown> | null;
  invoice?: { id: string } | null;
  createdBy?: { id: string; name: string | null } | null;
  contact: {
    id: string;
    name: string | null;
    surname: string | null;
    phone: string;
    email: string | null;
    company: string | null;
    address?: string | null;
  };
  quote: { id: string; quoteNumber: number } | null;
  items: OrderItemRow[];
  confirmationPdfUrl?: string | null;
}

const TSOFT_LOGO_URL = 'https://panel.tsoftstatic.com/images/logo/logo.svg';

function providerLabel(provider?: string | null): string {
  const p = String(provider || '').toLowerCase();
  if (p === 'tsoft') return 'T-Soft';
  if (!p) return 'Mağaza';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function siteField(o: SalesOrder, ...keys: string[]): string {
  const d = o.siteOrderData;
  if (!d || typeof d !== 'object') return '';
  for (const k of keys) {
    const v = (d as Record<string, unknown>)[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function cityFor(o: SalesOrder): string {
  const c = siteField(o, 'DeliveryCity', 'InvoiceCity');
  if (c) return c;
  return '';
}

function paymentTypeFor(o: SalesOrder): string {
  const p = siteField(o, 'PaymentType', 'PaymentInfo');
  if (p) return p;
  return o.source === 'TSOFT' ? '—' : 'Manuel';
}

function cargoFor(o: SalesOrder): string {
  return siteField(o, 'Cargo') || '—';
}

function packagingFor(o: SalesOrder): string {
  const p = siteField(o, 'PackageStatus', 'PackageStatusLabel', 'PackagingStatus');
  if (p) return p;
  if (o.status === 'SHIPPED' || o.status === 'COMPLETED') return 'Paketlendi';
  return '—';
}

function isTsoftOrder(o: SalesOrder) {
  return o.source === 'TSOFT' || (o.externalId?.startsWith('tsoft_') ?? false);
}

const LIMIT = 20;

const STATUS_FILTERS: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'AWAITING_CHECKOUT', label: 'Sepet Terk' },
  { value: 'AWAITING_PAYMENT', label: 'Ödeme Bekleniyor' },
  { value: 'PREPARING', label: 'Hazırlanıyor' },
  { value: 'SHIPPED', label: 'Kargoda' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'CANCELLED', label: 'İptal' },
];

const STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_CHECKOUT: 'Sepet Terk',
  AWAITING_PAYMENT: 'Ödeme Bekleniyor',
  PREPARING: 'Hazırlanıyor',
  SHIPPED: 'Kargoda',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal',
};

function formatOrderNo(n: number) {
  return `SIP-${String(n).padStart(5, '0')}`;
}

function formatMoney(amount: number, currency: string) {
  const code = currency && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : 'TRY';
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code }).format(amount);
  } catch {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount);
  }
}

function statusBadgeClass(status: OrderStatus) {
  switch (status) {
    case 'AWAITING_CHECKOUT':
      return 'bg-orange-100 text-orange-900 border border-orange-300';
    case 'AWAITING_PAYMENT':
      return 'bg-amber-100 text-amber-900 border border-amber-300';
    case 'PREPARING':
      return 'bg-blue-100 text-blue-900 border border-blue-300';
    case 'SHIPPED':
      return 'bg-purple-100 text-purple-900 border border-purple-300';
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-900 border border-emerald-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-900 border border-red-300';
    default:
      return 'bg-gray-100 text-gray-700 border border-gray-200';
  }
}

function contactDisplayName(o: SalesOrder['contact']) {
  const full = [o.name, o.surname].filter(Boolean).join(' ').trim();
  if (full) return full;
  return formatPhone(o.phone);
}

export default function OrdersPage() {
  const router = useRouter();
  const { user, loadFromStorage } = useAuthStore();
  const showTsoftTools = user?.role === 'ADMIN';
  const [ecomProvider, setEcomProvider] = useState<string | null>(null);
  const [ecomVisible, setEcomVisible] = useState(false);
  const canRegenerateOrderPdf =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';
  const canDeleteOrder =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  // Varsayılan filtre: son 7 gün. localStorage'da kayıtlı değer varsa onu kullan.
  const defaultDateRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { from: fmt(start), to: fmt(end) };
  }, []);
  const [dateFrom, setDateFrom] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('orders_dateFrom') ?? defaultDateRange.from;
    }
    return defaultDateRange.from;
  });
  const [dateTo, setDateTo] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('orders_dateTo') ?? defaultDateRange.to;
    }
    return defaultDateRange.to;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [siteOrdersOnly, setSiteOrdersOnly] = useState(false);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);

  const fetchOrders = useCallback(async (background?: boolean) => {
    if (!background) setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (siteOrdersOnly) params.source = 'TSOFT';
      const { data } = await api.get('/orders', { params });
      setOrders(data.orders ?? []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (err) {
      if (!background) {
        toast.error(getApiErrorMessage(err, 'Siparişler yüklenemedi'));
        setOrders([]);
        setTotal(0);
      } else {
        toast.error(getApiErrorMessage(err, 'Liste güncellenemedi'));
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo, searchQuery, siteOrdersOnly]);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/ecommerce/status')
      .then(({ data }) => {
        if (cancelled) return;
        setEcomVisible(!!data?.menuVisible);
        setEcomProvider(typeof data?.provider === 'string' ? data.provider : null);
      })
      .catch(() => {
        if (cancelled) return;
        setEcomVisible(false);
        setEcomProvider(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const removeOrder = async (order: SalesOrder, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!canDeleteOrder) return;
    if (!confirm(`Sipariş ${formatOrderNo(order.orderNumber)} silinsin mi?`)) return;
    try {
      await api.delete(`/orders/${order.id}`);
      toast.success('Sipariş silindi');
      void fetchOrders(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 2xl:px-10 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-whatsapp/10 text-whatsapp">
              <Package className="w-5 h-5" />
            </span>
            Siparişler
          </h1>
          <p className="text-sm text-gray-500 mt-1">Satış siparişlerini görüntüleyin, durum güncelleyin ve fatura oluşturun.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/orders/new"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-medium shadow-sm hover:bg-green-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Manuel Sipariş
          </Link>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row xl:items-center gap-4">
        <div className="flex flex-wrap gap-2.5 items-center">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => {
                setStatusFilter(f.value);
                setPage(1);
              }}
              className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                statusFilter === f.value
                  ? 'bg-whatsapp text-white border-whatsapp shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-whatsapp/30 hover:text-gray-900'
              }`}
            >
              {f.label}
            </button>
          ))}
          {ecomVisible ? (
            <button
              type="button"
              onClick={() => {
                setSiteOrdersOnly((v) => !v);
                setPage(1);
              }}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                siteOrdersOnly
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300/50 hover:text-gray-900'
              }`}
            >
              <Store className="w-4 h-4 shrink-0 opacity-80" />
              {providerLabel(ecomProvider)} siparişleri
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 xl:ml-auto xl:justify-end xl:flex-nowrap w-full xl:w-auto">
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
              setPage(1);
              if (typeof window !== 'undefined') {
                localStorage.setItem('orders_dateFrom', from);
                localStorage.setItem('orders_dateTo', to);
              }
            }}
          />
          <div className="relative min-w-[240px] flex-1 xl:flex-none xl:min-w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Sipariş no, müşteri adı veya telefon ara…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-10 pr-3 py-2.5 w-full bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-3.5 w-10" />
                <th className="px-4 py-3.5">Sipariş No</th>
                <th className="px-4 py-3.5">Üye Adı</th>
                <th className="px-4 py-3.5">Tarih</th>
                <th className="px-4 py-3.5">Şehir</th>
                <th className="px-4 py-3.5 text-right">Tutar</th>
                <th className="px-4 py-3.5">Ödeme Tipi</th>
                <th className="px-4 py-3.5">Kargo Firması</th>
                <th className="px-4 py-3.5">Paketleme Durumu</th>
                <th className="px-4 py-3.5">Sipariş Süreci</th>
                {canDeleteOrder ? <th className="px-3 py-3.5 w-12" /> : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canDeleteOrder ? 11 : 10} className="text-center py-16 text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
                      <span className="text-sm">Yükleniyor…</span>
                    </div>
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={canDeleteOrder ? 11 : 10} className="text-center py-16 text-gray-400 text-sm">
                    Sipariş bulunamadı
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/orders/${order.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/orders/${order.id}`);
                      }
                    }}
                    className="border-b border-gray-100 odd:bg-white even:bg-gray-50/30 hover:bg-green-50/40 transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-4">
                      {ecomVisible && isTsoftOrder(order) ? (
                        <img
                          src={TSOFT_LOGO_URL}
                          alt={providerLabel(ecomProvider)}
                          title={`${providerLabel(ecomProvider)} mağaza siparişi`}
                          className="w-8 h-8 object-contain"
                          loading="lazy"
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs font-semibold text-gray-900 whitespace-nowrap">
                      {formatOrderNo(order.orderNumber)}
                      <PanelEditedBadge at={order.panelEditedAt} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-[15px] font-semibold text-gray-900">{contactDisplayName(order.contact)}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{formatPhone(order.contact.phone)}</div>
                    </td>
                    <td className="px-4 py-4 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(order.createdAt).toLocaleString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {cityFor(order) || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-4 text-right text-base font-bold text-gray-900 tabular-nums whitespace-nowrap">
                      {formatMoney(order.grandTotal, order.currency)}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">
                      {paymentTypeFor(order)}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-700 whitespace-nowrap">
                      {cargoFor(order)}
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex text-[11px] font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 whitespace-nowrap">
                        {packagingFor(order)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex text-[11px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${statusBadgeClass(order.status)}`}>
                        {STATUS_LABELS[order.status]}
                      </span>
                      {ecomVisible && order.pushToTsoft && order.tsoftLastError && !order.tsoftSiteOrderId ? (
                        <div
                          className="mt-1 inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700"
                          title={order.tsoftLastError}
                        >
                          {providerLabel(ecomProvider)} ✕
                        </div>
                      ) : null}
                    </td>
                    {canDeleteOrder ? (
                      <td className="px-5 py-4 text-right">
                        {(order.status === 'AWAITING_PAYMENT' || order.status === 'AWAITING_CHECKOUT') && !order.invoice ? (
                          <button
                            type="button"
                            onClick={(e) => void removeOrder(order, e)}
                            className="p-2 rounded-lg text-red-500 opacity-70 hover:opacity-100 hover:bg-red-50"
                            aria-label="Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 bg-gray-50/30">
            <p className="text-xs text-gray-500">
              Toplam <span className="font-semibold text-gray-700">{total}</span> sipariş
              {totalPages > 1 ? (
                <>
                  {' '}
                  · Sayfa <span className="font-semibold text-gray-700">{page}</span> / {totalPages}
                </>
              ) : null}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(1)}
                  className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-whatsapp/40 hover:text-whatsapp disabled:opacity-40 shadow-sm"
                  aria-label="İlk sayfa"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-whatsapp/40 hover:text-whatsapp disabled:opacity-40 shadow-sm"
                  aria-label="Önceki sayfa"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-whatsapp/40 hover:text-whatsapp disabled:opacity-40 shadow-sm"
                  aria-label="Sonraki sayfa"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(totalPages)}
                  className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-whatsapp/40 hover:text-whatsapp disabled:opacity-40 shadow-sm"
                  aria-label="Son sayfa"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

    </div>
  );
}
