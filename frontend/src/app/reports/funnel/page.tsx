'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import {
  Loader2,
  Target,
  TrendingUp,
  TrendingDown,
  Users,
  UserPlus,
  Trophy,
  XCircle,
  Percent,
} from 'lucide-react';

type FunnelResponse = {
  byStatus: Record<string, number>;
  lostInPeriod: number;
  wonInPeriod: number;
  newLeadsInPeriod: number;
  totalPipeline: number;
  conversionOfferToWonPercent: number | null;
  conversionNewToWonInPeriodPercent: number | null;
  interestedPlus: number;
};

// Aktif huni basamakları (LOST ayrı gösterilir). WON bitiş.
const STAGES: { key: string; label: string; color: string; bar: string }[] = [
  { key: 'NEW', label: 'Yeni', color: 'text-slate-600', bar: 'bg-slate-400' },
  { key: 'CONTACTED', label: 'İletişim kuruldu', color: 'text-blue-600', bar: 'bg-blue-500' },
  { key: 'INTERESTED', label: 'İlgili', color: 'text-violet-600', bar: 'bg-violet-500' },
  { key: 'OFFER_SENT', label: 'Teklif gönderildi', color: 'text-sky-600', bar: 'bg-sky-500' },
  { key: 'WON', label: 'Kazanıldı', color: 'text-emerald-600', bar: 'bg-emerald-500' },
];

function fmtPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return `%${n.toFixed(1).replace(/\.0$/, '')}`;
}

export default function ReportFunnelPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string> = {};
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      const { data: d } = await api.get<FunnelResponse>('/reports/leads/funnel', { params: p });
      setData(d);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Huni verisi yüklenemedi'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const stagesComputed = useMemo(() => {
    if (!data) return [];
    const byStatus = data.byStatus || {};
    // Basamak genişliği: en çok kayıt olan basamağı 100% kabul eder.
    const counts = STAGES.map((s) => Number(byStatus[s.key] || 0));
    const max = Math.max(1, ...counts);
    // Basamaklar arası elde tutma: prev => curr oranı. NEW için N/A.
    return STAGES.map((s, i) => {
      const count = counts[i];
      const prev = i > 0 ? counts[i - 1] : null;
      const retention = prev != null && prev > 0 ? (count / prev) * 100 : null;
      const widthPct = max > 0 ? (count / max) * 100 : 0;
      return { ...s, count, widthPct, retention };
    });
  }, [data]);

  const lostCount = data?.byStatus?.LOST ?? 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Müşteri hunisi</h1>
          <p className="text-sm text-gray-500 mt-1">
            Potansiyel müşterilerin satın alma yolculuğu, basamak dönüşümleri ve dönemsel kazanım/kayıp özeti
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
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

      {loading && !data ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-whatsapp animate-spin" />
        </div>
      ) : !data ? (
        <p className="text-center text-gray-500 py-12">Veri alınamadı.</p>
      ) : (
        <>
          {/* KPI kartları */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi
              icon={Users}
              color="text-slate-600"
              label="Toplam pipeline"
              value={data.totalPipeline}
            />
            <Kpi
              icon={UserPlus}
              color="text-blue-600"
              label="Dönemde yeni"
              value={data.newLeadsInPeriod}
              sub="Seçili tarih aralığında oluşturulan"
            />
            <Kpi
              icon={Trophy}
              color="text-emerald-600"
              label="Dönemde kazanıldı"
              value={data.wonInPeriod}
            />
            <Kpi
              icon={XCircle}
              color="text-red-600"
              label="Dönemde kayıp"
              value={data.lostInPeriod}
            />
            <Kpi
              icon={Percent}
              color="text-cyan-600"
              label="Teklif → Kazanım"
              value={fmtPct(data.conversionOfferToWonPercent)}
              sub="Toplam OFFER_SENT içinden WON"
            />
            <Kpi
              icon={Target}
              color="text-indigo-600"
              label="Yeni → Kazanım (dönem)"
              value={fmtPct(data.conversionNewToWonInPeriodPercent)}
              sub="Dönemde açılan lead'lerden"
            />
          </div>

          {/* Huni basamakları */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Huni basamakları</h2>
            <div className="space-y-3">
              {stagesComputed.map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="w-36 shrink-0 text-xs font-medium text-gray-700">
                    {s.label}
                  </div>
                  <div className="flex-1 relative h-8 bg-gray-100 rounded-md overflow-hidden">
                    <div
                      className={`h-full ${s.bar} transition-all`}
                      style={{ width: `${Math.max(s.widthPct, s.count > 0 ? 3 : 0)}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-between px-3 text-xs font-semibold">
                      <span className={s.count > 0 ? 'text-white mix-blend-difference' : 'text-gray-400'}>
                        {s.count}
                      </span>
                      {s.retention != null && (
                        <span className="text-[10px] text-gray-600 bg-white/80 px-1.5 py-0.5 rounded tabular-nums">
                          {fmtPct(s.retention)} elde tutma
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {/* Kayıp ayrı bantta */}
              <div className="pt-3 mt-3 border-t border-gray-100 flex items-center gap-3">
                <div className="w-36 shrink-0 text-xs font-medium text-red-600 inline-flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" /> Kayıp
                </div>
                <div className="flex-1 relative h-8 bg-red-50 rounded-md overflow-hidden">
                  <div
                    className="h-full bg-red-400 transition-all"
                    style={{
                      width: `${Math.max(
                        lostCount > 0 && data.totalPipeline > 0
                          ? (lostCount / data.totalPipeline) * 100
                          : 0,
                        lostCount > 0 ? 3 : 0,
                      )}%`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center px-3 text-xs font-semibold text-red-900">
                    {lostCount}
                  </div>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-gray-400 mt-4">
              * Elde tutma, bir önceki basamaktan bu basamağa düşen oranı gösterir. &ldquo;Teklif →
              Kazanım&rdquo;{" "}
              {"KPI'sı, tüm pipeline üzerinden toplam teklif içinden kazanılan oranını verir."}
            </p>
          </div>

          {/* Sağlıklı pipeline ipucu */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
            <Insight
              icon={TrendingUp}
              color="text-emerald-600"
              title="İlgili ve üstü"
              value={data.interestedPlus}
              hint="Potansiyeli yüksek (INTERESTED + OFFER_SENT + WON + LOST)"
            />
            <Insight
              icon={Trophy}
              color="text-indigo-600"
              title="Net kazanım oranı"
              value={
                data.wonInPeriod + data.lostInPeriod > 0
                  ? fmtPct((data.wonInPeriod / (data.wonInPeriod + data.lostInPeriod)) * 100)
                  : '—'
              }
              hint="Dönemdeki WON / (WON + LOST)"
            />
            <Insight
              icon={Users}
              color="text-slate-600"
              title="Aktif pipeline"
              value={(data.totalPipeline || 0) - (data.byStatus?.WON || 0) - (data.byStatus?.LOST || 0)}
              hint="Henüz kapanmamış lead sayısı"
            />
          </div>
        </>
      )}
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

function Insight({
  icon: Icon,
  color,
  title,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  title: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="font-semibold text-gray-800">{title}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">
        {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
      </p>
      <p className="text-gray-400 mt-0.5">{hint}</p>
    </div>
  );
}
