'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone, backendPublicUrl, rewriteMediaUrlForClient } from '@/lib/utils';
import {
  ArrowLeft,
  FileText,
  Send,
  ShoppingCart,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
  Calendar,
  X,
  Search,
  Package,
  Edit3,
  Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import { QuoteEmbeddedChat } from '@/components/quotes/QuoteEmbeddedChat';

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

const CURRENCY: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Taslak', cls: 'bg-gray-100 text-gray-600' },
  SENT: { label: 'Gönderildi', cls: 'bg-blue-50 text-blue-600' },
  ACCEPTED: { label: 'Kabul Edildi', cls: 'bg-green-50 text-green-600' },
  REJECTED: { label: 'Reddedildi', cls: 'bg-red-50 text-red-600' },
  EXPIRED: { label: 'Süresi Doldu', cls: 'bg-amber-50 text-amber-600' },
};

type PaymentModeUI = 'FULL' | 'DEPOSIT_50';
type DiscountType = 'PERCENT' | 'AMOUNT';
type OrderPaymentModeUI = 'FULL' | 'DEPOSIT_50' | 'CUSTOM';

const LINE_VAT_OPTIONS = [0, 1, 10, 20] as const;

interface LocalLineItem {
  key: string;
  productId?: string;
  productVariantId?: string;
  lineImageUrl?: string;
  name: string;
  description?: string;
  colorFabricInfo?: string;
  measurementInfo?: string;
  quantity: number;
  unitPrice: number;
  applyDiscount: boolean;
  discountType: DiscountType;
  discountValue: number;
}

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  unitPrice: number;
  vatRate: number;
  currency?: string;
  imageUrl?: string | null;
}

interface SupplierHit {
  id: string;
  name: string;
}

type ConvertSource = 'STOCK' | 'SUPPLIER' | 'EXISTING_CUSTOMER';

interface ConvertItemSource {
  quoteItemId: string;
  source: ConvertSource;
  supplierId: string;
  supplierOrderNo: string;
}

function currencySymbol(c: string): string {
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  return '₺';
}

function measurementHintFromVariantMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const m = metadata as Record<string, unknown>;
  const t2 = typeof m.type2 === 'string' ? m.type2.trim() : '';
  const title = typeof m.title === 'string' ? m.title.trim() : '';
  return t2 || title || '';
}

function calcTotals(
  items: LocalLineItem[],
  discountType: DiscountType,
  discountValue: number,
  lineVatRate: number,
) {
  let netSubtotalBeforeGeneralDiscount = 0;
  let vatTotalBeforeGeneralDiscount = 0;
  let grossSubtotalBeforeGeneralDiscount = 0;
  const calculated = items.map((item) => {
    const lineGross = item.quantity * item.unitPrice;
    let lineDiscount = 0;
    if (item.discountValue && item.discountValue > 0) {
      lineDiscount =
        item.discountType === 'AMOUNT'
          ? item.discountValue
          : lineGross * (item.discountValue / 100);
    }
    const grossAfterLineDiscount = Math.max(0, lineGross - lineDiscount);
    const divider = 1 + (lineVatRate / 100);
    const lineNet = divider > 0 ? grossAfterLineDiscount / divider : grossAfterLineDiscount;
    const lineVat = grossAfterLineDiscount - lineNet;
    netSubtotalBeforeGeneralDiscount += lineNet;
    vatTotalBeforeGeneralDiscount += lineVat;
    grossSubtotalBeforeGeneralDiscount += grossAfterLineDiscount;
    const lineTotal = Math.round(grossAfterLineDiscount * 100) / 100;
    return { ...item, lineTotal };
  });

  let discountTotal = 0;
  if (discountValue > 0) {
    discountTotal =
      discountType === 'AMOUNT' ? discountValue : grossSubtotalBeforeGeneralDiscount * (discountValue / 100);
  }
  const grossAfterGeneralDiscount = Math.max(0, grossSubtotalBeforeGeneralDiscount - discountTotal);
  const discountRatio =
    grossSubtotalBeforeGeneralDiscount > 0
      ? grossAfterGeneralDiscount / grossSubtotalBeforeGeneralDiscount
      : 1;
  const adjustedNet = netSubtotalBeforeGeneralDiscount * discountRatio;
  const adjustedVat = vatTotalBeforeGeneralDiscount * discountRatio;
  const grandTotal = Math.round(grossAfterGeneralDiscount * 100) / 100;

  return {
    lineTotals: calculated.map((c) => c.lineTotal),
    subtotal: Math.round(adjustedNet * 100) / 100,
    discountTotal: Math.round(discountTotal * 100) / 100,
    vatTotal: Math.round(adjustedVat * 100) / 100,
    grandTotal,
  };
}

function genKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyLine(): LocalLineItem {
  return {
    key: genKey(),
    name: '',
    colorFabricInfo: '',
    measurementInfo: '',
    quantity: 1,
    unitPrice: 0,
    applyDiscount: false,
    discountType: 'PERCENT',
    discountValue: 0,
  };
}

