'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { backendPublicUrl, formatPhone, rewriteMediaUrlForClient } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import {
  ArrowLeft,
  Banknote,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  MessageSquare,
  Package,
  Plus,
  Receipt,
  ReceiptText,
  Save,
  Send,
  Store,
  Trash2,
  Truck,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { QuoteEmbeddedChat } from '@/components/quotes/QuoteEmbeddedChat';
import PanelEditedBadge from '@/components/ui/PanelEditedBadge';
import SiteOrderDetailsPanel from '@/components/orders/SiteOrderDetailsPanel';

type OrderStatus = 'AWAITING_CHECKOUT' | 'AWAITING_PAYMENT' | 'PREPARING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';

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
  productVariant?: {
    id: string;
    sku?: string | null;
    name: string;
    tsoftId?: string | null;
    externalId?: string | null;
  } | null;
  supplierId?: string | null;
  supplierOrderNo?: string | null;
  isFromStock?: boolean;
  supplier?: { id: string; name: string } | null;
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

interface CargoCompanyOption {
  id: string;
  name: string;
  isAmbar: boolean;
  isActive: boolean;
}

interface SalesOrder {
  id: string;
  orderNumber: number;
  externalId?: string | null;
  source?: string;
  status: OrderStatus;
  currency: string;
  subtotal?: number;
  vatTotal?: number;
  grandTotal: number;
  shippingAddress: string | null;
  notes: string | null;
  expectedDeliveryDate?: string | null;
  createdAt: string;
  panelEditedAt?: string | null;
  tsoftSiteOrderId?: string | null;
  pushToTsoft?: boolean;
  tsoftPushedAt?: string | null;
  tsoftLastError?: string | null;
  siteOrderData?: Record<string, unknown> | null;
  cargoCompanyId?: string | null;
  cargoTrackingNo?: string | null;
  cargoNotificationSentAt?: string | null;
  cargoCompany?: { id: string; name: string; isAmbar: boolean } | null;
  invoice?: { id: string } | null;
  createdBy?: { id: string; name: string | null } | null;
  contact: {
    name: string | null;
    surname: string | null;
    phone: string;
    email?: string | null;
    company?: string | null;
    address?: string | null;
    billingAddress?: string | null;
    shippingAddress?: string | null;
    taxOffice?: string | null;
    taxNumber?: string | null;
  };
  quote: { id: string; quoteNumber: number } | null;
  items: OrderItemRow[];
  confirmationPdfUrl?: string | null;
  payments?: PaymentEntry[];
  paidTotal?: number;
  refundedTotal?: number;
  remainingTotal?: number;
  isFullyPaid?: boolean;
}

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

function toDateTimeInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

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

function formatQuoteNo(n: number) {
  return `TKL-${String(n).padStart(5, '0')}`;
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function formatMoney(amount: number, currency: string) {
  const code = currency && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : 'TRY';
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: code }).format(amount);
  } catch {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount);
  }
}

function contactDisplayName(o: SalesOrder['contact']) {
  const full = [o.name, o.surname].filter(Boolean).join(' ').trim();
  if (full) return full;
  return formatPhone(o.phone);
}

type LineEditDraft = {
  name: string;
  colorFabricInfo: string;
  measurementInfo: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  priceIncludesVat: boolean;
};

function lineVatAmount(item: OrderItemRow) {
  const gross = item.lineTotal;
  const divider = 1 + (item.vatRate / 100);
  const net = divider > 0 ? gross / divider : gross;
  return Math.round((gross - net) * 100) / 100;
}

function draftLineGross(d: LineEditDraft): number {
  const r = Math.max(0, d.vatRate) / 100;
  return d.priceIncludesVat
    ? d.quantity * d.unitPrice
    : d.quantity * d.unitPrice * (1 + r);
}

