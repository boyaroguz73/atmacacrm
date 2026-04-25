'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Link from 'next/link';
import DateRangePicker from '@/components/ui/DateRangePicker';
import {
  MessageSquare,
  Users,
  Target,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Clock,
  ShoppingBag,
  Wallet,
  UserPlus,
  Loader2,
  AlertTriangle,
  Receipt,
  FileText,
} from 'lucide-react';
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '@/lib/constants';

interface DashboardData {
  totalMessagesToday: number;
  incomingMessagesToday: number;
  outgoingMessagesToday: number;
  activeConversations: number;
  unansweredConversations: number;
  totalContacts: number;
  newContactsInPeriod: number;
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
  orders: {
    count: number;
    sumGrandTotal: number;
    outstandingTotal: number;
    collectedTotal: number;
    overdueDeliveries: number;
    byStatus: { status: string; count: number; sumGrandTotal: number }[];
  };
  quotes: {
    total: number;
    accepted: number;
    conversionRate: number;
    byStatus: { status: string; count: number; sumGrandTotal: number }[];
  };
  cash: { income: number; expense: number; net: number };
}

type DashboardTier = 'primary' | 'secondary' | 'tertiary';

const ORDER_STATUS_LABELS: Record<string, string> = {
  AWAITING_CHECKOUT: 'Sepet Terk',
  AWAITING_PAYMENT: 'Ödeme Bekleniyor',
  PREPARING: 'Hazırlanıyor',
  SHIPPED: 'Kargoda',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal',
};

const statusLabels = LEAD_STATUS_LABELS;
const statusColors = LEAD_STATUS_COLORS;

interface AccWidgetState {
  tasks: { id: string; title: string; dueAt: string; contact?: { name?: string | null; phone?: string } }[];
  invoices: { id: string; invoiceNumber: number; dueDate?: string | null; status: string; grandTotal: number }[];
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDefaultLast7DaysRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - 6);
  return {
    from: toDateInputValue(from),
    to: toDateInputValue(to),
  };
}

const DASHBOARD_DEFAULT_RANGE = getDefaultLast7DaysRange();

