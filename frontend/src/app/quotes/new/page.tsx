'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { cn, formatPhone, rewriteMediaUrlForClient } from '@/lib/utils';
import { SOURCES } from '@/lib/constants';
import { QuoteEmbeddedChat } from '@/components/quotes/QuoteEmbeddedChat';
import { VariantPickerOption } from '@/components/quotes/VariantPickerOption';
import { HtmlEditor } from '@/components/HtmlEditor';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Building2,
  Loader2,
  MessageSquare,
  Package,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';

/** HTML editörden gelen değeri kontrol eder; boşsa undefined döner */
function stripHtmlEmpty(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const plain = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return plain ? html : undefined;
}

type DiscountType = 'PERCENT' | 'AMOUNT';


type BillingFields = {
  company: string;
  billingAddress: string;
  address: string;
  taxOffice: string;
  taxNumber: string;
  identityNumber: string;
};

type QuickContactForm = {
  phone: string;
  name: string;
  surname: string;
  email: string;
  source: string;
  company: string;
  city: string;
  address: string;
  billingAddress: string;
  taxOffice: string;
  taxNumber: string;
  identityNumber: string;
  openChat: boolean;
  sessionId: string;
};

function emptyQuickContactForm(): QuickContactForm {
  return {
    phone: '',
    name: '',
    surname: '',
    email: '',
    source: '',
    company: '',
    city: '',
    address: '',
    billingAddress: '',
    taxOffice: '',
    taxNumber: '',
    identityNumber: '',
    openChat: false,
    sessionId: '',
  };
}

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
  /** Satır KDV oranı (%) */
  vatRate: number;
  /** true: birim fiyat KDV dahil | false: KDV hariç */
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

/** Backend `QuotesService` ile aynı: satır indirimi sonrası KDV hariç tutar (genel iskonto öncesi). */
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

