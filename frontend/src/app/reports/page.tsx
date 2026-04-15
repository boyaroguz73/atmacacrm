'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import toast from 'react-hot-toast';
import {
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
} from 'recharts';
import ReportsNav from './ReportsNav';
import { ArrowRight, Loader2 } from 'lucide-react';

export default function ReportsOverviewPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<any>(null);

  const params = () => {
    const p: Record<string, string> = {};
    if (dateFrom) p.from = `${dateFrom}T00:00:00`;
    if (dateTo) p.to = `${dateTo}T23:59:59`;
    return p;
  };

  const fetchDash = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/reports/dashboard', { params: params() });
      setDash(data);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Rapor yüklenemedi'));
      setDash(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchDash();
  }, [fetchDash]);

  const msgData = dash?.charts?.messages || [];
  const catData = (dash?.charts?.topCategories || []).map((c: any) => ({
    name: c.category?.length > 18 ? `${c.category.slice(0, 18)}…` : c.category,
    revenue: Math.round((c.revenue || 0) * 100) / 100,
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Raporlar</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tarih aralığına göre mesajlar, kasa, huni, satış ve faturalar. Detaylar için alt menüyü kullanın.
          </p>
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
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-whatsapp animate-spin" />
        </div>
      ) : !dash ? (
        <p className="text-center text-gray-500 py-12">Veri alınamadı.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Toplam mesaj"
              value={dash.summary?.totalMessages ?? 0}
              sub={`${dash.summary?.incomingMessages ?? 0} gelen / ${dash.summary?.outgoingMessages ?? 0} giden`}
              href="/reports/messages"
            />
            <MetricCard
              label="Yeni kişi"
              value={dash.summary?.newContacts ?? 0}
              sub="Dönem içi oluşturulan"
              href="/reports/contacts"
            />
            <MetricCard
              label="Cevaplanmamış"
              value={dash.summary?.unansweredTotal ?? 0}
              sub="Açık görüşme"
            />
            <MetricCard
              label="Huni — kazanıldı"
              value={dash.funnel?.wonInPeriod ?? 0}
              sub={`Kayıp: ${dash.funnel?.lostInPeriod ?? 0} · Yeni lead: ${dash.funnel?.newLeadsInPeriod ?? 0}`}
              href="/reports/funnel"
            />
            <MetricCard
              label="Sipariş tutarı"
              value={fmtTry(dash.orders?.sumGrandTotal)}
              sub={`${dash.orders?.count ?? 0} sipariş`}
              href="/reports/products"
            />
            <MetricCard
              label="Fatura tutarı"
              value={fmtTry(dash.invoices?.sumGrandTotal)}
              sub={`${dash.invoices?.count ?? 0} fatura`}
              href="/reports/invoices"
            />
            <MetricCard
              label="Teklif→kazanç %"
              value={dash.funnel?.conversionOfferToWonPercent != null ? `${dash.funnel.conversionOfferToWonPercent}%` : '—'}
              sub="Teklif gönderildi → kazanıldı"
              href="/reports/funnel"
            />
            <MetricCard
              label="Temsilci"
              value={dash.agents?.length ?? 0}
              sub="Aktif temsilci raporu"
              href="/reports/agents"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-800">Günlük mesaj (gelen / giden)</h2>
                <Link href="/reports/messages" className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5">
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
                  <LineChart data={msgData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="incoming" name="Gelen" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="outgoing" name="Giden" stroke="#16a34a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-800">Kategori geliri (sipariş)</h2>
                <Link href="/reports/categories" className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5">
                  Detay <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
                  <BarChart data={catData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => fmtTry(typeof v === 'number' ? v : Number(v) || 0)} />
                    <Bar dataKey="revenue" name="Ciro" fill="#25D366" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-800">Kasa — günlük (TL)</h2>
              <Link href="/reports/cash" className="text-xs text-whatsapp font-medium inline-flex items-center gap-0.5">
                Detay <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
                <BarChart data={dash.charts?.cash || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => fmtTry(typeof v === 'number' ? v : Number(v) || 0)} />
                  <Legend />
                  <Bar dataKey="income" name="Giriş" stackId="a" fill="#22c55e" />
                  <Bar dataKey="expense" name="Çıkış" stackId="a" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function fmtTry(n: number | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
}

function MetricCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <>
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] text-gray-400 mt-1">{sub}</p> : null}
    </>
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
