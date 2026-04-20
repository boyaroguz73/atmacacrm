'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import toast from 'react-hot-toast';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
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
} from 'recharts';
import ReportsNav from './ReportsNav';
import {
  ArrowRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  UserPlus,
  ShoppingBag,
  FileText,
  Target,
  Wallet,
  Users,
  BarChart3,
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

export default function ReportsOverviewPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<any>(null);

  const buildParams = useCallback(() => {
    const p: Record<string, string> = {};
    if (dateFrom) p.from = `${dateFrom}T00:00:00`;
    if (dateTo) p.to = `${dateTo}T23:59:59`;
    return p;
  }, [dateFrom, dateTo]);

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

  const msgData = dash?.charts?.messages || [];
  const cashData = dash?.charts?.cash || [];
  const catData = useMemo(
    () =>
      (dash?.charts?.topCategories || []).map((c: any) => ({
        name: c.category?.length > 16 ? `${c.category.slice(0, 16)}…` : c.category,
        revenue: Math.round((c.revenue || 0) * 100) / 100,
      })),
    [dash],
  );

  const cashNet = useMemo(() => {
    const inc = cashData.reduce((a: number, r: any) => a + (r.income || 0), 0);
    const exp = cashData.reduce((a: number, r: any) => a + (r.expense || 0), 0);
    return { income: inc, expense: exp, net: inc - exp };
  }, [cashData]);

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

  const avgOrderValue = dash?.orders?.count > 0
    ? Math.round((dash.orders.sumGrandTotal / dash.orders.count) * 100) / 100
    : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Raporlar</h1>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
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
              label="Mesajlar"
              value={dash.summary?.totalMessages ?? 0}
              sub={`${dash.summary?.incomingMessages ?? 0} gelen / ${dash.summary?.outgoingMessages ?? 0} giden`}
              icon={MessageSquare}
              color="text-blue-600"
              href="/reports/messages"
            />
            <MetricCard
              label="Yeni Kişi"
              value={dash.summary?.newContacts ?? 0}
              icon={UserPlus}
              color="text-purple-600"
              href="/reports/contacts"
            />
            <MetricCard
              label="Sipariş Cirosu"
              value={fmtTry(dash.orders?.sumGrandTotal)}
              sub={`${dash.orders?.count ?? 0} sipariş · Ort: ${fmtTry(avgOrderValue)}`}
              icon={ShoppingBag}
              color="text-indigo-600"
              href="/reports/sales"
            />
            <MetricCard
              label="Fatura Toplamı"
              value={fmtTry(dash.invoices?.sumGrandTotal)}
              sub={`${dash.invoices?.count ?? 0} fatura`}
              icon={FileText}
              color="text-amber-600"
              href="/reports/invoices"
            />
            <MetricCard
              label="Kasa Net"
              value={fmtTry(cashNet.net)}
              sub={`Giriş: ${fmtTry(cashNet.income)} · Çıkış: ${fmtTry(cashNet.expense)}`}
              icon={cashNet.net >= 0 ? TrendingUp : TrendingDown}
              color={cashNet.net >= 0 ? 'text-emerald-600' : 'text-red-600'}
              href="/reports/cash"
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
              value={dash.funnel?.conversionOfferToWonPercent != null ? `%${dash.funnel.conversionOfferToWonPercent}` : '—'}
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
          </div>

          {/* Charts Row 1: Messages + Funnel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-800">Günlük Mesaj Trafiği</h2>
                <Link href="/reports/messages" className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline">
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={msgData}>
                    <defs>
                      <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16a34a" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => d?.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="incoming" name="Gelen" stroke="#2563eb" strokeWidth={2} fill="url(#colorIn)" />
                    <Area type="monotone" dataKey="outgoing" name="Giden" stroke="#16a34a" strokeWidth={2} fill="url(#colorOut)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-800">Müşteri Hunisi</h2>
                <Link href="/reports/funnel" className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline">
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              {funnelPie.length === 0 ? (
                <div className="flex items-center justify-center h-52 text-gray-400 text-sm">Veri yok</div>
              ) : (
                <>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
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
                      <span key={e.name} className="inline-flex items-center gap-1 text-[10px] text-gray-600">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color }} />
                        {e.name} ({e.value})
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Charts Row 2: Category Revenue + Cash */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-800">Kategori Cirosu</h2>
                <Link href="/reports/categories" className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline">
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="h-64">
                {catData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">Veri yok</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={catData} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtTryShort(v)} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                      <Tooltip formatter={(v) => fmtTry(typeof v === 'number' ? v : Number(v) || 0)} />
                      <Bar dataKey="revenue" name="Ciro" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-800">Kasa Akışı</h2>
                <Link href="/reports/cash" className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline">
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="h-64">
                {cashData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">Veri yok</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cashData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => d?.slice(5)} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtTryShort(v)} />
                      <Tooltip formatter={(v) => fmtTry(typeof v === 'number' ? v : Number(v) || 0)} />
                      <Legend />
                      <Bar dataKey="income" name="Giriş" stackId="a" fill="#22c55e" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="expense" name="Çıkış" stackId="a" fill="#ef4444" radius={[2, 2, 0, 0]} />
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
                <Link href="/reports/agents" className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5 hover:underline">
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="pb-2 pr-4">Temsilci</th>
                      <th className="pb-2 pr-4 text-right">Mesaj</th>
                      <th className="pb-2 pr-4 text-right">Konuşulan Kişi</th>
                      <th className="pb-2 pr-4 text-right">Aktif Atama</th>
                      <th className="pb-2 text-right">Cevaplanmamış</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.agents.map((a: any) => (
                      <tr key={a.agent.id} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-whatsapp/10 rounded-full flex items-center justify-center font-bold text-whatsapp text-xs shrink-0">
                              {a.agent.name?.charAt(0) || '?'}
                            </div>
                            <span className="font-medium text-gray-900">{a.agent.name}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-700">{a.totalMessagesSent}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-700">{a.uniqueContactsMessaged}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-700">{a.activeConversations}</td>
                        <td className="py-2 text-right">
                          <span className={`tabular-nums ${a.unansweredConversations > 0 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
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
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
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
