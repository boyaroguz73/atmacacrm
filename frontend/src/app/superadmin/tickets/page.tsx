'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  LifeBuoy,
  RefreshCw,
  Search,
  ArrowLeft,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from 'lucide-react';

interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  createdAt: string;
  closedAt: string | null;
  organization: { id: string; name: string };
  createdBy: { id: string; name: string; email: string };
  assignedTo: { id: string; name: string; email: string } | null;
  _count?: { messages: number };
  messages?: TicketMsg[];
}

interface TicketMsg {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; role: string; avatar: string | null };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  OPEN: { label: 'Açık', color: 'text-red-600 bg-red-50', icon: AlertCircle },
  IN_PROGRESS: { label: 'İşlemde', color: 'text-amber-600 bg-amber-50', icon: Clock },
  RESOLVED: { label: 'Çözüldü', color: 'text-green-600 bg-green-50', icon: CheckCircle2 },
  CLOSED: { label: 'Kapatıldı', color: 'text-gray-600 bg-gray-100', icon: XCircle },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Düşük', color: 'bg-gray-100 text-gray-600' },
  MEDIUM: { label: 'Orta', color: 'bg-blue-100 text-blue-600' },
  HIGH: { label: 'Yüksek', color: 'bg-orange-100 text-orange-600' },
  CRITICAL: { label: 'Kritik', color: 'bg-red-100 text-red-600' },
};

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const res = await api.get('/support/tickets', { params });
      setTickets(res.data);
    } catch {
      toast.error('Talepler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/support/tickets/${id}`);
      setSelected(res.data);
    } catch {
      toast.error('Talep detayı yüklenemedi');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.messages]);

  const handleSendMessage = async () => {
    if (!selected || !newMessage.trim()) return;
    setSending(true);
    try {
      await api.post(`/support/tickets/${selected.id}/messages`, {
        body: newMessage.trim(),
      });
      setNewMessage('');
      const res = await api.get(`/support/tickets/${selected.id}`);
      setSelected(res.data);
    } catch {
      toast.error('Mesaj gönderilemedi');
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (ticketId: string, status: string) => {
    try {
      await api.patch(`/support/tickets/${ticketId}`, { status });
      toast.success('Durum güncellendi');
      if (selected?.id === ticketId) {
        const res = await api.get(`/support/tickets/${ticketId}`);
        setSelected(res.data);
      }
      fetchTickets();
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const filteredTickets = tickets.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.subject.toLowerCase().includes(q) ||
      t.organization.name.toLowerCase().includes(q) ||
      t.createdBy.name.toLowerCase().includes(q)
    );
  });

  if (selected) {
    return (
      <div className="max-w-[1440px] mx-auto px-6 py-8">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Taleplere Dön
        </button>

        {detailLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Messages */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">{selected.subject}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {selected.organization.name} &middot; {selected.createdBy.name}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Initial description */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.description}</p>
                  <p className="text-[11px] text-gray-400 mt-2">
                    {new Date(selected.createdAt).toLocaleString('tr-TR')}
                  </p>
                </div>

                {selected.messages?.map((msg) => {
                  const isSuperAdmin = msg.user.role === 'SUPERADMIN';
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isSuperAdmin ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-xl px-4 py-2.5 ${
                          isSuperAdmin
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        <p className={`text-[11px] font-medium mb-0.5 ${isSuperAdmin ? 'text-purple-200' : 'text-gray-500'}`}>
                          {msg.user.name}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                        <p className={`text-[10px] mt-1 ${isSuperAdmin ? 'text-purple-200' : 'text-gray-400'}`}>
                          {new Date(msg.createdAt).toLocaleString('tr-TR')}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Send message */}
              <div className="px-4 py-3 border-t border-gray-100">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    placeholder="Yanıt yaz..."
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sending || !newMessage.trim()}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Sidebar Info */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Talep Bilgileri
                </h3>
                <div className="space-y-3">
                  <InfoRow label="Durum">
                    <select
                      value={selected.status}
                      onChange={(e) => handleStatusChange(selected.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      <option value="OPEN">Açık</option>
                      <option value="IN_PROGRESS">İşlemde</option>
                      <option value="RESOLVED">Çözüldü</option>
                      <option value="CLOSED">Kapatıldı</option>
                    </select>
                  </InfoRow>
                  <InfoRow label="Öncelik">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_CONFIG[selected.priority]?.color}`}>
                      {PRIORITY_CONFIG[selected.priority]?.label}
                    </span>
                  </InfoRow>
                  <InfoRow label="Organizasyon">
                    <span className="text-sm text-gray-900">{selected.organization.name}</span>
                  </InfoRow>
                  <InfoRow label="Oluşturan">
                    <span className="text-sm text-gray-900">{selected.createdBy.name}</span>
                  </InfoRow>
                  <InfoRow label="Tarih">
                    <span className="text-sm text-gray-900">
                      {new Date(selected.createdAt).toLocaleString('tr-TR')}
                    </span>
                  </InfoRow>
                  {selected.closedAt && (
                    <InfoRow label="Kapatılma">
                      <span className="text-sm text-gray-900">
                        {new Date(selected.closedAt).toLocaleString('tr-TR')}
                      </span>
                    </InfoRow>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Destek Talepleri</h1>
          <p className="text-gray-500 text-sm mt-1">{tickets.length} talep</p>
        </div>
        <button
          onClick={fetchTickets}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Talep ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="">Tüm Durumlar</option>
          <option value="OPEN">Açık</option>
          <option value="IN_PROGRESS">İşlemde</option>
          <option value="RESOLVED">Çözüldü</option>
          <option value="CLOSED">Kapatıldı</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="">Tüm Öncelikler</option>
          <option value="LOW">Düşük</option>
          <option value="MEDIUM">Orta</option>
          <option value="HIGH">Yüksek</option>
          <option value="CRITICAL">Kritik</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-3 font-medium">Konu</th>
                  <th className="px-6 py-3 font-medium">Organizasyon</th>
                  <th className="px-6 py-3 font-medium">Öncelik</th>
                  <th className="px-6 py-3 font-medium">Durum</th>
                  <th className="px-6 py-3 font-medium text-center">Mesaj</th>
                  <th className="px-6 py-3 font-medium">Tarih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredTickets.map((ticket) => {
                  const sc = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.OPEN;
                  const StatusIcon = sc.icon;
                  const pc = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.MEDIUM;
                  return (
                    <tr
                      key={ticket.id}
                      onClick={() => openDetail(ticket.id)}
                      className="hover:bg-gray-50/60 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-3">
                        <p className="font-medium text-gray-900">{ticket.subject}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[300px]">
                          {ticket.createdBy.name}
                        </p>
                      </td>
                      <td className="px-6 py-3 text-gray-700">{ticket.organization.name}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${pc.color}`}>
                          {pc.label}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-center text-gray-500">
                        {ticket._count?.messages || 0}
                      </td>
                      <td className="px-6 py-3 text-gray-500 text-xs">
                        {new Date(ticket.createdAt).toLocaleDateString('tr-TR')}
                      </td>
                    </tr>
                  );
                })}
                {filteredTickets.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400">
                      Destek talebi bulunamadı
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      {children}
    </div>
  );
}
