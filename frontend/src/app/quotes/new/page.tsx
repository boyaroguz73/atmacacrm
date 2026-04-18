'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { cn, formatPhone, rewriteMediaUrlForClient } from '@/lib/utils';
import { QuoteEmbeddedChat } from '@/components/quotes/QuoteEmbeddedChat';
import { MeasurementLineCell } from '@/components/quotes/MeasurementLineCell';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Building2,
  Loader2,
  Package,
  Search,
  Trash2,
  X,
} from 'lucide-react';

type DiscountType = 'PERCENT' | 'AMOUNT';

/** Tüm satırlarda tek KDV oranı (birim fiyat KDV dahil hesap için). */
const LINE_VAT_OPTIONS = [0, 1, 10, 20] as const;

type BillingFields = {
  company: string;
  billingAddress: string;
  address: string;
  taxOffice: string;
  taxNumber: string;
  identityNumber: string;
};

function billingFingerprint(b: BillingFields): string {
  return JSON.stringify({
    company: (b.company || '').trim(),
    billingAddress: (b.billingAddress || '').trim(),
    address: (b.address || '').trim(),
    taxOffice: (b.taxOffice || '').trim(),
    taxNumber: (b.taxNumber || '').trim(),
    identityNumber: (b.identityNumber || '').trim(),
  });
}

interface LocalLineItem {
  key: string;
  productId?: string;
  productVariantId?: string;
  lineImageUrl?: string;
  name: string;
  description?: string;
  /** Satıra özel (PDF’de kalem altında) */
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

function currencySymbol(c: string): string {
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  return '₺';
}

/** XML subproduct metadata.type2 / title → ölçü alanı ön doldurması */
function measurementHintFromVariantMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const m = metadata as Record<string, unknown>;
  const t2 = typeof m.type2 === 'string' ? m.type2.trim() : '';
  const title = typeof m.title === 'string' ? m.title.trim() : '';
  return t2 || title || '';
}

/** Backend `QuotesService.calcTotals` ile aynı mantık (önizleme). */
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

