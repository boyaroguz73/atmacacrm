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
  CreditCard,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  MapPin,
  Package,
  Plus,
  Receipt,
  ReceiptText,
  Store,
  Trash2,
  User,
  Wallet,
  X,
} from 'lucide-react';
import PanelEditedBadge from '@/components/ui/PanelEditedBadge';
import SiteOrderDetailsPanel from '@/components/orders/SiteOrderDetailsPanel';

type OrderStatus = 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

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
  }, [order?.id, order?.expectedDeliveryDate, order?.notes, order?.shippingAddress, loading]);

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

  const canEditOrderLines = Boolean(
    order &&
      !order.invoice &&
      order.status !== 'DELIVERED' &&
      order.status !== 'CANCELLED',
  );

  return (
    <div className="p-4 sm:p-6 w-full max-w-none space-y-5">
      <button
        type="button"
        onClick={() => router.push('/orders')}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
      >
        <ArrowLeft className="w-4 h-4" />
        Siparişlere dön
      </button>

      {loading || !order ? (
        <div className="rounded-xl border border-gray-100 bg-white py-16 flex items-center justify-center text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2 text-whatsapp" />
          Detay yükleniyor...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50/50">
            <div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                <Package className="w-5 h-5 text-whatsapp" />
                {formatOrderNo(order.orderNumber)}
                {order.source === 'TSOFT' && (
                  <span className="inline-flex text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase tracking-wide">Site Siparişi</span>
                )}
                <PanelEditedBadge at={order.panelEditedAt} />
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {contactDisplayName(order.contact)} · {formatPhone(order.contact.phone)}
              </p>
              {order.createdBy?.name ? (
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 shrink-0" />
                  Oluşturan: <span className="font-medium text-gray-600">{order.createdBy.name}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="px-5 py-4 space-y-5">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
              <div className="xl:col-span-2 space-y-5 min-w-0">
            <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-50 to-indigo-50/40 border-b border-indigo-100">
                <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wide flex items-center gap-2">
                  <Package className="w-4 h-4 text-indigo-700" />
                  Sipariş Ürünleri
                </h3>
                {canEditOrderLines ? (
                  <p className="text-[11px] text-indigo-800/70">
                    Düzenleyip <strong>Kaydet</strong> ile güncelleyin.
                  </p>
                ) : order.invoice ? (
                  <p className="text-[11px] text-amber-700">Faturalı siparişte kalem içeriği değiştirilemez.</p>
                ) : order.status === 'DELIVERED' || order.status === 'CANCELLED' ? (
                  <p className="text-[11px] text-gray-500">Bu durumda kalem düzenlenemez.</p>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead>
                    <tr className="bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2.5 w-16">Görsel</th>
                      <th className="px-3 py-2.5 min-w-[120px]">Ürün</th>
                      <th className="px-3 py-2.5 min-w-[100px]">Renk/Kumaş</th>
                      <th className="px-3 py-2.5 min-w-[100px]">Ölçü</th>
                      <th className="px-3 py-2.5 text-right w-20">Miktar</th>
                      <th className="px-3 py-2.5 text-right min-w-[90px]">Birim fiyat</th>
                      <th className="px-3 py-2.5 text-center min-w-[96px]">Fiyat tipi</th>
                      <th className="px-3 py-2.5 text-right min-w-[72px]">KDV</th>
                      <th className="px-3 py-2.5 text-left">Kaynak</th>
                      <th className="px-3 py-2.5 text-left">Tedarikçi</th>
                      <th className="px-3 py-2.5 text-left">Sipariş no</th>
                      <th className="px-3 py-2.5 text-right min-w-[88px]">Satır toplamı</th>
                      {canEditOrderLines ? <th className="px-3 py-2.5 w-24">İşlem</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items?.length ? (
                      order.items.map((item) => {
                        const vatAmt = lineVatAmount(item);
                        const d = lineDrafts[item.id];
                        const editable = canEditOrderLines && d;
                        const draftVat = editable ? draftLineVatAmount(d) : vatAmt;
                        const draftLineTotal = editable ? draftLineGross(d) : item.lineTotal;
                        return (
                          <tr key={item.id} className="border-t border-gray-50 align-top odd:bg-gray-50/30 hover:bg-indigo-50/20 transition-colors">
                            <td className="px-3 py-2.5 align-middle w-16">
                              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
                                {item.product?.imageUrl ? (
                                  <img src={rewriteMediaUrlForClient(item.product.imageUrl)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="flex w-full h-full items-center justify-center text-[10px] text-gray-300">—</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="space-y-1">
                                {editable ? (
                                  <input
                                    value={d.name}
                                    onChange={(e) => updateLineDraft(item.id, { name: e.target.value })}
                                    className="w-full px-2 py-1.5 rounded border border-gray-200 text-sm"
                                  />
                                ) : (
                                  <span className="font-medium text-gray-900">{item.name}</span>
                                )}
                                {item.productVariant ? (
                                  <p className="text-[10px] text-indigo-700">
                                    Varyant: {item.productVariant.name}
                                    {item.productVariant.sku ? ` · ${item.productVariant.sku}` : ''}
                                  </p>
                                ) : null}
                                {item.product ? (
                                  <p className="text-[10px] text-gray-400 font-mono">Ürün SKU: {item.product.sku}</p>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              {editable ? (
                                <textarea
                                  value={d.colorFabricInfo}
                                  onChange={(e) => updateLineDraft(item.id, { colorFabricInfo: e.target.value })}
                                  rows={2}
                                  className="w-full px-2 py-1.5 rounded border border-gray-200 text-xs"
                                  placeholder="Renk/kumaş"
                                />
                              ) : (
                                <span className="text-sm text-gray-700">{item.colorFabricInfo?.trim() || '—'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {editable ? (
                                <textarea
                                  value={d.measurementInfo}
                                  onChange={(e) => updateLineDraft(item.id, { measurementInfo: e.target.value })}
                                  rows={2}
                                  className="w-full px-2 py-1.5 rounded border border-gray-200 text-xs"
                                  placeholder="Ölçü"
                                />
                              ) : (
                                <span className="text-sm text-gray-700 whitespace-pre-wrap max-w-[200px]">{item.measurementInfo?.trim() || '—'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {editable ? (
                                <input
                                  type="number"
                                  min={0.01}
                                  step={0.01}
                                  value={d.quantity}
                                  onChange={(e) =>
                                    updateLineDraft(item.id, { quantity: parseFloat(e.target.value) || 0 })
                                  }
                                  className="w-full min-w-[4.5rem] px-2 py-1.5 rounded border border-gray-200 text-sm text-right tabular-nums"
                                />
                              ) : (
                                item.quantity
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {editable ? (
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  value={d.unitPrice}
                                  onChange={(e) =>
                                    updateLineDraft(item.id, { unitPrice: parseFloat(e.target.value) || 0 })
                                  }
                                  className="w-full min-w-[5.5rem] px-2 py-1.5 rounded border border-gray-200 text-sm text-right tabular-nums"
                                />
                              ) : (
                                <div>
                                  <div>{formatMoney(item.unitPrice, order.currency)}</div>
                                  <div className="text-[10px] text-gray-400">
                                    {item.priceIncludesVat !== false ? 'KDV dahil' : 'KDV hariç'}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {editable ? (
                                <select
                                  value={d.priceIncludesVat ? 'incl' : 'excl'}
                                  onChange={(e) =>
                                    updateLineDraft(item.id, {
                                      priceIncludesVat: e.target.value === 'incl',
                                    })
                                  }
                                  className="px-2 py-1.5 rounded border border-gray-200 text-xs"
                                >
                                  <option value="incl">KDV dahil</option>
                                  <option value="excl">KDV hariç</option>
                                </select>
                              ) : (
                                <span
                                  className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    item.priceIncludesVat !== false
                                      ? 'bg-green-50 text-green-700'
                                      : 'bg-blue-50 text-blue-700'
                                  }`}
                                >
                                  {item.priceIncludesVat !== false ? 'KDV dahil' : 'KDV hariç'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {editable ? (
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={d.vatRate}
                                  onChange={(e) =>
                                    updateLineDraft(item.id, { vatRate: parseFloat(e.target.value) || 0 })
                                  }
                                  className="w-14 px-2 py-1.5 rounded border border-gray-200 text-sm text-right"
                                />
                              ) : (
                                <span className="block">{item.vatRate}%</span>
                              )}
                              <span className="text-gray-400 text-xs block">
                                ({formatMoney(draftVat, order.currency)})
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <label className="inline-flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={!!item.isFromStock}
                                  disabled={!canEditOrderLines || itemSavingId === item.id}
                                  onChange={(e) =>
                                    void updateItemSource(item.id, {
                                      isFromStock: e.target.checked,
                                      ...(e.target.checked
                                        ? { supplierId: null, supplierOrderNo: null }
                                        : {}),
                                    })
                                  }
                                />
                                Stoktan
                              </label>
                            </td>
                            <td className="px-3 py-2.5">
                              <select
                                value={item.supplierId || ''}
                                disabled={!!item.isFromStock || itemSavingId === item.id || !canEditOrderLines}
                                onChange={(e) =>
                                  void updateItemSource(item.id, {
                                    supplierId: e.target.value || null,
                                  })
                                }
                                className="px-2 py-1.5 rounded border border-gray-200 text-xs min-w-[150px] disabled:bg-gray-100"
                              >
                                <option value="">Tedarikçi seç</option>
                                {suppliers.map((s) => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2.5">
                              <input
                                key={item.supplierOrderNo ?? 'empty'}
                                defaultValue={item.supplierOrderNo || ''}
                                disabled={!!item.isFromStock || itemSavingId === item.id || !canEditOrderLines}
                                onBlur={(e) =>
                                  void updateItemSource(item.id, {
                                    supplierOrderNo: e.target.value || null,
                                  })
                                }
                                placeholder="Sipariş no"
                                className="px-2 py-1.5 rounded border border-gray-200 text-xs min-w-[140px] disabled:bg-gray-100"
                              />
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                              {formatMoney(editable ? draftLineTotal : item.lineTotal, order.currency)}
                            </td>
                            {canEditOrderLines ? (
                              <td className="px-3 py-2.5">
                                <button
                                  type="button"
                                  disabled={itemSavingId === item.id || !d}
                                  onClick={() => void saveOrderLine(item.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-whatsapp text-white text-xs font-medium hover:bg-green-600 disabled:opacity-50"
                                >
                                  {itemSavingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Kaydet'}
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={canEditOrderLines ? 13 : 12} className="px-3 py-8 text-center text-gray-400 text-sm">
                          Kalem yok
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Ödeme / tahsilat paneli */}
            <div className="rounded-xl border border-emerald-100 bg-white overflow-hidden shadow-sm">
              <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 bg-gradient-to-r from-emerald-50 to-emerald-50/40 border-b border-emerald-100">
                <h3 className="text-xs font-bold text-emerald-900 uppercase tracking-wide flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-emerald-700" />
                  Tahsilat & Ödeme
                  {order.isFullyPaid ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800 uppercase tracking-wide">
                      <CheckCircle2 className="w-3 h-3" />
                      Ödendi
                    </span>
                  ) : null}
                </h3>
                <div className="flex gap-2 flex-wrap">
                  {order.remainingTotal && order.remainingTotal > 0 ? (
                    <button
                      type="button"
                      onClick={() => openPaymentForm(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-whatsapp text-white text-xs font-semibold hover:bg-green-600"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Kalanı tam tahsil et
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openPaymentForm(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tahsilat / İade ekle
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Toplam</div>
                  <div className="text-base font-semibold text-gray-900 tabular-nums mt-0.5">
                    {formatMoney(order.grandTotal, order.currency)}
                  </div>
                </div>
                <div className="rounded-lg border border-green-100 bg-green-50/60 p-3">
                  <div className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">Tahsil edilen</div>
                  <div className="text-base font-semibold text-green-800 tabular-nums mt-0.5">
                    {formatMoney(order.paidTotal ?? 0, order.currency)}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                  <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">İade</div>
                  <div className="text-base font-semibold text-amber-800 tabular-nums mt-0.5">
                    {formatMoney(order.refundedTotal ?? 0, order.currency)}
                  </div>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    (order.remainingTotal ?? 0) > 0
                      ? 'border-red-100 bg-red-50/60'
                      : 'border-green-100 bg-green-50/80'
                  }`}
                >
                  <div
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      (order.remainingTotal ?? 0) > 0 ? 'text-red-700' : 'text-green-700'
                    }`}
                  >
                    Kalan bakiye
                  </div>
                  <div
                    className={`text-base font-semibold tabular-nums mt-0.5 ${
                      (order.remainingTotal ?? 0) > 0 ? 'text-red-800' : 'text-green-800'
                    }`}
                  >
                    {formatMoney(Math.max(0, order.remainingTotal ?? 0), order.currency)}
                  </div>
                </div>
              </div>

              {order.payments?.length ? (
                <div className="rounded-lg border border-gray-100 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-left text-gray-500 uppercase text-[10px] font-semibold">
                        <th className="px-3 py-2">Tarih</th>
                        <th className="px-3 py-2">Yöntem</th>
                        <th className="px-3 py-2">Açıklama / Ref</th>
                        <th className="px-3 py-2">Kaydeden</th>
                        <th className="px-3 py-2 text-right">Tutar</th>
                        {canDeletePayment ? <th className="px-3 py-2 w-10" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {order.payments.map((p) => (
                        <tr key={p.id} className="border-t border-gray-50">
                          <td className="px-3 py-2 whitespace-nowrap text-gray-700">{formatDateTime(p.occurredAt)}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
                                p.direction === 'INCOME'
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {paymentMethodIcon(p.method)}
                              {PAYMENT_METHOD_LABELS[p.method]}
                              {p.direction === 'EXPENSE' ? ' · İade' : ''}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <div>{p.description}</div>
                            {p.reference ? (
                              <div className="text-[11px] text-gray-400">Ref: {p.reference}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{p.user?.name ?? '—'}</td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums font-semibold ${
                              p.direction === 'INCOME' ? 'text-green-700' : 'text-amber-700'
                            }`}
                          >
                            {p.direction === 'INCOME' ? '+' : '−'}
                            {formatMoney(p.amount, order.currency)}
                          </td>
                          {canDeletePayment ? (
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                disabled={paymentDeletingId === p.id}
                                onClick={() => void removePayment(p.id)}
                                className="text-gray-400 hover:text-red-600 disabled:opacity-40"
                                title="Tahsilatı sil"
                              >
                                {paymentDeletingId === p.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-gray-500 italic">Henüz tahsilat kaydı yok.</p>
              )}
              </div>
            </div>

            <div className="rounded-xl border border-teal-100 bg-white overflow-hidden shadow-sm">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-50 to-teal-50/40 border-b border-teal-100">
                <Calendar className="w-4 h-4 text-teal-700" />
                <h3 className="text-xs font-bold text-teal-900 uppercase tracking-wide">Sipariş Notları ve Teslimat</h3>
              </div>
              <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-gray-500 uppercase">Planlanan teslim</label>
                  <input
                    type="date"
                    value={expectedDeliveryDraft}
                    onChange={(e) => setExpectedDeliveryDraft(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-gray-500 uppercase">Sevk adresi</label>
                  <textarea
                    value={shippingDraft}
                    onChange={(e) => setShippingDraft(e.target.value)}
                    rows={2}
                    placeholder="Sevk adresi"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-gray-500 uppercase">Notlar</label>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Siparişle ilgili notlar"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={metaSaving || statusSaving}
                onClick={() => void saveOrderMeta()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm"
              >
                {metaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Bilgileri kaydet
              </button>
              </div>
            </div>
              </div>

              <aside className="space-y-4">
                <div className="rounded-xl border border-blue-100 bg-white overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-blue-50/40 border-b border-blue-100">
                    <Package className="w-4 h-4 text-blue-700" />
                    <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wide">Sipariş Bilgileri</h3>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="space-y-1">
                      <label htmlFor="order-status" className="text-[11px] font-semibold text-gray-500 uppercase">Durum</label>
                      <select
                        id="order-status"
                        value={order.status}
                        disabled={statusSaving}
                        onChange={(e) => void patchStatus(e.target.value as OrderStatus)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white"
                      >
                        {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </div>
                    <dl className="text-xs space-y-1.5">
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-500">Sipariş no</dt>
                        <dd className="font-mono font-semibold text-gray-900">{formatOrderNo(order.orderNumber)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-500">Oluşturulma</dt>
                        <dd className="text-gray-700">{formatDateTime(order.createdAt)}</dd>
                      </div>
                      {order.expectedDeliveryDate ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-gray-500">Planlanan teslim</dt>
                          <dd className="text-gray-700">{new Date(order.expectedDeliveryDate).toLocaleDateString('tr-TR')}</dd>
                        </div>
                      ) : null}
                      {order.quote ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-gray-500">Teklif</dt>
                          <dd className="font-mono font-medium text-gray-700">{formatQuoteNo(order.quote.quoteNumber)}</dd>
                        </div>
                      ) : null}
                      {order.createdBy?.name ? (
                        <div className="flex justify-between gap-2">
                          <dt className="text-gray-500">Oluşturan</dt>
                          <dd className="text-gray-700">{order.createdBy.name}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                </div>

                <div className="rounded-xl border border-whatsapp/30 bg-white overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-whatsapp/10 to-whatsapp/5 border-b border-whatsapp/20">
                    <Wallet className="w-4 h-4 text-whatsapp" />
                    <h3 className="text-xs font-bold text-green-900 uppercase tracking-wide">Sipariş Özeti</h3>
                  </div>
                  <div className="p-4 space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Ara toplam</span>
                      <span className="tabular-nums font-medium text-gray-800">{formatMoney(order.subtotal ?? 0, order.currency)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">KDV</span>
                      <span className="tabular-nums font-medium text-gray-800">{formatMoney(order.vatTotal ?? 0, order.currency)}</span>
                    </div>
                    <div className="flex justify-between items-baseline pt-2 mt-1 border-t border-gray-100">
                      <span className="text-sm text-gray-700 font-semibold">Genel toplam</span>
                      <span className="tabular-nums font-bold text-whatsapp text-lg">{formatMoney(order.grandTotal, order.currency)}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-purple-100 bg-white overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-50 to-purple-50/40 border-b border-purple-100">
                    <User className="w-4 h-4 text-purple-700" />
                    <h3 className="text-xs font-bold text-purple-900 uppercase tracking-wide">Müşteri</h3>
                  </div>
                  <div className="p-4 space-y-1.5">
                    <p className="text-sm font-semibold text-gray-900">{contactDisplayName(order.contact)}</p>
                    <p className="text-xs text-gray-500">{formatPhone(order.contact.phone)}</p>
                    {order.contact.company ? (
                      <p className="text-xs text-gray-700">{order.contact.company}</p>
                    ) : null}
                    {order.contact.email ? (
                      <p className="text-xs text-gray-600 break-all">{order.contact.email}</p>
                    ) : null}
                    {order.contact.taxOffice || order.contact.taxNumber ? (
                      <p className="text-xs text-gray-600 pt-1 border-t border-gray-50">
                        <span className="text-gray-400">VD:</span> {order.contact.taxOffice || '—'} · <span className="text-gray-400">VN:</span> {order.contact.taxNumber || '—'}
                      </p>
                    ) : null}
                  </div>
                </div>

                {order.contact.billingAddress || order.shippingAddress ? (
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-50 to-slate-50/40 border-b border-slate-200">
                      <MapPin className="w-4 h-4 text-slate-700" />
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Adresler</h3>
                    </div>
                    <div className="p-4 space-y-2.5">
                      {order.contact.billingAddress ? (
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Fatura</p>
                          <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{order.contact.billingAddress}</p>
                        </div>
                      ) : null}
                      {order.shippingAddress ? (
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Sevk</p>
                          <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{order.shippingAddress}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {order.source === 'TSOFT' || order.externalId || order.tsoftSiteOrderId || order.pushToTsoft ? (
                  <div className="rounded-xl border border-amber-200 bg-white overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-50 to-amber-50/40 border-b border-amber-200">
                      <Store className="w-4 h-4 text-amber-700" />
                      <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wide">E-ticaret / T-Soft</h3>
                    </div>
                    <div className="p-4 space-y-1">
                      <p className="text-xs text-gray-700">
                        <span className="text-gray-500">Kaynak:</span>{' '}
                        <span className="font-medium">{order.source || 'MANUAL'}</span>
                      </p>
                      {order.tsoftSiteOrderId ? (
                        <p className="text-xs font-mono text-gray-700">
                          <span className="text-gray-500 font-sans">Site OrderId:</span> {order.tsoftSiteOrderId}
                        </p>
                      ) : null}
                      {order.externalId ? (
                        <p className="text-xs font-mono break-all text-gray-700">
                          <span className="text-gray-500 font-sans">Harici ID:</span> {order.externalId}
                        </p>
                      ) : null}
                      {order.tsoftPushedAt ? (
                        <p className="text-xs text-emerald-700">İtildi: {formatDateTime(order.tsoftPushedAt)}</p>
                      ) : null}
                      {order.tsoftLastError ? (
                        <p className="text-[11px] text-red-700 whitespace-pre-wrap break-words">{order.tsoftLastError}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-xl border border-rose-100 bg-white overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-50 to-rose-50/40 border-b border-rose-100">
                    <FileText className="w-4 h-4 text-rose-700" />
                    <h3 className="text-xs font-bold text-rose-900 uppercase tracking-wide">Sipariş Onay PDF’i</h3>
                  </div>
                  <div className="p-4 flex flex-wrap items-center gap-2">
                    {order.confirmationPdfUrl ? (
                      <a
                        href={`${backendPublicUrl()}${order.confirmationPdfUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-whatsapp hover:underline"
                      >
                        <ExternalLink className="w-4 h-4" />
                        PDF’yi aç
                      </a>
                    ) : (
                      <span className="text-xs text-amber-700">Henüz PDF yok.</span>
                    )}
                    {canRegenerateOrderPdf ? (
                      <button
                        type="button"
                        disabled={pdfRegenLoading}
                        onClick={() => void regenerateOrderPdf()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700"
                      >
                        {pdfRegenLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                        PDF yenile
                      </button>
                    ) : null}
                  </div>
                </div>
              </aside>
            </div>

            {order.siteOrderData ? (
              <SiteOrderDetailsPanel data={order.siteOrderData} />
            ) : null}
          </div>

          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/40 flex flex-col sm:flex-row gap-2 sm:justify-end">
            {canDeleteOrder && order.status === 'PENDING' && !order.invoice ? (
              <button
                type="button"
                onClick={() => void removeOrder()}
                className="inline-flex items-center px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-sm font-medium text-red-700 sm:mr-auto gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Siparişi sil
              </button>
            ) : null}
            <input
              type="date"
              value={invoiceDueDraft}
              onChange={(e) => setInvoiceDueDraft(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
            />
            <button
              type="button"
              disabled={invoiceSaving || order.status === 'CANCELLED'}
              onClick={() => void createInvoiceFromOrder()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-medium disabled:opacity-50"
            >
              {invoiceSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Fatura Oluştur
            </button>
          </div>
        </div>
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
