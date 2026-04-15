'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Yeni',
  CONTACTED: 'İletişim',
  INTERESTED: 'İlgili',
  OFFER_SENT: 'Teklif gönderildi',
  WON: 'Kazanıldı',
  LOST: 'Kayıp',
};

const COLORS = ['#94a3b8', '#3b82f6', '#8b5cf6', '#0ea5e9', '#22c55e', '#ef4444'];

export default function ReportFunnelPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [funnel, setFunnel] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string> = {};
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      const { data } = await api.get('/reports/leads/funnel', { params: p });
      setFunnel(data);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const byStatus = funnel?.byStatus || {};
  const chartData = Object.entries(byStatus).map(([key, count]) => ({
    name: STATUS_LABEL[key] || key,
    count: Number(count),
    key,
  }));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Lead hunisi</h1>
          <p className="text-sm text-gray-500 mt-1">Durum dağılımı, dönem içi kazanılan / kayıp ve dönüşüm oranları</p>
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
      ) : !funnel ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500 uppercase font-medium">Dönem — kazanıldı</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{funnel.wonInPeriod ?? 0}</p>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500 uppercase font-medium">Dönem — kayıp</p>
              <p className="text-2xl font-bold text-red-600 mt-1">{funnel.lostInPeriod ?? 0}</p>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500 uppercase font-medium">Yeni lead (dönem)</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{funnel.newLeadsInPeriod ?? 0}</p>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500 uppercase font-medium">Pipeline toplam</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{funnel.totalPipeline ?? 0}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-800 mb-2">Teklif → kazanç %</p>
              <p className="text-3xl font-bold text-whatsapp tabular-nums">
                {funnel.conversionOfferToWonPercent != null ? `${funnel.conversionOfferToWonPercent}%` : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1">Tüm zamanlar: teklif gönderildi sayısına göre</p>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-800 mb-2">Yeni lead → kazanç (dönem) %</p>
              <p className="text-3xl font-bold text-gray-900 tabular-nums">
                {funnel.conversionNewToWonInPeriodPercent != null ? `${funnel.conversionNewToWonInPeriodPercent}%` : '—'}
              </p>
            </div>
          </div>

          <div className="h-80 bg-white rounded-xl border p-4">
            <p className="text-sm font-semibold text-gray-800 mb-2">Durumlara göre adet</p>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" name="Adet" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
