'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

function fmtTry(n: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
}

export default function ReportCashPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<{ day: string; income: number; expense: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string> = {};
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      const { data: d } = await api.get('/reports/cash/timeseries', { params: p });
      setData(Array.isArray(d) ? d : []);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sumIn = data.reduce((a, r) => a + (r.income || 0), 0);
  const sumOut = data.reduce((a, r) => a + (r.expense || 0), 0);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Kasa hareketleri</h1>
          <p className="text-sm text-gray-500 mt-1">Günlük giriş ve çıkış (elle girilen kasa kayıtları)</p>
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

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500 font-medium uppercase">Toplam giriş</p>
          <p className="text-lg font-bold text-emerald-700 tabular-nums mt-1">{fmtTry(sumIn)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500 font-medium uppercase">Toplam çıkış</p>
          <p className="text-lg font-bold text-red-600 tabular-nums mt-1">{fmtTry(sumOut)}</p>
        </div>
      </div>

      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-whatsapp mx-auto" />
      ) : (
        <div className="h-96 bg-white rounded-xl border p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => fmtTry(typeof v === 'number' ? v : Number(v) || 0)} />
              <Legend />
              <Bar dataKey="income" name="Giriş" stackId="a" fill="#22c55e" />
              <Bar dataKey="expense" name="Çıkış" stackId="a" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
