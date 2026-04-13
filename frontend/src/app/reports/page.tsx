'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import {
  MessageSquare,
  Users,
  AlertCircle,
  Target,
} from 'lucide-react';
import DateRangePicker from '@/components/ui/DateRangePicker';
import toast from 'react-hot-toast';

interface AgentReport {
  agent: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
  totalMessagesSent: number;
  totalMessagesInPeriod: number;
  uniqueContactsMessaged: number;
  activeConversations: number;
  unansweredConversations: number;
  avgResponseTimeMinutes: number | null;
  taskStats: { pending: number; overdue: number; completed: number };
}

interface Summary {
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
  newContacts: number;
  totalConversations: number;
  unansweredTotal: number;
  leadConversions: number;
}

export default function ReportsPage() {
  const [agents, setAgents] = useState<AgentReport[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (dateFrom) params.from = dateFrom + 'T00:00:00';
      if (dateTo) params.to = dateTo + 'T23:59:59';

      const [agentsRes, summaryRes] = await Promise.all([
        api.get('/reports/agents', { params }),
        api.get('/reports/summary', { params }),
      ]);
      setAgents(agentsRes.data);
      setSummary(summaryRes.data);
    } catch (error) {
      console.error(error);
      toast.error('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateFrom, dateTo]);

  const formatResponseTime = (minutes: number | null) => {
    if (minutes === null) return '—';
    if (minutes < 1) return '< 1 dk';
    if (minutes < 60) return `${minutes} dk`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} sa ${m} dk`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-whatsapp border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Raporlar</h1>
          <p className="text-gray-500 text-sm mt-1">Temsilci performansı ve sistem istatistikleri</p>
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

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <MessageSquare className="w-5 h-5 text-blue-500 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{summary.totalMessages}</p>
            <p className="text-xs text-gray-400">
              Toplam Mesaj
              <span className="ml-1 text-green-500">{summary.incomingMessages} gelen</span>
              {' / '}
              <span className="text-blue-500">{summary.outgoingMessages} giden</span>
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <Users className="w-5 h-5 text-purple-500 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{summary.newContacts}</p>
            <p className="text-xs text-gray-400">Yeni Kişi</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-500 mb-2" />
            <p className="text-2xl font-bold text-red-600">{summary.unansweredTotal}</p>
            <p className="text-xs text-gray-400">Cevaplanmamış</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <Target className="w-5 h-5 text-green-500 mb-2" />
            <p className="text-2xl font-bold text-green-600">{summary.leadConversions}</p>
            <p className="text-xs text-gray-400">Müşteri Dönüşüm</p>
          </div>
        </div>
      )}

      {/* Agent Report Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Temsilci Detaylı Raporu</h2>
        </div>

        {agents.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            Aktif temsilci bulunamadı
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Temsilci</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Gönderilen Mesaj</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Konuşulan Kişi</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Aktif Görüşme</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Cevaplanmamış</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Ort. Yanıt Süresi</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Görev (Bekleyen/Gecikmiş)</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((row) => (
                  <tr key={row.agent.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-whatsapp/10 rounded-full flex items-center justify-center text-whatsapp font-bold text-sm">
                          {row.agent.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-sm text-gray-900">{row.agent.name}</p>
                          <p className="text-xs text-gray-400">{row.agent.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className="text-sm font-semibold text-gray-900">{row.totalMessagesSent}</span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className="text-sm font-semibold text-gray-900">{row.uniqueContactsMessaged}</span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className="text-sm font-semibold text-gray-900">{row.activeConversations}</span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className={`text-sm font-semibold ${row.unansweredConversations > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {row.unansweredConversations}
                      </span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <span className={`text-sm font-semibold ${row.avgResponseTimeMinutes !== null && row.avgResponseTimeMinutes > 30 ? 'text-orange-600' : 'text-green-600'}`}>
                        {formatResponseTime(row.avgResponseTimeMinutes)}
                      </span>
                    </td>
                    <td className="text-center px-4 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                          {row.taskStats.pending} bekleyen
                        </span>
                        {row.taskStats.overdue > 0 && (
                          <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">
                            {row.taskStats.overdue} gecikmiş
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
