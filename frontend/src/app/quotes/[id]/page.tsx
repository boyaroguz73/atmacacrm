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
  Upload,
  Edit3,
  Save,
  ChevronDown,
  MessageSquare,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import { QuoteEmbeddedChat } from '@/components/quotes/QuoteEmbeddedChat';
import { VariantPickerOption } from '@/components/quotes/VariantPickerOption';
import { HtmlEditor } from '@/components/HtmlEditor';

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** HTML editörden gelen değeri kontrol eder; boşsa null döner */
function stripHtmlEmpty(html: string | undefined | null): string | null {
  if (!html) return null;
  const plain = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return plain ? html : null;
}

const CURRENCY: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Taslak', cls: 'bg-gray-100 text-gray-600' },
  SENT: { label: 'Gönderildi', cls: 'bg-blue-50 text-blue-600' },
  ACCEPTED: { label: 'Kabul Edildi', cls: 'bg-green-50 text-green-600' },
  REJECTED: { label: 'Reddedildi', cls: 'bg-red-50 text-red-600' },
  EXPIRED: { label: 'Süresi Doldu', cls: 'bg-amber-50 text-amber-600' },
};

type PaymentModeUI = 'FULL' | 'DEPOSIT_50' | 'CUSTOM';
type DiscountType = 'PERCENT' | 'AMOUNT';
type OrderPaymentModeUI = 'FULL' | 'DEPOSIT_50' | 'CUSTOM';


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
  vatRate: number;
  priceIncludesVat: boolean;
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
  salePriceAmount?: number | null;
  vatRate: number;
  priceIncludesVat?: boolean;
  currency?: string;
  imageUrl?: string | null;
  metadata?: unknown;
}

interface SupplierHit {
  id: string;
  name: string;
}

type ConvertSource = 'STOCK' | 'SUPPLIER';

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


function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function pickVatRate(...candidates: unknown[]): number | null {
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);
  }
  return null;
}