export default function QuoteDetailPage() {
  const { user } = useAuthStore();
  const canConvertToOrder =
    user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ACCOUNTANT';
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [lines, setLines] = useState<LocalLineItem[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENT');
  const [discountValue, setDiscountValue] = useState(0);
  const [currency, setCurrency] = useState('TRY');
  const [validUntil, setValidUntil] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [termsOverride, setTermsOverride] = useState('');
  const [footerNoteOverride, setFooterNoteOverride] = useState('');
  const [documentKind, setDocumentKind] = useState<'PROFORMA' | 'QUOTE'>('PROFORMA');
  const [grandTotalOverride, setGrandTotalOverride] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [lineVatRate, setLineVatRate] = useState(20);

  // Product search
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductHit[]>([]);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const productDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [variantPick, setVariantPick] = useState<{
    product: ProductHit;
    variants: { id: string; name: string; unitPrice: number; vatRate: number; metadata?: unknown }[];
  } | null>(null);

  // Accept modal
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [acceptPaymentMode, setAcceptPaymentMode] = useState<PaymentModeUI>('FULL');

  // WhatsApp gönderim onay modalı
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertManual, setConvertManual] = useState(false);
  const [convertItemSources, setConvertItemSources] = useState<ConvertItemSource[]>([]);
  const [convertPaymentMode, setConvertPaymentMode] = useState<OrderPaymentModeUI>('FULL');
  const [convertCustomPaymentValue, setConvertCustomPaymentValue] = useState<string>('');
  const [suppliers, setSuppliers] = useState<SupplierHit[]>([]);

  const sym = currencySymbol(currency);

  const totals = useMemo(
    () => calcTotals(lines, discountType, discountValue, lineVatRate),
    [lines, discountType, discountValue, lineVatRate],
  );

  const displayGrandTotal = grandTotalOverride && parseFloat(grandTotalOverride) > 0 
    ? parseFloat(grandTotalOverride) 
    : totals.grandTotal;

  const fetchQuote = async () => {
    try {
      const { data } = await api.get(`/quotes/${id}`);
      setQuote(data);
      initFormFromQuote(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Teklif yüklenemedi'));
    } finally {
      setLoading(false);
    }
  };

  const initFormFromQuote = (q: any) => {
    const rawItems = q.items || [];
    const rateSet = Array.from(
      new Set(rawItems.map((it: any) => Number(it.vatRate ?? 0))),
    ) as number[];
    setLineVatRate(rateSet.length === 1 ? rateSet[0]! : 20);
    setLines(
      rawItems.map((it: any) => ({
        key: String(it.id),
        productId: it.productId || undefined,
        productVariantId: it.productVariantId || undefined,
        lineImageUrl: it.lineImageUrl || undefined,
        name: String(it.name || ''),
        description: it.description || undefined,
        colorFabricInfo: it.colorFabricInfo != null ? String(it.colorFabricInfo) : '',
        measurementInfo: it.measurementInfo != null ? String(it.measurementInfo) : '',
        quantity: Number(it.quantity || 0),
        unitPrice: Number(it.unitPrice || 0),
        applyDiscount: Number(it.discountValue || 0) > 0,
        discountType: (it.discountType || 'PERCENT') as DiscountType,
        discountValue: Number(it.discountValue || 0),
      })),
    );
    setDiscountType((q.discountType || 'PERCENT') as DiscountType);
    setDiscountValue(Number(q.discountValue || 0));
    setCurrency(q.currency || 'TRY');
    setValidUntil(toDateInputValue(q.validUntil));
    setDeliveryDate(toDateInputValue(q.deliveryDate));
    setNotes(q.notes != null ? String(q.notes) : '');
    setTermsOverride(q.termsOverride != null ? String(q.termsOverride) : '');
    setFooterNoteOverride(q.footerNoteOverride != null ? String(q.footerNoteOverride) : '');
    setDocumentKind(q.documentKind === 'QUOTE' ? 'QUOTE' : 'PROFORMA');
    setGrandTotalOverride(q.grandTotalOverride ? String(q.grandTotalOverride) : '');
  };

  useEffect(() => {
    void fetchQuote();
    return () => {
      clearTimeout(productDebounceRef.current);
    };
  }, [id]);

  useEffect(() => {
    api
      .get('/suppliers', { params: { isActive: true, limit: 200 } })
      .then(({ data }) => setSuppliers(data.suppliers || []))
      .catch(() => setSuppliers([]));
  }, []);

  const searchProducts = useCallback(async (q: string) => {
    if (q.length < 1) {
      setProductResults([]);
      return;
    }
    try {
      const { data } = await api.get('/products', { params: { search: q, limit: 12, page: 1 } });
      setProductResults(data.products || []);
    } catch {
      setProductResults([]);
    }
  }, []);

  const handleProductSearch = (val: string) => {
    setProductQuery(val);
    setProductDropdownOpen(true);
    clearTimeout(productDebounceRef.current);
    productDebounceRef.current = setTimeout(() => searchProducts(val), 300);
  };

  const finalizeProductLine = (
    p: ProductHit,
    variant?: { id: string; name: string; unitPrice: number; metadata?: unknown },
  ) => {
    const measureHint = variant ? measurementHintFromVariantMetadata(variant.metadata) : '';
    setLines((prev) => [
      ...prev,
      {
        key: genKey(),
        productId: p.id,
        productVariantId: variant?.id,
        lineImageUrl: p.imageUrl || undefined,
        name: variant ? variant.name : String(p.name ?? ''),
        description: p.description || undefined,
        colorFabricInfo: '',
        measurementInfo: measureHint,
        quantity: 1,
        unitPrice: variant ? variant.unitPrice : p.unitPrice,
        applyDiscount: false,
        discountType: 'PERCENT',
        discountValue: 0,
      },
    ]);
    toast.success('Ürün satıra eklendi');
  };

  const onPickProductFromSearch = async (p: ProductHit) => {
    try {
      const { data } = await api.get(`/products/${p.id}/variants`);
      const vars = Array.isArray(data) ? data : [];
      if (vars.length === 0) {
        finalizeProductLine(p);
        setProductQuery('');
        setProductResults([]);
        setProductDropdownOpen(false);
        return;
      }
      setVariantPick({ product: p, variants: vars });
      setProductQuery('');
      setProductResults([]);
      setProductDropdownOpen(false);
    } catch {
      finalizeProductLine(p);
      setProductQuery('');
      setProductResults([]);
      setProductDropdownOpen(false);
    }
  };

  const updateLine = (key: string, patch: Partial<LocalLineItem>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? [emptyLine()] : prev.filter((l) => l.key !== key)));
  };

  const handleSave = async () => {
    const validLines = lines.filter((l) => String(l.name ?? '').trim() !== '');
    if (!validLines.length) {
      toast.error('En az bir ürün satırı ekleyin');
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.patch(`/quotes/${id}`, {
        currency,
        discountType,
        discountValue,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
        notes: notes.trim() || null,
        termsOverride: termsOverride.trim() || null,
        footerNoteOverride: footerNoteOverride.trim() || null,
        documentKind,
        colorFabricInfo: null,
        measurementInfo: null,
        grandTotalOverride: grandTotalOverride && parseFloat(grandTotalOverride) > 0 
          ? parseFloat(grandTotalOverride) 
          : null,
        items: validLines.map((l) => ({
          productId: l.productId || undefined,
          productVariantId: l.productVariantId || undefined,
          lineImageUrl: l.lineImageUrl?.trim() || undefined,
          name: String(l.name ?? '').trim(),
          description: l.description || undefined,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: Math.round(lineVatRate),
          discountType: l.applyDiscount ? l.discountType : 'PERCENT',
          discountValue: l.applyDiscount ? l.discountValue || 0 : 0,
          colorFabricInfo: String(l.colorFabricInfo ?? '').trim() || null,
          measurementInfo: String(l.measurementInfo ?? '').trim() || null,
        })),
      });
      setQuote(data);
      initFormFromQuote(data);
      setEditMode(false);
      toast.success('Teklif güncellendi');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Güncelleme başarısız'));
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      if (action === 'generate-pdf') {
        const { data } = await api.post(`/quotes/${id}/generate-pdf`);
        toast.success('PDF oluşturuldu');
        setQuote((q: any) => ({ ...q, pdfUrl: data.pdfUrl }));
      } else if (action === 'send') {
        await api.post(`/quotes/${id}/send`, {});
        toast.success('Teklif WhatsApp ile gönderildi');
        void fetchQuote();
      } else if (action === 'reject') {
        await api.patch(`/quotes/${id}/status`, { status: 'REJECTED' });
        toast.success('Teklif reddedildi');
        void fetchQuote();
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'İşlem başarısız'));
    } finally {
      setActionLoading('');
    }
  };

  const openConvertModal = (manual: boolean) => {
    const initial = (quote?.items || []).map((item: any) => ({
      quoteItemId: String(item.id),
      source: 'STOCK' as const,
      supplierId: '',
      supplierOrderNo: '',
    }));
    setConvertManual(manual);
    setConvertPaymentMode('FULL');
    setConvertCustomPaymentValue('');
    setConvertItemSources(initial);
    setShowConvertModal(true);
  };

  const updateConvertSource = (quoteItemId: string, patch: Partial<ConvertItemSource>) => {
    setConvertItemSources((prev) =>
      prev.map((x) => {
        if (x.quoteItemId !== quoteItemId) return x;
        const next = { ...x, ...patch };
        if (patch.source === 'STOCK') {
          next.supplierId = '';
          next.supplierOrderNo = '';
        }
        if (patch.source === 'EXISTING_CUSTOMER') {
          next.supplierId = '';
        }
        return next;
      }),
    );
  };

  const submitConvert = async () => {
    for (const src of convertItemSources) {
      const item = (quote?.items || []).find((x: any) => String(x.id) === src.quoteItemId);
      const itemName = item?.name || 'Kalem';
      if (src.source === 'SUPPLIER' && (!src.supplierId || !src.supplierOrderNo.trim())) {
        toast.error(`${itemName} için tedarikçi ve sipariş no zorunlu`);
        return;
      }
      if (src.source === 'EXISTING_CUSTOMER' && !src.supplierOrderNo.trim()) {
        toast.error(`${itemName} için eski müşteri referansı zorunlu`);
        return;
      }
    }
    if (
      convertPaymentMode === 'CUSTOM' &&
      (!(Number(convertCustomPaymentValue) > 0) || Number(convertCustomPaymentValue) > 100)
    ) {
      toast.error('Özel ödeme yüzdesi 0-100 arasında olmalıdır');
      return;
    }
    setActionLoading(convertManual ? 'convert-manual' : 'convert');
    try {
      await api.post(`/quotes/${id}/convert-to-order`, {
        manual: convertManual,
        payment: {
          mode: convertPaymentMode,
          customValue:
            convertPaymentMode === 'CUSTOM' ? Number(convertCustomPaymentValue) || undefined : undefined,
        },
        itemSources: convertItemSources.map((src) => ({
          quoteItemId: src.quoteItemId,
          source: src.source,
          supplierId: src.source === 'SUPPLIER' ? src.supplierId || undefined : undefined,
          supplierOrderNo:
            src.source === 'STOCK' ? undefined : src.supplierOrderNo.trim() || undefined,
        })),
      });
      toast.success(convertManual ? 'Teklif manuel olarak siparişe çevrildi' : 'Sipariş oluşturuldu');
      setShowConvertModal(false);
      router.push('/orders');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'İşlem başarısız'));
    } finally {
      setActionLoading('');
    }
  };

  const confirmAccept = async () => {
    setActionLoading('accept');
    try {
      await api.patch(`/quotes/${id}/status`, {
        status: 'ACCEPTED',
        paymentMode: acceptPaymentMode,
        documentKind,
      });
      toast.success('Teklif kabul edildi');
      setShowAcceptModal(false);
      void fetchQuote();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kabul başarısız'));
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
      </div>
    );
  }
  if (!quote) return <div className="p-6 text-gray-500">Teklif bulunamadı</div>;

  const cs = CURRENCY[quote.currency] || quote.currency;
  const badge = STATUS_BADGE[quote.status] || STATUS_BADGE.DRAFT;
  const fmt = (v: number) => `${cs} ${v.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
  const fmtNum = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const c = quote.contact || {};
  const pdfBase = backendPublicUrl();
  const halfDeposit = Math.round((quote.grandTotal * 0.5) * 100) / 100;

  if (editMode) {
    return (
      <div className="p-4 md:p-8 max-w-[1920px] mx-auto pb-28">
        {variantPick && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3">
              <h3 className="text-sm font-bold text-gray-900">Varyant seçin</h3>
              <p className="text-xs text-gray-500 line-clamp-2">{variantPick.product.name}</p>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {variantPick.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      finalizeProductLine(variantPick.product, v);
                      setVariantPick(null);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg border border-gray-100 hover:bg-green-50 text-sm"
                  >
                    <span className="font-medium text-gray-900">{v.name}</span>
                    <span className="text-xs text-gray-500 ml-2 tabular-nums">
                      {sym}
                      {v.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setVariantPick(null)}
                className="w-full py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-4 mb-8 rounded-2xl border border-gray-100 bg-white/90 shadow-sm px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={() => {
              setEditMode(false);
              initFormFromQuote(quote);
            }}
            className="p-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
            aria-label="Geri"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              TKL-{String(quote.quoteNumber).padStart(5, '0')} - Düzenle
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {[c.name, c.surname].filter(Boolean).join(' ') || formatPhone(c.phone)}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 xl:gap-6 items-start">
          <aside className="xl:col-span-3 space-y-2 order-2 xl:order-1">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sohbet</h3>
            <QuoteEmbeddedChat contactId={c.id} contactPhone={c.phone} />
          </aside>
          <div className="xl:col-span-6 space-y-6 order-1 xl:order-2 min-w-0">
            {/* Ürün arama */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-whatsapp" />
                Ürün ekle
              </h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Ürün adı veya SKU ile ara…"
                  value={productQuery}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  onFocus={() => productQuery.length >= 1 && setProductDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setProductDropdownOpen(false), 200)}
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp"
                />
                {productDropdownOpen && productResults.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                    {productResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={() => void onPickProductFromSearch(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-green-50/60 border-b border-gray-50 last:border-0"
                      >
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Satırlar */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Kalemler</h2>
                <button
                  type="button"
                  onClick={() => setLines((p) => [...p, emptyLine()])}
                  className="text-xs font-semibold text-whatsapp hover:text-green-700"
                >
                  + Boş satır
                </button>
              </div>
              <div className="px-5 pt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <span className="font-medium text-gray-600 shrink-0">KDV oranı (tüm satırlar)</span>
                  <select
                    value={lineVatRate}
                    onChange={(e) => setLineVatRate(Number(e.target.value))}
                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-medium bg-white focus:outline-none focus:border-whatsapp"
                  >
                    {LINE_VAT_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        %{v}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[11px] text-gray-500 sm:flex-1 min-w-0">
                  Birim fiyat KDV dahil düzenlenir. Satır indirimi yalnızca işaretlenirse geçerlidir. Açıklama (sadece form) PDF’e yazdırılmaz.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead>
                    <tr className="bg-gray-50/90 text-gray-500 font-semibold uppercase tracking-wide text-[10px]">
                      <th className="text-left px-2 py-2 w-20 sm:w-24">Görsel</th>
                      <th className="text-left px-3 py-2 w-[18%]">Ürün</th>
                      <th className="text-left px-2 py-2 w-[12%]">Renk/Kumaş</th>
                      <th className="text-left px-2 py-2 w-[10%]">Ölçü</th>
                      <th className="text-left px-2 py-2 w-[14%]">Açıklama (sadece form)</th>
                      <th className="text-left px-2 py-2 w-16">Miktar</th>
                      <th className="text-left px-2 py-2 w-28">Birim (KDV dahil)</th>
                      <th className="text-left px-2 py-2 w-40">Satır indirimi</th>
                      <th className="text-right px-3 py-2 w-24">Satır Toplamı</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lines.map((line, idx) => (
                      <tr key={line.key} className="align-top">
                        <td className="px-2 py-2 w-16">
                          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden shrink-0">
                            {line.lineImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={rewriteMediaUrlForClient(line.lineImageUrl)}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="flex w-full h-full items-center justify-center text-[9px] text-gray-300">
                                —
                              </span>
                            )}
                          </div>
                          <input
                            type="url"
                            value={line.lineImageUrl || ''}
                            onChange={(e) => updateLine(line.key, { lineImageUrl: e.target.value || undefined })}
                            placeholder="Görsel URL"
                            className="mt-1 w-full px-1 py-0.5 border border-gray-100 rounded text-[10px] text-gray-600"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={line.name}
                            onChange={(e) => updateLine(line.key, { name: e.target.value })}
                            placeholder="Ürün adı"
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.colorFabricInfo ?? ''}
                            onChange={(e) =>
                              updateLine(line.key, { colorFabricInfo: e.target.value })
                            }
                            placeholder="Renk/kumaş"
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.measurementInfo ?? ''}
                            onChange={(e) =>
                              updateLine(line.key, { measurementInfo: e.target.value })
                            }
                            placeholder="Ölçü"
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.description || ''}
                            onChange={(e) => updateLine(line.key, { description: e.target.value })}
                            placeholder="Açıklama (PDF'e gitmez)"
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp bg-amber-50/50"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0.01}
                            step={0.01}
                            value={line.quantity}
                            onChange={(e) =>
                              updateLine(line.key, { quantity: parseFloat(e.target.value) || 0 })
                            }
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={line.unitPrice}
                            onChange={(e) =>
                              updateLine(line.key, { unitPrice: parseFloat(e.target.value) || 0 })
                            }
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2">
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <label className="inline-flex items-center gap-2 text-[11px] font-medium text-gray-700">
                            <input
                              type="checkbox"
                              checked={line.applyDiscount}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  applyDiscount: e.target.checked,
                                  ...(e.target.checked ? {} : { discountValue: 0, discountType: 'PERCENT' }),
                                })
                              }
                              className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp shrink-0"
                            />
                            İndirim uygula
                          </label>
                          {line.applyDiscount ? (
                            <div className="flex gap-1 items-center">
                              <select
                                value={line.discountType}
                                onChange={(e) =>
                                  updateLine(line.key, {
                                    discountType: e.target.value as DiscountType,
                                  })
                                }
                                className="w-14 shrink-0 px-1 py-1 border border-gray-200 rounded-lg text-[11px] font-medium bg-white"
                              >
                                <option value="PERCENT">%</option>
                                <option value="AMOUNT">TL</option>
                              </select>
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={line.discountValue}
                                onChange={(e) =>
                                  updateLine(line.key, {
                                    discountValue: parseFloat(e.target.value) || 0,
                                  })
                                }
                                className="min-w-0 flex-1 px-2 py-1 border border-gray-200 rounded-lg text-sm tabular-nums"
                              />
                            </div>
                          ) : null}
                        </div>
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-semibold text-gray-800 tabular-nums">
                          {sym}
                          {fmtNum(totals.lineTotals[idx] ?? 0)}
                        </td>
                        <td className="px-1 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                            title="Satırı sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* İndirim ve genel ayarlar */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Genel indirim tipi</label>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-whatsapp"
                >
                  <option value="PERCENT">Yüzde (%)</option>
                  <option value="AMOUNT">Tutar (TL)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Genel indirim değeri</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Para birimi</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-whatsapp"
                >
                  <option value="TRY">TRY (₺)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">PDF başlığı (belge türü)</label>
                <select
                  value={documentKind}
                  onChange={(e) => setDocumentKind(e.target.value as 'PROFORMA' | 'QUOTE')}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-whatsapp"
                >
                  <option value="PROFORMA">Proforma teklif</option>
                  <option value="QUOTE">Satış teklifi</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Geçerlilik tarihi</label>
                <input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Teslimat tarihi</label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp"
                />
              </div>
            </section>

            {/* Notlar */}
            <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notlar</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Teklif ile ilgili notlar…"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp resize-y min-h-[80px]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Ödeme Koşulları (bu teklife özel)
                </label>
                <textarea
                  value={termsOverride}
                  onChange={(e) => setTermsOverride(e.target.value)}
                  rows={4}
                  placeholder="Bu teklifte PDF'e basılacak ödeme koşulları…"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp resize-y min-h-[96px]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Alt Not (bu teklife özel)
                </label>
                <textarea
                  value={footerNoteOverride}
                  onChange={(e) => setFooterNoteOverride(e.target.value)}
                  rows={3}
                  placeholder="Bu teklifte PDF'e basılacak alt not…"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp resize-y min-h-[80px]"
                />
              </div>
            </section>

            {/* Kaydet / İptal */}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditMode(false);
                  initFormFromQuote(quote);
                }}
                className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-semibold hover:bg-green-600 disabled:opacity-60 shadow-sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Değişiklikleri Kaydet
              </button>
            </div>
          </div>

          {/* Özet paneli */}
          <aside className="xl:col-span-3 order-3">
            <div className="sticky top-6 bg-gradient-to-b from-green-50/80 to-white rounded-2xl border border-green-100 shadow-md p-6 space-y-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide text-whatsapp">
                Özet
              </h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-2 text-gray-600">
                  <dt>Ara Toplam</dt>
                  <dd className="font-medium text-gray-900 tabular-nums">
                    {sym}
                    {fmtNum(totals.subtotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 text-gray-600">
                  <dt>İndirim</dt>
                  <dd className="font-medium text-red-600 tabular-nums">
                    −{sym}
                    {fmtNum(totals.discountTotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 text-gray-600">
                  <dt>KDV</dt>
                  <dd className="font-medium text-gray-900 tabular-nums">
                    {sym}
                    {fmtNum(totals.vatTotal)}
                  </dd>
                </div>
                {grandTotalOverride && parseFloat(grandTotalOverride) > 0 && (
                  <div className="flex justify-between gap-2 text-gray-500 text-xs">
                    <dt>Hesaplanan Toplam</dt>
                    <dd className="tabular-nums line-through">
                      {sym}
                      {fmtNum(totals.grandTotal)}
                    </dd>
                  </div>
                )}
                <div className="pt-3 border-t border-green-100 flex justify-between items-baseline gap-2">
                  <dt className="text-base font-bold text-gray-900">GENEL TOPLAM</dt>
                  <dd className="text-2xl font-extrabold text-whatsapp tabular-nums">
                    {sym}
                    {fmtNum(displayGrandTotal)}
                  </dd>
                </div>
              </dl>
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold text-gray-500">
                  Genel Toplam (Manuel)
                  <span className="text-[10px] text-gray-400 font-normal ml-1">(Doluysa hesaplanan yerine)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={grandTotalOverride}
                  onChange={(e) => setGrandTotalOverride(e.target.value)}
                  placeholder="Boş bırakılırsa otomatik hesaplanır"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp tabular-nums bg-white"
                />
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Kaydet&apos;e tıkladığınızda değişiklikler veritabanına yazılır. PDF&apos;i yeniden oluşturmak
                gerekebilir.
              </p>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // View Mode (normal detay görünümü)
  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1920px] mx-auto pb-16">
      {showAcceptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-gray-900">Teklifi kabul et</h2>
              <button
                type="button"
                onClick={() => setShowAcceptModal(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Ödeme modelini seçin. %50 ön ödemede, siparişte teslim tarihi varsa teslimden bir gün önce muhasebeciye
              otomatik görev oluşturulur.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="pay"
                  checked={acceptPaymentMode === 'FULL'}
                  onChange={() => setAcceptPaymentMode('FULL')}
                />
                <div>
                  <p className="font-medium text-gray-900">Tam ödeme</p>
                  <p className="text-xs text-gray-500">Toplam {fmt(quote.grandTotal)}</p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="pay"
                  checked={acceptPaymentMode === 'DEPOSIT_50'}
                  onChange={() => setAcceptPaymentMode('DEPOSIT_50')}
                />
                <div>
                  <p className="font-medium text-gray-900">%50 ön ödeme</p>
                  <p className="text-xs text-gray-500">
                    Ön ödeme ≈ {fmt(halfDeposit)} · Kalan teslim öncesi tahsil edilmeli
                  </p>
                </div>
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowAcceptModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={!!actionLoading}
                onClick={() => void confirmAccept()}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-whatsapp text-white hover:bg-green-600 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {actionLoading === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Gönderim Onay Modalı */}
      {showSendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Send className="w-7 h-7 text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">WhatsApp ile Gönder</h2>
              <p className="text-sm text-gray-600 mt-2">
                Bu teklifi müşteriye WhatsApp üzerinden göndermek istediğinize emin misiniz?
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
                disabled={!!actionLoading}
                onClick={() => {
                  setShowSendConfirm(false);
                  void handleAction('send');
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
              >
                {actionLoading === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Evet, Gönder
              </button>
            </div>
          </div>
        </div>
      )}
      {showConvertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Siparişe dönüştürme kaynak seçimi</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Her kalem için stok, tedarikçi veya eski müşteri kaynağını belirleyin.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConvertModal(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="border border-gray-100 rounded-xl p-3 space-y-2">
                <p className="text-sm font-semibold text-gray-900">Ödeme seçimi</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="convert-payment"
                      checked={convertPaymentMode === 'FULL'}
                      onChange={() => setConvertPaymentMode('FULL')}
                    />
                    Tam ödeme
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="convert-payment"
                      checked={convertPaymentMode === 'DEPOSIT_50'}
                      onChange={() => setConvertPaymentMode('DEPOSIT_50')}
                    />
                    %50 ön ödeme
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="convert-payment"
                      checked={convertPaymentMode === 'CUSTOM'}
                      onChange={() => setConvertPaymentMode('CUSTOM')}
                    />
                    Özel yüzde
                  </label>
                </div>
                {convertPaymentMode === 'CUSTOM' ? (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={convertCustomPaymentValue}
                    onChange={(e) => setConvertCustomPaymentValue(e.target.value)}
                    placeholder="Örn: 30"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full md:w-48"
                  />
                ) : null}
              </div>
              {(quote.items || []).map((item: any) => {
                const src = convertItemSources.find((x) => x.quoteItemId === String(item.id));
                if (!src) return null;
                return (
                  <div key={item.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <select
                        value={src.source}
                        onChange={(e) =>
                          updateConvertSource(String(item.id), {
                            source: e.target.value as ConvertSource,
                          })
                        }
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                      >
                        <option value="STOCK">Stoktan</option>
                        <option value="SUPPLIER">Tedarikçi</option>
                        <option value="EXISTING_CUSTOMER">Eski müşteri</option>
                      </select>
                      <select
                        value={src.supplierId}
                        disabled={src.source !== 'SUPPLIER'}
                        onChange={(e) => updateConvertSource(String(item.id), { supplierId: e.target.value })}
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        <option value="">Tedarikçi seçin</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={src.supplierOrderNo}
                        disabled={src.source === 'STOCK'}
                        onChange={(e) =>
                          updateConvertSource(String(item.id), { supplierOrderNo: e.target.value })
                        }
                        placeholder={
                          src.source === 'EXISTING_CUSTOMER' ? 'Müşteri referansı' : 'Sipariş no'
                        }
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConvertModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={!!actionLoading}
                onClick={() => void submitConvert()}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-whatsapp text-white hover:bg-green-600 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {(actionLoading === 'convert' || actionLoading === 'convert-manual') ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                Dönüştür
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-gray-100 bg-white shadow-sm p-4 md:p-5">
        <button
          type="button"
          onClick={() => router.push('/quotes')}
          className="p-2 shrink-0 rounded-xl border border-gray-200 hover:bg-gray-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">
            TKL-{String(quote.quoteNumber).padStart(5, '0')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {[c.name, c.surname].filter(Boolean).join(' ') || formatPhone(c.phone)} —{' '}
            {new Date(quote.createdAt).toLocaleString('tr-TR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          {quote.createdBy?.name ? (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <User className="w-3.5 h-3.5 shrink-0" />
              Oluşturan: <span className="font-medium text-gray-600">{quote.createdBy.name}</span>
            </p>
          ) : null}
        </div>
        <span className={`self-start sm:self-center px-3 py-1 rounded-full text-xs font-medium ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 xl:gap-6 items-start">
        <aside className="xl:col-span-3 space-y-2 order-2 xl:order-1">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sohbet</h3>
          <QuoteEmbeddedChat contactId={c.id} contactPhone={c.phone} />
        </aside>
        <div className="xl:col-span-6 space-y-4 order-1 xl:order-2 min-w-0">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-3 w-20 sm:w-24">Görsel</th>
                    <th className="text-left px-4 py-3">#</th>
                    <th className="text-left px-4 py-3">Ürün / Hizmet</th>
                    <th className="text-left px-4 py-3">Renk/Kumaş</th>
                    <th className="text-left px-4 py-3">Ölçü</th>
                    <th className="text-right px-4 py-3">Miktar</th>
                    <th className="text-right px-4 py-3">Birim (KDV dahil)</th>
                    <th className="text-right px-4 py-3">KDV %</th>
                    <th className="text-right px-4 py-3">İndirim</th>
                    <th className="text-right px-4 py-3">Toplam</th>
                  </tr>
                </thead>
                <tbody>
                  {(quote.items || []).map((item: any, i: number) => (
                    <tr key={item.id} className="border-t border-gray-50">
                      <td className="px-4 py-2.5 w-[72px] align-middle">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden shrink-0">
                          {item.lineImageUrl || item.product?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={rewriteMediaUrlForClient(item.lineImageUrl || item.product.imageUrl)}
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
                      <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-900">{item.name}</p>
                        {item.description && <p className="text-xs text-gray-400">{item.description}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 text-sm">
                        {item.colorFabricInfo || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 text-sm">
                        {item.measurementInfo || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(item.unitPrice)}</td>
                      <td className="px-4 py-2.5 text-right">%{item.vatRate}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {item.discountValue
                          ? item.discountType === 'AMOUNT'
                            ? fmt(item.discountValue)
                            : `%${item.discountValue}`
                          : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">{fmt(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-100 p-3">
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium hover:bg-gray-50"
              >
                <Edit3 className="w-4 h-4" />
                Teklifi Düzenle
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 md:p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Calendar className="w-4 h-4 text-whatsapp" />
              Tarihler ve notlar
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Geçerlilik:</span>
                <span className="ml-2 text-gray-900">
                  {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString('tr-TR') : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Teslim:</span>
                <span className="ml-2 text-gray-900">
                  {quote.deliveryDate ? new Date(quote.deliveryDate).toLocaleDateString('tr-TR') : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Belge türü:</span>
                <span className="ml-2 text-gray-900">
                  {quote.documentKind === 'QUOTE' ? 'Satış teklifi' : 'Proforma teklif'}
                </span>
              </div>
            </div>
            {quote.notes && (
              <div className="pt-2 border-t border-gray-100">
                <span className="text-xs text-gray-500 block mb-1">Notlar</span>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.notes}</p>
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-3 space-y-4 order-3">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Ara Toplam</span>
              <span>{fmt(quote.subtotal)}</span>
            </div>
            {quote.discountTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">İndirim</span>
                <span className="text-red-500">-{fmt(quote.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">KDV</span>
              <span>{fmt(quote.vatTotal)}</span>
            </div>
            {quote.grandTotalOverride && quote.grandTotalOverride !== quote.grandTotal && (
              <div className="flex justify-between text-xs text-gray-400">
                <span>Hesaplanan</span>
                <span className="line-through">{fmt(quote.grandTotal)}</span>
              </div>
            )}
            <div className="border-t pt-3 flex justify-between">
              <span className="font-bold text-gray-900">GENEL TOPLAM</span>
              <span className="font-bold text-lg text-whatsapp">
                {fmt(quote.grandTotalOverride || quote.grandTotal)}
              </span>
            </div>
            {quote.status === 'ACCEPTED' && (
              <div className="pt-2 border-t text-xs text-gray-600 space-y-1">
                <p>
                  <span className="text-gray-500">Ödeme: </span>
                  {quote.paymentMode === 'DEPOSIT_50' ? '%50 ön ödeme' : 'Tam ödeme'}
                </p>
                {quote.acceptedAt && (
                  <p>
                    <span className="text-gray-500">Kabul: </span>
                    {new Date(quote.acceptedAt).toLocaleString('tr-TR')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3 text-sm">
            <p className="text-gray-500">Müşteri</p>
            <p className="font-medium text-gray-900">{[c.name, c.surname].filter(Boolean).join(' ') || '-'}</p>
            {c.company && <p className="text-gray-600">{c.company}</p>}
            <p className="text-gray-600">{formatPhone(c.phone)}</p>
            {c.email && <p className="text-gray-600">{c.email}</p>}
            {quote.validUntil && (
              <p className="text-xs text-gray-400">
                Geçerlilik: {new Date(quote.validUntil).toLocaleDateString('tr-TR')}
              </p>
            )}
            {quote.deliveryDate && (
              <p className="text-xs text-gray-400">Teslim: {new Date(quote.deliveryDate).toLocaleDateString('tr-TR')}</p>
            )}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void handleAction('generate-pdf')}
              disabled={!!actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-50 text-purple-700 rounded-xl text-sm font-medium hover:bg-purple-100 disabled:opacity-50"
            >
              {actionLoading === 'generate-pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              PDF Oluştur
            </button>

            {quote.pdfUrl && (
              <a
                href={`${pdfBase}${quote.pdfUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-100"
              >
                <FileText className="w-4 h-4" /> PDF Görüntüle
              </a>
            )}

            <button
              type="button"
              onClick={() => setShowSendConfirm(true)}
              disabled={!!actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-whatsapp text-white rounded-xl text-sm font-medium hover:bg-green-600 disabled:opacity-50"
            >
              {actionLoading === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              WhatsApp ile Gönder
            </button>

            {quote.status === 'SENT' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setAcceptPaymentMode('FULL');
                    setShowAcceptModal(true);
                  }}
                  disabled={!!actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-50 text-green-700 rounded-xl text-sm font-medium hover:bg-green-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> Kabul et…
                </button>
                <button
                  type="button"
                  onClick={() => void handleAction('reject')}
                  disabled={!!actionLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-700 rounded-xl text-sm font-medium hover:bg-red-100 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> Reddet
                </button>
              </>
            )}

            {quote.status === 'ACCEPTED' && canConvertToOrder && !quote.order && (
              <button
                type="button"
                onClick={() => openConvertModal(false)}
                disabled={!!actionLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-50 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-100 disabled:opacity-50"
              >
                {actionLoading === 'convert' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                Siparişe Dönüştür
              </button>
            )}
            {quote.status !== 'ACCEPTED' && canConvertToOrder && !quote.order && (
              <button
                type="button"
                onClick={() => openConvertModal(true)}
                disabled={!!actionLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-50 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-100 disabled:opacity-50"
              >
                {actionLoading === 'convert-manual' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                Manuel Siparişe Çevir
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
