'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { backendPublicUrl, formatPhone, rewriteMediaUrlForClient } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  FileText,
  Loader2,
  Package,
  Trash2,
  User,
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
  colorFabricInfo?: string | null;
  measurementInfo?: string | null;
  product?: { id: string; sku: string; name: string; imageUrl?: string | null } | null;
  supplierId?: string | null;
  supplierOrderNo?: string | null;
  isFromStock?: boolean;
  supplier?: { id: string; name: string } | null;
}

interface SalesOrder {
  id: string;
  orderNumber: number;
  externalId?: string | null;
  source?: string;
  status: OrderStatus;
  currency: string;
  grandTotal: number;
  shippingAddress: string | null;
  notes: string | null;
  expectedDeliveryDate?: string | null;
  createdAt: string;
  panelEditedAt?: string | null;
  invoice?: { id: string } | null;
  createdBy?: { id: string; name: string | null } | null;
  contact: { name: string | null; surname: string | null; phone: string };
  quote: { id: string; quoteNumber: number } | null;
  items: OrderItemRow[];
  confirmationPdfUrl?: string | null;
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
};

function lineVatAmount(item: OrderItemRow) {
  const gross = item.lineTotal;
  const divider = 1 + (item.vatRate / 100);
  const net = divider > 0 ? gross / divider : gross;
  return Math.round((gross - net) * 100) / 100;
}

function draftLineVatAmount(d: LineEditDraft) {
  const gross = d.quantity * d.unitPrice;
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
      });
      await fetchOrder();
      toast.success('Kalem kaydedildi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kalem kaydedilemedi'));
    } finally {
      setItemSavingId(null);
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
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              <div className="flex-1 space-y-1">
                <label htmlFor="order-status" className="text-xs font-semibold text-gray-500 uppercase">
                  Sipariş durumu
                </label>
                <select
                  id="order-status"
                  value={order.status}
                  disabled={statusSaving}
                  onChange={(e) => void patchStatus(e.target.value as OrderStatus)}
                  className="w-full sm:max-w-xs px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white"
                >
                  {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div className="text-sm">
                <span className="text-gray-400 text-xs block">Genel toplam</span>
                <span className="font-semibold text-whatsapp tabular-nums">
                  {formatMoney(order.grandTotal, order.currency)}
                </span>
              </div>
            </div>

            {order.quote ? (
              <p className="text-xs text-gray-500">
                Teklif: <span className="font-mono font-medium text-gray-700">{formatQuoteNo(order.quote.quoteNumber)}</span>
              </p>
            ) : null}

            <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <Calendar className="w-4 h-4 text-whatsapp" />
                Tarih ve adres
              </div>
              <input
                type="date"
                value={expectedDeliveryDraft}
                onChange={(e) => setExpectedDeliveryDraft(e.target.value)}
                className="w-full max-w-xs px-3 py-2 rounded-xl border border-gray-200 text-sm"
              />
              <textarea
                value={shippingDraft}
                onChange={(e) => setShippingDraft(e.target.value)}
                rows={2}
                placeholder="Sevk adresi"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
              />
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={2}
                placeholder="Notlar"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
              />
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

            <div className="rounded-xl border border-gray-100 bg-white p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-800">Sipariş onay PDF’i</h3>
              <div className="flex flex-wrap items-center gap-2">
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

            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Kalemler</h3>
                {canEditOrderLines ? (
                  <p className="text-xs text-gray-500">
                    Ürün, miktar, fiyat ve renk/ölçü alanlarını düzenleyip <strong>Kaydet</strong> ile kaydedin. Genel toplam otomatik güncellenir.
                  </p>
                ) : order.invoice ? (
                  <p className="text-xs text-amber-700">Faturalı siparişte kalem içeriği değiştirilemez.</p>
                ) : order.status === 'DELIVERED' || order.status === 'CANCELLED' ? (
                  <p className="text-xs text-gray-500">Bu durumda kalem düzenlenemez.</p>
                ) : null}
              </div>
              <div className="rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead>
                    <tr className="bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2.5 w-16">Görsel</th>
                      <th className="px-3 py-2.5 min-w-[120px]">Ürün</th>
                      <th className="px-3 py-2.5 min-w-[100px]">Renk/Kumaş</th>
                      <th className="px-3 py-2.5 min-w-[100px]">Ölçü</th>
                      <th className="px-3 py-2.5 text-right w-20">Miktar</th>
                      <th className="px-3 py-2.5 text-right min-w-[90px]">Birim fiyat</th>
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
                        const draftLineTotal = editable ? d.quantity * d.unitPrice : item.lineTotal;
                        return (
                          <tr key={item.id} className="border-t border-gray-50 align-top">
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
                              {editable ? (
                                <input
                                  value={d.name}
                                  onChange={(e) => updateLineDraft(item.id, { name: e.target.value })}
                                  className="w-full px-2 py-1.5 rounded border border-gray-200 text-sm"
                                />
                              ) : (
                                item.name
                              )}
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
                                formatMoney(item.unitPrice, order.currency)
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
                        <td colSpan={canEditOrderLines ? 12 : 11} className="px-3 py-8 text-center text-gray-400 text-sm">
                          Kalem yok
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
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
    </div>
  );
}
