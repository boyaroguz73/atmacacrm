'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import toast from 'react-hot-toast';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Receipt,
  Send,
  Upload,
  User,
  X,
} from 'lucide-react';

const LIMIT = 15;

type InvoiceStatus = 'PENDING' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED' | string;

interface InvoiceRow {
  id: string;
  invoiceNumber?: number | string | null;
  invoiceNo?: string | null;
  contact?: { id?: string; name?: string | null; phone?: string | null };
  contactName?: string | null;
  personName?: string | null;
  order?: { id?: string; orderNumber?: string | null };
  orderId?: string | null;
  orderNumber?: string | null;
  status: InvoiceStatus;
  currency?: string | null;
  total?: number | string | null;
  amount?: number | string | null;
  dueDate?: string | null;
  pdfUrl?: string | null;
  createdAt?: string | null;
}

interface PendingBillingRow {
  orderId: string;
  id?: string;
  orderNumber?: string | null;
  contact?: { name?: string | null; phone?: string | null };
  contactName?: string | null;
  total?: number | string | null;
  amount?: number | string | null;
  createdAt?: string | null;
  orderDate?: string | null;
  date?: string | null;
}

const STATUS_FILTERS: { key: string | null; label: string; api?: InvoiceStatus }[] = [
  { key: null, label: 'Tümü' },
  { key: 'PENDING', label: 'Beklemede', api: 'PENDING' },
  { key: 'SENT', label: 'Gönderildi', api: 'SENT' },
  { key: 'PAID', label: 'Ödendi', api: 'PAID' },
  { key: 'OVERDUE', label: 'Vadesi Geçmiş', api: 'OVERDUE' },
  { key: 'CANCELLED', label: 'İptal', api: 'CANCELLED' },
];

const STATUS_PATCH_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: 'PENDING', label: 'Beklemede' },
  { value: 'SENT', label: 'Gönderildi' },
  { value: 'PAID', label: 'Ödendi' },
  { value: 'OVERDUE', label: 'Vadesi Geçmiş' },
  { value: 'CANCELLED', label: 'İptal' },
];

function pickArray(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.invoices)) return o.invoices;
  if (Array.isArray(o.items)) return o.items;
  if (Array.isArray(o.data)) return o.data;
  if (Array.isArray(o.rows)) return o.rows;
  if (Array.isArray(o.orders)) return o.orders;
  if (Array.isArray(o.pending)) return o.pending;
  return [];
}

function pickTotal(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const o = data as Record<string, unknown>;
  if (typeof o.total === 'number') return o.total;
  if (typeof o.total === 'string' && o.total.trim() !== '') return Number(o.total) || 0;
  const meta = o.meta;
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>;
    if (typeof m.total === 'number') return m.total;
  }
  return 0;
}

function formatInvoiceNo(inv: InvoiceRow): string {
  const raw = inv.invoiceNo != null ? String(inv.invoiceNo).trim() : '';
  if (raw) return raw;
  const n = inv.invoiceNumber;
  if (typeof n === 'number' && Number.isFinite(n)) {
    return `FTR-${String(Math.floor(n)).padStart(5, '0')}`;
  }
  if (typeof n === 'string' && /^\d+$/.test(n)) {
    return `FTR-${n.padStart(5, '0')}`;
  }
  const idDigits = (inv.id || '').replace(/\D/g, '').slice(-8) || '0';
  return `FTR-${idDigits.padStart(5, '0').slice(-5)}`;
}

function safeStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function personLabel(inv: InvoiceRow): string {
  const c = inv.contact;
  return (
    safeStr(c?.name) ||
    safeStr(inv.contactName) ||
    safeStr(inv.personName) ||
    '—'
  );
}

function personPhone(inv: InvoiceRow): string | null | undefined {
  return inv.contact?.phone ?? null;
}

function orderNoLabel(inv: InvoiceRow): string {
  return (
    safeStr(inv.order?.orderNumber) ||
    safeStr(inv.orderNumber) ||
    safeStr(inv.orderId) ||
    '—'
  );
}

