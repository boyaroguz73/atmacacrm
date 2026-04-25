'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { cn, formatPhone, rewriteMediaUrlForClient } from '@/lib/utils';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, Package, Search, Trash2, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { ColorFabricLineCell } from '@/components/quotes/ColorFabricLineCell';
import { VariantPickerOption } from '@/components/quotes/VariantPickerOption';
import { QuoteEmbeddedChat } from '@/components/quotes/QuoteEmbeddedChat';

interface LocalLineItem {
  key: string;
  productId?: string;
  productVariantId?: string;
  lineImageUrl?: string;
  name: string;
  colorFabricInfo?: string;
  measurementInfo?: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  /** true: unitPrice KDV dahil (varsayılan) | false: KDV hariç */
  priceIncludesVat: boolean;
  isFromStock: boolean;
  sourceType?: 'STOCK' | 'SUPPLIER';
  supplierId?: string;
  supplierOrderNo?: string;
}

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  unitPrice: number;
  salePriceAmount?: number | null;
  vatRate: number;
  imageUrl?: string | null;
  priceIncludesVat?: boolean;
}

interface SupplierHit {
  id: string;
  name: string;
}


function calcTotals(items: LocalLineItem[]) {
  let subtotal = 0;
  let vatTotal = 0;
  let grandTotal = 0;
  const lineTotals = items.map((item) => {
    const r = Math.max(0, item.vatRate) / 100;
    const incl = item.priceIncludesVat !== false;
    // incl=true -> unitPrice KDV dahil, incl=false -> KDV hariç
    const lineGross = incl
      ? item.quantity * item.unitPrice
      : item.quantity * item.unitPrice * (1 + r);
    const divider = 1 + r;
    const lineNet = divider > 0 ? lineGross / divider : lineGross;
    const lineVat = lineGross - lineNet;
    subtotal += lineNet;
    vatTotal += lineVat;
    grandTotal += lineGross;
    return Math.round(lineGross * 100) / 100;
  });
  return {
    lineTotals,
    subtotal: Math.round(subtotal * 100) / 100,
    vatTotal: Math.round(vatTotal * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
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
    isFromStock: true,
    sourceType: 'STOCK',
    supplierId: '',
    supplierOrderNo: '',
  };
}

function fmt(amount: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount);
}

