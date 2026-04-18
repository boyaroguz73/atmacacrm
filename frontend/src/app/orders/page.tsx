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
  RefreshCw,
  Search,
  Trash2,
  Plus,
} from 'lucide-react';
import PanelEditedBadge from '@/components/ui/PanelEditedBadge';

type OrderStatus = 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

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
  invoice?: { id: string } | null;
  createdBy?: { id: string; name: string | null } | null;
  contact: {
    id: string;
    name: string | null;
    surname: string | null;
    phone: string;
    email: string | null;
    company: string | null;
  };
  quote: { id: string; quoteNumber: number } | null;
  items: OrderItemRow[];
  confirmationPdfUrl?: string | null;
}

const LIMIT = 20;

const STATUS_FILTERS: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'PENDING', label: 'Beklemede' },
  { value: 'PROCESSING', label: 'İşleniyor' },
  { value: 'SHIPPED', label: 'Kargoda' },
  { value: 'DELIVERED', label: 'Teslim Edildi' },
  { value: 'CANCELLED', label: 'İptal' },
];

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Beklemede',
  PROCESSING: 'İşleniyor',
  SHIPPED: 'Kargoda',
  DELIVERED: 'Teslim Edildi',
  CANCELLED: 'İptal',
};

function formatOrderNo(n: number) {
  return `SIP-${String(n).padStart(5, '0')}`;
}

function formatQuoteNo(n: number) {
  return `TKL-${String(n).padStart(5, '0')}`;
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
    case 'PENDING':
      return 'bg-amber-100 text-amber-800 border border-amber-200/80';
    case 'PROCESSING':
      return 'bg-blue-100 text-blue-800 border border-blue-200/80';
    case 'SHIPPED':
      return 'bg-purple-100 text-purple-800 border border-purple-200/80';
    case 'DELIVERED':
      return 'bg-emerald-100 text-emerald-800 border border-emerald-200/80';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border border-red-200/80';
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
  const canRegenerateOrderPdf =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';
  const canDeleteOrder =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);

  const fetchOrders = useCallback(async (background?: boolean) => {
    if (!background) setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (searchQuery.trim()) params.search = searchQuery.trim();
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
  }, [page, statusFilter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

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
          <button
            type="button"
            onClick={() => void fetchOrders()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:border-whatsapp/40 hover:text-whatsapp transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row xl:items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => {
                setStatusFilter(f.value);
                setPage(1);
              }}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-medium border shadow-sm transition-colors ${
                statusFilter === f.value
                  ? 'bg-whatsapp text-white border-whatsapp'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-whatsapp/30 hover:text-gray-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 xl:ml-auto xl:justify-end xl:flex-nowrap w-full xl:w-auto">
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
              setPage(1);
            }}
          />
          <div className="relative min-w-[240px] flex-1 xl:flex-none xl:min-w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Kişi adı veya telefon..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9 pr-3 py-2 w-full bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-5 py-3">Sipariş No</th>
                <th className="px-5 py-3">Kişi</th>
                <th className="px-5 py-3">Teklif No</th>
                <th className="px-5 py-3">Durum</th>
                <th className="px-5 py-3">Para Birimi</th>
                <th className="px-5 py-3 text-right">Toplam</th>
                <th className="px-5 py-3">Plan. teslim</th>
                <th className="px-5 py-3">Sipariş tarihi</th>
                <th className="px-5 py-3">Temsilci</th>
                {canDeleteOrder ? <th className="px-5 py-3 w-12" /> : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canDeleteOrder ? 10 : 9} className="text-center py-16 text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
                      <span className="text-sm">Yükleniyor…</span>
                    </div>
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={canDeleteOrder ? 10 : 9} className="text-center py-16 text-gray-400 text-sm">
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
                    className="border-b border-gray-50 hover:bg-green-50/30 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-gray-900">
                      <span className="flex items-center gap-1.5">
                        {formatOrderNo(order.orderNumber)}
                        {order.source === 'TSOFT' && (
                          <span className="inline-flex text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase tracking-wide">Site</span>
                        )}
                      </span>
                      <PanelEditedBadge at={order.panelEditedAt} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{contactDisplayName(order.contact)}</div>
                      <div className="text-xs text-gray-400">{formatPhone(order.contact.phone)}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {order.quote ? (
                        <span className="font-mono text-xs font-medium">{formatQuoteNo(order.quote.quoteNumber)}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex text-[10px] font-semibold px-2.5 py-1 rounded-full ${statusBadgeClass(order.status)}`}>
                        {STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{order.currency || 'TRY'}</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900 tabular-nums">
                      {formatMoney(order.grandTotal, order.currency)}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {order.expectedDeliveryDate
                        ? new Date(order.expectedDeliveryDate).toLocaleDateString('tr-TR')
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(order.createdAt).toLocaleString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {order.createdBy?.name || '—'}
                    </td>
                    {canDeleteOrder ? (
                      <td className="px-5 py-3 text-right">
                        {order.status === 'PENDING' && !order.invoice ? (
                          <button
                            type="button"
                            onClick={(e) => void removeOrder(order, e)}
                            className="p-2 rounded-lg text-red-600 hover:bg-red-50"
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
