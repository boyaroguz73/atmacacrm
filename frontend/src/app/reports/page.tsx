'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import toast from 'react-hot-toast';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
} from 'recharts';
import ReportsNav from './ReportsNav';
import {
  ArrowRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  Target,
  Users,
  BarChart3,
  Banknote,
  Receipt,
  Filter,
} from 'lucide-react';

const FUNNEL_COLORS: Record<string, string> = {
  NEW: '#94a3b8',
  CONTACTED: '#3b82f6',
  INTERESTED: '#8b5cf6',
  OFFER_SENT: '#0ea5e9',
  WON: '#22c55e',
  LOST: '#ef4444',
};

const FUNNEL_LABELS: Record<string, string> = {
  NEW: 'Yeni',
  CONTACTED: 'İletişim',
  INTERESTED: 'İlgili',
  OFFER_SENT: 'Teklif',
  WON: 'Kazanıldı',
  LOST: 'Kayıp',
};

type SourceFilter = '' | 'MANUAL' | 'TSOFT';

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'MANUAL', label: 'CRM' },
  { value: 'TSOFT', label: 'Site' },
];

export default function ReportsOverviewPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [source, setSource] = useState<SourceFilter>('');
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<any>(null);

  const buildParams = useCallback(() => {
    const p: Record<string, string> = {};
    if (dateFrom) p.from = `${dateFrom}T00:00:00`;
    if (dateTo) p.to = `${dateTo}T23:59:59`;
    if (source) p.source = source;
    return p;
  }, [dateFrom, dateTo, source]);

  const fetchDash = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/reports/dashboard', { params: buildParams() });
      setDash(data);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Rapor yüklenemedi'));
      setDash(null);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    fetchDash();
  }, [fetchDash]);

  const collectionData = dash?.charts?.collections || [];
  const catData = useMemo(
    () =>
      (dash?.charts?.topCategories || []).map((c: any) => ({
        name: c.category?.length > 16 ? `${c.category.slice(0, 16)}…` : c.category,
        revenue: Math.round((c.revenue || 0) * 100) / 100,
      })),
    [dash],
  );

  const collectionTotal = useMemo(
    () => collectionData.reduce((a: number, r: any) => a + (r.amount || 0), 0),
    [collectionData],
  );

  const funnelPie = useMemo(() => {
    const byStatus = dash?.funnel?.byStatus || {};
    return Object.entries(byStatus)
      .filter(([, v]) => Number(v) > 0)
      .map(([key, count]) => ({
        name: FUNNEL_LABELS[key] || key,
        value: Number(count),
        color: FUNNEL_COLORS[key] || '#94a3b8',
      }));
  }, [dash]);

  const avgOrderValue =
    (dash?.orders?.count ?? 0) > 0
      ? Math.round((dash.orders.sumGrandTotal / dash.orders.count) * 100) / 100
      : 0;

  const collectionRevenue = dash?.collectionRevenue;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Raporlar</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {loading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}

          {/* Kaynak filtresi */}
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white p-0.5 text-xs shadow-sm">
            <Filter className="w-3.5 h-3.5 text-gray-400 ml-1.5" />
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSource(opt.value)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
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

      {loading && !dash ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-whatsapp animate-spin" />
        </div>
      ) : !dash ? (
        <p className="text-center text-gray-500 py-12">Veri alınamadı.</p>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Tahsilat Cirosu"
              value={fmtTry(collectionRevenue?.total ?? collectionTotal)}
              sub={`${collectionRevenue?.count ?? 0} tahsilat kaydı`}
              icon={Banknote}
              color="text-emerald-600"
              href="/reports/sales"
            />
            <MetricCard
              label="Sipariş Toplamı"
              value={fmtTry(dash.orders?.sumGrandTotal)}
              sub={`${dash.orders?.count ?? 0} sipariş · Ort: ${fmtTry(avgOrderValue)}`}
              icon={ShoppingBag}
              color="text-indigo-600"
              href="/reports/sales"
            />
            <MetricCard
              label="Yeni Kişi"
              value={dash.summary?.newContacts ?? 0}
              sub={`${dash.summary?.totalConversations ?? 0} konuşma`}
              icon={Users}
              color="text-purple-600"
              href="/reports/agents"
            />
            <MetricCard
              label="Huni Kazanıldı"
              value={dash.funnel?.wonInPeriod ?? 0}
              sub={`Kayıp: ${dash.funnel?.lostInPeriod ?? 0} · Yeni: ${dash.funnel?.newLeadsInPeriod ?? 0}`}
              icon={Target}
              color="text-emerald-600"
              href="/reports/funnel"
            />
            <MetricCard
              label="Dönüşüm Oranı"
              value={
                dash.funnel?.conversionOfferToWonPercent != null
                  ? `%${dash.funnel.conversionOfferToWonPercent}`
                  : '—'
              }
              sub="Teklif → kazanım"
              icon={BarChart3}
              color="text-cyan-600"
              href="/reports/funnel"
            />
            <MetricCard
              label="Temsilciler"
              value={dash.agents?.length ?? 0}
              sub="Aktif temsilci"
              icon={Users}
              color="text-whatsapp"
              href="/reports/agents"
            />
            <MetricCard
              label="Cevaplanmamış"
              value={dash.summary?.unansweredTotal ?? 0}
              sub="Açık konuşma"
              icon={Receipt}
              color="text-amber-600"
            />
            <MetricCard
              label="Lead Dönüşüm"
              value={dash.summary?.leadConversions ?? 0}
              sub="Kazanılan dönemde"
              icon={TrendingUp}
              color="text-blue-600"
              href="/reports/funnel"
            />
          </div>

          {/* Charts Row 1: Tahsilat Trendi + Funnel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-800">Tahsilat Cirosu Trendi</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Günlük onaylı tahsilat tutarları</p>
                </div>
                <Link
                  href="/reports/sales"
                  className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline"
                >
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="h-64 min-h-[256px] min-w-0">
                {collectionData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                    Seçili dönemde tahsilat verisi yok
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
                    <ComposedChart data={collectionData}>
                      <defs>
                        <linearGradient id="colGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(d) => d?.slice(5)}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => fmtTryShort(Number(v) || 0)}
                      />
                      <Tooltip
                        formatter={(v) =>
                          fmtTry(typeof v === 'number' ? v : Number(v) || 0)
                        }
                        labelFormatter={(l) => `Tarih: ${l}`}
                      />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        name="Tahsilat"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#colGrad)"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-800">Müşteri Hunisi</h2>
                <Link
                  href="/reports/funnel"
                  className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline"
                >
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              {funnelPie.length === 0 ? (
                <div className="flex items-center justify-center h-52 text-gray-400 text-sm">
                  Veri yok
                </div>
              ) : (
                <>
                  <div className="h-48 min-h-[192px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={180}>
                      <PieChart>
                        <Pie
                          data={funnelPie}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={2}
                        >
                          {funnelPie.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                    {funnelPie.map((e) => (
                      <span
                        key={e.name}
                        className="inline-flex items-center gap-1 text-[10px] text-gray-600"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: e.color }}
                        />
                        {e.name} ({e.value})
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sipariş trendi + Kategori Cirosu */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sipariş trendi */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-800">Sipariş Trendi</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Günlük sipariş tutarı (onaylı)</p>
                </div>
                <Link
                  href="/reports/sales"
                  className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline"
                >
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="h-56 min-h-[224px] min-w-0">
                {collectionData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                    Veri yok
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={200}>
                    <AreaChart data={collectionData}>
                      <defs>
                        <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(d) => d?.slice(5)}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => fmtTryShort(Number(v) || 0)}
                      />
                      <Tooltip
                        formatter={(v) =>
                          fmtTry(typeof v === 'number' ? v : Number(v) || 0)
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="amount"
                        name="Tahsilat"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fill="url(#ordGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Kategori Cirosu */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-800">Kategori Cirosu</h2>
                <Link
                  href="/reports/categories"
                  className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline"
                >
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="h-56 min-h-[224px] min-w-0">
                {catData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                    Veri yok
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={200}>
                    <BarChart data={catData} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#f1f5f9"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => fmtTryShort(v)}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        width={100}
                      />
                      <Tooltip
                        formatter={(v) =>
                          fmtTry(typeof v === 'number' ? v : Number(v) || 0)
                        }
                      />
                      <Bar
                        dataKey="revenue"
                        name="Ciro"
                        fill="#6366f1"
                        radius={[0, 4, 4, 0]}
                        barSize={18}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Agent Summary */}
          {(dash.agents?.length ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-800">Temsilci Performansı</h2>
                <Link
                  href="/reports/agents"
                  className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline"
                >
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="pb-2 pr-4">Temsilci</th>
                      <th className="pb-2 pr-4 text-right">Gönderilen Mesaj</th>
                      <th className="pb-2 pr-4 text-right">Kişi</th>
                      <th className="pb-2 pr-4 text-right">Aktif Atama</th>
                      <th className="pb-2 pr-4 text-right">SLA %</th>
                      <th className="pb-2 text-right">Cevaplanmamış</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.agents.map((a: any) => (
                      <tr key={a.agent.id} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-whatsapp/10 rounded-full flex items-center justify-center font-bold text-whatsapp text-xs shrink-0">
                              {(a.agent.name || a.agent.email)?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <span className="font-medium text-gray-900">
                              {a.agent.name || a.agent.email}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-700">
                          {a.totalMessagesSent}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-700">
                          {a.uniqueContactsMessaged}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-700">
                          {a.activeConversations}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {a.responseMetrics?.sla30Percent != null ? (
                            <span
                              className={`tabular-nums text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                                a.responseMetrics.sla30Percent >= 90
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : a.responseMetrics.sla30Percent >= 75
                                    ? 'bg-sky-50 text-sky-700'
                                    : a.responseMetrics.sla30Percent >= 50
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-red-50 text-red-700'
                              }`}
                            >
                              %{a.responseMetrics.sla30Percent}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={`tabular-nums ${
                              a.unansweredConversations > 0
                                ? 'text-red-600 font-semibold'
                                : 'text-gray-500'
                            }`}
                          >
                            {a.unansweredConversations}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtTry(n: number | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtTryShort(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function MetricCard({
  label,
  value,
  sub,
  href,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  color?: string;
}) {
  const inner = (
    <div className="flex items-start gap-3">
      {Icon && (
        <div className={`mt-0.5 ${color || 'text-gray-500'}`}>
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</p>
        <p className="text-lg font-bold text-gray-900 mt-0.5 tabular-nums leading-tight">
          {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
        </p>
        {sub ? <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{sub}</p> : null}
      </div>
    </div>
  );
  const cls =
    'rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md';
  if (href) {
    return (
      <Link href={href} className={`${cls} block`}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}