/** Backend `QuotesService.calcTotals` ile aynı mantık (önizleme). */
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

  const subtotal = round2(sumExAfter);
  vatTotal = round2(vatTotal);
  const grandTotal = round2(sumExAfter + vatTotal);

  return {
    lineTotals,
    subtotal,
    discountTotal,
    vatTotal,
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
    vatRate: 20,
    priceIncludesVat: true,
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
  const contactSearchSeqRef = useRef(0);
  const [quickContactOpen, setQuickContactOpen] = useState(false);
  const [quickContactSubmitting, setQuickContactSubmitting] = useState(false);
  const [quickContactSessions, setQuickContactSessions] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const [quickContactForm, setQuickContactForm] = useState<QuickContactForm>(emptyQuickContactForm());
  
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
  const productSearchSeqRef = useRef(0);
  const [uploadingLineKey, setUploadingLineKey] = useState<string | null>(null);

  const [lines, setLines] = useState<LocalLineItem[]>([emptyLine()]);
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENT');
  const [discountValue, setDiscountValue] = useState(0);
  const [currency, setCurrency] = useState('TRY');
  const [validUntil, setValidUntil] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [termsOverride, setTermsOverride] = useState('');
  const [footerNoteOverride, setFooterNoteOverride] = useState('');
  const [termsTouched, setTermsTouched] = useState(false);
  const [footerTouched, setFooterTouched] = useState(false);
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

  const sym = currencySymbol(currency);

  const totals = useMemo(
    () => calcTotals(lines, discountType, discountValue),
    [lines, discountType, discountValue],
  );

  const billingDirty = useMemo(() => {
    if (!billingDraft || !billingBaseline) return false;
    return billingFingerprint(billingDraft) !== billingFingerprint(billingBaseline);
  }, [billingDraft, billingBaseline]);

  const searchContacts = useCallback(async (q: string) => {
    if (q.length < 2) {
      setContactResults([]);
      return;
    }
    const seq = ++contactSearchSeqRef.current;
    try {
      const { data } = await api.get('/contacts', { params: { search: q, limit: 10 } });
      if (seq !== contactSearchSeqRef.current) return;
      setContactResults(data.contacts || []);
    } catch {
      if (seq !== contactSearchSeqRef.current) return;
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

  const openQuickContactModal = async () => {
    setQuickContactForm({
      ...emptyQuickContactForm(),
      name:
        !selectedContact && contactQuery.trim() && !/\d/.test(contactQuery)
          ? contactQuery.trim()
          : '',
      phone:
        !selectedContact && /\d/.test(contactQuery)
          ? contactQuery.replace(/[^\d+]/g, '').trim()
          : '',
    });
    setQuickContactOpen(true);
    try {
      const { data } = await api.get('/sessions');
      const list = Array.isArray(data) ? data : [];
      setQuickContactSessions(
        list
          .filter((s: { status?: string }) => s.status === 'WORKING')
          .map((s: { id: string; name: string; status: string }) => ({
            id: s.id,
            name: s.name,
            status: s.status,
          })),
      );
    } catch {
      setQuickContactSessions([]);
    }
  };

  const closeQuickContactModal = () => {
    if (quickContactSubmitting) return;
    setQuickContactOpen(false);
    setQuickContactForm(emptyQuickContactForm());
    setQuickContactSessions([]);
  };

  const submitQuickContact = async () => {
    if (!quickContactForm.phone.trim()) {
      toast.error('Telefon numarası gerekli');
      return;
    }
    setQuickContactSubmitting(true);
    try {
      const { data } = await api.post('/contacts', {
        phone: quickContactForm.phone.trim(),
        name: quickContactForm.name.trim() || undefined,
        surname: quickContactForm.surname.trim() || undefined,
        email: quickContactForm.email.trim() || undefined,
        source: quickContactForm.source || undefined,
        company: quickContactForm.company.trim() || undefined,
        city: quickContactForm.city.trim() || undefined,
        address: quickContactForm.address.trim() || undefined,
        billingAddress: quickContactForm.billingAddress.trim() || undefined,
        taxOffice: quickContactForm.taxOffice.trim() || undefined,
        taxNumber: quickContactForm.taxNumber.trim() || undefined,
        identityNumber: quickContactForm.identityNumber.trim() || undefined,
        openChat: quickContactForm.openChat,
        sessionId: quickContactForm.sessionId || undefined,
      });
      const created = data?.contact;
      if (!created?.id || !created?.phone) throw new Error('Kişi bilgisi alınamadı');
      setSelectedContact({
        id: created.id,
        name: created.name || null,
        phone: created.phone,
      });
      setContactQuery(
        created.name ? `${created.name} (${formatPhone(created.phone)})` : formatPhone(created.phone),
      );
      setContactDropdownOpen(false);
      setContactResults([]);
      setQuickContactOpen(false);
      setQuickContactForm(emptyQuickContactForm());
      toast.success('Kişi oluşturuldu ve seçildi');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Kişi oluşturulamadı');
    } finally {
      setQuickContactSubmitting(false);
    }
  };

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
    setLines((prev) => (prev.length <= 1 ? [emptyLine()] : prev.filter((l) => l.key !== key)));
  };

  useEffect(() => {
    const loadPdfDefaults = async () => {
      try {
        const { data } = await api.get('/system-settings', { params: { _ts: Date.now() } });
        const all = Array.isArray(data) ? data : [];
        const terms = all.find((s: any) => s?.key === 'pdf_terms')?.value || '';
        const footer = all.find((s: any) => s?.key === 'pdf_footer_note')?.value || '';
        if (!termsTouched) setTermsOverride(String(terms));
        if (!footerTouched) setFooterNoteOverride(String(footer));
      } catch {
        // Sessiz geç: varsayılanlar olmadan da teklif oluşturulabilir.
      }
    };
    void loadPdfDefaults();
    return () => {
      clearTimeout(contactDebounceRef.current);
      clearTimeout(productDebounceRef.current);
    };
  }, [termsTouched, footerTouched]);

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
        notes: stripHtmlEmpty(notes),
        // Kullanıcı bu alanlara dokunmadıysa override göndermeyip
        // PDF tarafında en güncel ayarların kullanılmasını sağlarız.
        termsOverride: termsTouched ? stripHtmlEmpty(termsOverride) : undefined,
        footerNoteOverride: footerTouched ? stripHtmlEmpty(footerNoteOverride) : undefined,
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
          vatRate: Math.round(l.vatRate),
          priceIncludesVat: l.priceIncludesVat,
          discountType: 'PERCENT',
          discountValue: 0,
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
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-900">Varyant seçin</h3>
            <p className="text-xs text-gray-500 line-clamp-2">{variantPick.product.name}</p>
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {variantPick.variants.map((v) => (
                <VariantPickerOption
                  key={v.id ?? '__product_base__'}
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
      {quickContactOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          role="presentation"
          onClick={() => !quickContactSubmitting && closeQuickContactModal()}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden border border-gray-100"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="quick-contact-title"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitQuickContact();
              }}
            >
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 id="quick-contact-title" className="text-sm font-bold text-gray-900">
                    Hızlı kişi oluştur
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Kişiyi oluşturup teklife hemen bağlayın.</p>
                </div>
                <button
                  type="button"
                  onClick={closeQuickContactModal}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-72px)]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-gray-500">Telefon *</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.phone}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">E-posta</span>
                    <input
                      type="email"
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.email}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">Kaynak</span>
                    <select
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl bg-white"
                      value={quickContactForm.source}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, source: e.target.value }))}
                    >
                      <option value="">Seçiniz</option>
                      {SOURCES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">Ad</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.name}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">Soyad</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.surname}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, surname: e.target.value }))}
                    />
                  </label>
                  <label className="sm:col-span-2 block">
                    <span className="text-xs text-gray-500">Şirket / unvan</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.company}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, company: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">Şehir</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.city}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, city: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">Vergi dairesi</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.taxOffice}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, taxOffice: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">VKN</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.taxNumber}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, taxNumber: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">TC Kimlik No</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl"
                      value={quickContactForm.identityNumber}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, identityNumber: e.target.value }))}
                    />
                  </label>
                  <label className="sm:col-span-2 block">
                    <span className="text-xs text-gray-500">Adres</span>
                    <textarea
                      rows={2}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl resize-y"
                      value={quickContactForm.address}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, address: e.target.value }))}
                    />
                  </label>
                  <label className="sm:col-span-2 block">
                    <span className="text-xs text-gray-500">Fatura adresi</span>
                    <textarea
                      rows={2}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl resize-y"
                      value={quickContactForm.billingAddress}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, billingAddress: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={quickContactForm.openChat}
                      onChange={(e) => setQuickContactForm((f) => ({ ...f, openChat: e.target.checked }))}
                      className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp"
                    />
                    <span className="inline-flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-whatsapp" />
                      Kayıttan sonra gelen kutusunda sohbet aç
                    </span>
                  </label>
                  {quickContactForm.openChat && (
                    <label className="block">
                      <span className="text-xs text-gray-500">WhatsApp oturumu</span>
                      <select
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl bg-white"
                        value={quickContactForm.sessionId}
                        onChange={(e) => setQuickContactForm((f) => ({ ...f, sessionId: e.target.value }))}
                      >
                        <option value="">Varsayılan (en son aktif)</option>
                        {quickContactSessions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeQuickContactModal}
                    disabled={quickContactSubmitting}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    disabled={quickContactSubmitting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-whatsapp text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                  >
                    {quickContactSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Kaydet ve seç
                  </button>
                </div>
              </div>
            </form>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Kişi */}
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">Müşteri</h2>
              <button
                type="button"
                onClick={() => void openQuickContactModal()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Hızlı kişi oluştur
              </button>
            </div>
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
          </div>

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
                <table className="w-full text-xs min-w-[1020px]">
                <thead>
                  <tr className="bg-gray-50/90 text-gray-500 font-semibold uppercase tracking-wide text-[10px]">
                    <th className="text-left px-2 py-2 w-20 sm:w-24">Görsel</th>
                    <th className="text-left px-3 py-2 w-[18%]">Ürün</th>
                    <th className="text-left px-2 py-2 w-[14%]">Renk/Kumaş</th>
                    <th className="text-left px-2 py-2 w-[12%]">Ölçü</th>
                    <th className="text-left px-2 py-2 w-14">Miktar</th>
                    <th className="text-left px-2 py-2 w-28">Birim fiyat</th>
                    <th className="text-right px-3 py-2 w-28">Satır (KDV dahil)</th>
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
                          placeholder="Örn. krem"
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
                          min={1}
                          step={1}
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.key, {
                              quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                            })
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
                <option value="TRY">TL (₺)</option>
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
              <HtmlEditor
                value={notes}
                onChange={setNotes}
                placeholder="Teklif ile ilgili notlar…"
                minHeight="80px"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Ödeme Koşulları (bu teklife özel)
              </label>
              <HtmlEditor
                value={termsOverride}
                onChange={(val) => {
                  setTermsTouched(true);
                  setTermsOverride(val);
                }}
                placeholder="Bu teklifte PDF'e basılacak ödeme koşulları…"
                minHeight="96px"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Alt Not (bu teklife özel)
              </label>
              <HtmlEditor
                value={footerNoteOverride}
                onChange={(val) => {
                  setFooterTouched(true);
                  setFooterNoteOverride(val);
                }}
                placeholder="Bu teklifte PDF'e basılacak alt not…"
                minHeight="80px"
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
              {totals.discountTotal > 0 ? (
                <div className="flex justify-between gap-2 text-gray-600">
                  <dt>İskonto öncesi toplam (KDV hariç)</dt>
                  <dd className="font-medium text-gray-900 tabular-nums">
                    {sym}
                    {fmt(totals.subtotal + totals.discountTotal)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-2 text-gray-600">
                <dt>İskontolu toplam (KDV hariç)</dt>
                <dd className="font-medium text-gray-900 tabular-nums">
                  {sym}
                  {fmt(totals.subtotal)}
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
                <dt className="text-base font-bold text-gray-900">GENEL TOPLAM (KDV dahil)</dt>
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