function moneyAmount(inv: InvoiceRow | PendingBillingRow): number {
  const t = 'total' in inv ? inv.total : undefined;
  const a = 'amount' in inv ? inv.amount : undefined;
  const v = t ?? a;
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(amount: number, currency: string | null | undefined): string {
  const cur = safeStr(currency) || 'TRY';
  return `${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function statusBadgeClass(status: string): string {
  const s = (status || '').toUpperCase();
  switch (s) {
    case 'PENDING':
      return 'bg-amber-100 text-amber-900 border border-amber-200';
    case 'SENT':
      return 'bg-blue-100 text-blue-900 border border-blue-200';
    case 'PAID':
      return 'bg-emerald-100 text-emerald-900 border border-emerald-200';
    case 'OVERDUE':
      return 'bg-red-100 text-red-900 border border-red-200';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-600 border border-gray-200';
    default:
      return 'bg-gray-50 text-gray-700 border border-gray-200';
  }
}

function statusLabelTr(status: string): string {
  const s = (status || '').toUpperCase();
  const map: Record<string, string> = {
    PENDING: 'Beklemede',
    SENT: 'Gönderildi',
    PAID: 'Ödendi',
    OVERDUE: 'Vadesi Geçmiş',
    CANCELLED: 'İptal',
  };
  return map[s] || status || '—';
}

function normalizePendingRow(raw: unknown): PendingBillingRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const orderId = String(o.orderId ?? o.id ?? '');
  if (!orderId) return null;
  const contact =
    o.contact && typeof o.contact === 'object'
      ? (o.contact as PendingBillingRow['contact'])
      : undefined;
  return {
    orderId,
    id: o.id != null ? String(o.id) : undefined,
    orderNumber: o.orderNumber != null ? String(o.orderNumber) : null,
    contact,
    contactName: o.contactName != null ? String(o.contactName) : null,
    total: o.total as PendingBillingRow['total'],
    amount: o.amount as PendingBillingRow['amount'],
    createdAt: o.createdAt != null ? String(o.createdAt) : null,
    orderDate: o.orderDate != null ? String(o.orderDate) : null,
    date: o.date != null ? String(o.date) : null,
  };
}

function normalizeInvoiceRow(raw: unknown): InvoiceRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '');
  if (!id) return null;
  const contact =
    o.contact && typeof o.contact === 'object'
      ? (o.contact as InvoiceRow['contact'])
      : undefined;
  const order =
    o.order && typeof o.order === 'object' ? (o.order as InvoiceRow['order']) : undefined;
  return {
    id,
    invoiceNumber: o.invoiceNumber as InvoiceRow['invoiceNumber'],
    invoiceNo: o.invoiceNo != null ? String(o.invoiceNo) : null,
    contact,
    contactName: o.contactName != null ? String(o.contactName) : null,
    personName: o.personName != null ? String(o.personName) : null,
    order,
    orderId: o.orderId != null ? String(o.orderId) : null,
    orderNumber: o.orderNumber != null ? String(o.orderNumber) : null,
    status: String(o.status ?? 'PENDING'),
    currency: o.currency != null ? String(o.currency) : null,
    total: o.total as InvoiceRow['total'],
    amount: o.amount as InvoiceRow['amount'],
    dueDate: o.dueDate != null ? String(o.dueDate) : null,
    pdfUrl: o.pdfUrl != null ? String(o.pdfUrl) : null,
    createdAt: o.createdAt != null ? String(o.createdAt) : null,
  };
}

export default function AccountingInvoicesPage() {
  const [tab, setTab] = useState<'invoices' | 'pending'>('invoices');

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  /** API toplam kayıt sayısı; yoksa null (Sonraki, sayfa metni tahmine dayanır) */
  const [invoiceTotalCount, setInvoiceTotalCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const [pendingRows, setPendingRows] = useState<PendingBillingRow[]>([]);
  const [pendingTotalCount, setPendingTotalCount] = useState<number | null>(null);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [invoicesHasMore, setInvoicesHasMore] = useState(false);
  const [pendingHasMore, setPendingHasMore] = useState(false);

  const [detail, setDetail] = useState<InvoiceRow | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [sendSessionName, setSendSessionName] = useState('');
  const [sendTemplateBody, setSendTemplateBody] = useState('');
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      const apiStatus = STATUS_FILTERS.find((f) => f.key === statusFilter)?.api;
      if (apiStatus) params.status = apiStatus;

      const { data } = await api.get('/accounting/invoices', { params });
      const list = pickArray(data)
        .map(normalizeInvoiceRow)
        .filter((x): x is InvoiceRow => Boolean(x));
      setInvoices(list);
      const t = pickTotal(data);
      if (t > 0) {
        setInvoiceTotalCount(t);
        setInvoicesHasMore(page * LIMIT < t);
      } else {
        setInvoiceTotalCount(null);
        setInvoicesHasMore(list.length >= LIMIT);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Faturalar yüklenemedi'));
      setInvoices([]);
      setInvoiceTotalCount(null);
      setInvoicesHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  const fetchPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const { data } = await api.get('/accounting/invoices/pending-billing', {
        params: { page: pendingPage, limit: LIMIT },
      });
      const list = pickArray(data)
        .map(normalizePendingRow)
        .filter((x): x is PendingBillingRow => Boolean(x));
      setPendingRows(list);
      const t = pickTotal(data);
      if (t > 0) {
        setPendingTotalCount(t);
        setPendingHasMore(pendingPage * LIMIT < t);
      } else {
        setPendingTotalCount(null);
        setPendingHasMore(list.length >= LIMIT);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Fatura bekleyenler yüklenemedi'));
      setPendingRows([]);
      setPendingTotalCount(null);
      setPendingHasMore(false);
    } finally {
      setPendingLoading(false);
    }
  }, [pendingPage]);

  useEffect(() => {
    if (tab === 'invoices') fetchInvoices();
  }, [tab, fetchInvoices]);

  useEffect(() => {
    if (tab === 'pending') fetchPending();
  }, [tab, fetchPending]);

  const invoicePageCount =
    invoiceTotalCount != null ? Math.max(1, Math.ceil(invoiceTotalCount / LIMIT)) : null;
  const pendingPageCount =
    pendingTotalCount != null ? Math.max(1, Math.ceil(pendingTotalCount / LIMIT)) : null;

  const closeDetail = () => {
    setDetail(null);
    setShowSendForm(false);
    setSendSessionName('');
    setSendTemplateBody('');
  };

  const refreshDetailInList = (updated: InvoiceRow) => {
    setInvoices((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setDetail((d) => (d && d.id === updated.id ? { ...d, ...updated } : d));
  };

  const patchStatus = async (inv: InvoiceRow, status: InvoiceStatus) => {
    setDetailBusy(true);
    try {
      const { data } = await api.patch(`/accounting/invoices/${inv.id}/status`, { status });
      const merged = normalizeInvoiceRow({ ...inv, ...(data && typeof data === 'object' ? data : {}), status });
      if (merged) refreshDetailInList(merged);
      toast.success('Durum güncellendi');
      fetchInvoices();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Durum güncellenemedi'));
    } finally {
      setDetailBusy(false);
    }
  };

  const uploadPdf = async (inv: InvoiceRow, file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Yalnızca PDF dosyası seçin');
      return;
    }
    setDetailBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/accounting/invoices/${inv.id}/upload-pdf`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const merged = normalizeInvoiceRow({
        ...inv,
        ...(data && typeof data === 'object' ? data : {}),
      });
      if (merged) refreshDetailInList(merged);
      toast.success('PDF yüklendi');
      fetchInvoices();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'PDF yüklenemedi'));
    } finally {
      setDetailBusy(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const sendInvoice = async (inv: InvoiceRow) => {
    if (!sendSessionName.trim()) {
      toast.error('Oturum adı gerekli');
      return;
    }
    setDetailBusy(true);
    try {
      await api.post(`/accounting/invoices/${inv.id}/send`, {
        sessionName: sendSessionName.trim(),
        ...(sendTemplateBody.trim() ? { templateBody: sendTemplateBody.trim() } : {}),
      });
      toast.success('Fatura gönderildi');
      setShowSendForm(false);
      setSendSessionName('');
      setSendTemplateBody('');
      fetchInvoices();
      const merged = normalizeInvoiceRow({ ...inv, status: 'SENT' });
      if (merged) refreshDetailInList(merged);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Gönderim başarısız'));
    } finally {
      setDetailBusy(false);
    }
  };

  const createFromOrder = async (orderId: string) => {
    try {
      await api.post('/accounting/invoices/from-order', { orderId });
      toast.success('Fatura oluşturuldu');
      fetchPending();
      if (tab === 'invoices') fetchInvoices();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Fatura oluşturulamadı'));
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Receipt className="w-8 h-8 text-whatsapp" />
            Faturalar
          </h1>
          <p className="text-sm text-gray-500 mt-1">Muhasebe — fatura listesi ve fatura bekleyen siparişler</p>
        </div>
      </div>

      <div className="flex rounded-xl bg-gray-100/80 p-1 shadow-sm border border-gray-100 max-w-md">
        <button
          type="button"
          onClick={() => setTab('invoices')}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
            tab === 'invoices'
              ? 'bg-white text-whatsapp shadow-sm border border-gray-100'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Faturalar
        </button>
        <button
          type="button"
          onClick={() => setTab('pending')}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
            tab === 'pending'
              ? 'bg-white text-whatsapp shadow-sm border border-gray-100'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Fatura Bekleyenler
        </button>
      </div>

      {tab === 'invoices' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Durum</p>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key ?? 'all'}
                  type="button"
                  onClick={() => {
                    setStatusFilter(f.key);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === f.key
                      ? 'bg-whatsapp text-white shadow-sm'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-whatsapp" />
                Yükleniyor…
              </div>
            ) : invoices.length === 0 ? (
              <p className="text-center py-16 text-gray-400 text-sm">Kayıt bulunamadı.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <th className="px-5 py-3">Fatura No</th>
                      <th className="px-5 py-3">Kişi</th>
                      <th className="px-5 py-3">Sipariş No</th>
                      <th className="px-5 py-3">Durum</th>
                      <th className="px-5 py-3">Para Birimi</th>
                      <th className="px-5 py-3">Toplam</th>
                      <th className="px-5 py-3">Vade Tarihi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr
                        key={inv.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setDetail(inv);
                          setShowSendForm(false);
                          setSendSessionName('');
                          setSendTemplateBody('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDetail(inv);
                            setShowSendForm(false);
                          }
                        }}
                        className="border-b border-gray-50 hover:bg-whatsapp/5 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3 font-mono font-medium text-gray-900">{formatInvoiceNo(inv)}</td>
                        <td className="px-5 py-3">
                          <div className="font-medium text-gray-900">{personLabel(inv)}</div>
                          {personPhone(inv) ? (
                            <div className="text-xs text-gray-500">{formatPhone(personPhone(inv))}</div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-gray-700">{orderNoLabel(inv)}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${statusBadgeClass(
                              inv.status,
                            )}`}
                          >
                            {statusLabelTr(String(inv.status))}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-600">{safeStr(inv.currency) || 'TRY'}</td>
                        <td className="px-5 py-3 font-medium text-gray-900">
                          {formatMoney(moneyAmount(inv), inv.currency)}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{formatDate(inv.dueDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-whatsapp disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
                Önceki
              </button>
              <span className="text-xs text-gray-500">
                {invoicePageCount != null
                  ? `Sayfa ${page} / ${invoicePageCount} — Toplam ${invoiceTotalCount}`
                  : `Sayfa ${page}${invoicesHasMore ? ' · devamı var' : ''} — Bu sayfada ${invoices.length} kayıt`}
              </span>
              <button
                type="button"
                disabled={loading || !invoicesHasMore}
                onClick={() => setPage((p) => p + 1)}
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-whatsapp disabled:opacity-40"
              >
                Sonraki
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {pendingLoading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-whatsapp" />
              Yükleniyor…
            </div>
          ) : pendingRows.length === 0 ? (
            <p className="text-center py-16 text-gray-400 text-sm">Fatura bekleyen sipariş yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-5 py-3">Sipariş No</th>
                    <th className="px-5 py-3">Kişi</th>
                    <th className="px-5 py-3">Toplam</th>
                    <th className="px-5 py-3">Tarih</th>
                    <th className="px-5 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRows.map((row) => {
                    const orderLabel =
                      safeStr(row.orderNumber) || safeStr(row.orderId) || safeStr(row.id) || '—';
                    const name =
                      safeStr(row.contact?.name) || safeStr(row.contactName) || '—';
                    const phone = row.contact?.phone;
                    const dateStr =
                      row.orderDate || row.createdAt || row.date || null;
                    return (
                      <tr key={row.orderId} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-5 py-3 font-medium text-gray-900">{orderLabel}</td>
                        <td className="px-5 py-3">
                          <div className="text-gray-900">{name}</div>
                          {phone ? (
                            <div className="text-xs text-gray-500">{formatPhone(phone)}</div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-gray-800">
                          {formatMoney(moneyAmount(row), 'TRY')}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{formatDate(dateStr)}</td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => createFromOrder(row.orderId)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-whatsapp text-white shadow-sm hover:opacity-95"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Fatura Oluştur
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40">
            <button
              type="button"
              disabled={pendingPage <= 1 || pendingLoading}
              onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-whatsapp disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              Önceki
            </button>
            <span className="text-xs text-gray-500">
              {pendingPageCount != null
                ? `Sayfa ${pendingPage} / ${pendingPageCount} — Toplam ${pendingTotalCount}`
                : `Sayfa ${pendingPage}${pendingHasMore ? ' · devamı var' : ''} — Bu sayfada ${pendingRows.length} kayıt`}
            </span>
            <button
              type="button"
              disabled={pendingLoading || !pendingHasMore}
              onClick={() => setPendingPage((p) => p + 1)}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-whatsapp disabled:opacity-40"
            >
              Sonraki
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {detail ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[1px]"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl shadow-xl border border-gray-100 max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{formatInvoiceNo(detail)}</h2>
                <p className="text-xs text-gray-500 mt-0.5">Fatura detayı</p>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 text-sm">
              <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <User className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-500">Kişi</p>
                    <p className="font-medium text-gray-900">{personLabel(detail)}</p>
                    {personPhone(detail) ? (
                      <p className="text-gray-600 text-xs">{formatPhone(personPhone(detail))}</p>
                    ) : null}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500">Sipariş No</p>
                    <p className="font-medium text-gray-900">{orderNoLabel(detail)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Durum</p>
                    <span
                      className={`inline-flex mt-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass(
                        detail.status,
                      )}`}
                    >
                      {statusLabelTr(String(detail.status))}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Toplam</p>
                    <p className="font-semibold text-gray-900">
                      {formatMoney(moneyAmount(detail), detail.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Vade</p>
                    <p className="font-medium text-gray-900">{formatDate(detail.dueDate)}</p>
                  </div>
                </div>
                {detail.pdfUrl ? (
                  <p className="text-xs text-whatsapp pt-1 break-all">
                    PDF:{' '}
                    <a
                      href={detail.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Aç
                    </a>
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadPdf(detail, f);
                  }}
                />
                <button
                  type="button"
                  disabled={detailBusy}
                  onClick={() => pdfInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 shadow-sm disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  PDF Yükle
                </button>
                <button
                  type="button"
                  disabled={detailBusy}
                  onClick={() => setShowSendForm((s) => !s)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-whatsapp text-white shadow-sm hover:opacity-95 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  Gönder
                </button>
                <button
                  type="button"
                  disabled={detailBusy || String(detail.status).toUpperCase() === 'PAID'}
                  onClick={() => patchStatus(detail, 'PAID')}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  Ödendi
                </button>
              </div>

              {showSendForm ? (
                <div className="rounded-xl border border-whatsapp/25 bg-whatsapp/5 p-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-700">WhatsApp gönderimi</p>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Oturum adı (sessionName)</label>
                    <input
                      value={sendSessionName}
                      onChange={(e) => setSendSessionName(e.target.value)}
                      placeholder="Örn: default"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/30 focus:border-whatsapp"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Şablon gövdesi (isteğe bağlı)</label>
                    <textarea
                      value={sendTemplateBody}
                      onChange={(e) => setSendTemplateBody(e.target.value)}
                      rows={3}
                      placeholder="Boş bırakılabilir"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/30 focus:border-whatsapp resize-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={detailBusy}
                    onClick={() => sendInvoice(detail)}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold bg-whatsapp text-white shadow-sm disabled:opacity-50"
                  >
                    Gönderimi başlat
                  </button>
                </div>
              ) : null}

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Durum değiştir</label>
                <select
                  value={String(detail.status).toUpperCase()}
                  disabled={detailBusy}
                  onChange={(e) => {
                    const v = e.target.value as InvoiceStatus;
                    if (v !== String(detail.status).toUpperCase()) patchStatus(detail, v);
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp disabled:opacity-50"
                >
                  {STATUS_PATCH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {detailBusy ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin text-whatsapp" />
                  İşlem sürüyor…
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
