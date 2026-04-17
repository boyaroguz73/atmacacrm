'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone, rewriteMediaUrlForClient } from '@/lib/utils';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, Package, Search, Trash2 } from 'lucide-react';

interface LocalLineItem {
  key: string;
  productId?: string;
  lineImageUrl?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  isFromStock: boolean;
  sourceType?: 'STOCK' | 'SUPPLIER' | 'EXISTING_CUSTOMER';
  supplierId?: string;
  supplierOrderNo?: string;
}

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  unitPrice: number;
  vatRate: number;
  imageUrl?: string | null;
}

interface SupplierHit {
  id: string;
  name: string;
}

type OrderPaymentModeUI = 'FULL' | 'DEPOSIT_50' | 'CUSTOM';

function calcTotals(items: LocalLineItem[]) {
  let subtotal = 0;
  let vatTotal = 0;
  let grandTotal = 0;
  const lineTotals = items.map((item) => {
    const lineGross = item.quantity * item.unitPrice;
    const divider = 1 + item.vatRate / 100;
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
    quantity: 1,
    unitPrice: 0,
    vatRate: 20,
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
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string | null; phone: string } | null>(null);
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductHit[]>([]);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const productDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [lines, setLines] = useState<LocalLineItem[]>([emptyLine()]);
  const [shippingAddress, setShippingAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierHit[]>([]);
  const [paymentMode, setPaymentMode] = useState<OrderPaymentModeUI>('FULL');
  const [customPaymentValue, setCustomPaymentValue] = useState('');

  const totals = useMemo(() => calcTotals(lines), [lines]);

  useEffect(() => {
    api
      .get('/suppliers', { params: { isActive: true, limit: 200 } })
      .then(({ data }) => setSuppliers(data.suppliers || []))
      .catch(() => setSuppliers([]));
  }, []);

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
  };

  const handleProductSearch = (val: string) => {
    setProductQuery(val);
    setProductDropdownOpen(true);
    clearTimeout(productDebounceRef.current);
    productDebounceRef.current = setTimeout(() => searchProducts(val), 250);
  };

  const addProductLine = (p: ProductHit) => {
    setLines((prev) => [
      ...prev,
      {
        key: genKey(),
        productId: p.id,
        lineImageUrl: p.imageUrl || undefined,
        name: p.name,
        quantity: 1,
        unitPrice: p.unitPrice,
        vatRate: p.vatRate ?? 20,
        isFromStock: true,
        sourceType: 'STOCK',
        supplierId: '',
        supplierOrderNo: '',
      },
    ]);
    setProductQuery('');
    setProductResults([]);
    setProductDropdownOpen(false);
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
      if (sourceType === 'SUPPLIER' && (!l.supplierId || !l.supplierOrderNo?.trim())) {
        toast.error(`${l.name || 'Kalem'} için tedarikçi ve sipariş no zorunlu`);
        return;
      }
      if (sourceType === 'EXISTING_CUSTOMER' && !l.supplierOrderNo?.trim()) {
        toast.error(`${l.name || 'Kalem'} için eski müşteri referansı zorunlu`);
        return;
      }
    }
    if (!validLines.length) {
      toast.error('En az bir geçerli kalem girin');
      return;
    }
    if (paymentMode === 'CUSTOM') {
      const custom = Number(customPaymentValue);
      if (!(custom > 0) || custom > 100) {
        toast.error('Özel ödeme yüzdesi 0-100 arasında olmalı');
        return;
      }
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/orders', {
        contactId: selectedContact.id,
        currency: 'TRY',
        shippingAddress: shippingAddress.trim() || null,
        notes: notes.trim() || null,
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate).toISOString() : null,
        payment: {
          mode: paymentMode,
          customValue: paymentMode === 'CUSTOM' ? Number(customPaymentValue) || undefined : undefined,
        },
        items: validLines.map((l) => ({
          productId: l.productId || undefined,
          name: l.name.trim(),
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: Math.round(l.vatRate),
          isFromStock: (l.sourceType || (l.isFromStock ? 'STOCK' : 'SUPPLIER')) === 'STOCK',
          supplierId:
            (l.sourceType || (l.isFromStock ? 'STOCK' : 'SUPPLIER')) === 'SUPPLIER'
              ? l.supplierId || undefined
              : undefined,
          supplierOrderNo:
            (l.sourceType || (l.isFromStock ? 'STOCK' : 'SUPPLIER')) === 'STOCK'
              ? undefined
              : (l.supplierOrderNo || '').trim(),
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
              placeholder="Ürün adı / SKU ara"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm"
            />
          </div>
          {productDropdownOpen && productResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {productResults.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProductLine(p)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center gap-3 border-b border-gray-50 last:border-0"
                >
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-md border border-gray-100 bg-gray-50 overflow-hidden shrink-0">
                    {p.imageUrl ? (
                      <img src={rewriteMediaUrlForClient(p.imageUrl)} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div>
                    <div className="text-sm text-gray-900">{p.name}</div>
                    <div className="text-xs text-gray-400">
                      {p.sku || 'SKU yok'} · {fmt(p.unitPrice)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left w-20 sm:w-24">Görsel</th>
                <th className="px-3 py-2 text-left">Kalem</th>
                <th className="px-3 py-2 text-right w-20">Adet</th>
                <th className="px-3 py-2 text-right w-32">Birim (KDV Dahil)</th>
                <th className="px-3 py-2 text-right w-20">KDV %</th>
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
                  <td className="px-3 py-2">
                    <input
                      value={line.name}
                      onChange={(e) => updateLine(line.key, { name: e.target.value })}
                      className="w-full px-2 py-1.5 rounded border border-gray-200"
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
                    <input
                      type="number"
                      step="1"
                      min={0}
                      value={line.vatRate}
                      onChange={(e) => updateLine(line.key, { vatRate: Math.max(0, parseFloat(e.target.value) || 0) })}
                      className="w-full px-2 py-1.5 rounded border border-gray-200 text-right"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={line.sourceType || (line.isFromStock ? 'STOCK' : 'SUPPLIER')}
                      onChange={(e) => {
                        const nextSource = e.target.value as 'STOCK' | 'SUPPLIER' | 'EXISTING_CUSTOMER';
                        updateLine(line.key, {
                          sourceType: nextSource,
                          isFromStock: nextSource === 'STOCK',
                          ...(nextSource === 'STOCK'
                            ? { supplierId: '', supplierOrderNo: '' }
                            : nextSource === 'EXISTING_CUSTOMER'
                              ? { supplierId: '' }
                              : {}),
                        });
                      }}
                      className="w-full px-2 py-1.5 rounded border border-gray-200 text-sm"
                    >
                      <option value="STOCK">Stoktan</option>
                      <option value="SUPPLIER">Tedarikçi</option>
                      <option value="EXISTING_CUSTOMER">Eski müşteri</option>
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
                      disabled={(line.sourceType || (line.isFromStock ? 'STOCK' : 'SUPPLIER')) === 'STOCK'}
                      onChange={(e) => updateLine(line.key, { supplierOrderNo: e.target.value })}
                      placeholder={(line.sourceType || (line.isFromStock ? 'STOCK' : 'SUPPLIER')) === 'EXISTING_CUSTOMER' ? 'Müşteri referansı' : 'Sipariş no'}
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
          <div className="md:col-span-2 rounded-xl border border-gray-100 bg-gray-50/50 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-600 uppercase">Ödeme seçimi</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="order-payment"
                  checked={paymentMode === 'FULL'}
                  onChange={() => setPaymentMode('FULL')}
                />
                Tam ödeme
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="order-payment"
                  checked={paymentMode === 'DEPOSIT_50'}
                  onChange={() => setPaymentMode('DEPOSIT_50')}
                />
                %50 ön ödeme
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="order-payment"
                  checked={paymentMode === 'CUSTOM'}
                  onChange={() => setPaymentMode('CUSTOM')}
                />
                Özel yüzde
              </label>
            </div>
            {paymentMode === 'CUSTOM' ? (
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={customPaymentValue}
                onChange={(e) => setCustomPaymentValue(e.target.value)}
                placeholder="Örn: 30"
                className="w-full md:w-56 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
              />
            ) : null}
          </div>
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

        <div className="flex justify-end">
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
    </div>
  );
}
