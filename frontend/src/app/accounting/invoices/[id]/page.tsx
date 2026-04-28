'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { backendPublicUrl, formatPhone } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import {
  ArrowLeft,
  Banknote,
  Calendar,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  MapPin,
  Package,
  Receipt,
  ReceiptText,
  Send,
  Trash2,
  Upload,
  User,
  Wallet,
} from 'lucide-react';
import PanelEditedBadge from '@/components/ui/PanelEditedBadge';

type InvoiceStatus = 'PENDING' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED' | string;

interface InvoiceDetail {
  id: string;
  invoiceNumber?: number | string | null;
  invoiceNo?: string | null;
  contact?: {
    id?: string;
    name?: string | null;
    surname?: string | null;
    phone?: string | null;
    email?: string | null;
    company?: string | null;
    address?: string | null;
    billingAddress?: string | null;
    shippingAddress?: string | null;
    taxOffice?: string | null;
    taxNumber?: string | null;
    identityNumber?: string | null;
  };
  contactName?: string | null;
  personName?: string | null;
  order?: {
    id?: string;
    orderNumber?: string | number | null;
    status?: string | null;
    source?: string | null;
    currency?: string | null;
    subtotal?: number | null;
    vatTotal?: number | null;
    grandTotal?: number | null;
    notes?: string | null;
    shippingAddress?: string | null;
    expectedDeliveryDate?: string | null;
    createdAt?: string | null;
    items?: OrderItemRow[];
    payments?: PaymentEntry[];
    paidTotal?: number | null;
    refundedTotal?: number | null;
    remainingTotal?: number | null;
    isFullyPaid?: boolean | null;
    contact?: {
      id?: string;
      name?: string | null;
      surname?: string | null;
      phone?: string | null;
      email?: string | null;
      company?: string | null;
      address?: string | null;
      billingAddress?: string | null;
      shippingAddress?: string | null;
      taxOffice?: string | null;
      taxNumber?: string | null;
      identityNumber?: string | null;
    };
    createdBy?: { id?: string; name?: string | null } | null;
  };
  orderId?: string | null;
  orderNumber?: string | null;
  status: InvoiceStatus;
  currency?: string | null;
  grandTotal?: number | string | null;
  total?: number | string | null;
  amount?: number | string | null;
  dueDate?: string | null;
  pdfUrl?: string | null;
  uploadedPdfUrl?: string | null;
  createdAt?: string | null;
  notes?: string | null;
  createdBy?: { id?: string; name?: string | null } | null;
  panelEditedAt?: string | null;
}

interface OrderItemRow {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  priceIncludesVat?: boolean;
  lineTotal: number;
  colorFabricInfo?: string | null;
  measurementInfo?: string | null;
  product?: { id: string; sku: string; name: string; imageUrl?: string | null } | null;
  productVariant?: { id: string; name: string; sku?: string | null } | null;
}

type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD' | 'CHECK' | 'OTHER';
type PaymentDirection = 'INCOME' | 'EXPENSE';

interface PaymentEntry {
  id: string;
  amount: number;
  direction: PaymentDirection;
  method: PaymentMethod;
  description: string;
  reference: string | null;
  occurredAt: string;
  user: { id: string; name: string | null } | null;
}

const STATUS_PATCH_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: 'PENDING', label: 'Beklemede' },
  { value: 'SENT', label: 'Gönderildi' },
  { value: 'PAID', label: 'Ödendi' },
  { value: 'OVERDUE', label: 'Vadesi Geçmiş' },
  { value: 'CANCELLED', label: 'İptal' },
];

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Nakit',
  TRANSFER: 'Havale / EFT',
  CARD: 'Kredi Kartı / POS',
  CHECK: 'Çek / Senet',
  OTHER: 'Diğer',
};

function paymentMethodIcon(method: PaymentMethod) {
  switch (method) {
    case 'CASH':
      return <Banknote className="w-3.5 h-3.5" />;
    case 'TRANSFER':
      return <Landmark className="w-3.5 h-3.5" />;
    case 'CARD':
      return <CreditCard className="w-3.5 h-3.5" />;
    case 'CHECK':
      return <ReceiptText className="w-3.5 h-3.5" />;
    default:
      return <Wallet className="w-3.5 h-3.5" />;
  }
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  const n = typeof amount === 'string' ? parseFloat(String(amount).replace(',', '.')) : Number(amount ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const code = currency && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : 'TRY';
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code }).format(safe);
  } catch {
    return `${safe.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`;
  }
}

