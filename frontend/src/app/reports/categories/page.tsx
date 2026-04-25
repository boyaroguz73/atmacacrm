'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import { Loader2, Filter } from 'lucide-react';

type SourceFilter = '' | 'MANUAL' | 'TSOFT';
const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'MANUAL', label: 'CRM' },
  { value: 'TSOFT', label: 'Site' },
];
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function fmtTry(n: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
}

export default function ReportCategoriesPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [source, setSource] = useState<SourceFilter>('');
  const [rows, setRows] = useState<{ category: string; quantity: number; revenue: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string> = { limit: '24' };
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      if (source) p.source = source;
      const { data } = await api.get('/reports/sales/top-categories', { params: p });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, source]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const chartData = rows.map((r) => ({
    name: r.category.length > 20 ? `${r.category.slice(0, 20)}…` : r.category,
    revenue: Math.round((r.revenue || 0) * 100) / 100,
  }));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Kategori satışı</h1>
          <p className="text-sm text-gray-500 mt-1">Sipariş kalemlerinden ürün kategorisi bazlı ciro</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-gray-400 ml-1" />
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSource(opt.value)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  source === opt.value
                    ? 'bg-whatsapp text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
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
      </div>
      <ReportsNav />

      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-whatsapp mx-auto" />
      ) : (
        <>
          <div className="h-80 min-h-[320px] min-w-0 bg-white rounded-xl border p-4">
            <ResponsiveContainer width="100%" height="100%" minWidth={300} minHeight={240}>
              <BarChart data={chartData} margin={{ bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => fmtTry(typeof v === 'number' ? v : Number(v) || 0)} />
                <Bar dataKey="revenue" name="Ciro" fill="#25D366" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-4 py-3">Kategori</th>
                  <th className="px-4 py-3 text-right">Adet</th>
                  <th className="px-4 py-3 text-right">Ciro</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-12 text-center text-gray-400">
                      Veri yok
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.category} className="hover:bg-gray-50/80">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{r.category}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{Math.round(r.quantity)}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmtTry(r.revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