export default function NewQuotePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedContactId = searchParams.get('contactId');
  
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<
    { id: string; name: string | null; phone: string }[]
  >([]);
  const [selectedContact, setSelectedContact] = useState<{
    id: string;
    name: string | null;
    phone: string;
  } | null>(null);
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  
  // URL'den gelen contactId ile kişiyi otomatik seç
  useEffect(() => {
    if (preselectedContactId && !selectedContact) {
      api.get(`/contacts/${preselectedContactId}`)
        .then(({ data }) => {
          setSelectedContact({ id: data.id, name: data.name, phone: data.phone });
          setContactQuery(data.name || data.phone);
        })
        .catch(() => {});
    }
  }, [preselectedContactId]);

  useEffect(() => {
    if (!selectedContact?.id) {
      setBillingDraft(null);
      setBillingBaseline(null);
      return;
    }
    setBillingLoading(true);
    api
      .get(`/contacts/${selectedContact.id}`)
      .then(({ data }) => {
        const draft: BillingFields = {
          company: data.company || '',
          billingAddress: data.billingAddress || '',
          address: data.address || '',
          taxOffice: data.taxOffice || '',
          taxNumber: data.taxNumber || '',
          identityNumber: data.identityNumber || '',
        };
        setBillingDraft(draft);
        setBillingBaseline({ ...draft });
      })
      .catch(() => {
        setBillingDraft(null);
        setBillingBaseline(null);
      })
      .finally(() => setBillingLoading(false));
  }, [selectedContact?.id]);

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductHit[]>([]);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const productDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [lines, setLines] = useState<LocalLineItem[]>([emptyLine()]);
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENT');
  const [discountValue, setDiscountValue] = useState(0);
  const [currency, setCurrency] = useState('TRY');
  const [validUntil, setValidUntil] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [termsOverride, setTermsOverride] = useState('');
  const [footerNoteOverride, setFooterNoteOverride] = useState('');
  const [grandTotalOverride, setGrandTotalOverride] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [billingDraft, setBillingDraft] = useState<BillingFields | null>(null);
  /** Sunucuya son kaydedilen / yüklenen firma-fatura kopyası (kayıtsız düzenleme tespiti). */
  const [billingBaseline, setBillingBaseline] = useState<BillingFields | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingShake, setBillingShake] = useState(false);

  const [variantPick, setVariantPick] = useState<{
    product: ProductHit;
    variants: { id: string; name: string; unitPrice: number; vatRate: number; metadata?: unknown }[];
  } | null>(null);

  /** Teklifteki tüm satırlar için geçerli KDV oranı (API’ye satır başına yazılır). */
  const [lineVatRate, setLineVatRate] = useState(20);

  const sym = currencySymbol(currency);

  const totals = useMemo(
    () => calcTotals(lines, discountType, discountValue, lineVatRate),
    [lines, discountType, discountValue, lineVatRate],
  );

  const lineVatSelectOptions = useMemo(() => {
    const s = new Set<number>([...LINE_VAT_OPTIONS, lineVatRate]);
    return Array.from(s).sort((a, b) => a - b);
  }, [lineVatRate]);

  const billingDirty = useMemo(() => {
    if (!billingDraft || !billingBaseline) return false;
    return billingFingerprint(billingDraft) !== billingFingerprint(billingBaseline);
  }, [billingDraft, billingBaseline]);

  const searchContacts = useCallback(async (q: string) => {
    if (q.length < 2) {
      setContactResults([]);
      return;
    }
    try {
      const { data } = await api.get('/contacts', { params: { search: q, limit: 10 } });
      setContactResults(data.contacts || []);
    } catch {
      setContactResults([]);
    }
  }, []);

  const handleContactSearch = (val: string) => {
    setContactQuery(val);
    setContactDropdownOpen(true);
    if (selectedContact) {
      setSelectedContact(null);
    }
    clearTimeout(contactDebounceRef.current);
    contactDebounceRef.current = setTimeout(() => searchContacts(val), 300);
  };

  const pickContact = (c: { id: string; name: string | null; phone: string }) => {
    setSelectedContact(c);
    setContactQuery(c.name ? `${c.name} (${formatPhone(c.phone)})` : formatPhone(c.phone));
    setContactDropdownOpen(false);
  };

  const clearContact = () => {
    setSelectedContact(null);
    setContactQuery('');
    setContactResults([]);
  };

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
    variant?: { id: string; name: string; unitPrice: number; metadata?: unknown; vatRate?: number },
  ) => {
    const vat =
      variant?.vatRate != null && Number.isFinite(Number(variant.vatRate))
        ? Math.round(Number(variant.vatRate))
        : p.vatRate != null && Number.isFinite(Number(p.vatRate))
          ? Math.round(Number(p.vatRate))
          : null;
    if (vat != null) setLineVatRate(vat);
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

  useEffect(() => {
    const loadPdfDefaults = async () => {
      try {
        const { data } = await api.get('/system-settings');
        const all = Array.isArray(data) ? data : [];
        const terms = all.find((s: any) => s?.key === 'pdf_terms')?.value || '';
        const footer = all.find((s: any) => s?.key === 'pdf_footer_note')?.value || '';
        setTermsOverride(String(terms));
        setFooterNoteOverride(String(footer));
      } catch {
        // Sessiz geç: varsayılanlar olmadan da teklif oluşturulabilir.
      }
    };
    void loadPdfDefaults();
    return () => {
      clearTimeout(contactDebounceRef.current);
      clearTimeout(productDebounceRef.current);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact) {
      toast.error('Lütfen bir kişi seçin');
      return;
    }
    if (billingDirty) {
      toast.error('Firma / fatura bilgilerini kaydedin veya değişiklikleri sıfırlayın.');
      setBillingShake(true);
      window.setTimeout(() => setBillingShake(false), 450);
      return;
    }
    const validLines = lines.filter((l) => String(l.name ?? '').trim() !== '');
    if (!validLines.length) {
      toast.error('En az bir ürün satırı ekleyin');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post('/quotes', {
        contactId: selectedContact.id,
        currency,
        discountType,
        discountValue,
        validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : undefined,
        notes: String(notes ?? '').trim() || undefined,
        termsOverride: String(termsOverride ?? '').trim() || undefined,
        footerNoteOverride: String(footerNoteOverride ?? '').trim() || undefined,
        grandTotalOverride: grandTotalOverride && parseFloat(grandTotalOverride) > 0 
          ? parseFloat(grandTotalOverride) 
          : undefined,
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
          colorFabricInfo: String(l.colorFabricInfo ?? '').trim() || undefined,
          measurementInfo: String(l.measurementInfo ?? '').trim() || undefined,
        })),
      });
      toast.success('Teklif oluşturuldu');
      router.push(`/quotes/${res.data.id}`);
    } catch {
      toast.error('Teklif kaydedilemedi');
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const saveBilling = async () => {
    if (!selectedContact?.id || !billingDraft) return;
    setBillingSaving(true);
    try {
      await api.patch(`/contacts/${selectedContact.id}`, {
        company: billingDraft.company.trim() || null,
        billingAddress: billingDraft.billingAddress.trim() || null,
        address: billingDraft.address.trim() || null,
        taxOffice: billingDraft.taxOffice.trim() || null,
        taxNumber: billingDraft.taxNumber.trim() || null,
        identityNumber: billingDraft.identityNumber.trim() || null,
      });
      setBillingBaseline({ ...billingDraft });
      toast.success('Firma bilgileri kaydedildi (PDF ve muhasebe için)');
    } catch {
      toast.error('Firma bilgileri kaydedilemedi');
    } finally {
      setBillingSaving(false);
    }
  };

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
          onClick={() => router.push('/quotes')}
          className="p-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
          aria-label="Geri"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Yeni Teklif</h1>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col xl:flex-row xl:items-start xl:gap-8 gap-6"
      >
        <aside className="w-full xl:w-72 xl:shrink-0 space-y-2 order-2 xl:order-1">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sohbet</h3>
          {selectedContact ? (
            <QuoteEmbeddedChat contactId={selectedContact.id} contactPhone={selectedContact.phone} />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4 text-xs text-gray-500 text-center">
              Müşteri seçildiğinde WhatsApp sohbeti burada görünür.
            </div>
          )}
        </aside>
        <div className="flex-1 min-w-0 space-y-6 order-1 xl:order-2 w-full">
          {/* Kişi */}
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Müşteri</h2>
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Kişi ara (isim veya telefon)…"
                  value={contactQuery}
                  onChange={(e) => handleContactSearch(e.target.value)}
                  onFocus={() => contactQuery.length >= 2 && setContactDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setContactDropdownOpen(false), 200)}
                  className={`w-full pl-9 pr-9 py-2.5 border rounded-xl text-sm focus:outline-none transition-colors ${
                    selectedContact
                      ? 'border-whatsapp bg-green-50/40 text-green-900'
                      : 'border-gray-200 focus:border-whatsapp'
                  }`}
                />
                {selectedContact && (
                  <button
                    type="button"
                    onClick={clearContact}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {contactDropdownOpen && contactResults.length > 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                  {contactResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => pickContact(c)}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-50 last:border-0"
                    >
                      <div className="w-8 h-8 bg-whatsapp/10 rounded-full flex items-center justify-center flex-shrink-0 text-whatsapp font-bold text-xs">
                        {(c.name || c.phone || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {c.name || formatPhone(c.phone)}
                        </p>
                        {c.name && (
                          <p className="text-[11px] text-gray-400">{formatPhone(c.phone)}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {contactDropdownOpen && contactQuery.length >= 2 && contactResults.length === 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-xs text-gray-400 text-center">
                  Kişi bulunamadı
                </div>
              )}
            </div>
          </section>

          {selectedContact && (
            <section
              className={cn(
                'bg-white rounded-xl border shadow-sm p-5 space-y-3 transition-[box-shadow,border-color]',
                billingShake && 'animate-crm-shake ring-2 ring-red-500 border-red-400',
                !billingShake && billingDirty && 'border-amber-400 ring-1 ring-amber-200/80',
                !billingShake && !billingDirty && 'border-amber-100',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                  <Building2 className="w-4 h-4 text-amber-700" />
                  Firma / fatura bilgileri
                  {billingDirty ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                      Kaydedilmedi
                    </span>
                  ) : null}
                </h2>
                <div className="flex items-center gap-2">
                  {billingDirty ? (
                    <button
                      type="button"
                      onClick={() => billingBaseline && setBillingDraft({ ...billingBaseline })}
                      className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1.5 rounded-lg border border-gray-200 bg-white"
                    >
                      Sıfırla
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void saveBilling()}
                    disabled={billingLoading || billingSaving || !billingDraft || !billingDirty}
                    className={cn(
                      'text-xs font-semibold px-3 py-1.5 rounded-lg text-white inline-flex items-center gap-1 disabled:opacity-50',
                      billingDirty ? 'bg-amber-600 hover:bg-amber-700' : 'bg-gray-300 cursor-not-allowed',
                    )}
                  >
                    {billingSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Kaydet
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-gray-500">
                Teklif PDF’inde müşteri bloğunda ve sipariş / muhasebe ekranlarında kullanılır.
                {billingDirty ? (
                  <span className="text-red-600 font-medium"> Kayıtsız değişiklik varken teklif oluşturulamaz.</span>
                ) : null}
              </p>
              {billingLoading || !billingDraft ? (
                <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Yükleniyor…
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <label className="sm:col-span-2 block">
                    <span className="text-xs text-gray-500">Ticari unvan / şirket</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={billingDraft.company}
                      onChange={(e) =>
                        setBillingDraft((d) => (d ? { ...d, company: e.target.value } : d))
                      }
                    />
                  </label>
                  <label className="sm:col-span-2 block">
                    <span className="text-xs text-gray-500">Açık adres</span>
                    <textarea
                      rows={2}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl resize-y"
                      value={billingDraft.address}
                      onChange={(e) =>
                        setBillingDraft((d) => (d ? { ...d, address: e.target.value } : d))
                      }
                    />
                  </label>
                  <label className="sm:col-span-2 block">
                    <span className="text-xs text-gray-500">Fatura adresi (öncelikli)</span>
                    <textarea
                      rows={2}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl resize-y"
                      placeholder="Boşsa açık adres kullanılır"
                      value={billingDraft.billingAddress}
                      onChange={(e) =>
                        setBillingDraft((d) => (d ? { ...d, billingAddress: e.target.value } : d))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">Vergi dairesi</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={billingDraft.taxOffice}
                      onChange={(e) =>
                        setBillingDraft((d) => (d ? { ...d, taxOffice: e.target.value } : d))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">VKN</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={billingDraft.taxNumber}
                      onChange={(e) =>
                        setBillingDraft((d) => (d ? { ...d, taxNumber: e.target.value } : d))
                      }
                    />
                  </label>
                  <label className="sm:col-span-2 block">
                    <span className="text-xs text-gray-500">TC Kimlik No</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={billingDraft.identityNumber}
                      onChange={(e) =>
                        setBillingDraft((d) => (d ? { ...d, identityNumber: e.target.value } : d))
                      }
                    />
                  </label>
                </div>
              )}
            </section>
          )}

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

          {/* Satırlar — tam genişlik (orta sütun flex-1) */}
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden w-full">
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
            
            <div className="overflow-x-auto w-full min-w-0">
                <table className="w-full text-xs min-w-[780px]">
                <thead>
                  <tr className="bg-gray-50/90 text-gray-500 font-semibold uppercase tracking-wide text-[10px]">
                    <th className="text-left px-2 py-2 w-20 sm:w-24">Görsel</th>
                    <th className="text-left px-3 py-2 w-[18%]">Ürün</th>
                    <th className="text-left px-2 py-2 w-[14%]">Renk/Kumaş</th>
                    <th className="text-left px-2 py-2 w-[12%]">Ölçü</th>
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
                          onChange={(e) =>
                            updateLine(line.key, { lineImageUrl: e.target.value || undefined })
                          }
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
                          placeholder="Örn. krem"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MeasurementLineCell
                          productId={line.productId}
                          value={line.measurementInfo ?? ''}
                          onChange={(next) => updateLine(line.key, { measurementInfo: next })}
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
                        {fmt(totals.lineTotals[idx] ?? 0)}
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

          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 grid sm:grid-cols-2 gap-4 w-full">
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
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Notlar</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Teklif ile ilgili notlar…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp resize-y min-h-[80px]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Ödeme Koşulları (bu teklife özel)
              </label>
              <textarea
                value={termsOverride}
                onChange={(e) => setTermsOverride(e.target.value)}
                rows={4}
                placeholder="Bu teklifte PDF’e basılacak ödeme koşulları…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp resize-y min-h-[96px]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Alt Not (bu teklife özel)
              </label>
              <textarea
                value={footerNoteOverride}
                onChange={(e) => setFooterNoteOverride(e.target.value)}
                rows={3}
                placeholder="Bu teklifte PDF’e basılacak alt not…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp resize-y min-h-[80px]"
              />
            </div>
          </section>
        </div>

        {/* Özet + aksiyonlar (butonlar özetin altında) */}
        <aside className="w-full xl:w-72 xl:shrink-0 order-3 flex flex-col gap-4">
          <div className="xl:sticky xl:top-6 space-y-4">
            <div className="bg-gradient-to-b from-green-50/80 to-white rounded-2xl border border-green-100 shadow-md p-6 space-y-4">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide text-whatsapp">
              Özet
            </h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-2 text-gray-600">
                <dt>Ara Toplam</dt>
                <dd className="font-medium text-gray-900 tabular-nums">
                  {sym}
                  {fmt(totals.subtotal)}
                </dd>
              </div>
              <div className="flex justify-between gap-2 text-gray-600">
                <dt>İndirim</dt>
                <dd className="font-medium text-red-600 tabular-nums">
                  −{sym}
                  {fmt(totals.discountTotal)}
                </dd>
              </div>
              <div className="flex justify-between gap-2 text-gray-600">
                <dt>KDV</dt>
                <dd className="font-medium text-gray-900 tabular-nums">
                  {sym}
                  {fmt(totals.vatTotal)}
                </dd>
              </div>
              {grandTotalOverride && parseFloat(grandTotalOverride) > 0 && (
                <div className="flex justify-between gap-2 text-gray-500 text-xs">
                  <dt>Hesaplanan Toplam</dt>
                  <dd className="tabular-nums line-through">
                    {sym}
                    {fmt(totals.grandTotal)}
                  </dd>
                </div>
              )}
              <div className="pt-3 border-t border-green-100 flex justify-between items-baseline gap-2">
                <dt className="text-base font-bold text-gray-900">GENEL TOPLAM</dt>
                <dd className="text-2xl font-extrabold text-whatsapp tabular-nums">
                  {sym}
                  {fmt(grandTotalOverride && parseFloat(grandTotalOverride) > 0 
                    ? parseFloat(grandTotalOverride) 
                    : totals.grandTotal)}
                </dd>
              </div>
            </dl>
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-gray-500">
                Genel Toplam (Manuel)
                <span className="text-[10px] text-gray-400 font-normal ml-1">(Hesaplanan yerine)</span>
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={grandTotalOverride}
                onChange={(e) => setGrandTotalOverride(e.target.value)}
                placeholder="Boş bırakılırsa otomatik"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp tabular-nums bg-white"
              />
            </div>
            
            </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => router.push('/quotes')}
              className="w-full px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 w-full px-6 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-semibold hover:bg-green-600 disabled:opacity-60 shadow-sm"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Teklifi kaydet
            </button>
          </div>
        </div>
        </aside>
      </form>
    </div>
  );
}
