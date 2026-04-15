'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatPhone } from '@/lib/utils';

export default function ReportContactsPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string | number> = { page, limit: 40 };
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      const { data: d } = await api.get('/reports/contacts/engaged', { params: p });
      setData(d);
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

  const rows = data?.rows ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Konuşulan kişiler</h1>
          <p className="text-sm text-gray-500 mt-1">Dönemde en az bir mesaj alışverişi olan benzersiz kişiler</p>
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

      {data?.totalDistinctContacts != null ? (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500 uppercase font-medium">Benzersiz kişi</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{data.totalDistinctContacts}</p>
        </div>
      ) : null}

      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-whatsapp mx-auto" />
      ) : (
        <>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-4 py-3">Kişi</th>
                  <th className="px-4 py-3 text-right">Mesaj</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {!rows.length ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-12 text-center text-gray-400">
                      Kayıt yok
                    </td>
                  </tr>
                ) : (
                  rows.map((r: any) => (
                    <tr key={r.contactId} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900">{r.name || formatPhone(r.phone)}</div>
                        <div className="text-xs text-gray-500">{formatPhone(r.phone)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{r.messageCount}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/contacts/${r.contactId}`}
                          className="text-xs font-medium text-whatsapp hover:underline"
                        >
                          Aç
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">
                Sayfa {page} / {totalPages}
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
                  disabled={page >= totalPages}
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
