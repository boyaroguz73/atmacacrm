'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone, rewriteMediaUrlForClient, backendPublicUrl } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import DateRangePicker from '@/components/ui/DateRangePicker';
import {
  Package,
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  RefreshCw,
  User,
  Calendar,
  ExternalLink,
  Search,
  Trash2,
} from 'lucide-react';
import PanelEditedBadge from '@/components/ui/PanelEditedBadge';

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

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

function lineVatAmount(item: OrderItemRow) {
  const gross = item.lineTotal;
  const divider = 1 + (item.vatRate / 100);
  const net = divider > 0 ? gross / divider : gross;
  return Math.round((gross - net) * 100) / 100;
}

export default function OrdersPage() {
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
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [expectedDeliveryDraft, setExpectedDeliveryDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [shippingDraft, setShippingDraft] = useState('');
  const [invoiceDueDraft, setInvoiceDueDraft] = useState('');
  const [pdfRegenLoading, setPdfRegenLoading] = useState(false);

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

  useEffect(() => {
    if (!selectedOrder || detailLoading) return;
    setExpectedDeliveryDraft(toDateInputValue(selectedOrder.expectedDeliveryDate ?? null));
    setNotesDraft(selectedOrder.notes ?? '');
    setShippingDraft(selectedOrder.shippingAddress ?? '');
  }, [selectedOrder?.id, selectedOrder?.expectedDeliveryDate, selectedOrder?.notes, selectedOrder?.shippingAddress, detailLoading]);

  useEffect(() => {
    if (selectedOrder?.id) setInvoiceDueDraft('');
  }, [selectedOrder?.id]);

  const openDetail = async (order: SalesOrder) => {
    setSelectedOrder(order);
    setDetailLoading(true);
    try {
      const { data } = await api.get<SalesOrder>(`/orders/${order.id}`);
      setSelectedOrder(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Sipariş detayı alınamadı'));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedOrder(null);
  };

  const patchStatus = async (orderId: string, status: OrderStatus) => {
    setStatusSaving(true);
    try {
      const { data } = await api.patch<SalesOrder>(`/orders/${orderId}/status`, { status });
      setSelectedOrder((cur) => (cur && cur.id === orderId ? { ...cur, ...data } : cur));
      toast.success('Durum güncellendi');
      await fetchOrders(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Durum güncellenemedi'));
    } finally {
      setStatusSaving(false);
    }
  };

  const saveOrderMeta = async () => {
    if (!selectedOrder) return;
    setMetaSaving(true);
    try {
      const { data } = await api.patch<SalesOrder>(`/orders/${selectedOrder.id}`, {
        expectedDeliveryDate: expectedDeliveryDraft
          ? new Date(expectedDeliveryDraft).toISOString()
          : null,
        notes: notesDraft.trim() === '' ? null : notesDraft,
        shippingAddress: shippingDraft.trim() === '' ? null : shippingDraft,
      });
      setSelectedOrder((cur) => (cur && cur.id === data.id ? { ...cur, ...data } : cur));
      toast.success('Sipariş bilgileri kaydedildi');
      void fetchOrders(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setMetaSaving(false);
    }
  };

  const createInvoiceFromOrder = async () => {
    if (!selectedOrder) return;
    setInvoiceSaving(true);
    try {
      await api.post('/accounting/invoices/from-order', {
        orderId: selectedOrder.id,
        ...(invoiceDueDraft
          ? { dueDate: new Date(invoiceDueDraft).toISOString() }
          : {}),
      });
      toast.success('Fatura oluşturuldu');
      closeDetail();
      void fetchOrders(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Fatura oluşturulamadı'));
    } finally {
      setInvoiceSaving(false);
    }
  };

  const regenerateOrderPdf = async () => {
    if (!selectedOrder) return;
    setPdfRegenLoading(true);
    try {
      const { data } = await api.post<SalesOrder>(
        `/orders/${selectedOrder.id}/regenerate-confirmation-pdf`,
      );
      setSelectedOrder(data);
      toast.success('Sipariş onay PDF’i güncellendi');
      void fetchOrders(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'PDF oluşturulamadı'));
    } finally {
      setPdfRegenLoading(false);
    }
  };

  const removeOrder = async (order: SalesOrder, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!canDeleteOrder) return;
    if (!confirm(`Sipariş ${formatOrderNo(order.orderNumber)} silinsin mi?`)) return;
    try {
      await api.delete(`/orders/${order.id}`);
      toast.success('Sipariş silindi');
      if (selectedOrder?.id === order.id) closeDetail();
      void fetchOrders(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
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

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
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
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
              setPage(1);
            }}
          />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Kişi adı veya telefon..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9 pr-3 py-2 w-52 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
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
                {canDeleteOrder ? <th className="px-5 py-3 w-12" /> : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canDeleteOrder ? 9 : 8} className="text-center py-16 text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
                      <span className="text-sm">Yükleniyor…</span>
                    </div>
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={canDeleteOrder ? 9 : 8} className="text-center py-16 text-gray-400 text-sm">
                    Sipariş bulunamadı
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void openDetail(order)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void openDetail(order);
                      }
                    }}
                    className="border-b border-gray-50 hover:bg-green-50/30 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-gray-900">
                      {formatOrderNo(order.orderNumber)}
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

      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px]"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-detail-title"
            className="bg-white rounded-xl border border-gray-100 shadow-lg max-w-3xl w-full max-h-[min(90vh,720px)] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50/50">
              <div>
                <h2 id="order-detail-title" className="text-lg font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                  <Package className="w-5 h-5 text-whatsapp" />
                  {formatOrderNo(selectedOrder.orderNumber)}
                  <PanelEditedBadge at={selectedOrder.panelEditedAt} />
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {contactDisplayName(selectedOrder.contact)} · {formatPhone(selectedOrder.contact.phone)}
                </p>
                {selectedOrder.createdBy?.name ? (
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 shrink-0" />
                    Oluşturan: <span className="font-medium text-gray-600">{selectedOrder.createdBy.name}</span>
                  </p>
                ) : null}
                <p className="text-xs text-gray-400 mt-0.5">
                  Sipariş tarihi:{' '}
                  {new Date(selectedOrder.createdAt).toLocaleString('tr-TR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {detailLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                  <Loader2 className="w-7 h-7 animate-spin text-whatsapp" />
                  <span className="text-sm">Detay yükleniyor…</span>
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                    <div className="flex-1 space-y-1">
                      <label htmlFor="order-status" className="text-xs font-semibold text-gray-500 uppercase">
                        Sipariş durumu
                      </label>
                      <select
                        id="order-status"
                        value={selectedOrder.status}
                        disabled={statusSaving}
                        onChange={(e) => {
                          const next = e.target.value as OrderStatus;
                          void patchStatus(selectedOrder.id, next);
                        }}
                        className="w-full sm:max-w-xs px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp disabled:opacity-50 shadow-sm"
                      >
                        {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <div>
                        <span className="text-gray-400 text-xs block">Para birimi</span>
                        <span className="font-medium text-gray-900">{selectedOrder.currency || 'TRY'}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 text-xs block">Genel toplam</span>
                        <span className="font-semibold text-whatsapp tabular-nums">
                          {formatMoney(selectedOrder.grandTotal, selectedOrder.currency)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {selectedOrder.quote && (
                    <p className="text-xs text-gray-500">
                      Teklif:{' '}
                      <span className="font-mono font-medium text-gray-700">{formatQuoteNo(selectedOrder.quote.quoteNumber)}</span>
                    </p>
                  )}

                  <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                      <Calendar className="w-4 h-4 text-whatsapp" />
                      Tarih ve adres
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Planlanan teslim tarihi</label>
                      <input
                        type="date"
                        value={expectedDeliveryDraft}
                        onChange={(e) => setExpectedDeliveryDraft(e.target.value)}
                        className="w-full max-w-xs px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Sevk adresi</label>
                      <textarea
                        value={shippingDraft}
                        onChange={(e) => setShippingDraft(e.target.value)}
                        rows={2}
                        placeholder="İsteğe bağlı"
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp resize-y"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Notlar</label>
                      <textarea
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp resize-y"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={metaSaving || statusSaving}
                      onClick={() => void saveOrderMeta()}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                    >
                      {metaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Bilgileri kaydet
                    </button>
                  </div>

                  <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-4 space-y-2">
                    <p className="text-xs font-semibold text-gray-800">Fatura oluştururken vade tarihi</p>
                    <p className="text-[11px] text-gray-500">Boş bırakılırsa sistem +30 gün vade uygular.</p>
                    <input
                      type="date"
                      value={invoiceDueDraft}
                      onChange={(e) => setInvoiceDueDraft(e.target.value)}
                      className="w-full max-w-xs px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                    />
                  </div>

                  {selectedOrder.status === 'CANCELLED' ? (
                    <p className="text-xs text-red-600 font-medium">İptal edilmiş siparişten fatura oluşturulamaz.</p>
                  ) : null}

                  <div className="rounded-xl border border-gray-100 bg-white p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-800">Sipariş onay PDF’i</h3>
                    <p className="text-[11px] text-gray-500">
                      Tekliften dönüşümde oluşturulur; logo, banka ve şartlar PDF ayarlarından gelir.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedOrder.confirmationPdfUrl ? (
                        <a
                          href={`${backendPublicUrl()}${selectedOrder.confirmationPdfUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-whatsapp hover:underline"
                        >
                          <ExternalLink className="w-4 h-4" />
                          PDF’yi aç
                        </a>
                      ) : (
                        <span className="text-xs text-amber-700">Henüz PDF yok — muhasebe yeniden üretebilir.</span>
                      )}
                      {canRegenerateOrderPdf ? (
                        <button
                          type="button"
                          disabled={pdfRegenLoading || detailLoading}
                          onClick={() => void regenerateOrderPdf()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {pdfRegenLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FileText className="w-3.5 h-3.5" />
                          )}
                          PDF yenile
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">Kalemler</h3>
                    <div className="rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase">
                            <th className="px-3 py-2.5 w-14">Görsel</th>
                            <th className="px-3 py-2.5">Ürün</th>
                            <th className="px-3 py-2.5 text-right">Miktar</th>
                            <th className="px-3 py-2.5 text-right">Birim fiyat</th>
                            <th className="px-3 py-2.5 text-right">KDV</th>
                            <th className="px-3 py-2.5 text-right">Satır toplamı</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedOrder.items?.length ? (
                            selectedOrder.items.map((item) => {
                              const vatAmt = lineVatAmount(item);
                              return (
                                <tr key={item.id} className="border-t border-gray-50">
                                  <td className="px-3 py-2.5 align-middle w-14">
                                    <div className="w-11 h-11 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
                                      {item.product?.imageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={rewriteMediaUrlForClient(item.product.imageUrl)}
                                          alt=""
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        <span className="flex w-full h-full items-center justify-center text-[10px] text-gray-300">
                                          —
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="font-medium text-gray-900">{item.name}</div>
                                    {item.product?.sku ? (
                                      <div className="text-[10px] text-gray-400 font-mono">SKU: {item.product.sku}</div>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{item.quantity}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                                    {formatMoney(item.unitPrice, selectedOrder.currency)}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-gray-700">
                                    <span className="tabular-nums">{item.vatRate}%</span>
                                    <span className="text-gray-400 text-xs block tabular-nums">
                                      ({formatMoney(vatAmt, selectedOrder.currency)})
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-medium text-gray-900 tabular-nums">
                                    {formatMoney(item.lineTotal, selectedOrder.currency)}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={6} className="px-3 py-8 text-center text-gray-400 text-sm">
                                Kalem yok
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/40 flex flex-col sm:flex-row gap-2 sm:justify-end">
              {canDeleteOrder &&
              selectedOrder.status === 'PENDING' &&
              !selectedOrder.invoice ? (
                <button
                  type="button"
                  onClick={() => void removeOrder(selectedOrder)}
                  className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 sm:mr-auto"
                >
                  Siparişi sil
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeDetail}
                className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Kapat
              </button>
              <button
                type="button"
                disabled={
                  invoiceSaving ||
                  detailLoading ||
                  !selectedOrder ||
                  selectedOrder.status === 'CANCELLED'
                }
                onClick={() => void createInvoiceFromOrder()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-medium shadow-sm hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                {invoiceSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Fatura Oluştur
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
