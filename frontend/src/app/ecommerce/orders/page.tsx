'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { ShoppingBag, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

export default function EcommerceOrdersPage() {
  const [rows, setRows] = useState<unknown[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

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
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShoppingBag className="w-7 h-7 text-orange-500" />
          E-Ticaret Siparişleri
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          T-Soft sipariş listesi.{' '}
          <a
            href="https://developer.tsoft.com.tr/docs/api/order/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-600 hover:underline"
          >
            Sipariş API dokümantasyonu
          </a>
        </p>
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

      {process.env.NODE_ENV === 'development' && Boolean(raw) ? (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer">Ham yanıt (geliştirici)</summary>
          <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded-lg overflow-auto max-h-64">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
