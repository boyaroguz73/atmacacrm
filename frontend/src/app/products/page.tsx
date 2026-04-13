'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import {
  Package,
  Search,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  FileSpreadsheet,
} from 'lucide-react';

const PAGE_SIZE = 20;

interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: number;
  currency: string;
  vatRate: number;
  stock: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type FormState = {
  sku: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: string;
  currency: string;
  vatRate: string;
  stock: string;
};

const emptyForm = (): FormState => ({
  sku: '',
  name: '',
  description: '',
  unit: 'Adet',
  unitPrice: '',
  currency: 'TRY',
  vatRate: '20',
  stock: '',
});

function productToForm(p: Product): FormState {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description ?? '',
    unit: p.unit || 'Adet',
    unitPrice: String(p.unitPrice),
    currency: p.currency || 'TRY',
    vatRate: String(p.vatRate),
    stock: p.stock != null ? String(p.stock) : '',
  };
}

export default function ProductsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ products: Product[]; total: number; page: number; totalPages?: number }>(
        '/products',
        {
          params: {
            search: debouncedSearch || undefined,
            page,
            limit: PAGE_SIZE,
          },
        },
      );
      setProducts(Array.isArray(data?.products) ? data.products : []);
      setTotal(typeof data?.total === 'number' ? data.total : 0);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Ürünler yüklenemedi'));
      setProducts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const openCreate = () => {
    setEditingProduct(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setForm(productToForm(p));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingProduct(null);
    setForm(emptyForm());
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const unitPrice = parseFloat(form.unitPrice.replace(',', '.'));
    if (!form.sku.trim() || !form.name.trim()) {
      toast.error('SKU ve ad zorunludur');
      return;
    }
    if (Number.isNaN(unitPrice) || unitPrice < 0) {
      toast.error('Geçerli bir birim fiyat girin');
      return;
    }
    const stockVal = form.stock.trim() === '' ? undefined : parseInt(form.stock, 10);
    if (form.stock.trim() !== '' && Number.isNaN(stockVal)) {
      toast.error('Stok sayı olmalıdır');
      return;
    }
    const vat = parseInt(form.vatRate, 10);
    const payload = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      unit: form.unit.trim() || 'Adet',
      unitPrice,
      currency: form.currency,
      vatRate: vat,
      stock: stockVal,
    };
    setSaving(true);
    try {
      if (editingProduct) {
        await api.patch(`/products/${editingProduct.id}`, payload);
        toast.success('Ürün güncellendi');
      } else {
        await api.post('/products', payload);
        toast.success('Ürün oluşturuldu');
      }
      closeForm();
      fetchProducts();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, editingProduct ? 'Güncelleme başarısız' : 'Oluşturma başarısız'));
    } finally {
      setSaving(false);
    }
  };

  const removeProduct = async (p: Product) => {
    if (!confirm(`“${p.name}” silinsin mi? Bu işlem geri alınamaz.`)) return;
    try {
      await api.delete(`/products/${p.id}`);
      toast.success('Ürün silindi');
      fetchProducts();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  const toggleActive = async (p: Product) => {
    setTogglingId(p.id);
    try {
      await api.patch(`/products/${p.id}`, { isActive: !p.isActive });
      toast.success(p.isActive ? 'Ürün pasifleştirildi' : 'Ürün aktifleştirildi');
      setProducts((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, isActive: !x.isActive } : x)),
      );
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Durum güncellenemedi'));
    } finally {
      setTogglingId(null);
    }
  };

  const onExcelSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Yalnızca .xlsx dosyası yükleyin');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    setImporting(true);
    try {
      const { data } = await api.post<{ imported: number; updated: number; errors: string[] }>(
        '/products/import-excel',
        fd,
      );
      const errCount = data.errors?.length ?? 0;
      toast.success(
        `İçe aktarma tamamlandı: ${data.imported ?? 0} yeni, ${data.updated ?? 0} güncellendi${
          errCount ? `, ${errCount} satır hatası` : ''
        }`,
      );
      if (errCount && data.errors?.length) {
        const preview = data.errors.slice(0, 5).join(' · ');
        toast.error(preview + (data.errors.length > 5 ? '…' : ''), { duration: 6000 });
      }
      fetchProducts();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Excel yüklenemedi'));
    } finally {
      setImporting(false);
    }
  };

  const formatMoney = (n: number, currency: string) =>
    new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency === 'TRY' || currency === 'USD' || currency === 'EUR' ? currency : 'TRY',
      minimumFractionDigits: 2,
    }).format(n);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-8 h-8 text-whatsapp" />
              Ürünler
            </h1>
            <p className="text-sm text-gray-500 mt-1">SKU, fiyat ve stok yönetimi</p>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={onExcelSelected}
              />
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-whatsapp" />}
                Excel içe aktar
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-medium shadow-sm hover:bg-whatsapp/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Yeni ürün
              </button>
            </div>
          ) : null}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="SKU, ad veya açıklama ara…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-500 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-whatsapp" />
              Yükleniyor…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[880px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 whitespace-nowrap">SKU</th>
                    <th className="px-4 py-3">Ad</th>
                    <th className="px-4 py-3 whitespace-nowrap">Birim Fiyat</th>
                    <th className="px-4 py-3 whitespace-nowrap">Para Birimi</th>
                    <th className="px-4 py-3 whitespace-nowrap">KDV %</th>
                    <th className="px-4 py-3 whitespace-nowrap">Stok</th>
                    <th className="px-4 py-3 whitespace-nowrap">Aktif</th>
                    <th className="px-4 py-3 whitespace-nowrap text-right">Aksiyonlar</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-gray-400">
                        Ürün bulunamadı
                      </td>
                    </tr>
                  ) : (
                    products.map((p) => (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-800">{p.sku}</td>
                        <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate" title={p.name}>
                          {p.name}
                        </td>
                        <td className="px-4 py-3 text-gray-700 tabular-nums">{formatMoney(p.unitPrice, p.currency)}</td>
                        <td className="px-4 py-3 text-gray-600">{p.currency}</td>
                        <td className="px-4 py-3 text-gray-600">{p.vatRate}</td>
                        <td className="px-4 py-3 text-gray-600 tabular-nums">{p.stock != null ? p.stock : '—'}</td>
                        <td className="px-4 py-3">
                          {isAdmin ? (
                            <button
                              type="button"
                              disabled={togglingId === p.id}
                              onClick={() => toggleActive(p)}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-whatsapp/30 focus:ring-offset-1 disabled:opacity-50 ${
                                p.isActive ? 'bg-whatsapp' : 'bg-gray-200'
                              }`}
                              role="switch"
                              aria-checked={p.isActive}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                                  p.isActive ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                              />
                            </button>
                          ) : (
                            <span className={p.isActive ? 'text-whatsapp font-medium' : 'text-gray-400'}>
                              {p.isActive ? 'Evet' : 'Hayır'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isAdmin ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEdit(p)}
                                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-whatsapp transition-colors"
                                title="Düzenle"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeProduct(p)}
                                className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                                title="Sil"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && total > 0 ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <p className="text-xs text-gray-500">
                Toplam <span className="font-semibold text-gray-700">{total}</span> kayıt · Sayfa{' '}
                <span className="font-semibold text-gray-700">{page}</span> / {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((x) => Math.max(1, x - 1))}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Önceki
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((x) => x + 1)}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  Sonraki
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div
            className="bg-white rounded-xl border border-gray-100 shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-form-title"
          >
            <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-white rounded-t-xl">
              <h2 id="product-form-title" className="text-lg font-semibold text-gray-900">
                {editingProduct ? 'Ürünü düzenle' : 'Yeni ürün'}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitForm} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">SKU</label>
                <input
                  required
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
                  placeholder="Benzersiz stok kodu"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Ad</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Açıklama</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20 resize-y"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Birim</label>
                  <input
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
                    placeholder="Adet"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Birim fiyat</label>
                  <input
                    required
                    inputMode="decimal"
                    value={form.unitPrice}
                    onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Para birimi</label>
                  <select
                    value={form.currency}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20 bg-white"
                  >
                    <option value="TRY">TRY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">KDV %</label>
                  <select
                    value={form.vatRate}
                    onChange={(e) => setForm((f) => ({ ...f, vatRate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20 bg-white"
                  >
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="10">10</option>
                    <option value="20">20</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Stok (boş bırakılabilir)</label>
                <input
                  inputMode="numeric"
                  value={form.stock}
                  onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-medium hover:bg-whatsapp/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {editingProduct ? 'Kaydet' : 'Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
