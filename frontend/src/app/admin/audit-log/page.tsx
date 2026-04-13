'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  User,
  FileText,
  Trash2,
  Edit2,
  Plus,
  Zap,
  Eye,
  Settings,
  MessageSquare,
} from 'lucide-react';

interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: any;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; role: string } | null;
}

const ACTION_ICONS: Record<string, any> = {
  CREATE: Plus,
  UPDATE: Edit2,
  DELETE: Trash2,
  LOGIN: User,
  VIEW: Eye,
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-50 text-green-700',
  UPDATE: 'bg-blue-50 text-blue-700',
  DELETE: 'bg-red-50 text-red-700',
  LOGIN: 'bg-purple-50 text-purple-700',
  VIEW: 'bg-gray-50 text-gray-600',
};

const ENTITY_ICONS: Record<string, any> = {
  MessageTemplate: FileText,
  AutoReplyFlow: Zap,
  User: User,
  SystemSetting: Settings,
  Message: MessageSquare,
};

const ENTITY_LABELS: Record<string, string> = {
  MessageTemplate: 'Mesaj Şablonu',
  AutoReplyFlow: 'Otomatik Yanıt',
  User: 'Kullanıcı',
  SystemSetting: 'Sistem Ayarı',
  Message: 'Mesaj',
  Contact: 'Kişi',
  Conversation: 'Konuşma',
  Lead: 'Potansiyel Müşteri',
  Task: 'Görev',
  Assignment: 'Atama',
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Oluşturuldu',
  UPDATE: 'Güncellendi',
  DELETE: 'Silindi',
  LOGIN: 'Giriş Yapıldı',
  LOGOUT: 'Çıkış Yapıldı',
  VIEW: 'Görüntülendi',
  TOGGLE: 'Durum Değiştirildi',
  ASSIGN: 'Atandı',
  SEND: 'Gönderildi',
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [entities, setEntities] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);

  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    fetchMeta();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [page, entityFilter, actionFilter, dateFrom, dateTo]);

  const fetchMeta = async () => {
    try {
      const [entRes, actRes] = await Promise.all([
        api.get('/audit-logs/entities'),
        api.get('/audit-logs/actions'),
      ]);
      setEntities(entRes.data);
      setActions(actRes.data);
    } catch {}
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 30 };
      if (entityFilter) params.entity = entityFilter;
      if (actionFilter) params.action = actionFilter;
      if (dateFrom) params.startDate = `${dateFrom}T00:00:00`;
      if (dateTo) params.endDate = `${dateTo}T23:59:59`;

      const { data } = await api.get('/audit-logs', { params });
      setLogs(data.logs);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Aktivite Logu</h1>
        <p className="text-sm text-gray-500 mt-1">
          Sistemdeki tüm işlemlerin kaydı. Toplam {total} kayıt.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={entityFilter}
          onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
        >
          <option value="">Tüm Varlıklar</option>
          {entities.map((e) => (
            <option key={e} value={e}>
              {ENTITY_LABELS[e] || e}
            </option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
        >
          <option value="">Tüm İşlemler</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a] || a}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        {(entityFilter || actionFilter || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setEntityFilter('');
              setActionFilter('');
              setDateFrom('');
              setDateTo('');
              setPage(1);
            }}
            className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
          >
            Temizle
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Kayıt bulunamadı</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const ActionIcon = ACTION_ICONS[log.action] || Activity;
            const actionColor = ACTION_COLORS[log.action] || 'bg-gray-50 text-gray-600';
            const EntityIcon = ENTITY_ICONS[log.entity] || FileText;
            const isExpanded = expandedLog === log.id;

            return (
              <div
                key={log.id}
                className="bg-white border rounded-xl overflow-hidden hover:shadow-sm transition-shadow"
              >
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer"
                  onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${actionColor}`}>
                    <ActionIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-gray-900">
                        {log.user?.name || 'Sistem'}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${actionColor}`}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                      <span className="flex items-center gap-1 text-gray-500 text-xs">
                        <EntityIcon className="w-3 h-3" />
                        {ENTITY_LABELS[log.entity] || log.entity}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {formatDate(log.createdAt)}
                  </span>
                </div>
                {isExpanded && log.details && (
                  <div className="px-4 pb-3 border-t bg-gray-50">
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap mt-2 font-mono bg-white p-3 rounded-lg border overflow-x-auto">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                    {log.entityId && (
                      <p className="text-xs text-gray-400 mt-2">
                        Varlık ID: <code className="bg-gray-100 px-1 rounded">{log.entityId}</code>
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Sayfa {page} / {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
              Önceki
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30"
            >
              Sonraki
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