function formatInvoiceNo(inv: InvoiceDetail): string {
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

function personLabel(inv: InvoiceDetail): string {
  const c = inv.contact;
  const full = [c?.name, c?.surname].filter(Boolean).join(' ').trim();
  return full || c?.name || inv.contactName || inv.personName || '—';
}

function statusBadgeClass(status: string): string {
  const s = (status || '').toUpperCase();
  switch (s) {
    case 'PENDING':
      return 'bg-amber-100 text-amber-900 border border-amber-300';
    case 'SENT':
      return 'bg-blue-100 text-blue-900 border border-blue-300';
    case 'PAID':
      return 'bg-emerald-100 text-emerald-900 border border-emerald-300';
    case 'OVERDUE':
      return 'bg-red-100 text-red-900 border border-red-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border border-red-300';
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

const ORDER_STATUS_LABELS: Record<string, string> = {
  AWAITING_CHECKOUT: 'Sepette Bekliyor',
  AWAITING_PAYMENT: 'Ödeme Bekleniyor',
  PREPARING: 'Hazırlanıyor',
  READY_TO_SHIP: 'Gönderime Hazır',
  SHIPPED: 'Kargoya Verildi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal',
};

function orderStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return ORDER_STATUS_LABELS[status.toUpperCase()] || status;
}

function lineVatAmount(item: OrderItemRow): number {
  const gross = item.lineTotal;
  const divider = 1 + item.vatRate / 100;
  const net = divider > 0 ? gross / divider : gross;
  return Math.round((gross - net) * 100) / 100;
}

function rewriteMediaUrlForClient(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${typeof window !== 'undefined' ? '' : ''}${backendPublicUrl()}${url}`;
}

function normalizeInvoice(raw: unknown): InvoiceDetail | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '');
  if (!id) return null;
  return {
    id,
    invoiceNumber: o.invoiceNumber as InvoiceDetail['invoiceNumber'],
    invoiceNo: o.invoiceNo != null ? String(o.invoiceNo) : null,
    contact:
      o.contact && typeof o.contact === 'object'
        ? (o.contact as InvoiceDetail['contact'])
        : undefined,
    contactName: o.contactName != null ? String(o.contactName) : null,
    personName: o.personName != null ? String(o.personName) : null,
    order:
      o.order && typeof o.order === 'object'
        ? (o.order as InvoiceDetail['order'])
        : undefined,
    orderId: o.orderId != null ? String(o.orderId) : null,
    orderNumber: o.orderNumber != null ? String(o.orderNumber) : null,
    status: String(o.status ?? 'PENDING'),
    currency: o.currency != null ? String(o.currency) : null,
    grandTotal: o.grandTotal as InvoiceDetail['grandTotal'],
    total: (o.grandTotal ?? o.total ?? o.amount ?? o.subtotal) as InvoiceDetail['total'],
    amount: o.amount as InvoiceDetail['amount'],
    dueDate: o.dueDate != null && o.dueDate !== '' ? String(o.dueDate) : null,
    pdfUrl: o.pdfUrl != null ? String(o.pdfUrl) : null,
    uploadedPdfUrl: o.uploadedPdfUrl != null ? String(o.uploadedPdfUrl) : null,
    createdAt: o.createdAt != null ? String(o.createdAt) : null,
    notes: o.notes != null ? String(o.notes) : null,
    createdBy:
      o.createdBy && typeof o.createdBy === 'object'
        ? (o.createdBy as InvoiceDetail['createdBy'])
        : undefined,
    panelEditedAt:
      o.panelEditedAt != null && o.panelEditedAt !== '' ? String(o.panelEditedAt) : null,
  };
}

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const invoiceId = String(params?.id || '');
  const { user, loadFromStorage } = useAuthStore();

  const canDelete =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [dueEdit, setDueEdit] = useState('');
  const [notesEdit, setNotesEdit] = useState('');
  const [metaSaving, setMetaSaving] = useState(false);

  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showPdfUploadConfirm, setShowPdfUploadConfirm] = useState(false);
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const fetchInvoice = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/accounting/invoices/${invoiceId}`);
      const n = normalizeInvoice(data);
      if (n) {
        setInvoice(n);
      } else {
        toast.error('Fatura bulunamadı');
        router.push('/accounting/invoices');
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Fatura detayı alınamadı'));
      router.push('/accounting/invoices');
    } finally {
      setLoading(false);
    }
  }, [invoiceId, router]);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    void fetchInvoice();
  }, [fetchInvoice]);

  useEffect(() => {
    if (!invoice) return;
    setDueEdit(toDateInputValue(invoice.dueDate));
    setNotesEdit(invoice.notes != null ? String(invoice.notes) : '');
  }, [invoice?.id, invoice?.dueDate, invoice?.notes]);

  const patchStatus = async (status: InvoiceStatus) => {
    if (!invoice) return;
    setBusy(true);
    try {
      const { data } = await api.patch(`/accounting/invoices/${invoice.id}/status`, { status });
      const updated = normalizeInvoice({ ...invoice, ...(data && typeof data === 'object' ? data : {}), status });
      if (updated) setInvoice(updated);
      toast.success('Durum güncellendi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Durum güncellenemedi'));
    } finally {
      setBusy(false);
    }
  };

  const saveInvoiceMeta = async () => {
    if (!invoice) return;
    setMetaSaving(true);
    try {
      const { data } = await api.patch(`/accounting/invoices/${invoice.id}`, {
        dueDate: dueEdit ? new Date(dueEdit).toISOString() : null,
        notes: notesEdit.trim() === '' ? null : notesEdit,
      });
      const updated = normalizeInvoice({
        ...invoice,
        ...(data && typeof data === 'object' ? data : {}),
      });
      if (updated) setInvoice(updated);
      toast.success('Vade ve notlar kaydedildi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setMetaSaving(false);
    }
  };

  const uploadPdf = async (file: File) => {
    if (!invoice) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Yalnızca PDF dosyası seçin');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('PDF dosyası en fazla 10 MB olabilir');
      return;
    }
    setBusy(true);
    setUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/accounting/invoices/${invoice.id}/upload-pdf`, fd, {
        timeout: 120_000,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded * 100) / e.total));
        },
      });
      const updated = normalizeInvoice({
        ...invoice,
        ...(data && typeof data === 'object' ? data : {}),
      });
      if (updated) setInvoice(updated);
      toast.success('PDF yüklendi');
    } catch (err: unknown) {
      const e = err as { code?: string; response?: { status?: number } };
      if (e?.code === 'ECONNABORTED' || e?.code === 'ERR_NETWORK') {
        toast.error('Sunucuya bağlanılamadı veya zaman aşımı.');
      } else if (e?.response?.status === 413) {
        toast.error('PDF çok büyük — sunucu reddetti');
      } else {
        toast.error(getApiErrorMessage(err, 'PDF yüklenemedi'));
      }
    } finally {
      setBusy(false);
      setUploadProgress(null);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const confirmPdfUpload = async () => {
    if (!pendingPdfFile) {
      setShowPdfUploadConfirm(false);
      setPendingPdfFile(null);
      return;
    }
    const file = pendingPdfFile;
    setShowPdfUploadConfirm(false);
    setPendingPdfFile(null);
    await uploadPdf(file);
  };

  const sendInvoice = async () => {
    if (!invoice) return;
    setBusy(true);
    try {
      await api.post(`/accounting/invoices/${invoice.id}/send`, {});
      toast.success('Fatura gönderildi');
      const updated = normalizeInvoice({ ...invoice, status: 'SENT' });
      if (updated) setInvoice(updated);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Gönderim başarısız'));
    } finally {
      setBusy(false);
    }
  };

  const deleteInvoice = async () => {
    if (!invoice) return;
    if (String(invoice.status).toUpperCase() !== 'PENDING') {
      toast.error('Sadece beklemedeki faturalar silinebilir');
      return;
    }
    if (!confirm(`${formatInvoiceNo(invoice)} silinsin mi?`)) return;
    setBusy(true);
    try {
      await api.delete(`/accounting/invoices/${invoice.id}`);
      toast.success('Fatura silindi');
      router.push('/accounting/invoices');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    } finally {
      setBusy(false);
    }
  };

  const pdfViewUrl = invoice?.uploadedPdfUrl || invoice?.pdfUrl;

  return (
    <div className="p-4 sm:p-6 w-full max-w-none space-y-6">
      <button
        type="button"
        onClick={() => router.push('/accounting/invoices')}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
      >
        <ArrowLeft className="w-4 h-4" />
        Faturalara dön
      </button>

      {loading || !invoice ? (
        <div className="rounded-xl border border-gray-100 bg-white py-16 flex items-center justify-center text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2 text-whatsapp" />
          Detay yükleniyor...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Başlık */}
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 bg-gray-50/70">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2 flex-wrap">
                <Receipt className="w-5 h-5 text-whatsapp" />
                {formatInvoiceNo(invoice)}
                <PanelEditedBadge at={invoice.panelEditedAt} />
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {personLabel(invoice)}
                {invoice.contact?.phone ? ` · ${formatPhone(invoice.contact.phone)}` : ''}
              </p>
              {invoice.createdBy?.name ? (
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 shrink-0" />
                  Oluşturan: <span className="font-medium text-gray-600">{invoice.createdBy.name}</span>
                </p>
              ) : null}
            </div>
            <span
              className={`inline-flex items-center text-xs font-semibold px-3.5 py-1.5 rounded-full shrink-0 ${statusBadgeClass(invoice.status)}`}
            >
              {statusLabelTr(String(invoice.status))}
            </span>
          </div>

          <div className="px-5 py-5 space-y-6">
            {busy && (
              <p className="text-xs text-gray-400 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-whatsapp" />
                İşlem sürüyor…
              </p>
            )}

            {/* Üst kartlar */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Finansal özet */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Finansal özet</h3>
                <div className="flex justify-between text-sm pt-1 border-t border-gray-100">
                  <span className="text-gray-700 font-medium">Genel toplam</span>
                  <span className="tabular-nums text-lg font-extrabold text-whatsapp">
                    {formatMoney(invoice.grandTotal ?? invoice.total ?? invoice.amount, invoice.currency)}
                  </span>
                </div>
                {invoice.dueDate ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Vade tarihi</span>
                    <span className="font-medium text-gray-800">{formatDate(invoice.dueDate)}</span>
                  </div>
                ) : null}
                <p className="text-[10px] text-gray-400">
                  Oluşturulma: {formatDateTime(invoice.createdAt)}
                </p>
              </div>

              {/* Müşteri */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Müşteri</h3>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-gray-500">Firma</dt>
                  <dd className="text-gray-900 font-medium">{invoice.contact?.company || '—'}</dd>
                  <dt className="text-gray-500">Kişi</dt>
                  <dd className="text-gray-900 font-medium">{personLabel(invoice)}</dd>
                  <dt className="text-gray-500">Telefon</dt>
                  <dd className="text-gray-700">{invoice.contact?.phone ? formatPhone(invoice.contact.phone) : '—'}</dd>
                  <dt className="text-gray-500">E-posta</dt>
                  <dd className="text-gray-700 break-all">{invoice.contact?.email || '—'}</dd>
                  <dt className="text-gray-500">VD / VN</dt>
                  <dd className="text-gray-700">
                    {invoice.contact?.taxOffice || '—'} / {invoice.contact?.taxNumber || '—'}
                  </dd>
                  <dt className="text-gray-500">TC</dt>
                  <dd className="text-gray-700">{invoice.contact?.identityNumber || '—'}</dd>
                </dl>
                {invoice.contact?.billingAddress ? (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase">Fatura adresi</p>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap">{invoice.contact.billingAddress}</p>
                  </div>
                ) : null}
              </div>

              {/* Sipariş bilgisi */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
                <h3 className="text-xs font-semibold text-indigo-800 uppercase tracking-wide flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  Bağlı Sipariş
                </h3>
                {invoice.order?.orderNumber || invoice.orderNumber ? (
                  <div className="space-y-1.5 text-xs text-gray-700">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1"
                        onClick={() => {
                          const oid = invoice.order?.id || invoice.orderId;
                          if (oid) router.push(`/orders/${oid}`);
                        }}
                      >
                        {invoice.order?.orderNumber
                          ? `SIP-${String(invoice.order.orderNumber).padStart(5, '0')}`
                          : invoice.orderNumber || '—'}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                      {invoice.order?.status ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                          {orderStatusLabel(invoice.order.status)}
                        </span>
                      ) : null}
                    </div>
                    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[11px]">
                      {invoice.order?.createdAt ? (
                        <>
                          <dt className="text-gray-400">Sipariş tarihi</dt>
                          <dd>{formatDate(invoice.order.createdAt)}</dd>
                        </>
                      ) : null}
                      {invoice.order?.expectedDeliveryDate ? (
                        <>
                          <dt className="text-gray-400">Plan. teslim</dt>
                          <dd>{formatDate(invoice.order.expectedDeliveryDate)}</dd>
                        </>
                      ) : null}
                      {invoice.order?.grandTotal != null ? (
                        <>
                          <dt className="text-gray-400">Sipariş tutarı</dt>
                          <dd className="font-semibold">{formatMoney(invoice.order.grandTotal, invoice.order.currency ?? invoice.currency)}</dd>
                        </>
                      ) : null}
                      {invoice.order?.paidTotal != null ? (
                        <>
                          <dt className="text-gray-400">Ödenen</dt>
                          <dd className="text-emerald-700 text-sm font-semibold">{formatMoney(invoice.order.paidTotal, invoice.order.currency ?? invoice.currency)}</dd>
                        </>
                      ) : null}
                      {invoice.order?.remainingTotal != null && invoice.order.remainingTotal > 0 ? (
                        <>
                          <dt className="text-gray-400">Kalan</dt>
                          <dd className="text-red-700 text-sm font-semibold">{formatMoney(invoice.order.remainingTotal, invoice.order.currency ?? invoice.currency)}</dd>
                        </>
                      ) : null}
                      {invoice.order?.createdBy?.name ? (
                        <>
                          <dt className="text-gray-400">Oluşturan</dt>
                          <dd>{invoice.order.createdBy.name}</dd>
                        </>
                      ) : null}
                    </dl>
                    {invoice.order?.isFullyPaid ? (
                      <p className="text-[10px] font-semibold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Sipariş ödemesi tamamlandı
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Bu faturaya bağlı sipariş yok.</p>
                )}
              </div>
            </div>

            {/* Sipariş adresleri */}
            {(invoice.order?.shippingAddress || invoice.order?.contact?.billingAddress || invoice.order?.contact?.shippingAddress) ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Adresler
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {invoice.order?.contact?.billingAddress ? (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Fatura adresi</p>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{invoice.order.contact.billingAddress}</p>
                    </div>
                  ) : null}
                  {(invoice.order?.shippingAddress || invoice.order?.contact?.shippingAddress) ? (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Sevk adresi</p>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {invoice.order?.shippingAddress || invoice.order?.contact?.shippingAddress}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Vade ve notlar düzenleme */}
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <Calendar className="w-4 h-4 text-whatsapp" />
                Vade ve notlar
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Vade tarihi</label>
                <input
                  type="date"
                  value={dueEdit}
                  onChange={(e) => setDueEdit(e.target.value)}
                  className="w-full max-w-sm px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notlar</label>
                <textarea
                  value={notesEdit}
                  onChange={(e) => setNotesEdit(e.target.value)}
                  rows={3}
                  placeholder="Örn: vade mutabakatı, teslimat notu, özel açıklama"
                  className="w-full max-w-2xl px-3 py-2.5 rounded-lg border border-gray-200 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                />
              </div>
              <button
                type="button"
                disabled={metaSaving || busy}
                onClick={() => void saveInvoiceMeta()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold disabled:opacity-50"
              >
                {metaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Kaydet
              </button>
            </div>

            {/* PDF bölümü */}
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-whatsapp" />
                Fatura PDF
              </h3>
              {pdfViewUrl ? (
                <a
                  href={`${backendPublicUrl()}${pdfViewUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-whatsapp hover:underline"
                >
                  <ExternalLink className="w-4 h-4" />
                  PDF&apos;yi görüntüle
                </a>
              ) : (
                <p className="text-xs text-amber-700">Henüz PDF yüklenmemiş.</p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
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
                  disabled={busy}
                  onClick={() => pdfInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {uploadProgress !== null ? `Yükleniyor %${uploadProgress}` : 'PDF Yükle'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowSendConfirm(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-whatsapp text-white hover:opacity-95 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  WhatsApp ile Gönder
                </button>
              </div>
            </div>

            {/* Durum değiştirme + ek işlemler */}
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">İşlemler</h3>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Durum değiştir</label>
                <select
                  value={String(invoice.status).toUpperCase()}
                  disabled={busy}
                  onChange={(e) => {
                    const v = e.target.value as InvoiceStatus;
                    if (v !== String(invoice.status).toUpperCase()) void patchStatus(v);
                  }}
                  className="w-full max-w-sm px-3 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp disabled:opacity-50"
                >
                  {STATUS_PATCH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy || String(invoice.status).toUpperCase() === 'PAID'}
                  onClick={() => void patchStatus('PAID')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Ödendi olarak işaretle
                </button>
                {canDelete && String(invoice.status).toUpperCase() === 'PENDING' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteInvoice()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Sil
                  </button>
                ) : null}
              </div>
            </div>

            {/* Sipariş kalemleri */}
            {invoice.order?.items && invoice.order.items.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <Package className="w-4 h-4 text-indigo-600" />
                  Sipariş kalemleri
                  <span className="text-[10px] text-gray-400 font-normal">({invoice.order.items.length} kalem)</span>
                </h3>
                <div className="rounded-lg border border-gray-200 overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead>
                      <tr className="bg-gray-50 text-left text-[10px] font-semibold text-gray-500 uppercase">
                        <th className="px-3 py-3 w-12">Görsel</th>
                        <th className="px-3 py-3 min-w-[140px]">Ürün</th>
                        <th className="px-3 py-3 min-w-[90px]">Renk/Kumaş</th>
                        <th className="px-3 py-3 min-w-[90px]">Ölçü</th>
                        <th className="px-3 py-3 text-right w-16">Miktar</th>
                        <th className="px-3 py-3 text-right min-w-[80px]">Birim</th>
                        <th className="px-3 py-3 text-center min-w-[60px]">Fiyat tipi</th>
                        <th className="px-3 py-3 text-right min-w-[60px]">KDV</th>
                        <th className="px-3 py-3 text-right min-w-[80px]">Toplam</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.order.items.map((item) => {
                        const vatAmt = lineVatAmount(item);
                        const cur = invoice.order?.currency ?? invoice.currency;
                        return (
                          <tr key={item.id} className="border-t border-gray-100 odd:bg-white even:bg-gray-50/30 align-top hover:bg-gray-50 transition-colors">
                            <td className="px-3 py-2.5 align-middle">
                              <div className="w-9 h-9 rounded border border-gray-100 bg-gray-50 overflow-hidden">
                                {item.product?.imageUrl ? (
                                  <img src={rewriteMediaUrlForClient(item.product.imageUrl)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="flex w-full h-full items-center justify-center text-[10px] text-gray-300">—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
                              {item.productVariant ? (
                                <p className="text-[10px] text-indigo-600">
                                  Varyant: {item.productVariant.name}
                                  {item.productVariant.sku ? ` · ${item.productVariant.sku}` : ''}
                                </p>
                              ) : null}
                              {item.product?.sku ? (
                                <p className="text-[10px] text-gray-400 font-mono">{item.product.sku}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-600">
                              {item.colorFabricInfo || '—'}
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-600 whitespace-pre-wrap max-w-[180px]">
                              {item.measurementInfo || '—'}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-800 text-xs">
                              {item.quantity}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-800 text-xs">
                              {formatMoney(item.unitPrice, cur)}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                                item.priceIncludesVat !== false
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-blue-50 text-blue-700'
                              }`}>
                                {item.priceIncludesVat !== false ? 'KDV dahil' : 'KDV hariç'}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right text-xs">
                              <span className="tabular-nums text-gray-700">%{item.vatRate}</span>
                              <span className="block text-[10px] text-gray-400 tabular-nums">
                                {formatMoney(vatAmt, cur)}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-base font-semibold text-gray-900">
                              {formatMoney(item.lineTotal, cur)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 bg-gray-50/60 text-xs">
                        <td colSpan={4} />
                        <td colSpan={4} className="px-3 py-2.5 text-right text-gray-500">Ara toplam</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-700">
                          {formatMoney(invoice.order.subtotal ?? 0, invoice.order.currency ?? invoice.currency)}
                        </td>
                      </tr>
                      <tr className="border-t border-gray-100 bg-gray-50/60 text-xs">
                        <td colSpan={4} />
                        <td colSpan={4} className="px-3 py-2.5 text-right text-gray-500">KDV toplam</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-700">
                          {formatMoney(invoice.order.vatTotal ?? 0, invoice.order.currency ?? invoice.currency)}
                        </td>
                      </tr>
                      <tr className="border-t-2 border-gray-200 bg-gray-50/80">
                        <td colSpan={4} />
                        <td colSpan={4} className="px-3 py-3 text-right text-sm font-semibold text-gray-700">
                          Genel Toplam
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-bold text-whatsapp text-base">
                          {formatMoney(
                            invoice.order.grandTotal ?? invoice.grandTotal ?? invoice.total,
                            invoice.order.currency ?? invoice.currency,
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : null}

            {/* Ödeme geçmişi (sipariş ödemeleri) */}
            {invoice.order?.payments && invoice.order.payments.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Tahsilat geçmişi</h3>
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  {invoice.order.payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-gray-100 text-gray-600">
                          {paymentMethodIcon(p.method)}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-800">
                            {PAYMENT_METHOD_LABELS[p.method] || p.method}
                          </p>
                          {p.description ? (
                            <p className="text-[10px] text-gray-500">{p.description}</p>
                          ) : null}
                          {p.reference ? (
                            <p className="text-[10px] text-gray-400 font-mono">{p.reference}</p>
                          ) : null}
                          <p className="text-[10px] text-gray-400">
                            {formatDateTime(p.occurredAt)}
                            {p.user?.name ? ` · ${p.user.name}` : ''}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          p.direction === 'INCOME' ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {p.direction === 'INCOME' ? '+' : '−'}
                        {formatMoney(p.amount, invoice.order?.currency ?? invoice.currency)}
                      </span>
                    </div>
                  ))}

                  {(invoice.order.paidTotal != null || invoice.order.remainingTotal != null) && (
                    <div className="px-4 py-3 bg-gray-50/70 border-t border-gray-200 grid grid-cols-2 gap-3 text-xs">
                      {invoice.order.paidTotal != null ? (
                        <div>
                          <p className="text-gray-500">Ödenen</p>
                          <p className="text-base font-bold text-emerald-700 tabular-nums">
                            {formatMoney(invoice.order.paidTotal, invoice.order.currency ?? invoice.currency)}
                          </p>
                        </div>
                      ) : null}
                      {invoice.order.remainingTotal != null ? (
                        <div>
                          <p className="text-gray-500">Kalan</p>
                          <p className={`text-base font-bold tabular-nums ${invoice.order.remainingTotal > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                            {formatMoney(invoice.order.remainingTotal, invoice.order.currency ?? invoice.currency)}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* WhatsApp Gönderim Onay Modalı */}
      {showSendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[1px]">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Send className="w-7 h-7 text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">WhatsApp ile Gönder</h2>
              <p className="text-sm text-gray-600 mt-2">
                Bu faturayı müşteriye WhatsApp üzerinden göndermek istediğinize emin misiniz?
              </p>
              {invoice && (
                <p className="text-xs text-gray-500 mt-2 font-medium">{formatInvoiceNo(invoice)}</p>
              )}
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
                disabled={busy}
                onClick={() => {
                  setShowSendConfirm(false);
                  void sendInvoice();
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Evet, Gönder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Yükleme Onay Modalı */}
      {showPdfUploadConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[1px]">
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
                disabled={busy}
                onClick={() => void confirmPdfUpload()}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-whatsapp text-white hover:opacity-95 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Evet, yükle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