function fmtTry(n: number | undefined | null) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [accWidgets, setAccWidgets] = useState<AccWidgetState | null>(null);
  const [dateFrom, setDateFrom] = useState(DASHBOARD_DEFAULT_RANGE.from);
  const [dateTo, setDateTo] = useState(DASHBOARD_DEFAULT_RANGE.to);

  const fetchData = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(false);
    try {
      const params: Record<string, string> = {};
      if (from) params.from = `${from}T00:00:00`;
      if (to) params.to = `${to}T23:59:59`;
      const res = await api.get('/dashboard/overview', { params });
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

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

    fetchData(dateFrom, dateTo);
  }, [router, dateFrom, dateTo, fetchData]);

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
          } catch {}
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-whatsapp animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-gray-500 text-sm">Veriler yüklenemedi</p>
        <button
          onClick={() => fetchData(dateFrom, dateTo)}
          className="px-4 py-2 bg-whatsapp text-white rounded-lg text-sm hover:bg-green-600"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }

  const statCards: Array<{
    label: string;
    value: number | string;
    icon: any;
    color: string;
    sub?: string;
    href?: string;
    tier: DashboardTier;
  }> = [
    {
      label: 'Mesajlar',
      value: data.totalMessagesToday,
      icon: MessageSquare,
      color: 'bg-slate-500',
      sub: `${data.incomingMessagesToday} gelen / ${data.outgoingMessagesToday} giden`,
      tier: 'secondary',
    },
    {
      label: 'Aktif Görüşmeler',
      value: data.activeConversations,
      icon: BarChart3,
      color: 'bg-whatsapp',
      sub: `${data.unansweredConversations} cevaplanmamış`,
      tier: 'primary',
    },
    {
      label: 'Kişiler',
      value: data.totalContacts,
      icon: Users,
      color: 'bg-violet-500',
      sub: data.newContactsInPeriod > 0 ? `+${data.newContactsInPeriod} yeni` : undefined,
      tier: 'secondary',
    },
    {
      label: 'Potansiyel Müşteri',
      value: data.totalLeads,
      icon: Target,
      color: 'bg-amber-500',
      sub: `%${data.conversionRate} dönüşüm`,
      tier: 'secondary',
    },
    {
      label: 'Siparişler',
      value: data.orders.count,
      icon: ShoppingBag,
      color: 'bg-indigo-500',
      sub: fmtTry(data.orders.sumGrandTotal),
      href: '/orders',
      tier: 'secondary',
    },
    {
      label: 'Tahsilat bekleyen',
      value: fmtTry(data.orders.outstandingTotal),
      icon: Receipt,
      color: data.orders.outstandingTotal > 0 ? 'bg-rose-500' : 'bg-emerald-500',
      sub: `Tahsil edilen: ${fmtTry(data.orders.collectedTotal)}`,
      href: '/orders',
      tier: 'primary',
    },
    {
      label: 'Gecikmiş teslimat',
      value: data.orders.overdueDeliveries,
      icon: AlertTriangle,
      color: data.orders.overdueDeliveries > 0 ? 'bg-amber-500' : 'bg-gray-300',
      sub: data.orders.overdueDeliveries > 0
        ? 'Beklenen tarihi geçmiş ve hâlâ teslim edilmemiş'
        : 'Gecikme yok',
      href: '/orders',
      tier: 'secondary',
    },
    {
      label: 'Teklif dönüşüm',
      value: `%${data.quotes.conversionRate}`,
      icon: FileText,
      color: 'bg-slate-500',
      sub: `${data.quotes.accepted}/${data.quotes.total} kabul edilen`,
      href: '/quotes',
      tier: 'tertiary',
    },
    {
      label: 'Kasa',
      value: fmtTry(data.cash.net),
      icon: data.cash.net >= 0 ? TrendingUp : TrendingDown,
      color: data.cash.net >= 0 ? 'bg-emerald-500' : 'bg-red-500',
      sub: `Giriş: ${fmtTry(data.cash.income)} · Çıkış: ${fmtTry(data.cash.expense)}`,
      href: '/accounting/cash',
      tier: 'tertiary',
    },
  ];

  const orderStatusRows = (data.orders.byStatus || [])
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const focusSummary = `Bugün ${data.activeConversations.toLocaleString()} aktif görüşme var, ${fmtTry(
    data.orders.outstandingTotal,
  )} tahsilat bekleniyor.`;

  return (
    <div className="p-6 space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gösterge Paneli</h1>
          <p className="mt-1 text-sm text-gray-500">{focusSummary}</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
          />
        </div>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {statCards.map((card) => {
          const normalizedColor =
            card.tier === 'secondary'
              ? 'bg-slate-500'
              : card.tier === 'tertiary' && card.label !== 'Kasa'
                ? 'bg-gray-500'
                : card.color;
          const tierClass =
            card.tier === 'primary'
              ? 'border-gray-200 shadow-md ring-1 ring-gray-100'
              : card.tier === 'secondary'
                ? 'border-gray-100 shadow-sm'
                : 'border-gray-100 shadow-sm opacity-95';
          const valueClass =
            card.tier === 'primary'
              ? 'text-3xl'
              : card.tier === 'secondary'
                ? 'text-2xl'
                : 'text-xl';
          const inner = (
            <div className={`bg-white rounded-xl border p-5 hover:shadow-md transition-all ${tierClass}`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                    {card.label}
                  </p>
                  <p className={`${valueClass} font-bold mt-1 text-gray-900 tabular-nums leading-tight`}>
                    {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
                  </p>
                  {card.sub && (
                    <p className="text-[11px] text-gray-400 mt-1">{card.sub}</p>
                  )}
                </div>
                <div
                  className={`${normalizedColor} w-10 h-10 rounded-xl flex items-center justify-center shrink-0`}
                >
                  <card.icon className="w-5 h-5 text-white" />
                </div>
              </div>
            </div>
          );
          if ('href' in card && card.href) {
            return <Link key={card.label} href={card.href} className="block">{inner}</Link>;
          }
          return <div key={card.label}>{inner}</div>;
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
        <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Sipariş Durumu</h2>
            <Link
              href="/orders"
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-whatsapp text-white hover:bg-green-600"
            >
              Tüm siparişler
            </Link>
          </div>
          {orderStatusRows.length === 0 ? (
            <p className="text-gray-400 text-sm">Kayıt yok</p>
          ) : (
            <div className="space-y-3">
              {orderStatusRows.map((row) => {
                const totalCount = orderStatusRows.reduce((s, r) => s + r.count, 0);
                const pct = totalCount > 0 ? (row.count / totalCount) * 100 : 0;
                const label = ORDER_STATUS_LABELS[row.status] || row.status;
                const barColor =
                  row.status === 'COMPLETED'
                    ? 'bg-emerald-500'
                    : row.status === 'CANCELLED'
                      ? 'bg-rose-500'
                      : row.status === 'PREPARING'
                        ? 'bg-amber-500'
                        : row.status === 'SHIPPED'
                          ? 'bg-violet-500'
                          : 'bg-sky-500';
                return (
                  <div key={row.status} className="flex items-center gap-3 group" title={`${label}: ${row.count} sipariş • ${fmtTry(row.sumGrandTotal)}`}>
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-gray-100 text-gray-700 min-w-[72px] text-center">
                      {label}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className={`${barColor} h-2 rounded-full transition-all group-hover:brightness-110`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-semibold text-gray-700">{row.count}</span>
                      {row.sumGrandTotal > 0 && (
                        <span className="text-[10px] text-gray-400 ml-1">({fmtTry(row.sumGrandTotal)})</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Potansiyel Müşteri Durumu
          </h2>
          {data.leadsByStatus.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-5">
              <p className="text-sm text-gray-500">Henüz kayıt yok</p>
              <Link
                href="/contacts"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-whatsapp hover:text-green-700"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Yeni müşteri ekle
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {data.leadsByStatus.map((item) => (
                <div key={item.status} className="flex items-center gap-3">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${statusColors[item.status] || 'bg-gray-100 text-gray-700'}`}
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
                  <div className="text-right shrink-0">
                    <span className="text-sm font-semibold text-gray-700">{item.count}</span>
                    {item.totalValue > 0 && (
                      <span className="text-[10px] text-gray-400 ml-1">({fmtTry(item.totalValue)})</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Temsilci Performansı
          </h2>
          {data.agentStats.length === 0 ? (
            <p className="text-gray-400 text-sm">Henüz temsilci bulunmuyor</p>
          ) : (
            <div className="space-y-3">
              {data.agentStats.map((agent) => {
                const isIdle = (agent.messagesToday || 0) === 0 && (agent.activeAssignments || 0) === 0;
                return (
                <div
                  key={agent.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    isIdle ? 'bg-gray-50 border-gray-100 opacity-70' : 'bg-emerald-50/40 border-emerald-100'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 ${
                    isIdle ? 'bg-gray-200 text-gray-500' : 'bg-whatsapp/10 text-whatsapp'
                  }`}>
                    {agent.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm ${isIdle ? 'text-gray-500' : 'text-gray-900'}`}>
                      {agent.name}
                    </p>
                    <p className={`text-xs ${isIdle ? 'text-gray-400' : 'text-gray-500'}`}>
                      {agent.activeAssignments} aktif görüşme
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold tabular-nums ${isIdle ? 'text-gray-400' : 'text-gray-900'}`}>
                      {agent.messagesToday}
                    </p>
                    <p className="text-[10px] text-gray-400">mesaj</p>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
