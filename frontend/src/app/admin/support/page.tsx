'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  HeadphonesIcon,
  Plus,
  X,
  Send,
  ArrowLeft,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
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

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [createForm, setCreateForm] = useState({
    subject: '',
    description: '',
    priority: 'MEDIUM',
    category: '',
  });

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/support/tickets');
      setTickets(res.data);
    } catch {
      toast.error('Talepler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleCreate = async () => {
    if (!createForm.subject.trim() || !createForm.description.trim()) {
      toast.error('Konu ve açıklama zorunludur');
      return;
    }
    setCreating(true);
    try {
      await api.post('/support/tickets', createForm);
      toast.success('Destek talebi oluşturuldu');
      setShowCreate(false);
      setCreateForm({ subject: '', description: '', priority: 'MEDIUM', category: '' });
      fetchTickets();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Hata oluştu');
    } finally {
      setCreating(false);
    }
  };

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

  // Detail view
  if (selected) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Taleplerime Dön
        </button>

        {detailLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
            <div className="px-6 py-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">{selected.subject}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    {(() => {
                      const sc = STATUS_CONFIG[selected.status] || STATUS_CONFIG.OPEN;
                      const StatusIcon = sc.icon;
                      return (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {sc.label}
                        </span>
                      );
                    })()}
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_CONFIG[selected.priority]?.color}`}>
                      {PRIORITY_CONFIG[selected.priority]?.label}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  {new Date(selected.createdAt).toLocaleString('tr-TR')}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.description}</p>
              </div>

              {selected.messages?.map((msg) => {
                const isSupport = msg.user.role === 'SUPERADMIN';
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isSupport ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-xl px-4 py-2.5 ${
                        isSupport
                          ? 'bg-blue-50 text-blue-900'
                          : 'bg-green-500 text-white'
                      }`}
                    >
                      <p className={`text-[11px] font-medium mb-0.5 ${isSupport ? 'text-blue-500' : 'text-green-200'}`}>
                        {isSupport ? 'Destek Ekibi' : msg.user.name}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                      <p className={`text-[10px] mt-1 ${isSupport ? 'text-blue-400' : 'text-green-200'}`}>
                        {new Date(msg.createdAt).toLocaleString('tr-TR')}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {selected.status !== 'CLOSED' && (
              <div className="px-4 py-3 border-t border-gray-100">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    placeholder="Mesaj yaz..."
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sending || !newMessage.trim()}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Destek</h1>
          <p className="text-gray-500 text-sm mt-1">
            Destek taleplerinizi görüntüleyin ve yeni talep oluşturun
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchTickets}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700"
          >
            <Plus className="w-4 h-4" />
            Yeni Talep
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <HeadphonesIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-700 mb-1">Henüz destek talebiniz yok</h3>
          <p className="text-sm text-gray-400 mb-4">
            Bir sorun yaşıyorsanız yeni bir destek talebi oluşturabilirsiniz.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700"
          >
            Talep Oluştur
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const sc = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.OPEN;
            const StatusIcon = sc.icon;
            const pc = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.MEDIUM;
            return (
              <div
                key={ticket.id}
                onClick={() => openDetail(ticket.id)}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:border-green-200 cursor-pointer transition"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{ticket.subject}</h3>
                    <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{ticket.description}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {sc.label}
                    </span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${pc.color}`}>
                      {pc.label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                  <span>{new Date(ticket.createdAt).toLocaleString('tr-TR')}</span>
                  <span>{ticket._count?.messages || 0} mesaj</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Ticket Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Yeni Destek Talebi</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Konu</label>
                <input
                  type="text"
                  value={createForm.subject}
                  onChange={(e) => setCreateForm((p) => ({ ...p, subject: e.target.value }))}
                  placeholder="Sorununuzu kısaca özetleyin"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Açıklama</label>
                <textarea
                  rows={4}
                  value={createForm.description}
                  onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Sorununuzu detaylı açıklayın..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Öncelik</label>
                  <select
                    value={createForm.priority}
                    onChange={(e) => setCreateForm((p) => ({ ...p, priority: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="LOW">Düşük</option>
                    <option value="MEDIUM">Orta</option>
                    <option value="HIGH">Yüksek</option>
                    <option value="CRITICAL">Kritik</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Kategori</label>
                  <input
                    type="text"
                    value={createForm.category}
                    onChange={(e) => setCreateForm((p) => ({ ...p, category: e.target.value }))}
                    placeholder="Teknik, Fatura, vb."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                İptal
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {creating ? 'Gönderiliyor...' : 'Talep Oluştur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
