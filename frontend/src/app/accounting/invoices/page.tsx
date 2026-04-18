'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  Suspense,
} from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone, backendPublicUrl } from '@/lib/utils';
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
  Trash2,
} from 'lucide-react';
import PanelEditedBadge from '@/components/ui/PanelEditedBadge';
import { useRouter, useSearchParams } from 'next/navigation';

const LIMIT = 15;

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

type InvoiceStatus = 'PENDING' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED' | string;

interface InvoiceRow {
  id: string;
  invoiceNumber?: number | string | null;
  invoiceNo?: string | null;
  contact?: {
    id?: string;
    name?: string | null;
    surname?: string | null;
    phone?: string | null;
    company?: string | null;
    address?: string | null;
    billingAddress?: string | null;
    taxOffice?: string | null;
    taxNumber?: string | null;
    identityNumber?: string | null;
  };
  contactName?: string | null;
  personName?: string | null;
  order?: { id?: string; orderNumber?: string | null };
  orderId?: string | null;
  orderNumber?: string | null;
  status: InvoiceStatus;
  currency?: string | null;
  total?: number | string | null;
  amount?: number | string | null;
  /** API (Prisma) alanı; liste/detayda toplam için kullanılır */
  grandTotal?: number | string | null;
  dueDate?: string | null;
  pdfUrl?: string | null;
  uploadedPdfUrl?: string | null;
  createdAt?: string | null;
  notes?: string | null;
  createdBy?: { id?: string; name?: string | null } | null;
  panelEditedAt?: string | null;
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
  expectedDeliveryDate?: string | null;
  createdBy?: { name?: string | null } | null;
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
  const full = [c?.name, c?.surname].filter(Boolean).join(' ').trim();
  return (
    full ||
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
  const g = 'grandTotal' in inv ? (inv as InvoiceRow).grandTotal : undefined;
  const t = 'total' in inv ? inv.total : undefined;
  const a = 'amount' in inv ? inv.amount : undefined;
  const v = g ?? t ?? a;
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(String(v).replace(',', '.')) : Number(v);
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
  const createdBy =
    o.createdBy && typeof o.createdBy === 'object'
      ? (o.createdBy as PendingBillingRow['createdBy'])
      : undefined;
  return {
    orderId,
    id: o.id != null ? String(o.id) : undefined,
    orderNumber: o.orderNumber != null ? String(o.orderNumber) : null,
    contact,
    contactName: o.contactName != null ? String(o.contactName) : null,
    total: (o.grandTotal ?? o.total ?? o.amount ?? o.subtotal) as PendingBillingRow['total'],
    amount: o.amount as PendingBillingRow['amount'],
    createdAt: o.createdAt != null ? String(o.createdAt) : null,
    orderDate: o.orderDate != null ? String(o.orderDate) : null,
    date: o.date != null ? String(o.date) : null,
    expectedDeliveryDate:
      o.expectedDeliveryDate != null ? String(o.expectedDeliveryDate) : null,
    createdBy,
  };
}

function PendingInvoiceCreateButton({
  onCreate,
}: {
  onCreate: (dueIso?: string) => void;
}) {
  const [due, setDue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCreate(due ? new Date(due).toISOString() : undefined);
    setDue('');
  };
  return (
    <form onSubmit={submit} className="inline-flex flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        type="date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        className="max-w-[132px] px-2 py-1 rounded-lg border border-gray-200 text-[10px] bg-white"
        title="Vade (boş = +30 gün)"
      />
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-whatsapp text-white shadow-sm hover:opacity-95"
      >
        <FileText className="w-3.5 h-3.5" />
        Fatura
      </button>
    </form>
  );
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
    grandTotal: o.grandTotal as InvoiceRow['grandTotal'],
    total: (o.grandTotal ?? o.total ?? o.amount ?? o.subtotal) as InvoiceRow['total'],
    amount: o.amount as InvoiceRow['amount'],
    dueDate:
      o.dueDate != null && o.dueDate !== ''
        ? String(o.dueDate)
        : null,
    pdfUrl: o.pdfUrl != null ? String(o.pdfUrl) : null,
    uploadedPdfUrl: o.uploadedPdfUrl != null ? String(o.uploadedPdfUrl) : null,
    createdAt: o.createdAt != null ? String(o.createdAt) : null,
    notes: o.notes != null ? String(o.notes) : null,
    createdBy:
      o.createdBy && typeof o.createdBy === 'object'
        ? (o.createdBy as InvoiceRow['createdBy'])
        : undefined,
    panelEditedAt:
      o.panelEditedAt != null && o.panelEditedAt !== '' ? String(o.panelEditedAt) : null,
  };
}

function AccountingInvoicesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<'invoices' | 'pending'>('invoices');

  useLayoutEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'pending') setTab('pending');
    else setTab('invoices');
  }, [searchParams]);

  const setTabAndUrl = useCallback(
    (next: 'invoices' | 'pending') => {
      setTab(next);
      const path =
        next === 'pending' ? '/accounting/invoices?tab=pending' : '/accounting/invoices';
      router.replace(path, { scroll: false });
    },
    [router],
  );

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
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showPdfUploadConfirm, setShowPdfUploadConfirm] = useState(false);
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [dueEdit, setDueEdit] = useState('');
  const [notesEdit, setNotesEdit] = useState('');

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

  useEffect(() => {
    if (!detail) return;
    setDueEdit(toDateInputValue(detail.dueDate));
    setNotesEdit(detail.notes != null ? String(detail.notes) : '');
  }, [detail?.id, detail?.dueDate, detail?.notes]);

  const invoicePageCount =
    invoiceTotalCount != null ? Math.max(1, Math.ceil(invoiceTotalCount / LIMIT)) : null;
  const pendingPageCount =
    pendingTotalCount != null ? Math.max(1, Math.ceil(pendingTotalCount / LIMIT)) : null;

  const closeDetail = () => {
    setDetail(null);
    setDueEdit('');
    setNotesEdit('');
  };

  const openInvoiceDetail = async (inv: InvoiceRow) => {
    setDetail(inv);
    setDetailBusy(true);
    try {
      const { data } = await api.get(`/accounting/invoices/${inv.id}`);
      const n = normalizeInvoiceRow(data);
      if (n) setDetail(n);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Fatura detayı alınamadı'));
    } finally {
      setDetailBusy(false);
    }
  };

  const refreshDetailInList = (updated: InvoiceRow) => {
    setInvoices((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setDetail((d) => (d && d.id === updated.id ? { ...d, ...updated } : d));
  };

  const saveInvoiceMeta = async (inv: InvoiceRow) => {
    setDetailBusy(true);
    try {
      const { data } = await api.patch(`/accounting/invoices/${inv.id}`, {
        dueDate: dueEdit ? new Date(dueEdit).toISOString() : null,
        notes: notesEdit.trim() === '' ? null : notesEdit,
      });
      const merged = normalizeInvoiceRow({
        ...inv,
        ...(data && typeof data === 'object' ? data : {}),
      });
      if (merged) refreshDetailInList(merged);
      toast.success('Vade ve notlar kaydedildi');
      fetchInvoices();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setDetailBusy(false);
    }
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
        timeout: 120_000,
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
    setDetailBusy(true);
    try {
      await api.post(`/accounting/invoices/${inv.id}/send`, {});
      toast.success('Fatura gönderildi');
      fetchInvoices();
      const merged = normalizeInvoiceRow({ ...inv, status: 'SENT' });
      if (merged) refreshDetailInList(merged);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Gönderim başarısız'));
    } finally {
      setDetailBusy(false);
    }
  };

  const confirmPdfUpload = async () => {
    if (!detail || !pendingPdfFile) {
      setShowPdfUploadConfirm(false);
      setPendingPdfFile(null);
      return;
    }
    const inv = detail;
    const file = pendingPdfFile;
    setShowPdfUploadConfirm(false);
    setPendingPdfFile(null);
    await uploadPdf(inv, file);
  };

  const deleteInvoice = async (inv: InvoiceRow) => {
    if (String(inv.status).toUpperCase() !== 'PENDING') {
      toast.error('Sadece beklemedeki faturalar silinebilir');
      return;
    }
    if (!confirm(`${formatInvoiceNo(inv)} silinsin mi?`)) return;
    setDetailBusy(true);
    try {
      await api.delete(`/accounting/invoices/${inv.id}`);
      toast.success('Fatura silindi');
      setDetail((d) => (d?.id === inv.id ? null : d));
      void fetchInvoices();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    } finally {
      setDetailBusy(false);
    }
  };

  const createFromOrder = async (orderId: string, dueDateIso?: string) => {
    try {
      await api.post('/accounting/invoices/from-order', {
        orderId,
        ...(dueDateIso ? { dueDate: dueDateIso } : {}),
      });
      toast.success('Fatura oluşturuldu');
      fetchPending();
      if (tab === 'invoices') fetchInvoices();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Fatura oluşturulamadı'));
    }
  };

  return (
    <div className="space-y-6">
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
          onClick={() => setTabAndUrl('invoices')}
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
          onClick={() => setTabAndUrl('pending')}
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
                <table className="w-full text-sm min-w-[820px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      <th className="px-5 py-3">Fatura No</th>
                      <th className="px-5 py-3">Kişi</th>
                      <th className="px-5 py-3">Sipariş No</th>
                      <th className="px-5 py-3">Durum</th>
                      <th className="px-5 py-3">Para Birimi</th>
                      <th className="px-5 py-3">Toplam</th>
                      <th className="px-5 py-3">Vade</th>
                      <th className="px-5 py-3">Oluşturan</th>
                      <th className="px-5 py-3 w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr
                        key={inv.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => void openInvoiceDetail(inv)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void openInvoiceDetail(inv);
                          }
                        }}
                        className="border-b border-gray-50 hover:bg-whatsapp/5 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3 font-mono font-medium text-gray-900">
                          <span className="inline-flex items-center flex-wrap gap-x-0">
                            {formatInvoiceNo(inv)}
                            <PanelEditedBadge at={inv.panelEditedAt} />
                          </span>
                        </td>
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
                        <td className="px-5 py-3 text-gray-600 text-xs max-w-[100px] truncate" title={inv.createdBy?.name || ''}>
                          {inv.createdBy?.name || '—'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {String(inv.status).toUpperCase() === 'PENDING' ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteInvoice(inv);
                              }}
                              className="p-2 rounded-lg text-red-600 hover:bg-red-50"
                              aria-label="Sil"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : null}
                        </td>
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
              <table className="w-full text-sm min-w-[920px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-5 py-3">Sipariş No</th>
                    <th className="px-5 py-3">Kişi</th>
                    <th className="px-5 py-3">Toplam</th>
                    <th className="px-5 py-3">Plan. teslim</th>
                    <th className="px-5 py-3">Tarih</th>
                    <th className="px-5 py-3">Oluşturan</th>
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
                        <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">
                          {formatDate(row.expectedDeliveryDate)}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{formatDate(dateStr)}</td>
                        <td className="px-5 py-3 text-gray-600 text-xs max-w-[90px] truncate" title={row.createdBy?.name || ''}>
                          {row.createdBy?.name || '—'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <PendingInvoiceCreateButton onCreate={(due) => void createFromOrder(row.orderId, due)} />
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
                <h2 className="text-lg font-bold text-gray-900 flex flex-wrap items-center gap-x-1">
                  {formatInvoiceNo(detail)}
                  <PanelEditedBadge at={detail.panelEditedAt} />
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Fatura detayı</p>
                {detail.createdAt ? (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Oluşturulma: {formatDate(detail.createdAt)}
                  </p>
                ) : null}
                {detail.createdBy?.name ? (
                  <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                    <User className="w-3 h-3 shrink-0" />
                    Kaydı açan: <span className="font-medium text-gray-700">{detail.createdBy.name}</span>
                  </p>
                ) : null}
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
            {detailBusy ? (
              <p className="px-5 pb-2 text-xs text-gray-400 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-whatsapp" />
                Sunucudan güncelleniyor…
              </p>
            ) : null}

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
                    {detail.contact?.company ? (
                      <p className="text-gray-600 text-xs mt-1">{detail.contact.company}</p>
                    ) : null}
                  </div>
                </div>
                {detail.contact &&
                  (detail.contact.billingAddress ||
                    detail.contact.taxOffice ||
                    detail.contact.taxNumber ||
                    detail.contact.identityNumber ||
                    detail.contact.address) && (
                  <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-xs space-y-1">
                    <p className="font-semibold text-amber-900 uppercase tracking-wide">Fatura / firma</p>
                    {detail.contact.billingAddress && (
                      <p className="text-gray-800 whitespace-pre-wrap">
                        <span className="text-gray-500">Fatura adresi: </span>
                        {detail.contact.billingAddress}
                      </p>
                    )}
                    {!detail.contact.billingAddress && detail.contact.address && (
                      <p className="text-gray-800 whitespace-pre-wrap">
                        <span className="text-gray-500">Adres: </span>
                        {detail.contact.address}
                      </p>
                    )}
                    {detail.contact.taxOffice && (
                      <p className="text-gray-800">
                        <span className="text-gray-500">VD: </span>
                        {detail.contact.taxOffice}
                      </p>
                    )}
                    {detail.contact.taxNumber && (
                      <p className="text-gray-800">
                        <span className="text-gray-500">VKN: </span>
                        {detail.contact.taxNumber}
                      </p>
                    )}
                    {detail.contact.identityNumber && (
                      <p className="text-gray-800">
                        <span className="text-gray-500">TC: </span>
                        {detail.contact.identityNumber}
                      </p>
                    )}
                  </div>
                )}
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
                    <p className="text-xs text-gray-500">Vade (kayıtlı)</p>
                    <p className="font-medium text-gray-900">{formatDate(detail.dueDate)}</p>
                  </div>
                </div>
                {detail.pdfUrl || detail.uploadedPdfUrl ? (
                  <p className="text-xs text-whatsapp pt-1 break-all">
                    PDF:{' '}
                    <a
                      href={`${backendPublicUrl()}${detail.uploadedPdfUrl || detail.pdfUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Aç
                    </a>
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-700">Vade ve notlar</p>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Vade tarihi</label>
                  <input
                    type="date"
                    value={dueEdit}
                    onChange={(e) => setDueEdit(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Notlar</label>
                  <textarea
                    value={notesEdit}
                    onChange={(e) => setNotesEdit(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp resize-y"
                    placeholder="Fatura notu…"
                  />
                </div>
                <button
                  type="button"
                  disabled={detailBusy}
                  onClick={() => void saveInvoiceMeta(detail)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  Kaydet
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {String(detail.status).toUpperCase() === 'PENDING' ? (
                  <button
                    type="button"
                    disabled={detailBusy}
                    onClick={() => void deleteInvoice(detail)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Sil
                  </button>
                ) : null}
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (pdfInputRef.current) pdfInputRef.current.value = '';
                    if (!f) return;
                    if (!f.name.toLowerCase().endsWith('.pdf')) {
                      toast.error('Yalnızca PDF dosyası seçin');
                      return;
                    }
                    setPendingPdfFile(f);
                    setShowPdfUploadConfirm(true);
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
                  onClick={() => setShowSendConfirm(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-whatsapp text-white shadow-sm hover:opacity-95 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  WhatsApp ile Gönder
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

              {/* WhatsApp Gönderim Onay Modalı */}
              {showSendConfirm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
                  <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
                    <div className="text-center">
                      <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Send className="w-7 h-7 text-green-600" />
                      </div>
                      <h2 className="text-lg font-bold text-gray-900">WhatsApp ile Gönder</h2>
                      <p className="text-sm text-gray-600 mt-2">
                        Bu faturayı müşteriye WhatsApp üzerinden göndermek istediğinize emin misiniz?
                      </p>
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowSendConfirm(false)}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                      >
                        Hayır
                      </button>
                      <button
                        type="button"
                        disabled={detailBusy}
                        onClick={() => {
                          setShowSendConfirm(false);
                          sendInvoice(detail);
                        }}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
                      >
                        {detailBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Evet, Gönder
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {showPdfUploadConfirm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
                  <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
                    <div className="text-center">
                      <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Upload className="w-7 h-7 text-amber-700" />
                      </div>
                      <h2 className="text-lg font-bold text-gray-900">PDF yükleme</h2>
                      <p className="text-sm text-gray-600 mt-2">
                        Seçilen PDF bu faturanın belgesi olarak kaydedilecek. Devam etmek istiyor musunuz?
                      </p>
                      {pendingPdfFile ? (
                        <p className="text-xs text-gray-500 mt-2 font-mono break-all">{pendingPdfFile.name}</p>
                      ) : null}
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPdfUploadConfirm(false);
                          setPendingPdfFile(null);
                        }}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                      >
                        Vazgeç
                      </button>
                      <button
                        type="button"
                        disabled={detailBusy}
                        onClick={() => void confirmPdfUpload()}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-whatsapp text-white hover:opacity-95 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
                      >
                        {detailBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Evet, yükle
                      </button>
                    </div>
                  </div>
                </div>
              )}

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

export default function AccountingInvoicesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 text-whatsapp animate-spin" />
        </div>
      }
    >
      <AccountingInvoicesContent />
    </Suspense>
  );
}
