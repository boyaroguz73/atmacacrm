'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ReportsNav from '../ReportsNav';
import toast from 'react-hot-toast';
import {
  Loader2,
  Zap,
  Clock,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  Users,
  Inbox,
  ListChecks,
  Medal,
} from 'lucide-react';

type ResponseMetrics = {
  avg: number | null;
  p50: number | null;
  p90: number | null;
  total: number;
  sla30Percent: number | null;
  slaBreaches: number;
};

type AgentRow = {
  agent: { id: string; name: string | null; email: string; avatar?: string | null };
  totalMessagesSent: number;
  totalMessagesInPeriod: number;
  uniqueContactsMessaged: number;
  activeConversations: number;
  unansweredConversations: number;
  avgResponseTimeMinutes: number | null;
  responseMetrics: ResponseMetrics;
  taskStats: { pending: number; overdue: number; completed: number };
};

function fmtMin(n: number | null | undefined) {
  if (n == null) return '—';
  if (n >= 60) {
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return `${h}sa${m > 0 ? ` ${m}dk` : ''}`;
  }
  return `${n.toFixed(1).replace(/\.0$/, '')} dk`;
}

function slaTone(pct: number | null): { cls: string; label: string } {
  if (pct == null) return { cls: 'bg-gray-100 text-gray-500 border-gray-200', label: '—' };
  if (pct >= 90) return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Mükemmel' };
  if (pct >= 75) return { cls: 'bg-sky-50 text-sky-700 border-sky-200', label: 'İyi' };
  if (pct >= 50) return { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Dikkat' };
  return { cls: 'bg-red-50 text-red-700 border-red-200', label: 'Kritik' };
}

export default function ReportAgentsPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string> = {};
      if (dateFrom) p.from = `${dateFrom}T00:00:00`;
      if (dateTo) p.to = `${dateTo}T23:59:59`;
      const { data } = await api.get<AgentRow[]>('/reports/agents', { params: p });
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

  // Takım özeti: tüm agent'ların toplamlarını çıkarır; p50/p90 için ağırlıklı ortalama.
  const team = useMemo(() => {
    if (rows.length === 0) return null;
    let sent = 0;
    let unique = 0;
    let active = 0;
    let unanswered = 0;
    let p50Num = 0;
    let p50Den = 0;
    let p90Num = 0;
    let p90Den = 0;
    let slaTotal = 0;
    let slaBreaches = 0;
    for (const r of rows) {
      sent += r.totalMessagesSent;
      unique += r.uniqueContactsMessaged;
      active += r.activeConversations;
      unanswered += r.unansweredConversations;
      const m = r.responseMetrics;
      if (m && m.total > 0) {
        if (m.p50 != null) {
          p50Num += m.p50 * m.total;
          p50Den += m.total;
        }
        if (m.p90 != null) {
          p90Num += m.p90 * m.total;
          p90Den += m.total;
        }
        slaTotal += m.total;
        slaBreaches += m.slaBreaches;
      }
    }
    return {
      sent,
      unique,
      active,
      unanswered,
      p50: p50Den > 0 ? Math.round((p50Num / p50Den) * 10) / 10 : null,
      p90: p90Den > 0 ? Math.round((p90Num / p90Den) * 10) / 10 : null,
      slaPercent:
        slaTotal > 0 ? Math.round(((slaTotal - slaBreaches) / slaTotal) * 1000) / 10 : null,
      responsePairs: slaTotal,
    };
  }, [rows]);

  // Performans karnesi (hızlı sıralama)
  const leaderboard = useMemo(() => {
    return [...rows].sort((a, b) => {
      const am = a.responseMetrics?.p50;
      const bm = b.responseMetrics?.p50;
      if (am == null && bm == null) return b.totalMessagesSent - a.totalMessagesSent;
      if (am == null) return 1;
      if (bm == null) return -1;
      return am - bm;
    });
  }, [rows]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Temsilci performans karnesi</h1>
          <p className="text-sm text-gray-500 mt-1">
            Yanıt süresi medyanı, SLA uyumu, yük dağılımı ve aktivite metrikleri
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

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center text-gray-500 py-12">Aktif temsilci yok veya veri yok.</p>
      ) : (
        <>
          {/* Takım özeti */}
          {team && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <TeamKpi
                icon={MessageSquare}
                color="text-blue-600"
                label="Gönderilen mesaj"
                value={team.sent}
              />
              <TeamKpi
                icon={Users}
                color="text-violet-600"
                label="Benzersiz kişi"
                value={team.unique}
              />
              <TeamKpi
                icon={Inbox}
                color="text-indigo-600"
                label="Açık atama"
                value={team.active}
                sub={`${team.unanswered} cevapsız`}
              />
              <TeamKpi
                icon={Clock}
                color="text-sky-600"
                label="Medyan yanıt"
                value={fmtMin(team.p50)}
                sub={`Ağırlıklı, ${team.responsePairs} yanıt`}
              />
              <TeamKpi
                icon={AlertTriangle}
                color="text-amber-600"
                label="P90 yanıt (en yavaş %10)"
                value={fmtMin(team.p90)}
              />
              <TeamKpi
                icon={CheckCircle2}
                color="text-emerald-600"
                label="30 dk SLA uyumu"
                value={team.slaPercent == null ? '—' : `%${team.slaPercent}`}
                sub="Takım geneli"
              />
            </div>
          )}

          {/* Lider tablosu (görsel kartlar) */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Medal className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-gray-800">
                Yanıt hızı sıralaması (medyan yanıt süresine göre)
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {leaderboard.map((r, idx) => {
                const m = r.responseMetrics || {
                  avg: null,
                  p50: null,
                  p90: null,
                  total: 0,
                  sla30Percent: null,
                  slaBreaches: 0,
                };
                const tone = slaTone(m.sla30Percent);
                return (
                  <div
                    key={r.agent.id}
                    className="rounded-xl border border-gray-100 bg-gray-50/40 p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-11 h-11 rounded-full bg-whatsapp/10 text-whatsapp font-bold text-sm flex items-center justify-center">
                          {(r.agent.name || r.agent.email).charAt(0).toUpperCase()}
                        </div>
                        {idx < 3 && m.p50 != null && (
                          <span
                            className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white shadow ${
                              idx === 0
                                ? 'bg-amber-500'
                                : idx === 1
                                  ? 'bg-gray-400'
                                  : 'bg-orange-600'
                            }`}
                          >
                            {idx + 1}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-gray-900 truncate">
                          {r.agent.name || r.agent.email}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{r.agent.email}</div>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${tone.cls} whitespace-nowrap`}
                        title="30 dk SLA uyum seviyesi"
                      >
                        {tone.label}
                      </span>
                    </div>

                    {/* Yanıt süresi metrikleri */}
                    <div className="grid grid-cols-3 gap-2">
                      <MiniStat
                        icon={Zap}
                        color="text-sky-600"
                        label="Medyan"
                        value={fmtMin(m.p50)}
                      />
                      <MiniStat
                        icon={Clock}
                        color="text-indigo-600"
                        label="Ortalama"
                        value={fmtMin(m.avg)}
                      />
                      <MiniStat
                        icon={AlertTriangle}
                        color="text-amber-600"
                        label="P90"
                        value={fmtMin(m.p90)}
                      />
                    </div>

                    {/* SLA uyum barı */}
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                        <span>30 dk SLA uyumu</span>
                        <span className="tabular-nums font-semibold text-gray-700">
                          {m.sla30Percent == null ? '—' : `%${m.sla30Percent}`}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            m.sla30Percent == null
                              ? 'bg-gray-300'
                              : m.sla30Percent >= 90
                                ? 'bg-emerald-500'
                                : m.sla30Percent >= 75
                                  ? 'bg-sky-500'
                                  : m.sla30Percent >= 50
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                          }`}
                          style={{ width: `${m.sla30Percent ?? 0}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {m.total} yanıt · {m.slaBreaches} ihlal
                      </div>
                    </div>

                    {/* Alt: yük/aktivite */}
                    <div className="grid grid-cols-3 gap-2 text-[11px] border-t border-gray-200/70 pt-2 -mb-1">
                      <div>
                        <div className="text-gray-400">Gönderilen</div>
                        <div className="font-semibold text-gray-800 tabular-nums">
                          {r.totalMessagesSent.toLocaleString('tr-TR')}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-400">Açık atama</div>
                        <div className="font-semibold text-gray-800 tabular-nums">
                          {r.activeConversations}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-400">Cevapsız</div>
                        <div
                          className={`font-semibold tabular-nums ${
                            r.unansweredConversations > 0 ? 'text-red-600' : 'text-gray-500'
                          }`}
                        >
                          {r.unansweredConversations}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detay tablosu — eski görünüm yedek / karşılaştırma için */}
          <div className="bg-white rounded-xl border overflow-x-auto shadow-sm">
            <div className="px-5 pt-5 flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-800">Detay tablosu</h2>
            </div>
            <table className="w-full text-sm min-w-[1100px] mt-3">
              <thead>
                <tr className="bg-gray-50 border-y text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-4 py-3">Temsilci</th>
                  <th className="px-4 py-3 text-right">Gönderilen</th>
                  <th className="px-4 py-3 text-right">Dönem</th>
                  <th className="px-4 py-3 text-right">Benzersiz</th>
                  <th className="px-4 py-3 text-right">Atama</th>
                  <th className="px-4 py-3 text-right">Cevapsız</th>
                  <th className="px-4 py-3 text-right">Medyan</th>
                  <th className="px-4 py-3 text-right">P90</th>
                  <th className="px-4 py-3 text-right">SLA %</th>
                  <th className="px-4 py-3 text-right">Görev B/E/T</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.agent.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">
                        {r.agent.name || r.agent.email}
                      </div>
                      <div className="text-xs text-gray-500">{r.agent.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.totalMessagesSent}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.totalMessagesInPeriod}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.uniqueContactsMessaged}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.activeConversations}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">
                      {r.unansweredConversations}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtMin(r.responseMetrics?.p50 ?? null)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtMin(r.responseMetrics?.p90 ?? null)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.responseMetrics?.sla30Percent == null
                        ? '—'
                        : `%${r.responseMetrics.sla30Percent}`}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums text-gray-600">
                      {r.taskStats?.pending ?? 0}/{r.taskStats?.overdue ?? 0}/
                      {r.taskStats?.completed ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-gray-400 px-5 py-3 border-t">
              * Yanıt süresi: bir gelen mesaja cevap atma süresi (24 saat üstü aykırı değerler hariç).
              SLA eşiği 30 dakika. Medyan ve P90, `percentile_cont` ile hesaplanır.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function TeamKpi({
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
    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 ${color || 'text-gray-500'}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider leading-tight">
            {label}
          </p>
          <p className="text-base font-bold text-gray-900 mt-0.5 tabular-nums leading-tight">
            {typeof value === 'number' ? value.toLocaleString('tr-TR') : value}
          </p>
          {sub && <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  color,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-white border border-gray-100 px-2 py-1.5">
      <div className={`flex items-center gap-1 ${color}`}>
        <Icon className="w-3 h-3" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          {label}
        </span>
      </div>
      <div className="text-sm font-bold text-gray-900 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
