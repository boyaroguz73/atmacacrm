'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { Loader2, RefreshCw, Users, ChevronLeft, ChevronRight, Download } from 'lucide-react';

type SiteCustomer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  city: string | null;
};

const LIMIT = 30;

export default function EcommerceCustomersPage() {
  const [rows, setRows] = useState<SiteCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const { data } = await api.get('/ecommerce/tsoft/customers', {
        params: { page: p, limit: LIMIT },
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setTotal(typeof data?.total === 'number' ? data.total : 0);
      setTotalPages(typeof data?.totalPages === 'number' ? Math.max(1, data.totalPages) : 1);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Site üyeleri yüklenemedi'));
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [page, load]);

  const syncCustomers = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-customers', {}, { timeout: 120_000 });
      toast.success(
        `Senkron tamamlandı: ${data?.matched ?? 0} eşleşti, ${data?.created ?? 0} yeni kişi oluştu`,
      );
      await load(page);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Senkron başarısız'));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-7 h-7 text-orange-500" />
            Site Üyeleri
          </h1>
          <p className="text-sm text-gray-500 mt-1">T-Soft mağaza üyeleri listesi</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={syncCustomers}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-50 text-orange-800 border border-orange-200 hover:bg-orange-100 text-sm font-medium disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Üyeleri CRM’e senkronla
          </button>
          <button
            type="button"
            onClick={() => void load(page)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
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
          <p className="text-center py-16 text-gray-400 text-sm">Üye bulunamadı.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-5 py-3">Ad Soyad</th>
                  <th className="px-5 py-3">Telefon</th>
                  <th className="px-5 py-3">E-posta</th>
                  <th className="px-5 py-3">Şirket</th>
                  <th className="px-5 py-3">Şehir</th>
                  <th className="px-5 py-3">Üye ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.id}-${r.phone || r.email || r.name}`} className="border-b border-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{r.name || '—'}</td>
                    <td className="px-5 py-3 text-gray-700">{r.phone || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{r.email || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{r.company || '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{r.city || '—'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{r.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > 0 ? (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/30">
            <p className="text-xs text-gray-500">
              Toplam <span className="font-semibold text-gray-700">{total}</span> üye · Sayfa {page} / {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
                Önceki
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 disabled:opacity-40"
              >
                Sonraki
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
