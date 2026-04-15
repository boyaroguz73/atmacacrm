'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export default function ReportMessagesPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string> = {};
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      const { data: d } = await api.get('/reports/messages/timeseries', { params: p });
      setData(d);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Mesaj trafiği</h1>
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
        <div className="h-96 bg-white rounded-xl border p-4">
          <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="incoming" name="Gelen" stroke="#2563eb" strokeWidth={2} />
              <Line type="monotone" dataKey="outgoing" name="Giden" stroke="#16a34a" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
