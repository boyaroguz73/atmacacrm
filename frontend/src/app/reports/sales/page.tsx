'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  Wallet,
  Target,
  Users,
  Filter,
  Banknote,
} from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

type SalesPoint = { bucket: string; count: number; revenue: number; avgOrderValue: number };
type Customer = {
  contactId: string;
  name: string;
  phone: string;
  orderCount: number;
  revenue: number;
};

type Granularity = 'day' | 'week' | 'month';
type SourceFilter = '' | 'MANUAL' | 'TSOFT';

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'MANUAL', label: 'CRM' },
  { value: 'TSOFT', label: 'Site' },
];

const GRAN_LABELS: Record<Granularity, string> = {
  day: 'Gün',
  week: 'Hafta',
  month: 'Ay',
};

function fmtTry(n: number | undefined | null) {
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

function fmtBucket(bucket: string, gran: Granularity) {
  if (gran === 'month') return bucket.slice(0, 7);
  if (gran === 'week') return bucket.slice(5);
  return bucket.slice(5);
}

export default function ReportSalesPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [source, setSource] = useState<SourceFilter>('');
  const [series, setSeries] = useState<SalesPoint[]>([]);
  const [topCustomers, setTopCustomers] = useState<Customer[]>([]);
  const [collectionTotal, setCollectionTotal] = useState<number>(0);
  const [collectionCount, setCollectionCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const buildParams = useCallback(() => {
    const p: Record<string, string> = {};
    if (dateFrom) p.from = `${dateFrom}T00:00:00`;
    if (dateTo) p.to = `${dateTo}T23:59:59`;
    if (source) p.source = source;
    return p;
  }, [dateFrom, dateTo, source]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      const [ts, cust, colRev] = await Promise.all([
        api.get<SalesPoint[]>('/reports/sales/timeseries', {
          params: { ...params, granularity },
        }),
        api.get<Customer[]>('/reports/sales/top-customers', {
          params: { ...params, limit: 10 },
        }),
        api.get<{ total: number; count: number }>('/reports/collections/revenue', {
          params,
        }),
      ]);
      setSeries(Array.isArray(ts.data) ? ts.data : []);
      setTopCustomers(Array.isArray(cust.data) ? cust.data : []);
      setCollectionTotal(colRev.data?.total ?? 0);
      setCollectionCount(colRev.data?.count ?? 0);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Satış verisi yüklenemedi'));
      setSeries([]);
      setTopCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [buildParams, granularity]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totals = useMemo(() => {
    const totalRevenue = series.reduce((a, r) => a + (r.revenue || 0), 0);
    const totalCount = series.reduce((a, r) => a + (r.count || 0), 0);
    const avgOrderValue = totalCount > 0 ? totalRevenue / totalCount : 0;
    const topCustomersRevenue = topCustomers.reduce((a, r) => a + (r.revenue || 0), 0);
    const topCustomerShare =
      totalRevenue > 0 ? (topCustomersRevenue / totalRevenue) * 100 : 0;
    return {
      totalRevenue,
      totalCount,
      avgOrderValue,
      topCustomersRevenue,
      topCustomerShare,
    };
  }, [series, topCustomers]);

  // Dönem içi büyüme: seriyi ikiye böl ve ikinci yarıyı ilkine göre kıyasla.
  const growth = useMemo(() => {
    if (series.length < 2) return null;
    const mid = Math.floor(series.length / 2);
    const first = series.slice(0, mid);
    const second = series.slice(mid);
    const firstRev = first.reduce((a, r) => a + (r.revenue || 0), 0);
    const secondRev = second.reduce((a, r) => a + (r.revenue || 0), 0);
    if (firstRev <= 0) return secondRev > 0 ? 100 : 0;
    return ((secondRev - firstRev) / firstRev) * 100;
  }, [series]);

  const chartData = useMemo(
    () =>
      series.map((p) => ({
        ...p,
        label: fmtBucket(p.bucket, granularity),
      })),
    [series, granularity],
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Satış trendi</h1>
          <p className="text-sm text-gray-500 mt-1">
            Zaman içinde sipariş adedi, ciro ve sepet ortalaması; dönem büyümesi ve en çok katkı sağlayan
            müşteriler.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {loading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}

          {/* Kaynak filtresi */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-gray-400 ml-1" />
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSource(opt.value)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  source === opt.value
                    ? 'bg-whatsapp text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
            {(['day', 'week', 'month'] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  granularity === g
                    ? 'bg-whatsapp text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {GRAN_LABELS[g]}
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

      {/* KPI kartları */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          icon={Banknote}
          color="text-emerald-600"
          label="Tahsilat Cirosu"
          value={fmtTry(collectionTotal)}
          sub={`${collectionCount} tahsilat`}
        />
        <Kpi
          icon={Wallet}
          color="text-indigo-600"
          label="Sipariş tutarı"
          value={fmtTry(totals.totalRevenue)}
        />
        <Kpi
          icon={ShoppingBag}
          color="text-indigo-600"
          label="Sipariş adedi"
          value={totals.totalCount}
        />
        <Kpi
          icon={Target}
          color="text-sky-600"
          label="Sepet ortalaması"
          value={fmtTry(totals.avgOrderValue)}
        />
        <Kpi
          icon={growth != null && growth >= 0 ? TrendingUp : TrendingDown}
          color={growth != null && growth >= 0 ? 'text-emerald-600' : 'text-red-600'}
          label="Dönem büyümesi"
          value={
            growth == null
              ? '—'
              : `${growth > 0 ? '+' : ''}${growth.toFixed(1).replace(/\.0$/, '')}%`
          }
          sub="İkinci yarı / ilk yarı"
        />
        <Kpi
          icon={Users}
          color="text-amber-600"
          label="İlk 10 müşteri payı"
          value={`%${totals.topCustomerShare.toFixed(1).replace(/\.0$/, '')}`}
          sub={fmtTry(totals.topCustomersRevenue)}
        />
      </div>

      {/* Ana grafik: ciro (bar) + sipariş adedi (line) */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">
          Ciro ve sipariş adedi trendi ({GRAN_LABELS[granularity].toLocaleLowerCase('tr-TR')})
        </h2>
        <div className="h-80 min-h-[320px] min-w-0">
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Seçili dönemde sipariş bulunamadı.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={300} minHeight={240}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="rev"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => fmtTryShort(Number(v) || 0)}
                />
                <YAxis
                  yAxisId="cnt"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(v, name) => {
                    if (name === 'Ciro' || name === 'Sepet ort.')
                      return fmtTry(typeof v === 'number' ? v : Number(v) || 0);
                    return v;
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="rev"
                  dataKey="revenue"
                  name="Ciro"
                  fill="#6366f1"
                  radius={[3, 3, 0, 0]}
                  barSize={18}
                />
                <Line
                  yAxisId="cnt"
                  type="monotone"
                  dataKey="count"
                  name="Sipariş"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="rev"
                  type="monotone"
                  dataKey="avgOrderValue"
                  name="Sepet ort."
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top müşteriler */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">En çok ciro yaratan müşteriler</h2>
        {topCustomers.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Bu dönemde sipariş bulunamadı.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="pb-2 pr-4 w-8">#</th>
                  <th className="pb-2 pr-4">Müşteri</th>
                  <th className="pb-2 pr-4 text-right">Sipariş</th>
                  <th className="pb-2 pr-4 text-right">Ciro</th>
                  <th className="pb-2 text-right">Pay</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c, i) => {
                  const share =
                    totals.totalRevenue > 0 ? (c.revenue / totals.totalRevenue) * 100 : 0;
                  return (
                    <tr key={c.contactId} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-4 text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="py-2 pr-4">
                        <Link
                          href={`/contacts/${c.contactId}`}
                          className="font-medium text-gray-900 hover:text-whatsapp"
                        >
                          {c.name}
                        </Link>
                        {c.phone && (
                          <div className="text-[11px] text-gray-400 tabular-nums">{c.phone}</div>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-gray-700">
                        {c.orderCount}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums font-semibold text-gray-900">
                        {fmtTry(c.revenue)}
                      </td>
                      <td className="py-2 text-right">
                        <div className="inline-flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500"
                              style={{ width: `${Math.min(100, share)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-gray-500 w-10 text-right">
                            %{share.toFixed(1).replace(/\.0$/, '')}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${color || 'text-gray-500'}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</p>
          <p className="text-lg font-bold text-gray-900 mt-0.5 tabular-nums leading-tight">
            {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
          </p>
          {sub && <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
