'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Link from 'next/link';
import {
  MessageSquare,
  Users,
  Target,
  TrendingUp,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Clock,
} from 'lucide-react';
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '@/lib/constants';

interface DashboardData {
  totalMessagesToday: number;
  incomingMessagesToday: number;
  outgoingMessagesToday: number;
  activeConversations: number;
  unansweredConversations: number;
  totalContacts: number;
  totalLeads: number;
  conversionRate: number;
  leadsByStatus: { status: string; count: number; totalValue: number }[];
  agentStats: {
    id: string;
    name: string;
    avatar: string | null;
    totalMessages: number;
    messagesToday: number;
    activeAssignments: number;
  }[];
}

const statusLabels = LEAD_STATUS_LABELS;
const statusColors = LEAD_STATUS_COLORS;

interface AccWidgetState {
  tasks: { id: string; title: string; dueAt: string; contact?: { name?: string | null; phone?: string } }[];
  invoices: { id: string; invoiceNumber: number; dueDate?: string | null; status: string; grandTotal: number }[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [accWidgets, setAccWidgets] = useState<AccWidgetState | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.role === 'AGENT') {
          router.replace('/inbox');
          return;
        }
      }
    } catch {}

    api
      .get('/dashboard/overview')
      .then((res) => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
        if (!raw) return;
        const role = JSON.parse(raw).role as string;
        if (role !== 'ACCOUNTANT') return;
        const [tRes, iRes] = await Promise.all([
          api.get('/tasks/my', { params: { status: 'PENDING', limit: 15 } }),
          api.get('/accounting/invoices', { params: { limit: 100 } }),
        ]);
        if (cancelled) return;
        const tasks = (tRes.data.tasks || []) as AccWidgetState['tasks'];
        const now = Date.now();
        const week = 7 * 86400000;
        const invoices = (iRes.data.invoices || []).filter((inv: any) => {
          if (!inv.dueDate) return false;
          if (inv.status === 'PAID' || inv.status === 'CANCELLED') return false;
          const t = new Date(inv.dueDate).getTime();
          return t >= now && t <= now + week;
        }) as AccWidgetState['invoices'];
        setAccWidgets({ tasks, invoices: invoices.slice(0, 12) });
      } catch {
        if (!cancelled) {
          try {
            const raw = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
            if (raw && JSON.parse(raw).role === 'ACCOUNTANT') {
              setAccWidgets({ tasks: [], invoices: [] });
            }
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-whatsapp border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-gray-500 text-sm">Veriler yüklenemedi</p>
        <button
          onClick={() => { setError(false); setLoading(true); api.get('/dashboard/overview').then((r) => setData(r.data)).catch(() => setError(true)).finally(() => setLoading(false)); }}
          className="px-4 py-2 bg-whatsapp text-white rounded-lg text-sm hover:bg-green-600"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Bugünkü Mesajlar',
      value: data.totalMessagesToday,
      icon: MessageSquare,
      color: 'bg-blue-500',
      sub: `${data.incomingMessagesToday} gelen / ${data.outgoingMessagesToday} giden`,
    },
    {
      label: 'Aktif Görüşmeler',
      value: data.activeConversations,
      icon: BarChart3,
      color: 'bg-whatsapp',
      sub: `${data.unansweredConversations} cevaplanmamış`,
    },
    {
      label: 'Toplam Kişi',
      value: data.totalContacts,
      icon: Users,
      color: 'bg-purple-500',
    },
    {
      label: 'Potansiyel Müşteri',
      value: data.totalLeads,
      icon: Target,
      color: 'bg-orange-500',
      sub: `%${data.conversionRate} dönüşüm`,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Gösterge Paneli</h1>
        <p className="text-gray-500 text-sm mt-1">
          WhatsApp CRM genel görünüm
        </p>
      </div>

      {accWidgets != null && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-whatsapp" />
                Bekleyen görevlerim
              </h2>
              <Link href="/tasks" className="text-xs font-medium text-whatsapp hover:underline">
                Tümü
              </Link>
            </div>
            <ul className="space-y-2 text-sm">
              {accWidgets.tasks.length === 0 ? (
                <li className="text-gray-400">Bekleyen görev yok</li>
              ) : (
                accWidgets.tasks.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2 border-b border-gray-50 pb-2 last:border-0">
                    <span className="text-gray-800 truncate">{t.title}</span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {new Date(t.dueAt).toLocaleDateString('tr-TR')}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-amber-600" />
                Vadesi yaklaşan faturalar
              </h2>
              <Link href="/accounting/invoices" className="text-xs font-medium text-whatsapp hover:underline">
                Muhasebe
              </Link>
            </div>
            <ul className="space-y-2 text-sm">
              {accWidgets.invoices.length === 0 ? (
                <li className="text-gray-400">Önümüzdeki 7 günde vadesi gelen fatura yok</li>
              ) : (
                accWidgets.invoices.map((inv) => (
                  <li key={inv.id} className="flex justify-between gap-2 border-b border-gray-50 pb-2 last:border-0">
                    <span className="font-mono text-gray-700">FTR-{String(inv.invoiceNumber).padStart(5, '0')}</span>
                    <span className="text-xs text-gray-500">
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('tr-TR') : '—'}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500 font-medium">
                  {card.label}
                </p>
                <p className="text-3xl font-bold mt-1 text-gray-900">
                  {card.value.toLocaleString()}
                </p>
                {card.sub && (
                  <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
                )}
              </div>
              <div
                className={`${card.color} w-11 h-11 rounded-xl flex items-center justify-center`}
              >
                <card.icon className="w-5 h-5 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Potansiyel Müşteri Durumu
          </h2>
          <div className="space-y-3">
            {data.leadsByStatus.map((item) => (
              <div key={item.status} className="flex items-center gap-3">
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[item.status] || 'bg-gray-100 text-gray-700'}`}
                >
                  {statusLabels[item.status] || item.status}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-whatsapp h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (item.count / Math.max(data.totalLeads, 1)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-sm font-semibold text-gray-700 w-8 text-right">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Temsilci Performansı
          </h2>
          {data.agentStats.length === 0 ? (
            <p className="text-gray-400 text-sm">Henüz temsilci bulunmuyor</p>
          ) : (
            <div className="space-y-4">
              {data.agentStats.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                >
                  <div className="w-10 h-10 bg-whatsapp/10 rounded-full flex items-center justify-center font-bold text-whatsapp">
                    {agent.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900">
                      {agent.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {agent.activeAssignments} aktif görüşme
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">
                      {agent.messagesToday}
                    </p>
                    <p className="text-xs text-gray-400">bugün mesaj</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
