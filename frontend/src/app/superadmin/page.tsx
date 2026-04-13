'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Building2,
  Users,
  Wifi,
  DollarSign,
  MessageSquare,
  LifeBuoy,
  Clock,
  RefreshCw,
} from 'lucide-react';

interface Stats {
  totalOrganizations?: number;
  activeOrganizations?: number;
  totalUsers?: number;
  totalSessions?: number;
  organizations?: { total: number; active: number };
  users?: number;
  sessions?: number;
  planDistribution?: { plan: string; _count: number }[];
}

interface RevenueData {
  total: number;
  invoiceCount: number;
  monthly: { month: string; revenue: number; count: number }[];
  planBreakdown: { plan: string; status: string; _count: number }[];
}

interface TicketStats {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  total: number;
}

interface SystemMetrics {
  messages: {
    todayIncoming: number;
    todayOutgoing: number;
    todayTotal: number;
    totalMessages: number;
  };
  organizations: {
    total: number;
    active: number;
    trial: number;
    paid: number;
    planDistribution: { plan: string; count: number }[];
  };
  sessions: {
    total: number;
    working: number;
    stopped: number;
  };
  database: {
    messages: number;
    conversations: number;
    contacts: number;
    users: number;
    organizations: number;
  };
}

const PLAN_COLORS: Record<string, string> = {
  FREE: '#9CA3AF',
  STARTER: '#3B82F6',
  PROFESSIONAL: '#10B981',
  ENTERPRISE: '#8B5CF6',
};

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Deneme',
  STARTER: 'Başlangıç',
  PROFESSIONAL: 'Profesyonel',
  ENTERPRISE: 'Kurumsal',
};

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [ticketStats, setTicketStats] = useState<TicketStats | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        api.get('/organizations/stats'),
        api.get('/billing/revenue'),
        api.get('/support/stats/tickets'),
        api.get('/system/metrics'),
      ]);

      const errMsg = (r: PromiseSettledResult<unknown>) =>
        r.status === 'rejected'
          ? (r.reason as { response?: { data?: { message?: string } } })?.response?.data?.message ||
            (r.reason as Error)?.message ||
            'İstek başarısız'
          : '';

      if (results[0].status === 'fulfilled') {
        setStats(results[0].value.data);
      } else {
        setStats(null);
        toast.error(`İstatistikler: ${errMsg(results[0])}`);
      }

      if (results[1].status === 'fulfilled') {
        setRevenue(results[1].value.data);
      } else {
        setRevenue(null);
        toast.error(`Gelir verisi: ${errMsg(results[1])}`);
      }

      if (results[2].status === 'fulfilled') {
        setTicketStats(results[2].value.data);
      } else {
        setTicketStats(null);
      }

      if (results[3].status === 'fulfilled') {
        setMetrics(results[3].value.data);
      } else {
        setMetrics(null);
        toast.error(`Sistem metrikleri: ${errMsg(results[3])}`);
      }
    } catch {
      toast.error('Veriler yüklenirken hata oluştu');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const planRows =
    metrics?.organizations?.planDistribution?.length ?
      metrics.organizations.planDistribution
    : (stats?.planDistribution ?? []).map((p) => ({
        plan: p.plan,
        count: typeof p._count === 'number' ? p._count : 0,
      }));

  const totalPlanCount = Math.max(
    planRows.reduce((s, p) => s + p.count, 0),
    1,
  );

  const orgTotal =
    stats?.totalOrganizations ?? stats?.organizations?.total ?? 0;
  const orgActive =
    stats?.activeOrganizations ?? stats?.organizations?.active ?? 0;
  const userTotal = stats?.totalUsers ?? stats?.users ?? 0;
  const sessionTotal = stats?.totalSessions ?? stats?.sessions ?? 0;

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Genel Bakış</h1>
          <p className="text-gray-500 text-sm mt-1">
            Platform istatistikleri ve özet bilgiler
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          icon={Building2}
          label="Organizasyon"
          value={orgTotal}
          sub={`${orgActive} aktif`}
          color="bg-purple-500"
        />
        <StatCard
          icon={Users}
          label="Kullanıcı"
          value={metrics?.database?.users || userTotal}
          color="bg-blue-500"
        />
        <StatCard
          icon={Wifi}
          label="Oturum"
          value={metrics?.sessions?.total || sessionTotal}
          sub={`${metrics?.sessions?.working || 0} aktif`}
          color="bg-green-500"
        />
        <StatCard
          icon={DollarSign}
          label="Gelir"
          value={`₺${(revenue?.total || 0).toLocaleString('tr-TR')}`}
          sub={`${revenue?.invoiceCount || 0} fatura`}
          color="bg-amber-500"
        />
        <StatCard
          icon={MessageSquare}
          label="Bugünkü Mesaj"
          value={metrics?.messages?.todayTotal || 0}
          sub={`↓${metrics?.messages?.todayIncoming || 0} ↑${metrics?.messages?.todayOutgoing || 0}`}
          color="bg-cyan-500"
        />
        <StatCard
          icon={LifeBuoy}
          label="Açık Talep"
          value={ticketStats?.open || 0}
          sub={`${ticketStats?.total || 0} toplam`}
          color="bg-rose-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan Distribution */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Dağılımı</h2>
          <div className="space-y-3">
            {planRows.map((p) => {
              const pct = Math.round((p.count / totalPlanCount) * 100);
              return (
                <div key={p.plan}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">
                      {PLAN_LABELS[p.plan] || p.plan}
                    </span>
                    <span className="text-gray-500">
                      {p.count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: PLAN_COLORS[p.plan] || '#6B7280',
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {planRows.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-4">Veri bulunamadı</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-gray-100">
            <div className="bg-emerald-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">
                {metrics?.organizations?.paid || 0}
              </p>
              <p className="text-xs text-emerald-500 mt-0.5">Ödeme Yapan</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">
                {metrics?.organizations?.trial || 0}
              </p>
              <p className="text-xs text-amber-500 mt-0.5">Deneme Süreci</p>
            </div>
          </div>
        </div>

        {/* Monthly Revenue */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Aylık Gelir</h2>
          <p className="text-sm text-gray-400 mb-4">
            Son {revenue?.monthly?.length || 0} ay
          </p>
          {revenue?.monthly && revenue.monthly.length > 0 ? (
            <div className="flex items-end gap-2 h-48">
              {revenue.monthly.slice().reverse().map((r: any) => {
                const maxRev = Math.max(
                  ...revenue.monthly.map((m: any) => Number(m.revenue) || 0),
                  1,
                );
                const pct = ((Number(r.revenue) || 0) / maxRev) * 100;
                const month = r.month
                  ? new Date(r.month).toLocaleDateString('tr-TR', {
                      month: 'short',
                      year: '2-digit',
                    })
                  : '?';
                return (
                  <div key={r.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-gray-600">
                      ₺{Number(r.revenue || 0).toLocaleString('tr-TR')}
                    </span>
                    <div className="w-full flex justify-center">
                      <div
                        className="w-full max-w-[40px] bg-purple-500 rounded-t-md"
                        style={{ height: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400">{month}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              Henüz gelir verisi yok
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Ticket Summary */}
        {ticketStats && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Destek Talepleri
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Açık" value={ticketStats.open} color="text-red-600 bg-red-50" />
              <MiniStat label="İşlemde" value={ticketStats.inProgress} color="text-amber-600 bg-amber-50" />
              <MiniStat label="Çözüldü" value={ticketStats.resolved} color="text-green-600 bg-green-50" />
              <MiniStat label="Kapatıldı" value={ticketStats.closed} color="text-gray-600 bg-gray-50" />
            </div>
          </div>
        )}

        {/* DB Stats */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Veritabanı
          </h3>
          <div className="space-y-2.5">
            <DbRow label="Mesajlar" value={metrics?.database?.messages || 0} />
            <DbRow label="Konuşmalar" value={metrics?.database?.conversations || 0} />
            <DbRow label="Kişiler" value={metrics?.database?.contacts || 0} />
            <DbRow label="Kullanıcılar" value={metrics?.database?.users || 0} />
            <DbRow label="Organizasyonlar" value={metrics?.database?.organizations || 0} />
          </div>
        </div>

        {/* Messages Today */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Günlük Mesaj Trafiği
          </h3>
          <div className="flex items-center justify-center gap-6 py-4">
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">
                {metrics?.messages?.todayIncoming || 0}
              </p>
              <p className="text-xs text-gray-500 mt-1">Gelen</p>
            </div>
            <div className="w-px h-12 bg-gray-200" />
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-600">
                {metrics?.messages?.todayOutgoing || 0}
              </p>
              <p className="text-xs text-gray-500 mt-1">Giden</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-500">
              Toplam:{' '}
              <span className="font-semibold text-gray-900">
                {(metrics?.messages?.totalMessages || 0).toLocaleString('tr-TR')}
              </span>{' '}
              mesaj
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium">{label}</p>
          <p className="text-2xl font-bold mt-0.5 text-gray-900 truncate">
            {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
          </p>
          {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <div className={`${color} w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`rounded-lg p-3 text-center ${color}`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs mt-0.5 opacity-80">{label}</p>
    </div>
  );
}

function DbRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-900">{value.toLocaleString('tr-TR')}</span>
    </div>
  );
}
