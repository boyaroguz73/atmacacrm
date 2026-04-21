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
    orderNumber?: string | null;
    status?: string | null;
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
    remainingTotal?: number | null;
    isFullyPaid?: boolean | null;
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
    return `${safe.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TRY`;
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

function lineVatAmount(item: OrderItemRow): number {
  const gross = item.lineTotal;
  const divider = 1 + item.vatRate / 100;
  const net = divider > 0 ? gross / divider : gross;
  return Math.round((gross - net) * 100) / 100;
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
    <div className="p-4 sm:p-6 w-full max-w-none space-y-5">
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
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Başlık */}
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50/50">
            <div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2 flex-wrap">
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
              className={`inline-flex items-center text-xs font-semibold px-3 py-1 rounded-full shrink-0 ${statusBadgeClass(invoice.status)}`}
            >
              {statusLabelTr(String(invoice.status))}
            </span>
          </div>

          <div className="px-5 py-4 space-y-5">
            {busy && (
              <p className="text-xs text-gray-400 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-whatsapp" />
                İşlem sürüyor…
              </p>
            )}

            {/* Üst kartlar */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Finansal özet */}
              <div className="rounded-xl border border-gray-100 bg-gradient-to-br from-slate-50 to-white p-4 space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Finansal özet</h3>
                <div className="flex justify-between text-sm pt-1 border-t border-gray-100">
                  <span className="text-gray-700 font-medium">Genel toplam</span>
                  <span className="tabular-nums font-bold text-whatsapp">
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
              <div className="rounded-xl border border-gray-100 bg-white p-4 space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Müşteri</h3>
                {invoice.contact?.company ? (
                  <p className="text-sm font-medium text-gray-900">{invoice.contact.company}</p>
                ) : null}
                <p className="text-sm text-gray-800">{personLabel(invoice)}</p>
                {invoice.contact?.phone ? (
                  <p className="text-xs text-gray-600">{formatPhone(invoice.contact.phone)}</p>
                ) : null}
                {invoice.contact?.email ? (
                  <p className="text-xs text-gray-600">{invoice.contact.email}</p>
                ) : null}
                {invoice.contact?.billingAddress ? (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase">Fatura adresi</p>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap">{invoice.contact.billingAddress}</p>
                  </div>
                ) : null}
                {invoice.contact?.taxOffice || invoice.contact?.taxNumber ? (
                  <p className="text-xs text-gray-600">
                    VD: {invoice.contact.taxOffice || '—'} · VN: {invoice.contact.taxNumber || '—'}
                  </p>
                ) : null}
                {invoice.contact?.identityNumber ? (
                  <p className="text-xs text-gray-600">TC: {invoice.contact.identityNumber}</p>
                ) : null}
              </div>

              {/* Sipariş bilgisi */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-2">
                <h3 className="text-xs font-semibold text-indigo-800 uppercase tracking-wide flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  Bağlı Sipariş
                </h3>
                {invoice.order?.orderNumber || invoice.orderNumber ? (
                  <div className="space-y-1 text-xs text-gray-700">
                    <p>
                      <span className="text-gray-500">Sipariş No: </span>
                      <button
                        type="button"
                        className="font-medium text-indigo-700 hover:underline"
                        onClick={() => {
                          const oid = invoice.order?.id || invoice.orderId;
                          if (oid) router.push(`/orders/${oid}`);
                        }}
                      >
                        {invoice.order?.orderNumber
                          ? `SIP-${String(invoice.order.orderNumber).padStart(5, '0')}`
                          : invoice.orderNumber || '—'}
                        <ExternalLink className="inline w-3 h-3 ml-0.5 align-middle" />
                      </button>
                    </p>
                    {invoice.order?.status ? (
                      <p>
                        <span className="text-gray-500">Sipariş durumu: </span>
                        <span className="font-medium">{invoice.order.status}</span>
                      </p>
                    ) : null}
                    {invoice.order?.expectedDeliveryDate ? (
                      <p>
                        <span className="text-gray-500">Plan. teslim: </span>
                        {formatDate(invoice.order.expectedDeliveryDate)}
                      </p>
                    ) : null}
                    {invoice.order?.grandTotal != null ? (
                      <p>
                        <span className="text-gray-500">Sipariş tutarı: </span>
                        <span className="font-medium">
                          {formatMoney(invoice.order.grandTotal, invoice.order.currency ?? invoice.currency)}
                        </span>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Bu faturaya bağlı sipariş yok.</p>
                )}
              </div>
            </div>

            {/* Vade ve notlar düzenleme */}
            <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-4 space-y-3">
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
                  className="w-full max-w-xs px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notlar</label>
                <textarea
                  value={notesEdit}
                  onChange={(e) => setNotesEdit(e.target.value)}
                  rows={3}
                  placeholder="Fatura notu…"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
                />
              </div>
              <button
                type="button"
                disabled={metaSaving || busy}
                onClick={() => void saveInvoiceMeta()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm disabled:opacity-50"
              >
                {metaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Kaydet
              </button>
            </div>

            {/* PDF bölümü */}
            <div className="rounded-xl border border-gray-100 bg-white p-4 space-y-3">
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
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 bg-white hover:bg-gray-50 shadow-sm disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {uploadProgress !== null ? `Yükleniyor %${uploadProgress}` : 'PDF Yükle'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowSendConfirm(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-whatsapp text-white shadow-sm hover:opacity-95 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  WhatsApp ile Gönder
                </button>
              </div>
            </div>

            {/* Durum değiştirme + ek işlemler */}
            <div className="rounded-xl border border-gray-100 bg-white p-4 space-y-3">
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
                  className="w-full max-w-xs px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp disabled:opacity-50"
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
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Ödendi olarak işaretle
                </button>
                {canDelete && String(invoice.status).toUpperCase() === 'PENDING' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteInvoice()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
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
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Sipariş kalemleri</h3>
                <div className="rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase">
                        <th className="px-3 py-2.5 min-w-[140px]">Ürün</th>
                        <th className="px-3 py-2.5 min-w-[100px]">Renk/Kumaş</th>
                        <th className="px-3 py-2.5 min-w-[100px]">Ölçü</th>
                        <th className="px-3 py-2.5 text-right w-20">Miktar</th>
                        <th className="px-3 py-2.5 text-right min-w-[96px]">Birim fiyat</th>
                        <th className="px-3 py-2.5 text-right min-w-[72px]">KDV</th>
                        <th className="px-3 py-2.5 text-right min-w-[96px]">Satır toplamı</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.order.items.map((item) => {
                        const vatAmt = lineVatAmount(item);
                        return (
                          <tr key={item.id} className="border-t border-gray-50 align-top">
                            <td className="px-3 py-2.5">
                              <p className="font-medium text-gray-900">{item.name}</p>
                              {item.product?.sku ? (
                                <p className="text-xs text-gray-400 font-mono">{item.product.sku}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-600">
                              {item.colorFabricInfo || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-600">
                              {item.measurementInfo || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                              {item.quantity}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                              {formatMoney(item.unitPrice, invoice.order?.currency ?? invoice.currency)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 text-xs">
                              %{item.vatRate}
                              <span className="block text-[10px] text-gray-400">
                                {formatMoney(vatAmt, invoice.order?.currency ?? invoice.currency)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-900">
                              {formatMoney(item.lineTotal, invoice.order?.currency ?? invoice.currency)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-100 bg-gray-50/50">
                        <td colSpan={6} className="px-3 py-2.5 text-right text-sm font-semibold text-gray-700">
                          Genel Toplam
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-whatsapp text-sm">
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
                <div className="rounded-xl border border-gray-100 overflow-hidden">
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
                    <div className="px-4 py-3 bg-gray-50/60 border-t border-gray-100 grid grid-cols-2 gap-3 text-xs">
                      {invoice.order.paidTotal != null ? (
                        <div>
                          <p className="text-gray-500">Ödenen</p>
                          <p className="font-bold text-emerald-700 tabular-nums">
                            {formatMoney(invoice.order.paidTotal, invoice.order.currency ?? invoice.currency)}
                          </p>
                        </div>
                      ) : null}
                      {invoice.order.remainingTotal != null ? (
                        <div>
                          <p className="text-gray-500">Kalan</p>
                          <p className={`font-bold tabular-nums ${invoice.order.remainingTotal > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
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
