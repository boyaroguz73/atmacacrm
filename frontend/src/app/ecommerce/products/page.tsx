'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Package, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

export default function EcommerceProductsPage() {
  const [rows, setRows] = useState<unknown[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const { data } = await api.get('/ecommerce/tsoft/products', { params: { page: p, limit: 50 } });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setRaw(data?.raw ?? null);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Ürünler yüklenemedi');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const rowLabel = (r: unknown): string => {
    if (!r || typeof r !== 'object') return '—';
    const o = r as Record<string, unknown>;
    const name = (o.ProductName as string) || (o.name as string) || (o.title as string);
    const id = o.ProductId ?? o.id;
    return name || (id != null ? `#${id}` : '—');
  };

  const rowId = (r: unknown): string => {
    if (!r || typeof r !== 'object') return '—';
    const o = r as Record<string, unknown>;
    return String(o.ProductCode || o.ProductId || o.id || '—');
  };

  const rowPrice = (r: unknown): string => {
    if (!r || typeof r !== 'object') return '';
    const o = r as Record<string, unknown>;
    const p = o.SellingPrice ?? o.priceSale ?? o.price;
    if (p == null) return '';
    const cur = o.Currency || 'TRY';
    return `${p} ${cur}`;
  };

  const rowStock = (r: unknown): string => {
    if (!r || typeof r !== 'object') return '';
    const o = r as Record<string, unknown>;
    const s = o.Stock;
    return s != null ? String(s) : '—';
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Package className="w-7 h-7 text-orange-500" />
          E-Ticaret Ürünleri
        </h1>
        
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center py-16 text-gray-400 text-sm">Kayıt bulunamadı veya API yanıtı beklenen formatta değil.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-semibold text-gray-500 uppercase">
                <th className="px-5 py-3">Ürün</th>
                <th className="px-5 py-3">Kod</th>
                <th className="px-5 py-3">Fiyat</th>
                <th className="px-5 py-3">Stok</th>
                <th className="px-5 py-3">Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const o = r as Record<string, unknown>;
                const active = o.IsActive === true || o.IsActive === 'true' || o.IsActive === 1;
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className="px-5 py-3 font-medium text-gray-900">{rowLabel(r)}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{rowId(r)}</td>
                    <td className="px-5 py-3 text-gray-600">{rowPrice(r) || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{rowStock(r)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {active ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
          <span className="text-xs text-gray-500">Sayfa {page}</span>
          <button
            type="button"
            disabled={loading || rows.length < 50}
            onClick={() => setPage((p) => p + 1)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
          >
            Sonraki
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      
    </div>
  );
}
