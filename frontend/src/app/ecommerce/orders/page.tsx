'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { ShoppingBag, ChevronLeft, ChevronRight, Loader2, RefreshCw, Users, Download } from 'lucide-react';

export default function EcommerceOrdersPage() {
  const [rows, setRows] = useState<unknown[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<'orders' | 'customers' | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const { data } = await api.get('/ecommerce/tsoft/orders', { params: { page: p, limit: 50 } });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setRaw(data?.raw ?? null);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Siparişler yüklenemedi');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const syncOrders = async () => {
    setSyncing('orders');
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-orders', {}, { timeout: 120_000 });
      toast.success(`Sipariş senkronu: ${data.imported} aktarıldı, ${data.skippedExisting} zaten var, ${data.errors || 0} hata`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Sipariş senkronu başarısız');
    } finally {
      setSyncing(null);
    }
  };

  const syncCustomers = async () => {
    setSyncing('customers');
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-customers', {}, { timeout: 120_000 });
      toast.success(`Müşteri senkronu: ${data.matched} eşleşti, ${data.created || 0} yeni, ${data.skipped || 0} atlandı`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Müşteri senkronu başarısız');
    } finally {
      setSyncing(null);
    }
  };

  const summarize = (r: unknown) => {
    if (!r || typeof r !== 'object') return { no: '—', status: '', total: '', date: '' };
    const o = r as Record<string, unknown>;
    return {
      no: String(o.orderNumber ?? o.id ?? '—'),
      status: String(o.orderStatus ?? o.status ?? ''),
      total: o.orderTotal != null ? String(o.orderTotal) : '',
      date: o.createDate != null ? String(o.createDate) : o.createdAt != null ? String(o.createdAt) : '',
    };
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingBag className="w-7 h-7 text-orange-500" />
            E-Ticaret Siparişleri
          </h1>
          
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={syncing !== null}
            onClick={syncCustomers}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
          >
            {syncing === 'customers' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Müşteri Senkronu
          </button>
          <button
            type="button"
            disabled={syncing !== null}
            onClick={syncOrders}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition"
          >
            {syncing === 'orders' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Sipariş Aktar
          </button>
        </div>
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
                <th className="px-5 py-3">Sipariş</th>
                <th className="px-5 py-3">Durum</th>
                <th className="px-5 py-3">Tutar</th>
                <th className="px-5 py-3">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const s = summarize(r);
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className="px-5 py-3 font-medium text-gray-900">{s.no}</td>
                    <td className="px-5 py-3">
                      {s.status ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                          {s.status}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{s.total ? `${s.total} TL` : '—'}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{s.date || '—'}</td>
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