export default function NewOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedContactId = searchParams.get('contactId');
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string | null; phone: string } | null>(null);
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const contactSearchSeqRef = useRef(0);

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductHit[]>([]);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const productDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const productSearchSeqRef = useRef(0);

  const [lines, setLines] = useState<LocalLineItem[]>([emptyLine()]);
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierHit[]>([]);
  const [pushToTsoft, setPushToTsoft] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const [variantPick, setVariantPick] = useState<{
    product: ProductHit;
    variants: {
      id: string | null;
      name: string;
      unitPrice: number;
      salePriceAmount?: number | null;
      property2?: string | null;
      vatRate: number;
      metadata?: unknown;
      imageUrl?: string | null;
      priceIncludesVat?: boolean;
    }[];
  } | null>(null);

  const totals = useMemo(() => calcTotals(lines), [lines]);

  useEffect(() => {
    api
      .get('/suppliers', { params: { isActive: true, limit: 200 } })
      .then(({ data }) => setSuppliers(data.suppliers || []))
      .catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    if (preselectedContactId && !selectedContact) {
      api.get(`/contacts/${preselectedContactId}`)
        .then(({ data }) => {
          setSelectedContact({ id: data.id, name: data.name, phone: data.phone });
          setContactQuery(data.name ? `${data.name} (${formatPhone(data.phone)})` : formatPhone(data.phone));
          setChatOpen(true);
        })
        .catch(() => {});
    }
  }, [preselectedContactId, selectedContact]);

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

  const handleContactSearch = (val: string) => {
    setContactQuery(val);
    setContactDropdownOpen(true);
    if (selectedContact) setSelectedContact(null);
    clearTimeout(contactDebounceRef.current);
    contactDebounceRef.current = setTimeout(() => searchContacts(val), 300);
  };

  const pickContact = (c: { id: string; name: string | null; phone: string }) => {
    setSelectedContact(c);
    setContactQuery(c.name ? `${c.name} (${formatPhone(c.phone)})` : formatPhone(c.phone));
    setContactDropdownOpen(false);
    setChatOpen(true);
  };

  const handleProductSearch = (val: string) => {
    setProductQuery(val);
    setProductDropdownOpen(true);
    clearTimeout(productDebounceRef.current);
    productDebounceRef.current = setTimeout(() => searchProducts(val), 250);
  };

  const finalizeOrderLine = (
    p: ProductHit,
    variant?: {
      id?: string | null;
      name: string;
      unitPrice: number;
      salePriceAmount?: number | null;
      property2?: string | null;
      vatRate?: number;
      imageUrl?: string | null;
      priceIncludesVat?: boolean;
    },
  ) => {
    // İndirimli fiyat varsa onu kullan: KDV hariç, %10 KDV
    const variantSale = variant?.salePriceAmount != null && variant.salePriceAmount > 0
      ? variant.salePriceAmount
      : null;
    const productSale = p.salePriceAmount != null && p.salePriceAmount > 0
      ? p.salePriceAmount
      : null;
    const salePrice = variantSale ?? productSale;

    let effectiveUnitPrice: number;
    let effectiveVat: number;
    let effectiveIncl: boolean;

    if (salePrice != null) {
      effectiveUnitPrice = salePrice;
      effectiveVat = 10;
      effectiveIncl = false;
    } else {
      effectiveUnitPrice = variant ? variant.unitPrice : p.unitPrice;
      effectiveVat =
        variant?.vatRate != null && Number.isFinite(Number(variant.vatRate))
          ? Math.round(Number(variant.vatRate))
          : p.vatRate != null && Number.isFinite(Number(p.vatRate))
            ? Math.round(Number(p.vatRate))
            : 20;
      effectiveIncl =
        variant?.priceIncludesVat !== undefined
          ? variant.priceIncludesVat
          : p.priceIncludesVat !== undefined
            ? p.priceIncludesVat
            : true;
    }

    setLines((prev) => [
      ...prev,
      {
        key: genKey(),
        productId: p.id,
        productVariantId: variant?.id ?? undefined,
        lineImageUrl: (variant?.imageUrl && String(variant.imageUrl).trim()) || p.imageUrl || undefined,
        name: variant ? variant.name : p.name,
        colorFabricInfo: '',
        measurementInfo: variant?.property2 ?? '',
        quantity: 1,
        unitPrice: effectiveUnitPrice,
        vatRate: effectiveVat,
        priceIncludesVat: effectiveIncl,
        isFromStock: true,
        sourceType: 'STOCK',
        supplierId: '',
        supplierOrderNo: '',
      },
    ]);
    toast.success(salePrice != null ? 'Ürün indirimli fiyatla eklendi' : 'Ürün satıra eklendi');
    setProductQuery('');
    setProductResults([]);
    setProductDropdownOpen(false);
  };

  const onPickProductFromSearch = async (p: ProductHit) => {
    try {
      const { data } = await api.get(`/products/${p.id}/variants`);
      const vars = Array.isArray(data) ? data : [];
      if (vars.length === 0) {
        finalizeOrderLine(p);
        return;
      }
      setVariantPick({ product: p, variants: vars });
      setProductQuery('');
      setProductResults([]);
      setProductDropdownOpen(false);
    } catch {
      finalizeOrderLine(p);
    }
  };

  const updateLine = (key: string, patch: Partial<LocalLineItem>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((line) => line.key !== key) : prev));
  };

  const addEmptyLine = () => setLines((prev) => [...prev, emptyLine()]);

  const submit = async () => {
    if (!selectedContact?.id) {
      toast.error('Lütfen bir kişi seçin');
      return;
    }
    const validLines = lines.filter((l) => l.name.trim() && l.quantity > 0 && l.unitPrice > 0);
    for (const l of validLines) {
      const sourceType = l.sourceType || (l.isFromStock ? 'STOCK' : 'SUPPLIER');
      if (sourceType === 'SUPPLIER' && !l.supplierId) {
        toast.error(`${l.name || 'Kalem'} için tedarikçi seçimi zorunlu`);
        return;
      }
    }
    if (!validLines.length) {
      toast.error('En az bir geçerli kalem girin');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/orders', {
        contactId: selectedContact.id,
        currency: 'TRY',
        shippingAddress: shippingAddress.trim() || null,
        notes: notes.trim() || null,
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate).toISOString() : null,
        pushToTsoft,
        items: validLines.map((l) => ({
          productId: l.productId || undefined,
          productVariantId: l.productVariantId || undefined,
          name: l.name.trim(),
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: Math.round(l.vatRate),
          priceIncludesVat: l.priceIncludesVat !== false,
          isFromStock: (l.sourceType || (l.isFromStock ? 'STOCK' : 'SUPPLIER')) === 'STOCK',
          supplierId:
            (l.sourceType || (l.isFromStock ? 'STOCK' : 'SUPPLIER')) === 'SUPPLIER'
              ? l.supplierId || undefined
              : undefined,
          supplierOrderNo:
            (l.sourceType || (l.isFromStock ? 'STOCK' : 'SUPPLIER')) === 'STOCK'
              ? undefined
              : (l.supplierOrderNo || '').trim(),
          colorFabricInfo: String(l.colorFabricInfo ?? '').trim() || undefined,
          measurementInfo: String(l.measurementInfo ?? '').trim() || undefined,
        })),
      });
      toast.success('Sipariş oluşturuldu');
      router.push(`/orders/${data.id}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Sipariş oluşturulamadı'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 w-full max-w-none space-y-6">
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
                  priceDisplay={fmt(v.unitPrice)}
                  discountedPriceDisplay={
                    v.salePriceAmount != null && v.salePriceAmount !== v.unitPrice
                      ? fmt(v.salePriceAmount)
                      : null
                  }
                  onSelect={() => {
                    finalizeOrderLine(variantPick.product, v);
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
      <button
        type="button"
        onClick={() => router.push('/orders')}
        className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-whatsapp"
      >
        <ArrowLeft className="w-4 h-4" />
        Siparişlere dön
      </button>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-5">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Package className="w-5 h-5 text-whatsapp" />
          Manuel Sipariş Oluştur
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="text-xs text-gray-500 font-medium">Kişi</label>
            <input
              value={contactQuery}
              onChange={(e) => handleContactSearch(e.target.value)}
              onFocus={() => setContactDropdownOpen(true)}
              placeholder="Kişi adı veya telefon"
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm"
            />
            {contactDropdownOpen && contactResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {contactResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickContact(c)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50"
                  >
                    <div className="text-sm text-gray-900">{c.name || formatPhone(c.phone)}</div>
                    <div className="text-xs text-gray-400">{formatPhone(c.phone)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">Planlanan teslim</label>
            <input
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm"
            />
          </div>
        </div>

        <div className="relative">
          <label className="text-xs text-gray-500 font-medium">Ürün ekle</label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={productQuery}
              onChange={(e) => handleProductSearch(e.target.value)}
              onFocus={() => setProductDropdownOpen(true)}
              placeholder="Tam ürün adı veya SKU (tam eşleşme)"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm"
            />
          </div>
          {productDropdownOpen && productResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {productResults.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void onPickProductFromSearch(p)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-50 last:border-0"
                >
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-md border border-gray-100 bg-gray-50 overflow-hidden shrink-0">
                    {p.imageUrl ? (
                      <img src={rewriteMediaUrlForClient(p.imageUrl)} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div>
                    <div className="text-sm text-gray-900">{p.name}</div>
                    <div className="text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">
                      <span>{p.sku || 'SKU yok'}</span>
                      {p.salePriceAmount != null && p.salePriceAmount > 0 ? (
                        <>
                          <span className="text-green-600 font-semibold">{fmt(p.salePriceAmount)}</span>
                          <span className="line-through">{fmt(p.unitPrice)}</span>
                        </>
                      ) : (
                        <span>{fmt(p.unitPrice)}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border border-gray-100 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left w-20 sm:w-24">Görsel</th>
                <th className="px-3 py-2 text-left min-w-[140px]">Kalem</th>
                <th className="px-3 py-2 text-left min-w-[140px]">Renk/Kumaş</th>
                <th className="px-3 py-2 text-left min-w-[140px]">Ölçü</th>
                <th className="px-3 py-2 text-right w-20">Adet</th>
                <th className="px-3 py-2 text-right w-32">Birim fiyat</th>
                <th className="px-3 py-2 text-left w-44">Kaynak</th>
                <th className="px-3 py-2 text-left w-48">Tedarikçi</th>
                <th className="px-3 py-2 text-left w-44">Sipariş No / Referans</th>
                <th className="px-3 py-2 text-right w-28">Toplam</th>
                <th className="px-3 py-2 w-12" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={line.key} className="border-t border-gray-50">
                  <td className="px-3 py-2">
                    <div className="w-12 h-12 rounded border border-gray-100 bg-gray-50 overflow-hidden">
                      {line.lineImageUrl ? <img src={rewriteMediaUrlForClient(line.lineImageUrl)} alt="" className="w-full h-full object-cover" /> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      value={line.name}
                      onChange={(e) => updateLine(line.key, { name: e.target.value })}
                      placeholder="Ürün adı"
                      className="w-full px-2 py-1.5 rounded border border-gray-200"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <ColorFabricLineCell
                      productId={line.productId}
                      value={line.colorFabricInfo ?? ''}
                      onChange={(next) => updateLine(line.key, { colorFabricInfo: next })}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      value={line.measurementInfo ?? ''}
                      onChange={(e) => updateLine(line.key, { measurementInfo: e.target.value })}
                      placeholder="Örn. 180×200"
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: Math.max(1, parseFloat(e.target.value) || 1) })}
                      className="w-full px-2 py-1.5 rounded border border-gray-200 text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={line.unitPrice}
                      onChange={(e) => updateLine(line.key, { unitPrice: Math.max(0, parseFloat(e.target.value) || 0) })}
                      className="w-full px-2 py-1.5 rounded border border-gray-200 text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.sourceType || (line.isFromStock ? 'STOCK' : 'SUPPLIER')}
                      onChange={(e) => {
                        const nextSource = e.target.value as 'STOCK' | 'SUPPLIER';
                        updateLine(line.key, {
                          sourceType: nextSource,
                          isFromStock: nextSource === 'STOCK',
                          ...(nextSource === 'STOCK'
                            ? { supplierId: '', supplierOrderNo: '' }
                            : {}),
                        });
                      }}
                      className="w-full px-2 py-1.5 rounded border border-gray-200 text-sm"
                    >
                      <option value="STOCK">Stoktan</option>
                      <option value="SUPPLIER">Tedarikçi</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.supplierId || ''}
                      disabled={(line.sourceType || (line.isFromStock ? 'STOCK' : 'SUPPLIER')) !== 'SUPPLIER'}
                      onChange={(e) => updateLine(line.key, { supplierId: e.target.value })}
                      className="w-full px-2 py-1.5 rounded border border-gray-200 text-sm disabled:bg-gray-100"
                    >
                      <option value="">Tedarikçi seç</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.supplierOrderNo || ''}
                      disabled={(line.sourceType || (line.isFromStock ? 'STOCK' : 'SUPPLIER')) !== 'SUPPLIER' || !line.supplierId}
                      onChange={(e) => updateLine(line.key, { supplierOrderNo: e.target.value })}
                      placeholder="Sipariş no (opsiyonel)"
                      className="w-full px-2 py-1.5 rounded border border-gray-200 text-sm disabled:bg-gray-100"
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{fmt(totals.lineTotals[idx] || 0)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => removeLine(line.key)} className="p-1.5 rounded hover:bg-red-50 text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3 border-t border-gray-100 bg-gray-50">
            <button type="button" onClick={addEmptyLine} className="text-sm text-whatsapp font-medium">
              + Boş kalem ekle
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <textarea
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            rows={3}
            placeholder="Sevk adresi"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Notlar"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
          />
        </div>

        <div className="ml-auto w-full md:w-80 rounded-xl border border-green-100 bg-green-50/50 p-4 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600"><span>Ara toplam</span><span>{fmt(totals.subtotal)}</span></div>
          <div className="flex justify-between text-gray-600"><span>KDV</span><span>{fmt(totals.vatTotal)}</span></div>
          <div className="flex justify-between text-base font-semibold text-gray-900 pt-2 border-t border-green-100">
            <span>Genel toplam</span><span>{fmt(totals.grandTotal)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={pushToTsoft}
              onChange={(e) => setPushToTsoft(e.target.checked)}
              className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp"
            />
            T-Soft sitesine de gönderilsin (kuyruğa alınır)
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-semibold hover:bg-green-600 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Siparişi Oluştur
          </button>
        </div>
      </div>
      <div className="fixed bottom-6 right-6 z-40">
        <button
          type="button"
          onClick={() => selectedContact && setChatOpen((v) => !v)}
          disabled={!selectedContact}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-lg border',
            selectedContact
              ? 'bg-white border-whatsapp/30 text-gray-800 hover:bg-green-50'
              : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed',
          )}
        >
          {chatOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          WhatsApp
        </button>
      </div>
      {selectedContact && chatOpen && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setChatOpen(false)} />
          <aside className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white z-50 shadow-2xl border-l border-gray-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900">WhatsApp Sohbet</h3>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <QuoteEmbeddedChat contactId={selectedContact.id} contactPhone={selectedContact.phone} />
          </aside>
        </>
      )}
    </div>
  );
}