function draftLineVatAmount(d: LineEditDraft) {
  const gross = draftLineGross(d);
  const divider = 1 + (d.vatRate / 100);
  const net = divider > 0 ? gross / divider : gross;
  return Math.round((gross - net) * 100) / 100;
}

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = String(params?.id || '');
  const { user, loadFromStorage } = useAuthStore();

  const canRegenerateOrderPdf =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';
  const canDeleteOrder =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';
  const canDeletePayment =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';

  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusSaving, setStatusSaving] = useState(false);
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [pdfRegenLoading, setPdfRegenLoading] = useState(false);

  const [expectedDeliveryDraft, setExpectedDeliveryDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [shippingDraft, setShippingDraft] = useState('');
  const [invoiceDueDraft, setInvoiceDueDraft] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [cargoCompanies, setCargoCompanies] = useState<CargoCompanyOption[]>([]);
  const [cargoCompanyDraft, setCargoCompanyDraft] = useState('');
  const [cargoTrackingDraft, setCargoTrackingDraft] = useState('');
  const [cargoSaving, setCargoSaving] = useState(false);
  const [cargoNotifSending, setCargoNotifSending] = useState(false);
  const [itemSavingId, setItemSavingId] = useState<string | null>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineEditDraft>>({});

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentDeletingId, setPaymentDeletingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<string>('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('TRANSFER');
  const [payDirection, setPayDirection] = useState<PaymentDirection>('INCOME');
  const [payReference, setPayReference] = useState('');
  const [payDescription, setPayDescription] = useState('');
  const [payOccurredAt, setPayOccurredAt] = useState('');
  const [chatOpen, setChatOpen] = useState(true);

  const fetchOrder = async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const { data } = await api.get<SalesOrder>(`/orders/${orderId}`);
      setOrder(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Sipariş detayı alınamadı'));
      router.push('/orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    api
      .get('/suppliers', { params: { isActive: true, limit: 200 } })
      .then(({ data }) => setSuppliers(data.suppliers || []))
      .catch(() => setSuppliers([]));
    api
      .get('/cargo-companies', { params: { isActive: true, limit: 200 } })
      .then(({ data }) => setCargoCompanies(data.cargoCompanies || []))
      .catch(() => setCargoCompanies([]));
  }, []);

  useEffect(() => {
    void fetchOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    if (!order || loading) return;
    setExpectedDeliveryDraft(toDateInputValue(order.expectedDeliveryDate ?? null));
    setNotesDraft(order.notes ?? '');
    setShippingDraft(order.shippingAddress ?? '');
    setInvoiceDueDraft('');
    setCargoCompanyDraft(order.cargoCompanyId ?? '');
    setCargoTrackingDraft(order.cargoTrackingNo ?? '');
  }, [order?.id, order?.expectedDeliveryDate, order?.notes, order?.shippingAddress, order?.cargoCompanyId, order?.cargoTrackingNo, loading]);

  useEffect(() => {
    if (!order?.items?.length) {
      setLineDrafts({});
      return;
    }
    setLineDrafts(
      Object.fromEntries(
        order.items.map((it) => [
          it.id,
          {
            name: it.name,
            colorFabricInfo: it.colorFabricInfo ?? '',
            measurementInfo: it.measurementInfo ?? '',
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            vatRate: it.vatRate,
            priceIncludesVat: it.priceIncludesVat !== false,
          },
        ]),
      ),
    );
  }, [order?.id, order?.items]);

  const patchStatus = async (status: OrderStatus) => {
    if (!order) return;
    setStatusSaving(true);
    try {
      const { data } = await api.patch<SalesOrder>(`/orders/${order.id}/status`, { status });
      setOrder(data);
      toast.success('Durum güncellendi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Durum güncellenemedi'));
    } finally {
      setStatusSaving(false);
    }
  };

  const saveOrderMeta = async () => {
    if (!order) return;
    setMetaSaving(true);
    try {
      const { data } = await api.patch<SalesOrder>(`/orders/${order.id}`, {
        expectedDeliveryDate: expectedDeliveryDraft ? new Date(expectedDeliveryDraft).toISOString() : null,
        notes: notesDraft.trim() === '' ? null : notesDraft,
        shippingAddress: shippingDraft.trim() === '' ? null : shippingDraft,
      });
      setOrder(data);
      toast.success('Sipariş bilgileri kaydedildi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setMetaSaving(false);
    }
  };

  const createInvoiceFromOrder = async () => {
    if (!order) return;
    setInvoiceSaving(true);
    try {
      await api.post('/accounting/invoices/from-order', {
        orderId: order.id,
        ...(invoiceDueDraft ? { dueDate: new Date(invoiceDueDraft).toISOString() } : {}),
      });
      toast.success('Fatura oluşturuldu');
      router.push('/orders');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Fatura oluşturulamadı'));
    } finally {
      setInvoiceSaving(false);
    }
  };

  const regenerateOrderPdf = async () => {
    if (!order) return;
    setPdfRegenLoading(true);
    try {
      const { data } = await api.post<SalesOrder>(`/orders/${order.id}/regenerate-confirmation-pdf`);
      setOrder(data);
      toast.success('Sipariş onay PDF’i güncellendi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'PDF oluşturulamadı'));
    } finally {
      setPdfRegenLoading(false);
    }
  };

  const removeOrder = async () => {
    if (!order || !canDeleteOrder) return;
    if (!confirm(`Sipariş ${formatOrderNo(order.orderNumber)} silinsin mi?`)) return;
    try {
      await api.delete(`/orders/${order.id}`);
      toast.success('Sipariş silindi');
      router.push('/orders');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  const updateItemSource = async (
    itemId: string,
    patch: { isFromStock?: boolean; supplierId?: string | null; supplierOrderNo?: string | null },
  ) => {
    setItemSavingId(itemId);
    try {
      await api.patch(`/orders/items/${itemId}`, patch);
      await fetchOrder();
      toast.success('Kalem kaynağı güncellendi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kalem güncellenemedi'));
    } finally {
      setItemSavingId(null);
    }
  };

  const saveOrderLine = async (itemId: string) => {
    const d = lineDrafts[itemId];
    if (!d) return;
    if (!d.name.trim()) {
      toast.error('Ürün adı boş olamaz');
      return;
    }
    setItemSavingId(itemId);
    try {
      await api.patch(`/orders/items/${itemId}`, {
        name: d.name.trim(),
        colorFabricInfo: d.colorFabricInfo.trim() || null,
        measurementInfo: d.measurementInfo.trim() || null,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        vatRate: Math.round(d.vatRate),
        priceIncludesVat: d.priceIncludesVat,
      });
      await fetchOrder();
      toast.success('Kalem kaydedildi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kalem kaydedilemedi'));
    } finally {
      setItemSavingId(null);
    }
  };

  const openPaymentForm = (prefillRemaining: boolean) => {
    setPayAmount(
      prefillRemaining && order?.remainingTotal && order.remainingTotal > 0
        ? String(Math.round((order.remainingTotal + Number.EPSILON) * 100) / 100)
        : '',
    );
    setPayMethod('TRANSFER');
    setPayDirection('INCOME');
    setPayReference('');
    setPayDescription('');
    setPayOccurredAt(toDateTimeInputValue(new Date().toISOString()));
    setPaymentOpen(true);
  };

  const closePaymentForm = () => {
    if (paymentSaving) return;
    setPaymentOpen(false);
  };

  const submitPayment = async () => {
    if (!order) return;
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Geçerli bir tutar girin');
      return;
    }
    setPaymentSaving(true);
    try {
      await api.post(`/orders/${order.id}/payments`, {
        amount: amt,
        direction: payDirection,
        method: payMethod,
        description: payDescription.trim() || undefined,
        reference: payReference.trim() || null,
        occurredAt: payOccurredAt ? new Date(payOccurredAt).toISOString() : null,
      });
      toast.success(payDirection === 'INCOME' ? 'Tahsilat kaydedildi' : 'İade kaydedildi');
      setPaymentOpen(false);
      await fetchOrder();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setPaymentSaving(false);
    }
  };

  const removePayment = async (entryId: string) => {
    if (!order) return;
    if (!confirm('Bu tahsilat kaydı silinsin mi?')) return;
    setPaymentDeletingId(entryId);
    try {
      await api.delete(`/orders/${order.id}/payments/${entryId}`);
      toast.success('Tahsilat silindi');
      await fetchOrder();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    } finally {
      setPaymentDeletingId(null);
    }
  };

  const updateLineDraft = (itemId: string, patch: Partial<LineEditDraft>) => {
    setLineDrafts((prev) => {
      const cur = prev[itemId];
      if (!cur) return prev;
      return { ...prev, [itemId]: { ...cur, ...patch } };
    });
  };

  const saveCargoInfo = async () => {
    if (!order) return;
    setCargoSaving(true);
    try {
      const { data } = await api.patch<SalesOrder>(`/orders/${order.id}/shipping-info`, {
        cargoCompanyId: cargoCompanyDraft || null,
        cargoTrackingNo: cargoTrackingDraft.trim() || null,
      });
      setOrder(data);
      toast.success('Kargo bilgileri kaydedildi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setCargoSaving(false);
    }
  };

  const sendCargoNotification = async () => {
    if (!order) return;
    setCargoNotifSending(true);
    try {
      await api.post(`/orders/${order.id}/send-shipping-notification`);
      await fetchOrder();
      toast.success('Kargo bildirimi müşteriye gönderildi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Bildirim gönderilemedi'));
    } finally {
      setCargoNotifSending(false);
    }
  };

  const selectedCargoCompany = cargoCompanies.find((c) => c.id === cargoCompanyDraft);

  const canEditOrderLines = Boolean(
    order &&
      !order.invoice &&
      order.status !== 'COMPLETED' &&
      order.status !== 'CANCELLED',
  );

  const [openItemIds, setOpenItemIds] = useState<Set<string>>(new Set());
  const [notesOpen, setNotesOpen] = useState(false);
  const [cargoOpen, setCargoOpen] = useState(false);
  const [customerDetailOpen, setCustomerDetailOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  const toggleItemOpen = (id: string) => {
    setOpenItemIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const isLineDirty = (item: OrderItemRow): boolean => {
    const d = lineDrafts[item.id];
    if (!d) return false;
    return (
      d.name.trim() !== (item.name ?? '').trim() ||
      d.colorFabricInfo.trim() !== (item.colorFabricInfo ?? '').trim() ||
      d.measurementInfo.trim() !== (item.measurementInfo ?? '').trim() ||
      Number(d.quantity) !== Number(item.quantity) ||
      Number(d.unitPrice) !== Number(item.unitPrice) ||
      Boolean(d.priceIncludesVat) !== Boolean(item.priceIncludesVat !== false)
    );
  };

  const isMetaDirty = Boolean(
    order &&
      (toDateInputValue(order.expectedDeliveryDate ?? null) !== expectedDeliveryDraft ||
        (order.notes ?? '') !== notesDraft ||
        (order.shippingAddress ?? '') !== shippingDraft),
  );

  const dirtyItemIds = order?.items?.filter(isLineDirty).map((i) => i.id) ?? [];
  const hasUnsaved = dirtyItemIds.length > 0 || isMetaDirty;

  const bulkSave = async () => {
    if (!order) return;
    setBulkSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];
      for (const id of dirtyItemIds) {
        const d = lineDrafts[id];
        if (!d) continue;
        if (!d.name.trim()) {
          toast.error('Ürün adı boş olamaz');
          setBulkSaving(false);
          return;
        }
        tasks.push(
          api.patch(`/orders/items/${id}`, {
            name: d.name.trim(),
            colorFabricInfo: d.colorFabricInfo.trim() || null,
            measurementInfo: d.measurementInfo.trim() || null,
            quantity: d.quantity,
            unitPrice: d.unitPrice,
            priceIncludesVat: d.priceIncludesVat,
          }),
        );
      }
      if (isMetaDirty) {
        tasks.push(
          api.patch(`/orders/${order.id}`, {
            expectedDeliveryDate: expectedDeliveryDraft ? new Date(expectedDeliveryDraft).toISOString() : null,
            notes: notesDraft.trim() === '' ? null : notesDraft,
            shippingAddress: shippingDraft.trim() === '' ? null : shippingDraft,
          }),
        );
      }
      await Promise.all(tasks);
      await fetchOrder();
      toast.success('Sipariş güncellendi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Güncelleme başarısız'));
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="p-3 sm:p-4 w-full max-w-[1400px] mx-auto space-y-3">
      <button
        type="button"
        onClick={() => router.push('/orders')}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Siparişlere dön
      </button>

      {loading || !order ? (
        <div className="rounded-xl border border-gray-100 bg-white py-16 flex items-center justify-center text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2 text-whatsapp" />
          Detay yükleniyor...
        </div>
      ) : (
        <>
          {/* Header şeridi */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="min-w-0 flex items-center gap-3">
              <Package className="w-5 h-5 text-whatsapp shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base font-bold text-gray-900">{formatOrderNo(order.orderNumber)}</h1>
                  {order.source === 'TSOFT' && (
                    <span className="inline-flex text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase tracking-wide">Site</span>
                  )}
                  <PanelEditedBadge at={order.panelEditedAt} />
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {contactDisplayName(order.contact)} · {formatPhone(order.contact.phone)} · {formatDateTime(order.createdAt)}
                </p>
              </div>
            </div>
            <select
              value={order.status}
              disabled={statusSaving}
              onChange={(e) => void patchStatus(e.target.value as OrderStatus)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs bg-white font-medium shrink-0"
            >
              {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {/* SOL · 75% */}
            <div className="lg:col-span-3 space-y-3 min-w-0">
              {/* Ürünler — accordion */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
                  <h3 className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">Ürünler · {order.items?.length ?? 0}</h3>
                  {order.invoice ? (
                    <span className="text-[10px] text-amber-700">Faturalı — düzenleme kapalı</span>
                  ) : !canEditOrderLines ? (
                    <span className="text-[10px] text-gray-500">Bu durumda düzenlenemez</span>
                  ) : (
                    <span className="text-[10px] text-gray-400">Detay için satıra tıkla</span>
                  )}
                </div>
                <div className="divide-y divide-gray-50">
                  {order.items?.length ? (
                    order.items.map((item) => {
                      const open = openItemIds.has(item.id);
                      const d = lineDrafts[item.id];
                      const editable = canEditOrderLines && !!d;
                      const dirty = isLineDirty(item);
                      const total = editable && dirty ? draftLineGross(d) : item.lineTotal;
                      return (
                        <div key={item.id} className={dirty ? 'bg-amber-50/30' : ''}>
                          {/* Kapalı / özet satır */}
                          <button
                            type="button"
                            onClick={() => toggleItemOpen(item.id)}
                            className="w-full grid grid-cols-[20px_40px_1fr_auto_auto] gap-3 items-center px-3 py-2.5 hover:bg-gray-50 text-left transition-colors"
                          >
                            {open ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                            <div className="w-9 h-9 rounded border border-gray-100 bg-gray-50 overflow-hidden">
                              {item.product?.imageUrl ? (
                                <img src={rewriteMediaUrlForClient(item.product.imageUrl)} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span className="flex w-full h-full items-center justify-center text-[10px] text-gray-300">—</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                              <p className="text-[11px] text-gray-500 truncate">
                                {item.productVariant?.name ? <span className="text-indigo-700">{item.productVariant.name}</span> : null}
                                {item.colorFabricInfo ? (item.productVariant?.name ? ' · ' : '') + item.colorFabricInfo : ''}
                                {item.measurementInfo ? ' · ' + item.measurementInfo : ''}
                                {!item.productVariant?.name && !item.colorFabricInfo && !item.measurementInfo && item.product?.sku
                                  ? `SKU: ${item.product.sku}`
                                  : ''}
                              </p>
                            </div>
                            <p className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                              {item.quantity} × {formatMoney(item.unitPrice, order.currency)}
                            </p>
                            <p className="text-sm font-bold text-gray-900 tabular-nums w-28 text-right">
                              {formatMoney(total, order.currency)}
                            </p>
                          </button>

                          {/* Açık detay */}
                          {open ? (
                            <div className="px-4 pb-4 pt-1 bg-gray-50/30 border-t border-gray-50 space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Ürün adı</label>
                                  {editable ? (
                                    <input
                                      value={d.name}
                                      onChange={(e) => updateLineDraft(item.id, { name: e.target.value })}
                                      className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-sm bg-white"
                                    />
                                  ) : (
                                    <p className="text-sm text-gray-800">{item.name}</p>
                                  )}
                                  {item.product?.sku ? (
                                    <p className="text-[10px] text-gray-400 font-mono mt-1">SKU: {item.product.sku}</p>
                                  ) : null}
                                  {item.productVariant ? (
                                    <p className="text-[10px] text-indigo-700 mt-0.5">
                                      Varyant: {item.productVariant.name}
                                      {item.productVariant.sku ? ` · ${item.productVariant.sku}` : ''}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Miktar</label>
                                    {editable ? (
                                      <input
                                        type="number"
                                        min={0.01}
                                        step={0.01}
                                        value={d.quantity}
                                        onChange={(e) => updateLineDraft(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                                        className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-sm bg-white text-right tabular-nums"
                                      />
                                    ) : (
                                      <p className="text-sm text-gray-800 text-right tabular-nums">{item.quantity}</p>
                                    )}
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Birim fiyat</label>
                                    {editable ? (
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.01}
                                        value={d.unitPrice}
                                        onChange={(e) => updateLineDraft(item.id, { unitPrice: parseFloat(e.target.value) || 0 })}
                                        className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-sm bg-white text-right tabular-nums"
                                      />
                                    ) : (
                                      <p className="text-sm text-gray-800 text-right tabular-nums">{formatMoney(item.unitPrice, order.currency)}</p>
                                    )}
                                  </div>
                                  <div className="col-span-2">
                                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Fiyat tipi</label>
                                    {editable ? (
                                      <select
                                        value={d.priceIncludesVat ? 'incl' : 'excl'}
                                        onChange={(e) => updateLineDraft(item.id, { priceIncludesVat: e.target.value === 'incl' })}
                                        className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-sm bg-white"
                                      >
                                        <option value="incl">KDV dahil</option>
                                        <option value="excl">KDV hariç</option>
                                      </select>
                                    ) : (
                                      <p className="text-sm text-gray-800">{item.priceIncludesVat !== false ? 'KDV dahil' : 'KDV hariç'}</p>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Renk / Kumaş</label>
                                  {editable ? (
                                    <textarea
                                      value={d.colorFabricInfo}
                                      onChange={(e) => updateLineDraft(item.id, { colorFabricInfo: e.target.value })}
                                      rows={2}
                                      className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-xs bg-white resize-none"
                                      placeholder="—"
                                    />
                                  ) : (
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.colorFabricInfo?.trim() || '—'}</p>
                                  )}
                                </div>
                                <div>
                                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Ölçü</label>
                                  {editable ? (
                                    <textarea
                                      value={d.measurementInfo}
                                      onChange={(e) => updateLineDraft(item.id, { measurementInfo: e.target.value })}
                                      rows={2}
                                      className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-xs bg-white resize-none"
                                      placeholder="—"
                                    />
                                  ) : (
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.measurementInfo?.trim() || '—'}</p>
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-12 gap-2 items-center pt-2 border-t border-gray-100">
                                <div className="col-span-3">
                                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={!!item.isFromStock}
                                      disabled={!canEditOrderLines || itemSavingId === item.id}
                                      onChange={(e) =>
                                        void updateItemSource(item.id, {
                                          isFromStock: e.target.checked,
                                          ...(e.target.checked ? { supplierId: null, supplierOrderNo: null } : {}),
                                        })
                                      }
                                      className="accent-whatsapp"
                                    />
                                    <Store className="w-3.5 h-3.5 text-gray-400" />
                                    Stoktan
                                  </label>
                                </div>
                                <div className="col-span-5">
                                  <select
                                    value={item.supplierId || ''}
                                    disabled={!!item.isFromStock || itemSavingId === item.id || !canEditOrderLines}
                                    onChange={(e) => void updateItemSource(item.id, { supplierId: e.target.value || null })}
                                    className="w-full px-2 py-1.5 rounded-md border border-gray-200 text-xs bg-white disabled:bg-gray-100 disabled:text-gray-400"
                                  >
                                    <option value="">Tedarikçi seç</option>
                                    {suppliers.map((s) => (
                                      <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="col-span-4">
                                  <input
                                    key={item.supplierOrderNo ?? 'empty'}
                                    defaultValue={item.supplierOrderNo || ''}
                                    disabled={!!item.isFromStock || itemSavingId === item.id || !canEditOrderLines}
                                    onBlur={(e) => void updateItemSource(item.id, { supplierOrderNo: e.target.value || null })}
                                    placeholder="Tedarikçi sipariş no"
                                    className="w-full px-2 py-1.5 rounded-md border border-gray-200 text-xs bg-white disabled:bg-gray-100"
                                  />
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-4 py-10 text-center text-gray-400 text-sm">Kalem yok</div>
                  )}
                </div>
              </div>

              {/* Tahsilat */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
                  <h3 className="text-[11px] font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                    Tahsilat
                    {order.isFullyPaid ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-800">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Ödendi
                      </span>
                    ) : null}
                  </h3>
                  <button
                    type="button"
                    onClick={() => openPaymentForm((order.remainingTotal ?? 0) > 0)}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-whatsapp text-white text-[11px] font-semibold hover:bg-green-600"
                  >
                    <Plus className="w-3 h-3" />
                    Tahsilat Ekle
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
                  <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                    <div className="text-[9px] font-semibold text-gray-400 uppercase">Toplam</div>
                    <div className="text-sm font-semibold text-gray-900 tabular-nums">{formatMoney(order.grandTotal, order.currency)}</div>
                  </div>
                  <div className="rounded-lg border border-green-100 bg-green-50/60 px-3 py-2">
                    <div className="text-[9px] font-semibold text-green-600 uppercase">Tahsil</div>
                    <div className="text-sm font-semibold text-green-800 tabular-nums">{formatMoney(order.paidTotal ?? 0, order.currency)}</div>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${(order.remainingTotal ?? 0) > 0 ? 'border-red-200 bg-red-50' : 'border-green-100 bg-green-50/80'}`}>
                    <div className={`text-[9px] font-semibold uppercase ${(order.remainingTotal ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>Kalan</div>
                    <div className={`text-base font-bold tabular-nums ${(order.remainingTotal ?? 0) > 0 ? 'text-red-700' : 'text-green-800'}`}>
                      {formatMoney(Math.max(0, order.remainingTotal ?? 0), order.currency)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2">
                    <div className="text-[9px] font-semibold text-amber-600 uppercase">İade</div>
                    <div className="text-sm font-semibold text-amber-800 tabular-nums">{formatMoney(order.refundedTotal ?? 0, order.currency)}</div>
                  </div>
                </div>
                {order.payments?.length ? (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {order.payments.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                        <span className="text-gray-500 tabular-nums whitespace-nowrap w-24">{formatDateTime(p.occurredAt)}</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium text-[10px] ${
                            p.direction === 'INCOME' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {paymentMethodIcon(p.method)}
                          {PAYMENT_METHOD_LABELS[p.method]}
                          {p.direction === 'EXPENSE' ? ' · İade' : ''}
                        </span>
                        <span className="text-gray-600 truncate flex-1">
                          {p.description}
                          {p.reference ? <span className="text-gray-400"> · {p.reference}</span> : null}
                        </span>
                        <span className="text-gray-400 hidden sm:inline w-24 truncate">{p.user?.name ?? '—'}</span>
                        <span
                          className={`tabular-nums font-semibold w-28 text-right ${
                            p.direction === 'INCOME' ? 'text-green-700' : 'text-amber-700'
                          }`}
                        >
                          {p.direction === 'INCOME' ? '+' : '−'}
                          {formatMoney(p.amount, order.currency)}
                        </span>
                        {canDeletePayment ? (
                          <button
                            type="button"
                            disabled={paymentDeletingId === p.id}
                            onClick={() => void removePayment(p.id)}
                            className="text-gray-300 hover:text-red-600 disabled:opacity-40"
                            title="Sil"
                          >
                            {paymentDeletingId === p.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Notlar & teslimat — collapsed default */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setNotesOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-700 uppercase tracking-wide">
                    <Calendar className="w-3.5 h-3.5 text-teal-600" />
                    Notlar & Teslimat
                    {(order.notes || order.shippingAddress || order.expectedDeliveryDate) ? (
                      <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-teal-500" />
                    ) : null}
                  </span>
                  {notesOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                </button>
                {notesOpen ? (
                  <div className="px-4 pb-4 pt-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Teslim tarihi</label>
                      <input
                        type="date"
                        value={expectedDeliveryDraft}
                        onChange={(e) => setExpectedDeliveryDraft(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Sevk adresi</label>
                      <textarea
                        value={shippingDraft}
                        onChange={(e) => setShippingDraft(e.target.value)}
                        rows={2}
                        placeholder="Sevk adresi"
                        className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-xs resize-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notlar</label>
                      <textarea
                        value={notesDraft}
                        onChange={(e) => setNotesDraft(e.target.value)}
                        rows={2}
                        placeholder="Not"
                        className="w-full px-2.5 py-1.5 rounded-md border border-gray-200 text-xs resize-none"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Kargo — yalnızca SHIPPED */}
              {order.status === 'SHIPPED' ? (
                <div className="bg-white rounded-xl border border-blue-100 shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCargoOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-blue-50/30 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-blue-800 uppercase tracking-wide">
                      <Truck className="w-3.5 h-3.5" />
                      Kargo
                      {order.cargoCompany ? (
                        <span className="ml-1 text-[10px] font-normal text-blue-600 normal-case">
                          {order.cargoCompany.name}
                          {order.cargoTrackingNo && !order.cargoCompany.isAmbar ? ` · ${order.cargoTrackingNo}` : ''}
                        </span>
                      ) : null}
                    </span>
                    {cargoOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </button>
                  {cargoOpen ? (
                    <div className="px-4 pb-4 pt-1 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Kargo firması</label>
                          <select
                            value={cargoCompanyDraft}
                            onChange={(e) => setCargoCompanyDraft(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-md border border-gray-200 text-xs bg-white"
                          >
                            <option value="">Firma seçin</option>
                            {cargoCompanies.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}{c.isAmbar ? ' (Ambar)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        {selectedCargoCompany && !selectedCargoCompany.isAmbar ? (
                          <div>
                            <label className="text-[10px] font-semibold text-gray-500 uppercase block mb-1">Takip numarası</label>
                            <input
                              type="text"
                              value={cargoTrackingDraft}
                              onChange={(e) => setCargoTrackingDraft(e.target.value)}
                              placeholder="Takip no"
                              className="w-full px-2 py-1.5 rounded-md border border-gray-200 text-xs"
                            />
                          </div>
                        ) : null}
                      </div>
                      {selectedCargoCompany?.isAmbar ? (
                        <div className="rounded-md bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] text-amber-800">
                          Ambar teslimatı — takip kodu gönderilmeyecek.
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={cargoSaving || !cargoCompanyDraft}
                          onClick={() => void saveCargoInfo()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-xs disabled:opacity-50"
                        >
                          {cargoSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          Kaydet
                        </button>
                        <button
                          type="button"
                          disabled={cargoNotifSending || !order.cargoCompanyId}
                          onClick={() => void sendCargoNotification()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-whatsapp text-white text-xs disabled:opacity-50 hover:bg-green-600"
                        >
                          {cargoNotifSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Müşteriye Gönder
                        </button>
                      </div>
                      {order.cargoNotificationSentAt ? (
                        <p className="text-xs text-green-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Son bildirim: {formatDateTime(order.cargoNotificationSentAt)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {order.siteOrderData ? <SiteOrderDetailsPanel data={order.siteOrderData} /> : null}
            </div>

            {/* SAĞ · 25% sticky */}
            <aside className="lg:col-span-1 space-y-3 lg:sticky lg:top-3 lg:self-start lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto min-w-0">
              {/* Toplam + tahsilat mini */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Genel toplam</p>
                  <p className="text-2xl font-bold text-whatsapp tabular-nums leading-tight">{formatMoney(order.grandTotal, order.currency)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Ara: <span className="tabular-nums">{formatMoney(order.subtotal ?? 0, order.currency)}</span>
                    <span className="mx-1">·</span>
                    KDV: <span className="tabular-nums">{formatMoney(order.vatTotal ?? 0, order.currency)}</span>
                  </p>
                </div>
                <div className="px-4 py-3 border-b border-gray-100 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-500">Tahsil</span>
                    <span className="text-green-700 font-semibold tabular-nums">{formatMoney(order.paidTotal ?? 0, order.currency)}</span>
                  </div>
                  <div className={`flex items-center justify-between text-sm font-bold rounded-md px-2 py-1.5 ${(order.remainingTotal ?? 0) > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                    <span>Kalan</span>
                    <span className="tabular-nums">{formatMoney(Math.max(0, order.remainingTotal ?? 0), order.currency)}</span>
                  </div>
                </div>
                {order.expectedDeliveryDate || order.quote ? (
                  <div className="px-4 py-2 text-[11px] space-y-0.5 border-b border-gray-100">
                    {order.expectedDeliveryDate ? (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Teslim</span>
                        <span className="text-gray-700">{new Date(order.expectedDeliveryDate).toLocaleDateString('tr-TR')}</span>
                      </div>
                    ) : null}
                    {order.quote ? (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Teklif</span>
                        <span className="font-mono text-gray-700">{formatQuoteNo(order.quote.quoteNumber)}</span>
                      </div>
                    ) : null}
                    {order.createdBy?.name ? (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Oluşturan</span>
                        <span className="text-gray-700">{order.createdBy.name}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Müşteri — kompakt + collapse detay */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-1.5 border-b border-gray-100">
                  <User className="w-3.5 h-3.5 text-purple-600" />
                  <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wide">Müşteri</span>
                </div>
                <div className="px-4 py-3 space-y-0.5">
                  <p className="text-xs font-semibold text-gray-900 truncate">{contactDisplayName(order.contact)}</p>
                  <p className="text-[11px] text-gray-500">{formatPhone(order.contact.phone)}</p>
                  {order.contact.company ? <p className="text-[11px] text-gray-600 truncate">{order.contact.company}</p> : null}
                </div>
                {(order.contact.email || order.contact.taxOffice || order.contact.taxNumber || order.contact.billingAddress || order.shippingAddress) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setCustomerDetailOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-2 text-[11px] text-gray-500 hover:bg-gray-50 border-t border-gray-100"
                    >
                      <span>{customerDetailOpen ? 'Detayı gizle' : 'Detay'}</span>
                      {customerDetailOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    {customerDetailOpen ? (
                      <div className="px-4 pb-3 space-y-1.5 text-[11px] text-gray-600">
                        {order.contact.email ? <p className="break-all">{order.contact.email}</p> : null}
                        {order.contact.taxOffice || order.contact.taxNumber ? (
                          <p>VD: {order.contact.taxOffice || '—'} · VN: {order.contact.taxNumber || '—'}</p>
                        ) : null}
                        {order.contact.billingAddress ? (
                          <div>
                            <p className="text-[9px] font-semibold text-gray-400 uppercase">Fatura adresi</p>
                            <p className="whitespace-pre-wrap leading-snug">{order.contact.billingAddress}</p>
                          </div>
                        ) : null}
                        {order.shippingAddress ? (
                          <div>
                            <p className="text-[9px] font-semibold text-gray-400 uppercase">Sevk adresi</p>
                            <p className="whitespace-pre-wrap leading-snug">{order.shippingAddress}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              {/* T-Soft kaynak (varsa) */}
              {order.source === 'TSOFT' || order.externalId || order.tsoftSiteOrderId || order.pushToTsoft ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wide">Kaynak</span>
                  </div>
                  <div className="px-4 py-2 text-[11px] space-y-0.5">
                    <p className="text-gray-600">
                      <span className="text-gray-400">Kaynak:</span> <span className="font-medium">{order.source || 'MANUAL'}</span>
                    </p>
                    {order.tsoftSiteOrderId ? (
                      <p className="text-gray-500">OrderId: <span className="font-mono">{order.tsoftSiteOrderId}</span></p>
                    ) : null}
                    {order.tsoftPushedAt ? <p className="text-emerald-600">İtildi: {formatDateTime(order.tsoftPushedAt)}</p> : null}
                    {order.tsoftLastError ? <p className="text-red-600 text-[10px] break-words">{order.tsoftLastError}</p> : null}
                  </div>
                </div>
              ) : null}

              {/* WhatsApp Sohbet Akordiyon */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setChatOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-whatsapp" />
                    WhatsApp Sohbet
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${chatOpen ? 'rotate-0' : '-rotate-90'}`} />
                </button>
                {chatOpen && (
                  <div className="border-t border-gray-100 h-[440px] flex flex-col">
                    <QuoteEmbeddedChat contactId={order.contact.id} contactPhone={order.contact.phone} />
                  </div>
                )}
              </div>
            </aside>
          </div>

          {/* Aksiyon şeridi */}
          <div className="sticky bottom-0 z-10 px-3 py-2.5 bg-white rounded-xl border border-gray-100 shadow-md flex items-center gap-2 flex-wrap">
            {canDeleteOrder && (order.status === 'AWAITING_PAYMENT' || order.status === 'AWAITING_CHECKOUT') && !order.invoice ? (
              <button
                type="button"
                onClick={() => void removeOrder()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Sil
              </button>
            ) : null}

            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {order.confirmationPdfUrl ? (
                <a
                  href={`${backendPublicUrl()}${order.confirmationPdfUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  PDF
                </a>
              ) : null}
              {canRegenerateOrderPdf ? (
                <button
                  type="button"
                  disabled={pdfRegenLoading}
                  onClick={() => void regenerateOrderPdf()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {pdfRegenLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  PDF Yenile
                </button>
              ) : null}

              {order.invoice ? (
                <button
                  type="button"
                  onClick={() => router.push(`/accounting/invoices/${order.invoice!.id}`)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-700"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Fatura görüntüle
                </button>
              ) : (
                <>
                  <input
                    type="date"
                    value={invoiceDueDraft}
                    onChange={(e) => setInvoiceDueDraft(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs"
                    title="Fatura vade tarihi"
                  />
                  <button
                    type="button"
                    disabled={invoiceSaving || order.status === 'CANCELLED'}
                    onClick={() => void createInvoiceFromOrder()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {invoiceSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    Muhasebeye Gönder
                  </button>
                </>
              )}

              <button
                type="button"
                disabled={!hasUnsaved || bulkSaving || metaSaving}
                onClick={() => void bulkSave()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-whatsapp text-white text-xs font-semibold hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bulkSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Siparişi Güncelle
                {hasUnsaved ? (
                  <span className="ml-1 text-[10px] bg-white/20 px-1.5 rounded-full">{dirtyItemIds.length + (isMetaDirty ? 1 : 0)}</span>
                ) : null}
              </button>
            </div>
          </div>
        </>
      )}


      {paymentOpen && order ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={closePaymentForm}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-whatsapp" />
                {payDirection === 'INCOME' ? 'Tahsilat ekle' : 'İade ekle'}
              </h3>
              <button
                type="button"
                onClick={closePaymentForm}
                className="text-gray-400 hover:text-gray-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPayDirection('INCOME')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ${
                    payDirection === 'INCOME'
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-white border-gray-200 text-gray-600'
                  }`}
                >
                  Tahsilat
                </button>
                <button
                  type="button"
                  onClick={() => setPayDirection('EXPENSE')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ${
                    payDirection === 'EXPENSE'
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-white border-gray-200 text-gray-600'
                  }`}
                >
                  İade
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">
                  Tutar ({order.currency})
                  {payDirection === 'INCOME' && order.remainingTotal != null ? (
                    <span className="text-gray-400 font-normal ml-1">
                      · kalan {formatMoney(Math.max(0, order.remainingTotal), order.currency)}
                    </span>
                  ) : null}
                </label>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  placeholder="0,00"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">Yöntem</label>
                <div className="grid grid-cols-5 gap-1">
                  {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMethod(m)}
                      className={`flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-lg border text-[10px] font-medium ${
                        payMethod === m
                          ? 'bg-whatsapp/10 border-whatsapp text-whatsapp'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {paymentMethodIcon(m)}
                      <span className="text-center leading-tight">{PAYMENT_METHOD_LABELS[m]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">Tarih / saat</label>
                <input
                  type="datetime-local"
                  value={payOccurredAt}
                  onChange={(e) => setPayOccurredAt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">
                  Dekont / çek / POS referansı
                </label>
                <input
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  placeholder="İsteğe bağlı"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">Açıklama</label>
                <textarea
                  value={payDescription}
                  onChange={(e) => setPayDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  placeholder="Boş bırakılırsa otomatik doldurulur"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={closePaymentForm}
                disabled={paymentSaving}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-white disabled:opacity-50"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => void submitPayment()}
                disabled={paymentSaving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-whatsapp text-white text-sm font-semibold hover:bg-green-600 disabled:opacity-50"
              >
                {paymentSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                Kaydet
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
