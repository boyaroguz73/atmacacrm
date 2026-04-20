'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import { rewriteMediaUrlForClient } from '@/lib/utils';
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
  RefreshCw,
  ImageDown,
} from 'lucide-react';

const PAGE_SIZE = 20;

interface ProductVariantLite {
  id: string;
  tsoftId?: string | null;
  sku?: string | null;
  name: string;
  unitPrice: number;
  listPrice?: number | null;
  salePriceAmount?: number | null;
  stock?: number | null;
  isActive: boolean;
  imageUrl?: string | null;
}

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
  productFeedSource?: 'MANUAL' | 'TSOFT';
  productUrl?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  listPrice?: number | null;
  salePriceAmount?: number | null;
  salePriceEffectiveRange?: string | null;
  brand?: string | null;
  googleProductCategory?: string | null;
  googleProductType?: string | null;
  googleCustomLabel0?: string | null;
  googleCondition?: string | null;
  googleAvailability?: string | null;
  googleIdentifierExists?: string | null;
  gtin?: string | null;
  additionalImages?: string[] | null;
  tsoftId?: string | null;
  tsoftLastPulledAt?: string | null;
  pendingPushOp?: 'CREATE' | 'UPDATE' | 'DELETE' | null;
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
  const [pushToTsoft, setPushToTsoft] = useState(false);
  const [editingVariants, setEditingVariants] = useState<ProductVariantLite[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [downloadingImages, setDownloadingImages] = useState(false);
  const [syncingTsoft, setSyncingTsoft] = useState(false);

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
    setPushToTsoft(false);
    setEditingVariants([]);
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setForm(productToForm(p));
    setPushToTsoft(p.productFeedSource === 'TSOFT');
    setEditingVariants([]);
    setShowForm(true);
    if (p.productFeedSource === 'TSOFT') {
      void loadVariants(p.id);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingProduct(null);
    setForm(emptyForm());
    setPushToTsoft(false);
    setEditingVariants([]);
  };

  const loadVariants = async (productId: string) => {
    setVariantsLoading(true);
    try {
      const { data } = await api.get<{ variants: ProductVariantLite[] }>(
        `/products/${productId}/variants`,
      );
      setEditingVariants(Array.isArray(data?.variants) ? data.variants : []);
    } catch {
      setEditingVariants([]);
    } finally {
      setVariantsLoading(false);
    }
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
    const payload: Record<string, unknown> = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      unit: form.unit.trim() || 'Adet',
      unitPrice,
      currency: form.currency,
      vatRate: vat,
      stock: stockVal,
    };
    if (pushToTsoft) payload.pushToTsoft = true;
    setSaving(true);
    try {
      if (editingProduct) {
        await api.patch(`/products/${editingProduct.id}`, payload);
        toast.success(
          pushToTsoft ? 'Ürün güncellendi · T-Soft kuyruğa alındı' : 'Ürün güncellendi',
        );
      } else {
        await api.post('/products', payload);
        toast.success(
          pushToTsoft ? 'Ürün oluşturuldu · T-Soft kuyruğa alındı' : 'Ürün oluşturuldu',
        );
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
    const isTsoft = p.productFeedSource === 'TSOFT';
    const msg = isTsoft
      ? `“${p.name}” T-Soft'ta da silinecek (kuyruğa alınır). Devam edilsin mi?`
      : `“${p.name}” silinsin mi? Bu işlem geri alınamaz.`;
    if (!confirm(msg)) return;
    try {
      await api.delete(`/products/${p.id}`, {
        params: isTsoft ? { pushToTsoft: 'true' } : {},
      });
      toast.success(isTsoft ? 'Silme kuyruğa alındı' : 'Ürün silindi');
      fetchProducts();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  const runTsoftSync = async () => {
    setSyncingTsoft(true);
    try {
      const { data } = await api.post<{
        upsertedProducts: number;
        upsertedVariants: number;
      }>('/ecommerce/tsoft/sync-products', {}, { timeout: 180_000 });
      toast.success(
        `T-Soft senkron: ${data.upsertedProducts ?? 0} ürün · ${data.upsertedVariants ?? 0} varyant`,
      );
      fetchProducts();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'T-Soft senkron başarısız'));
    } finally {
      setSyncingTsoft(false);
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

  const downloadProductImages = async () => {
    setDownloadingImages(true);
    try {
      const { data } = await api.post<{
        total: number;
        downloaded: number;
        alreadyLocal: number;
        failed: number;
      }>('/products/download-images', {}, { timeout: 300_000 });
      toast.success(
        `Görsel indirme: ${data.downloaded} indirildi, ${data.alreadyLocal} zaten yerel, ${data.failed} başarısız`,
      );
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Görsel indirme başarısız'));
    } finally {
      setDownloadingImages(false);
    }
  };

  const formatMoney = (n: number, currency: string) =>
    new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency === 'TRY' || currency === 'USD' || currency === 'EUR' ? currency : 'TRY',
      minimumFractionDigits: 2,
    }).format(n);

  return (
    <div className="p-4 sm:p-6 pt-0">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-8 h-8 text-whatsapp" />
              Ürünler
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              SKU, fiyat ve stok. T-Soft kaynaklı ürünler ve elle eklenenler tek listede görünür; T-Soft tarafıyla senkron
              admin entegrasyonlar panelinden yapılır.
            </p>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={syncingTsoft}
                onClick={() => void runTsoftSync()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-orange-200 bg-orange-50 text-sm font-medium text-orange-700 shadow-sm hover:bg-orange-100 disabled:opacity-50 transition-colors"
                title="T-Soft API'den ürünleri ve varyantları senkronize et"
              >
                {syncingTsoft ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                T-Soft senkron
              </button>
              <button
                type="button"
                disabled={downloadingImages}
                onClick={() => void downloadProductImages()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {downloadingImages ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImageDown className="w-4 h-4 text-blue-600" />
                )}
                Görselleri İndir
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
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 whitespace-nowrap">Görsel</th>
                    <th className="px-4 py-3 whitespace-nowrap">SKU</th>
                    <th className="px-4 py-3 whitespace-nowrap">Kaynak</th>
                    <th className="px-4 py-3">Ad</th>
                    <th className="px-4 py-3 whitespace-nowrap">Kategori</th>
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
                      <td colSpan={11} className="px-4 py-16 text-center text-gray-400">
                        Ürün bulunamadı
                      </td>
                    </tr>
                  ) : (
                    products.map((p) => (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3">
                          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={rewriteMediaUrlForClient(p.imageUrl)}
                                alt={p.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="flex w-full h-full items-center justify-center text-[10px] text-gray-300">
                                —
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-800">{p.sku}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ${
                                p.productFeedSource === 'TSOFT'
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                              title={
                                p.productFeedSource === 'TSOFT'
                                  ? `T-Soft ID: ${p.tsoftId || '—'}`
                                  : undefined
                              }
                            >
                              {p.productFeedSource === 'TSOFT' ? 'T-Soft' : 'El'}
                            </span>
                            {p.pendingPushOp ? (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-amber-100 text-amber-800"
                                title={`Kuyrukta: ${p.pendingPushOp}`}
                              >
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                {p.pendingPushOp}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate" title={p.name}>
                          {p.name}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-[220px] truncate" title={p.category || ''}>
                          {p.category || '—'}
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
              {editingProduct?.productFeedSource === 'TSOFT' ? (
                <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 text-xs text-gray-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-orange-900">T-Soft bağlı ürün</p>
                      <p className="text-[11px] text-orange-700 mt-0.5">
                        {editingProduct.tsoftId ? `T-Soft ID: ${editingProduct.tsoftId}` : 'T-Soft ID yok'}
                        {editingProduct.tsoftLastPulledAt
                          ? ` · Son pull: ${new Date(editingProduct.tsoftLastPulledAt).toLocaleString('tr-TR')}`
                          : ''}
                      </p>
                    </div>
                    {editingProduct.pendingPushOp ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-amber-200 text-amber-900">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Kuyrukta · {editingProduct.pendingPushOp}
                      </span>
                    ) : null}
                  </div>
                  <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pushToTsoft}
                      onChange={(e) => setPushToTsoft(e.target.checked)}
                      className="mt-0.5 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
                    />
                    <span>
                      <span className="font-medium text-gray-900">T-Soft'a da yaz</span>
                      <span className="block text-[11px] text-gray-500 mt-0.5">
                        Değişiklik önce T-Soft'a itilecek (kuyruk), başarılı olunca bir sonraki pull ile
                        CRM doğrulanacak. Kapatırsanız değişiklik yalnızca CRM'de kalır (bir sonraki pull
                        üzerine yazabilir).
                      </span>
                    </span>
                  </label>
                </div>
              ) : !editingProduct ? (
                <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <input
                    type="checkbox"
                    checked={pushToTsoft}
                    onChange={(e) => setPushToTsoft(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
                  />
                  <span>
                    <span className="font-medium text-gray-900">T-Soft'a da oluştur</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">
                      Ürün kuyruğa alınır, T-Soft'ta oluşturulduktan sonra T-Soft ID geri döner.
                    </span>
                  </span>
                </label>
              ) : null}

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
              {editingProduct?.productFeedSource === 'TSOFT' ? (
                <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-900">
                      Varyantlar {editingVariants.length > 0 ? `(${editingVariants.length})` : ''}
                    </p>
                    {variantsLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => void loadVariants(editingProduct.id)}
                        className="text-[11px] text-gray-500 hover:text-gray-800"
                      >
                        Yenile
                      </button>
                    )}
                  </div>
                  {editingVariants.length === 0 && !variantsLoading ? (
                    <p className="text-[11px] text-gray-400 py-1">Varyant bulunamadı.</p>
                  ) : (
                    <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                      {editingVariants.map((v) => (
                        <div key={v.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                          <div className="w-8 h-8 shrink-0 rounded-md border border-gray-100 bg-gray-50 overflow-hidden">
                            {v.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={rewriteMediaUrlForClient(v.imageUrl)}
                                alt={v.name}
                                className="w-full h-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-800 truncate" title={v.name}>
                              {v.name}
                            </p>
                            <p className="text-gray-400 font-mono truncate" title={v.sku || ''}>
                              {v.sku || '—'}
                            </p>
                          </div>
                          <div className="text-right tabular-nums">
                            <p className="text-gray-800">{formatMoney(v.unitPrice, editingProduct.currency)}</p>
                            <p className="text-[10px] text-gray-400">
                              Stok: {v.stock != null ? v.stock : '—'}
                            </p>
                          </div>
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              v.isActive ? 'bg-emerald-500' : 'bg-gray-300'
                            }`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-gray-400">
                    Varyant düzenleme T-Soft üzerinden yapılır; buradaki veriler pull senkronu ile güncellenir.
                  </p>
                </div>
              ) : null}

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
                  {pushToTsoft ? ' · T-Soft' : ''}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
