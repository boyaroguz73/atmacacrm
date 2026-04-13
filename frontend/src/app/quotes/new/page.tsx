'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Loader2,
  Package,
  Search,
  Trash2,
  X,
} from 'lucide-react';

type DiscountType = 'PERCENT' | 'AMOUNT';

interface LocalLineItem {
  key: string;
  productId?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
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
}

function currencySymbol(c: string): string {
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  return '₺';
}

/** Backend `QuotesService.calcTotals` ile aynı mantık (önizleme). */
function calcTotals(
  items: LocalLineItem[],
  discountType: DiscountType,
  discountValue: number,
) {
  let subtotal = 0;
  let vatTotal = 0;
  const calculated = items.map((item) => {
    let base = item.quantity * item.unitPrice;
    let lineDiscount = 0;
    if (item.discountValue && item.discountValue > 0) {
      lineDiscount =
        item.discountType === 'AMOUNT'
          ? item.discountValue
          : base * (item.discountValue / 100);
    }
    base -= lineDiscount;
    const vat = base * (item.vatRate / 100);
    subtotal += base;
    vatTotal += vat;
    const lineTotal = Math.round((base + vat) * 100) / 100;
    return { ...item, lineTotal };
  });

  let discountTotal = 0;
  if (discountValue > 0) {
    discountTotal =
      discountType === 'AMOUNT' ? discountValue : subtotal * (discountValue / 100);
  }
  const afterDiscount = subtotal - discountTotal;
  const adjustedVat = vatTotal * (afterDiscount / (subtotal || 1));
  const grandTotal = Math.round((afterDiscount + adjustedVat) * 100) / 100;

  return {
    lineTotals: calculated.map((c) => c.lineTotal),
    subtotal: Math.round(subtotal * 100) / 100,
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
    quantity: 1,
    unitPrice: 0,
    vatRate: 20,
    discountType: 'PERCENT',
    discountValue: 0,
  };
}

export default function NewQuotePage() {
  const router = useRouter();
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
  const [submitting, setSubmitting] = useState(false);

  const sym = currencySymbol(currency);

  const totals = useMemo(
    () => calcTotals(lines, discountType, discountValue),
    [lines, discountType, discountValue],
  );

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

  const addProductLine = (p: ProductHit) => {
    setLines((prev) => [
      ...prev,
      {
        key: genKey(),
        productId: p.id,
        name: p.name,
        description: p.description || undefined,
        quantity: 1,
        unitPrice: p.unitPrice,
        vatRate: p.vatRate,
        discountType: 'PERCENT',
        discountValue: 0,
      },
    ]);
    setProductQuery('');
    setProductResults([]);
    setProductDropdownOpen(false);
    toast.success('Ürün satıra eklendi');
  };

  const updateLine = (key: string, patch: Partial<LocalLineItem>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? [emptyLine()] : prev.filter((l) => l.key !== key)));
  };

  useEffect(() => {
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
    const validLines = lines.filter((l) => l.name.trim() !== '');
    if (!validLines.length) {
      toast.error('En az bir ürün satırı ekleyin');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/quotes', {
        contactId: selectedContact.id,
        currency,
        discountType,
        discountValue,
        validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
        deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : undefined,
        notes: notes.trim() || undefined,
        items: validLines.map((l) => ({
          productId: l.productId || undefined,
          name: l.name.trim(),
          description: l.description || undefined,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: Math.round(l.vatRate),
          discountType: l.discountType,
          discountValue: l.discountValue || 0,
        })),
      });
      toast.success('Teklif oluşturuldu');
      router.push('/quotes');
    } catch {
      toast.error('Teklif kaydedilemedi');
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => router.push('/quotes')}
          className="p-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          aria-label="Geri"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Yeni Teklif</h1>
          <p className="text-sm text-gray-500 mt-0.5">Kişi, ürün kalemleri ve koşullar</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
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
                      onMouseDown={() => addProductLine(p)}
                      className="w-full text-left px-4 py-2.5 hover:bg-green-50/60 border-b border-gray-50 last:border-0"
                    >
                      <p className="text-sm font-medium text-gray-900">{p.name}</p>
                      <p className="text-[11px] text-gray-500 font-mono">{p.sku}</p>
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
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50/90 text-gray-500 font-semibold uppercase tracking-wide text-[10px]">
                    <th className="text-left px-3 py-2 w-[28%]">Ürün</th>
                    <th className="text-left px-2 py-2 w-16">Miktar</th>
                    <th className="text-left px-2 py-2 w-24">Birim Fiyat</th>
                    <th className="text-left px-2 py-2 w-14">KDV %</th>
                    <th className="text-left px-2 py-2 w-24">İndirim</th>
                    <th className="text-left px-2 py-2 w-20">Değer</th>
                    <th className="text-right px-3 py-2 w-24">Satır Toplamı</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((line, idx) => (
                    <tr key={line.key} className="align-top">
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
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={line.vatRate}
                          onChange={(e) =>
                            updateLine(line.key, { vatRate: parseFloat(e.target.value) || 0 })
                          }
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={line.discountType}
                          onChange={(e) =>
                            updateLine(line.key, {
                              discountType: e.target.value as DiscountType,
                            })
                          }
                          className="w-full px-1 py-1.5 border border-gray-200 rounded-lg text-[11px] font-medium bg-white"
                        >
                          <option value="PERCENT">%</option>
                          <option value="AMOUNT">TL</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
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
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm tabular-nums"
                        />
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
          </section>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => router.push('/quotes')}
              className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-semibold hover:bg-green-600 disabled:opacity-60 shadow-sm"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Teklifi kaydet
            </button>
          </div>
        </div>

        {/* Özet paneli */}
        <aside className="lg:col-span-1">
          <div className="sticky top-6 bg-gradient-to-b from-green-50/80 to-white rounded-2xl border border-green-100 shadow-md p-6 space-y-4">
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
              <div className="pt-3 border-t border-green-100 flex justify-between items-baseline gap-2">
                <dt className="text-base font-bold text-gray-900">GENEL TOPLAM</dt>
                <dd className="text-2xl font-extrabold text-whatsapp tabular-nums">
                  {sym}
                  {fmt(totals.grandTotal)}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Tutarlar seçilen para birimine göre gösterilir. Kayıt sonrası teklif listesine
              yönlendirilirsiniz.
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}
