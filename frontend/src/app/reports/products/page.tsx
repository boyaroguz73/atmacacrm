'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { rewriteMediaUrlForClient } from '@/lib/utils';

function fmtTry(n: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(n);
}

export default function ReportSoldProductsPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: any[]; total: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const limit = 25;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string | number> = { page, limit };
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      const { data: d } = await api.get('/reports/sales/products', { params: p });
      setData({
        items: d.items ?? [],
        total: d.total ?? 0,
        totalPages: d.totalPages ?? 1,
      });
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Yüklenemedi'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, page]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Satılan ürünler</h1>
          <p className="text-sm text-gray-500 mt-1">Sipariş satırları — miktar ve satır tutarı</p>
        </div>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => {
            setDateFrom(f);
            setDateTo(t);
          }}
        />
      </div>
      <ReportsNav />

      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-whatsapp mx-auto" />
      ) : (
        <>
          <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-4 py-3 w-14" />
                  <th className="px-4 py-3">Ürün</th>
                  <th className="px-4 py-3">Sipariş</th>
                  <th className="px-4 py-3 text-right">Miktar</th>
                  <th className="px-4 py-3 text-right">Satır</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {!data?.items?.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      Kayıt yok
                    </td>
                  </tr>
                ) : (
                  data.items.map((it: any) => {
                    const p = it.product;
                    const img = p?.imageUrl ? rewriteMediaUrlForClient(p.imageUrl) : null;
                    return (
                      <tr key={it.id} className="hover:bg-gray-50/60">
                        <td className="px-4 py-2">
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg border bg-gray-50 overflow-hidden">
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={img} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="flex w-full h-full items-center justify-center text-[10px] text-gray-300">
                                —
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900">{it.name}</div>
                          <div className="text-xs text-gray-500 font-mono">{p?.sku || '—'}</div>
                          {p?.category ? <div className="text-[11px] text-gray-400">{p.category}</div> : null}
                        </td>
                        <td className="px-4 py-2">
                          {it.order ? (
                            <Link
                              href="/orders"
                              className="font-mono text-xs text-whatsapp font-medium hover:underline"
                            >
                              SIP-{String(it.order.orderNumber).padStart(5, '0')}
                            </Link>
                          ) : (
                            '—'
                          )}
                          <div className="text-[11px] text-gray-400">
                            {it.order?.createdAt
                              ? new Date(it.order.createdAt).toLocaleDateString('tr-TR')
                              : ''}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{it.quantity}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtTry(it.lineTotal)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {data && data.totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">
                Toplam {data.total} satır — Sayfa {page} / {data.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Önceki
                </button>
                <button
                  type="button"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white disabled:opacity-40"
                >
                  Sonraki
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
