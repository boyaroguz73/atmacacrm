'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Package,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  ExternalLink,
  Trash2,
  Plus,
  X,
} from 'lucide-react';

type CatalogRow = {
  id: string;
  productCode: string;
  productName: string;
  sellingPrice: number | null;
  listPrice: number | null;
  stock: number | null;
  currency: string;
  vatRate: number | null;
  isActive: boolean;
  barcode: string | null;
  brand: string | null;
  shortDescription: string | null;
  detailsText: string | null;
};

export default function EcommerceProductsPage() {
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [creating, setCreating] = useState(false);

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const { data } = await api.get('/ecommerce/tsoft/catalog', {
        params: { page: p, limit: 30, search: q || undefined },
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total) || 0);
      setTotalPages(Number(data?.totalPages) || 1);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Katalog yüklenemedi');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search);
  }, [page, search, load]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-catalog', {}, { timeout: 300_000 });
      toast.success(`Senkron tamam: ${data?.upserted ?? 0} kayıt güncellendi/eklendi`);
      await load(page, search);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Senkron başarısız');
    } finally {
      setSyncing(false);
    }
  };

  const applySearch = () => {
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const deleteRow = async (row: CatalogRow) => {
    if (!window.confirm(`"${row.productName}" CRM katalogundan silinsin mi?`)) return;
    const deleteOnSite = window.confirm('T-Soft sitesindeki ürün de silinsin mi?\n\nTamam = site + CRM\nİptal = yalnızca CRM kaydı');
    try {
      await api.delete(`/ecommerce/tsoft/catalog/${row.id}`, {
        params: { deleteOnSite: deleteOnSite ? 'true' : 'false' },
      });
      toast.success('Silindi');
      await load(page, search);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Silinemedi');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-7 h-7 text-orange-500" />
            E-Ticaret Ürünleri
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-green-50 text-green-800 hover:bg-green-100"
          >
            <Plus className="w-4 h-4" />
            Yeni ürün
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={runSync}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-50 text-orange-800 hover:bg-orange-100 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            T-Soft’tan senkron
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Ürün adı, kod veya barkod…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applySearch()}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-gray-200 text-sm"
        />
        <button
          type="button"
          onClick={applySearch}
          className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-800 hover:bg-gray-200"
        >
          Ara
        </button>
        <span className="text-xs text-gray-400">{total} kayıt</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Yükleniyor…
          </div>
        ) : items.length === 0 ? (
          <p className="text-center py-16 text-gray-400 text-sm">
            Kayıt yok. «T-Soft’tan senkron» ile çekin veya yeni ürün ekleyin.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-4 py-3">Ürün</th>
                  <th className="px-4 py-3 hidden md:table-cell max-w-[200px]">Özet</th>
                  <th className="px-4 py-3">Kod</th>
                  <th className="px-4 py-3 text-right">Satış</th>
                  <th className="px-4 py-3 text-right">Stok</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link
                        href={`/ecommerce/products/${r.id}`}
                        className="text-orange-700 hover:underline inline-flex items-center gap-1"
                      >
                        {r.productName}
                        <ExternalLink className="w-3.5 h-3.5 opacity-50" />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell max-w-[200px] truncate" title={r.shortDescription || ''}>
                      {r.shortDescription ? r.shortDescription.replace(/<[^>]+>/g, '').slice(0, 80) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{r.productCode}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {r.sellingPrice != null ? `${r.sellingPrice} ${r.currency}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{r.stock ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${r.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {r.isActive ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => deleteRow(r)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/30">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
            Önceki
          </button>
          <span className="text-xs text-gray-500">
            Sayfa {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
          >
            Sonraki
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {creating && (
        <ProductFormModal
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load(page, search);
          }}
        />
      )}
    </div>
  );
}

function ProductFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [currency, setCurrency] = useState('TL');
  const [stock, setStock] = useState('0');
  const [vatRate, setVatRate] = useState('20');
  const [isActive, setIsActive] = useState(true);
  const [barcode, setBarcode] = useState('');
  const [brand, setBrand] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [detailsText, setDetailsText] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const sp = parseFloat(String(sellingPrice).replace(',', '.'));
      if (!Number.isFinite(sp)) {
        toast.error('Geçerli bir satış fiyatı girin');
        return;
      }
      if (!productCode.trim() || !productName.trim()) {
        toast.error('Ürün kodu ve adı zorunludur');
        return;
      }
      await api.post('/ecommerce/tsoft/catalog', {
        productCode: productCode.trim(),
        productName: productName.trim(),
        sellingPrice: sp,
        currency: currency || 'TL',
        stock: stock === '' ? 0 : parseInt(stock, 10) || 0,
        vatRate: vatRate === '' ? 20 : parseInt(vatRate, 10) || 20,
        isActive,
        barcode: barcode.trim() || undefined,
        brand: brand.trim() || undefined,
        shortDescription: shortDescription.trim() || undefined,
        detailsText: detailsText.trim() || undefined,
      });
      toast.success('Ürün oluşturuldu');
      await onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'İşlem başarısız');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Yeni ürün</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3 text-sm">
          <label className="block">
            <span className="text-gray-600 text-xs">Ürün kodu</span>
            <input
              required
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-gray-600 text-xs">Ürün adı</span>
            <input
              required
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-gray-600 text-xs">Satış fiyatı</span>
              <input
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-gray-600 text-xs">Para birimi</span>
              <input
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-gray-600 text-xs">Stok</span>
              <input
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-gray-600 text-xs">KDV %</span>
              <input
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
                value={vatRate}
                onChange={(e) => setVatRate(e.target.value)}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>Aktif</span>
          </label>
          <label className="block">
            <span className="text-gray-600 text-xs">Barkod</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-gray-600 text-xs">Marka</span>
            <input
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-gray-600 text-xs">Kısa açıklama</span>
            <textarea
              rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-gray-600 text-xs">Detay metni</span>
            <textarea
              rows={3}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200"
              value={detailsText}
              onChange={(e) => setDetailsText(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
