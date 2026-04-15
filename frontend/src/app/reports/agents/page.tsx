'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';

export default function ReportAgentsPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string> = {};
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      const { data } = await api.get('/reports/agents', { params: p });
      setRows(Array.isArray(data) ? data : []);
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Temsilci özeti</h1>
          <p className="text-sm text-gray-500 mt-1">Mesaj, görüşme ve görev istatistikleri</p>
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
        <div className="bg-white rounded-xl border overflow-x-auto shadow-sm">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="bg-gray-50 border-b text-left text-xs font-semibold text-gray-500 uppercase">
                <th className="px-4 py-3">Temsilci</th>
                <th className="px-4 py-3 text-right">Gönderilen</th>
                <th className="px-4 py-3 text-right">Dönem (atama)</th>
                <th className="px-4 py-3 text-right">Benzersiz kişi</th>
                <th className="px-4 py-3 text-right">Açık atanmış</th>
                <th className="px-4 py-3 text-right">Cevapsız</th>
                <th className="px-4 py-3 text-right">Ort. yanıt (dk)</th>
                <th className="px-4 py-3 text-right">Görev B/E/T</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    Aktif temsilci yok veya veri yok
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.agent.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{r.agent.name || r.agent.email}</div>
                      <div className="text-xs text-gray-500">{r.agent.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.totalMessagesSent}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.totalMessagesInPeriod}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.uniqueContactsMessaged}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.activeConversations}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{r.unansweredConversations}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.avgResponseTimeMinutes != null ? r.avgResponseTimeMinutes : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums text-gray-600">
                      {r.taskStats?.pending ?? 0}/{r.taskStats?.overdue ?? 0}/{r.taskStats?.completed ?? 0}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
