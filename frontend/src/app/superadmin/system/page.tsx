'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Cpu,
  MemoryStick,
  HardDrive,
  MessageSquare,
  Database,
  Wifi,
  RefreshCw,
  Clock,
  Server,
} from 'lucide-react';

interface Metrics {
  cpu: {
    cores: number;
    model: string;
    usagePercent: number;
    loadAvg: number[];
  };
  memory: {
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
    processRSS_MB: number;
    processHeap_MB: number;
  };
  disk: {
    uploadsSizeMB: number;
  };
  messages: {
    todayIncoming: number;
    todayOutgoing: number;
    todayTotal: number;
    totalMessages: number;
  };
  database: {
    messages: number;
    conversations: number;
    contacts: number;
    users: number;
    organizations: number;
  };
  sessions: {
    total: number;
    working: number;
    stopped: number;
    sessions: { id: string; name: string; status: string; phone: string | null }[];
  };
  organizations: {
    total: number;
    active: number;
    trial: number;
    paid: number;
    planDistribution: { plan: string; count: number }[];
  };
  uptime: number;
  nodeVersion: string;
  platform: string;
}

export default function SystemPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/system/metrics');
      setMetrics(res.data);
    } catch {
      toast.error('Sistem metrikleri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}g ${h}s ${m}dk`;
  };

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sistem Sağlığı</h1>
          <p className="text-gray-500 text-sm mt-1">
            Sunucu metrikleri ve kaynak kullanımı
          </p>
        </div>
        <button
          onClick={fetchMetrics}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      {/* Server Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InfoCard icon={Server} label="Platform" value={metrics.platform} />
        <InfoCard icon={Clock} label="Çalışma Süresi" value={formatUptime(metrics.uptime)} />
        <InfoCard icon={Database} label="Node.js" value={metrics.nodeVersion} />
      </div>

      {/* Resource Usage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ResourceCard
          icon={Cpu}
          label="CPU Kullanımı"
          percent={metrics.cpu.usagePercent}
          details={[
            { label: 'Çekirdek', value: `${metrics.cpu.cores}` },
            { label: 'Model', value: metrics.cpu.model.substring(0, 30) },
            { label: 'Yük Ort.', value: metrics.cpu.loadAvg.join(', ') },
          ]}
          color="purple"
        />
        <ResourceCard
          icon={MemoryStick}
          label="RAM Kullanımı"
          percent={metrics.memory.usagePercent}
          details={[
            { label: 'Kullanılan', value: `${metrics.memory.usedGB} GB` },
            { label: 'Toplam', value: `${metrics.memory.totalGB} GB` },
            { label: 'Boş', value: `${metrics.memory.freeGB} GB` },
            { label: 'Process RSS', value: `${metrics.memory.processRSS_MB} MB` },
            { label: 'Heap', value: `${metrics.memory.processHeap_MB} MB` },
          ]}
          color="blue"
        />
        <ResourceCard
          icon={HardDrive}
          label="Disk (Uploads)"
          percent={Math.min(100, Math.round(metrics.disk.uploadsSizeMB / 10))}
          details={[
            { label: 'Uploads', value: `${metrics.disk.uploadsSizeMB} MB` },
          ]}
          color="green"
        />
      </div>

      {/* Messages & Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-5 h-5 text-cyan-500" />
            <h2 className="text-lg font-semibold text-gray-900">Mesaj İstatistikleri</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatBlock label="Bugün Gelen" value={metrics.messages.todayIncoming} color="text-green-600" />
            <StatBlock label="Bugün Giden" value={metrics.messages.todayOutgoing} color="text-blue-600" />
            <StatBlock label="Bugün Toplam" value={metrics.messages.todayTotal} color="text-cyan-600" />
            <StatBlock label="Tüm Zamanlar" value={metrics.messages.totalMessages} color="text-gray-900" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Wifi className="w-5 h-5 text-green-500" />
            <h2 className="text-lg font-semibold text-gray-900">WhatsApp Oturumları</h2>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatBlock label="Toplam" value={metrics.sessions.total} color="text-gray-900" />
            <StatBlock label="Çalışan" value={metrics.sessions.working} color="text-green-600" />
            <StatBlock label="Durmuş" value={metrics.sessions.stopped} color="text-red-600" />
          </div>
          <div className="space-y-1.5 mt-3 pt-3 border-t border-gray-100">
            {metrics.sessions.sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm py-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      s.status === 'WORKING' ? 'bg-green-500' : 'bg-red-400'
                    }`}
                  />
                  <span className="text-gray-900 font-medium">{s.name}</span>
                </div>
                <span className="text-xs text-gray-400">{s.phone || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* DB Record Counts */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-semibold text-gray-900">Veritabanı Kayıtları</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <DbCount label="Mesajlar" value={metrics.database.messages} />
          <DbCount label="Konuşmalar" value={metrics.database.conversations} />
          <DbCount label="Kişiler" value={metrics.database.contacts} />
          <DbCount label="Kullanıcılar" value={metrics.database.users} />
          <DbCount label="Organizasyonlar" value={metrics.database.organizations} />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-500 flex items-center justify-center">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-gray-900 truncate">{value}</p>
      </div>
    </div>
  );
}

function ResourceCard({
  icon: Icon,
  label,
  percent,
  details,
  color,
}: {
  icon: any;
  label: string;
  percent: number;
  details: { label: string; value: string }[];
  color: string;
}) {
  const colorMap: Record<string, { bg: string; fg: string; track: string }> = {
    purple: { bg: 'bg-purple-500', fg: 'text-purple-600', track: 'bg-purple-100' },
    blue: { bg: 'bg-blue-500', fg: 'text-blue-600', track: 'bg-blue-100' },
    green: { bg: 'bg-green-500', fg: 'text-green-600', track: 'bg-green-100' },
  };
  const c = colorMap[color] || colorMap.purple;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-5 h-5 ${c.fg}`} />
        <h3 className="font-semibold text-gray-900">{label}</h3>
      </div>
      <div className="flex items-center gap-4 mb-4">
        <div className="relative w-20 h-20">
          <svg viewBox="0 0 36 36" className="w-20 h-20 transform -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              stroke="#f3f4f6"
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              stroke={percent > 80 ? '#ef4444' : percent > 60 ? '#f59e0b' : '#10b981'}
              strokeWidth="3"
              strokeDasharray={`${percent} ${100 - percent}`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-gray-900">
            {percent}%
          </span>
        </div>
        <div className="flex-1 space-y-1.5">
          {details.map((d) => (
            <div key={d.label} className="flex justify-between text-xs">
              <span className="text-gray-500">{d.label}</span>
              <span className="font-medium text-gray-700 truncate ml-2">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value.toLocaleString('tr-TR')}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function DbCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 text-center">
      <p className="text-2xl font-bold text-gray-900">{value.toLocaleString('tr-TR')}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}