function parseDefaultVatRate(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function lineExAfterLineDiscount(item: LocalLineItem): number {
  const q = Math.max(0, Number(item.quantity) || 0);
  const u = Number(item.unitPrice) || 0;
  const r = Math.max(0, Number(item.vatRate) || 0) / 100;
  const incl = item.priceIncludesVat;

  let gross = incl ? q * u : q * u * (1 + r);

  let lineDiscount = 0;
  if (item.applyDiscount && item.discountValue && item.discountValue > 0) {
    lineDiscount =
      item.discountType === 'AMOUNT'
        ? item.discountValue
        : gross * (item.discountValue / 100);
  }
  gross = Math.max(0, gross - lineDiscount);

  return 1 + r > 0 ? gross / (1 + r) : gross;
}

function calcTotals(items: LocalLineItem[], discountType: DiscountType, discountValue: number) {
  const rows = items.map((item) => ({
    item,
    exBefore: lineExAfterLineDiscount(item),
  }));

  const sumExBefore = rows.reduce((s, x) => s + x.exBefore, 0);

  let discountTotal = 0;
  if (discountValue > 0) {
    discountTotal =
      discountType === 'AMOUNT'
        ? Math.min(discountValue, sumExBefore)
        : sumExBefore * (discountValue / 100);
  }
  discountTotal = round2(discountTotal);

  const sumExAfter = Math.max(0, sumExBefore - discountTotal);
  const ratio = sumExBefore > 0 ? sumExAfter / sumExBefore : 0;

  let vatTotal = 0;
  const lineTotals = rows.map(({ item, exBefore }) => {
    const r = Math.max(0, Number(item.vatRate) || 0) / 100;
    const exAfter = exBefore * ratio;
    const lineGrossAfterGeneral = exAfter * (1 + r);
    vatTotal += exAfter * r;
    return round2(lineGrossAfterGeneral);
  });

  return {
    lineTotals,
    subtotal: round2(sumExAfter),
    discountTotal,
    vatTotal: round2(vatTotal),
    grandTotal: round2(sumExAfter + vatTotal),
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

function emptyLine(defaultVatRate = 20): LocalLineItem {
  return {
    key: genKey(),
    name: '',
    colorFabricInfo: '',
    measurementInfo: '',
    quantity: 1,
    unitPrice: 0,
    vatRate: defaultVatRate,
    priceIncludesVat: true,
    applyDiscount: false,
    discountType: 'PERCENT',
    discountValue: 0,
  };
}

export default function QuoteDetailPage() {
  const [defaultVatRate, setDefaultVatRate] = useState(20);
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

  // Product search
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductHit[]>([]);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const productDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const productSearchSeqRef = useRef(0);
  const [uploadingLineKey, setUploadingLineKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/system-settings')
      .then(({ data }) => {
        if (cancelled) return;
        const all = Array.isArray(data) ? data : [];
        const nextVat = parseDefaultVatRate(
          all.find((s: any) => s?.key === 'quote_default_vat_rate')?.value,
        );
        setDefaultVatRate(nextVat);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [variantPick, setVariantPick] = useState<{
    product: ProductHit;
    variants: {
      id: string | null;
      name: string;
      unitPrice: number;
      salePriceAmount?: number | null;
      property2?: string | null;
      vatRate: number;
      priceIncludesVat?: boolean;
      metadata?: unknown;
      imageUrl?: string | null;
    }[];
  } | null>(null);

  // Accept modal
  const [chatOpen, setChatOpen] = useState(true);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [acceptPaymentMode, setAcceptPaymentMode] = useState<PaymentModeUI>('FULL');
  const [acceptCustomPaymentAmount, setAcceptCustomPaymentAmount] = useState<string>('');

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
    () => calcTotals(lines, discountType, discountValue),
    [lines, discountType, discountValue],
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
        quantity: Math.max(1, Math.round(Number(it.quantity || 1))),
        unitPrice: Number(it.unitPrice || 0),
        vatRate: Math.round(Number(it.vatRate ?? 20)),
        priceIncludesVat: it.priceIncludesVat !== false,
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
    const seq = ++productSearchSeqRef.current;
    try {
      const { data } = await api.get('/products', {
        params: { search: q, limit: 12, page: 1, matchExact: true },
      });
      if (seq !== productSearchSeqRef.current) return;
      setProductResults(data.products || []);
    } catch {
      if (seq !== productSearchSeqRef.current) return;
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
    variant?: {
      id?: string | null;
      name: string;
      unitPrice: number;
      salePriceAmount?: number | null;
      property2?: string | null;
      vatRate?: number;
      metadata?: unknown;
      priceIncludesVat?: boolean;
      imageUrl?: string | null;
    },
  ) => {
    const variantSale = variant?.salePriceAmount != null && variant.salePriceAmount > 0
      ? variant.salePriceAmount
      : null;
    const productSale = p.salePriceAmount != null && p.salePriceAmount > 0
      ? p.salePriceAmount
      : null;
    const salePrice = variantSale ?? productSale;

    const effectiveUnitPrice = salePrice ?? (variant ? variant.unitPrice : p.unitPrice);
    const variantMeta =
      variant?.metadata && typeof variant.metadata === 'object' && !Array.isArray(variant.metadata)
        ? (variant.metadata as Record<string, unknown>)
        : null;
    const productMeta =
      p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
        ? (p.metadata as Record<string, unknown>)
        : null;
    const effectiveVat =
      pickVatRate(
        // Ürün listesinde görünen KDV oranını öncele.
        p.vatRate,
        productMeta?.Vat,
        productMeta?.vat,
        productMeta?.vatRate,
        productMeta?.KDV,
        productMeta?.Kdv,
        // Varyantta açık oran varsa ikinci öncelik.
        variantMeta?.Vat,
        variantMeta?.vat,
        variantMeta?.vatRate,
        variantMeta?.KDV,
        variantMeta?.Kdv,
        variant?.vatRate,
      ) ?? 20;
    const effectivePic =
      variant?.priceIncludesVat !== undefined
        ? variant.priceIncludesVat
        : p.priceIncludesVat !== undefined
          ? p.priceIncludesVat
          : true;

    setLines((prev) => [
      ...prev,
      {
        key: genKey(),
        productId: p.id,
        productVariantId: variant?.id ?? undefined,
        lineImageUrl: (variant?.imageUrl && String(variant.imageUrl).trim()) || p.imageUrl || undefined,
        name: variant ? variant.name : String(p.name ?? ''),
        description: p.description || undefined,
        colorFabricInfo: '',
        measurementInfo: variant?.property2 ?? '',
        quantity: 1,
        unitPrice: effectiveUnitPrice,
        vatRate: effectiveVat,
        priceIncludesVat: effectivePic,
        applyDiscount: false,
        discountType: 'PERCENT',
        discountValue: 0,
      },
    ]);
    toast.success(salePrice != null ? 'Ürün indirimli fiyatla eklendi' : 'Ürün satıra eklendi');
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

  const uploadLineImage = async (lineKey: string, file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Lutfen bir gorsel dosyasi secin');
      return;
    }
    setUploadingLineKey(lineKey);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/messages/upload', form);
      const url = typeof data?.url === 'string' ? data.url.trim() : '';
      if (!url) throw new Error('Gorsel URL alinamadi');
      updateLine(lineKey, { lineImageUrl: url });
      toast.success('Gorsel yuklendi');
    } catch {
      toast.error('Gorsel yuklenemedi');
    } finally {
      setUploadingLineKey((prev) => (prev === lineKey ? null : prev));
    }
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? [emptyLine(defaultVatRate)] : prev.filter((l) => l.key !== key)));
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
        notes: stripHtmlEmpty(notes),
        termsOverride: stripHtmlEmpty(termsOverride),
        footerNoteOverride: stripHtmlEmpty(footerNoteOverride),
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
          vatRate: Math.round(l.vatRate),
          priceIncludesVat: l.priceIncludesVat,
          discountType: 'PERCENT',
          discountValue: 0,
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
        return next;
      }),
    );
  };

  const submitConvert = async () => {
    setActionLoading(convertManual ? 'convert-manual' : 'convert');
    try {
      await api.post(`/quotes/${id}/convert-to-order`, {
        manual: convertManual,
        itemSources: convertItemSources
          .filter((src) => src.source || src.supplierId)
          .map((src) => ({
            quoteItemId: src.quoteItemId,
            source: src.source || undefined,
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
    if (acceptPaymentMode === 'CUSTOM' && !(Number(acceptCustomPaymentAmount) > 0)) {
      toast.error('Özel ödeme tutarı 0’dan büyük olmalıdır');
      return;
    }
    setActionLoading('accept');
    try {
      await api.patch(`/quotes/${id}/status`, {
        status: 'ACCEPTED',
        paymentMode: acceptPaymentMode === 'DEPOSIT_50' ? 'DEPOSIT_50' : 'FULL',
        partialPaymentAmount:
          acceptPaymentMode === 'CUSTOM' ? Number(acceptCustomPaymentAmount) || undefined : undefined,
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

  const handleDirectAccept = async () => {
    setActionLoading('accept');
    try {
      await api.patch(`/quotes/${id}/status`, {
        status: 'ACCEPTED',
        paymentMode: 'FULL',
        documentKind,
      });
      toast.success('Teklif kabul edildi');
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
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-3">
              <h3 className="text-sm font-bold text-gray-900">Varyant seçin</h3>
              <p className="text-xs text-gray-500 line-clamp-2">{variantPick.product.name}</p>
              <div className="max-h-72 overflow-y-auto space-y-1.5">
                {variantPick.variants.filter((v) => !!v.id).map((v) => (
                  <VariantPickerOption
                    key={v.id}
                    name={v.name}
                    imageUrl={v.imageUrl}
                    property2={v.property2}
                    priceDisplay={`${sym}${v.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
                    discountedPriceDisplay={
                      v.salePriceAmount != null && v.salePriceAmount !== v.unitPrice
                        ? `${sym}${v.salePriceAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
                        : null
                    }
                    onSelect={() => {
                      finalizeProductLine(variantPick.product, v);
                      setVariantPick(null);
                    }}
                  />
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
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
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
                <div className="border-t border-gray-100 h-[480px] flex flex-col">
                  <QuoteEmbeddedChat contactId={c.id} contactPhone={c.phone} />
                </div>
              )}
            </div>
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
                  placeholder="Tam ürün adı veya SKU (tam eşleşme)"
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
                  onClick={() => setLines((p) => [...p, emptyLine(defaultVatRate)])}
                  className="text-xs font-semibold text-whatsapp hover:text-green-700"
                >
                  + Boş satır
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead>
                    <tr className="bg-gray-50/90 text-gray-500 font-semibold uppercase tracking-wide text-[10px]">
                      <th className="text-left px-2 py-2 w-20 sm:w-24">Görsel</th>
                      <th className="text-left px-3 py-2 w-[18%]">Ürün</th>
                      <th className="text-left px-2 py-2 w-[12%]">Renk/Kumaş</th>
                      <th className="text-left px-2 py-2 w-[10%]">Ölçü</th>
                      <th className="text-left px-2 py-2 w-16">Miktar</th>
                      <th className="text-left px-2 py-2 w-28">Birim fiyat</th>
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
                          <div className="mt-1 flex items-center gap-1">
                            <label className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-gray-200 rounded text-[10px] text-gray-700 cursor-pointer hover:bg-gray-50">
                              {uploadingLineKey === line.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                              Görsel yükle
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={uploadingLineKey === line.key}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) void uploadLineImage(line.key, file);
                                  e.currentTarget.value = '';
                                }}
                              />
                            </label>
                            {line.lineImageUrl && (
                              <button
                                type="button"
                                onClick={() => updateLine(line.key, { lineImageUrl: undefined })}
                                className="px-1.5 py-0.5 border border-gray-200 rounded text-[10px] text-gray-600 hover:bg-gray-50"
                              >
                                Temizle
                              </button>
                            )}
                          </div>
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
                            onChange={(e) => updateLine(line.key, { measurementInfo: e.target.value })}
                            placeholder="Örn. 180×200"
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
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
                          <div className="flex flex-col gap-1">
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
                            <span className="text-[10px] text-gray-400 px-0.5">
                              {line.priceIncludesVat ? 'KDV dahil' : 'KDV hariç'} · %{line.vatRate}
                            </span>
                          </div>
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
                  <option value="TRY">TL (₺)</option>
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
                <HtmlEditor
                  value={notes}
                  onChange={setNotes}
                  placeholder="Teklif ile ilgili notlar…"
                  minHeight="80px"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Ödeme Koşulları (bu teklife özel)
                </label>
                <HtmlEditor
                  value={termsOverride}
                  onChange={setTermsOverride}
                  placeholder="Bu teklifte PDF'e basılacak ödeme koşulları…"
                  minHeight="96px"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Alt Not (bu teklife özel)
                </label>
                <HtmlEditor
                  value={footerNoteOverride}
                  onChange={setFooterNoteOverride}
                  placeholder="Bu teklifte PDF'e basılacak alt not…"
                  minHeight="80px"
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
                {totals.discountTotal > 0 ? (
                  <div className="flex justify-between gap-2 text-gray-600">
                    <dt>İskonto öncesi toplam (KDV hariç)</dt>
                    <dd className="font-medium text-gray-900 tabular-nums">
                      {sym}
                      {fmtNum(totals.subtotal + totals.discountTotal)}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2 text-gray-600">
                  <dt>İskontolu toplam (KDV hariç)</dt>
                  <dd className="font-medium text-gray-900 tabular-nums">
                    {sym}
                    {fmtNum(totals.subtotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 text-gray-600">
                  <dt>KDV</dt>
                  <dd className="font-medium text-gray-900 tabular-nums">
                    {sym}
                    {fmtNum(totals.vatTotal)}
                  </dd>
                </div>
                {grandTotalOverride && parseFloat(grandTotalOverride) > 0 && parseFloat(grandTotalOverride) < totals.grandTotal && (
                  <div className="flex justify-between gap-2 text-orange-600 text-sm font-medium">
                    <dt>Manuel iskonto</dt>
                    <dd className="tabular-nums">
                      -{sym}{fmtNum(totals.grandTotal - parseFloat(grandTotalOverride))}
                    </dd>
                  </div>
                )}
                <div className="pt-3 border-t border-green-100 flex justify-between items-baseline gap-2">
                  <dt className="text-base font-bold text-gray-900">GENEL TOPLAM (KDV dahil)</dt>
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
                  checked={acceptPaymentMode === 'CUSTOM'}
                  onChange={() => setAcceptPaymentMode('CUSTOM')}
                />
                <div className="w-full">
                  <p className="font-medium text-gray-900">Özel miktar</p>
                  <p className="text-xs text-gray-500">Ön ödeme tutarını kendiniz belirleyin</p>
                  {acceptPaymentMode === 'CUSTOM' ? (
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={acceptCustomPaymentAmount}
                      onChange={(e) => setAcceptCustomPaymentAmount(e.target.value)}
                      placeholder="Örn: 15000"
                      className="mt-2 px-3 py-2 border border-gray-200 rounded-lg text-sm w-full md:w-56"
                    />
                  ) : null}
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
                  Kaynak seçimi opsiyoneldir; sipariş detayından sonradan güncelleyebilirsiniz.
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
                        disabled={src.source !== 'SUPPLIER' || !src.supplierId}
                        onChange={(e) =>
                          updateConvertSource(String(item.id), { supplierOrderNo: e.target.value })
                        }
                        placeholder="Sipariş no (opsiyonel)"
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
                    <th className="text-right px-4 py-3">Birim fiyat</th>
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
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 text-sm">
                        {item.colorFabricInfo || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 text-sm">
                        {item.measurementInfo || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div>{fmt(item.unitPrice)}</div>
                        <div className="text-[10px] text-gray-400">
                          {item.priceIncludesVat ? 'KDV dahil' : 'KDV hariç'} · %{item.vatRate}
                        </div>
                      </td>
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
            {Number(quote.discountTotal) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">İskonto öncesi toplam (KDV hariç)</span>
                <span>
                  {fmt(Number(quote.subtotal) + Number(quote.discountTotal))}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">İskontolu toplam (KDV hariç)</span>
              <span>{fmt(quote.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">KDV</span>
              <span>{fmt(quote.vatTotal)}</span>
            </div>
            {quote.grandTotalOverride && Number(quote.grandTotalOverride) > 0 && Number(quote.grandTotalOverride) < Number(quote.grandTotal) && (
              <div className="flex justify-between text-sm font-medium text-orange-600">
                <span>Manuel iskonto</span>
                <span>-{fmt(Number(quote.grandTotal) - Number(quote.grandTotalOverride))}</span>
              </div>
            )}
            <div className="border-t pt-3 flex justify-between">
              <span className="font-bold text-gray-900">GENEL TOPLAM (KDV dahil)</span>
              <span className="font-bold text-lg text-whatsapp">
                {fmt(quote.grandTotalOverride || quote.grandTotal)}
              </span>
            </div>
            {quote.status === 'ACCEPTED' && (
              <div className="pt-2 border-t text-xs text-gray-600 space-y-1">
                <p>
                  <span className="text-gray-500">Ödeme: </span>
                  {quote.partialPaymentAmount && Number(quote.partialPaymentAmount) > 0
                    ? `Özel miktar (${fmtNum(Number(quote.partialPaymentAmount))} ${quote.currency})`
                    : quote.paymentMode === 'DEPOSIT_50'
                      ? '%50 ön ödeme'
                      : 'Tam ödeme'}
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
                  onClick={() => void handleDirectAccept()}
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
