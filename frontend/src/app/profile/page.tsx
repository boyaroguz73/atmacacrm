'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import {
  Mail,
  Shield,
  MessageSquare,
  Target,
  BarChart3,
  CheckCircle2,
  Edit3,
  Save,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface AgentStats {
  totalMessages: number;
  messagesToday: number;
  activeAssignments: number;
  totalAssignments: number;
}

interface RecentConversation {
  id: string;
  lastMessageText: string | null;
  lastMessageAt: string;
  unreadCount: number;
  contact: { name: string | null; phone: string };
  session: { name: string };
}

const roleLabels: Record<string, string> = {
  SUPERADMIN: 'Yönetici',
  ADMIN: 'Yönetici',
  AGENT: 'Temsilci',
};

const roleColors: Record<string, string> = {
  SUPERADMIN: 'bg-blue-100 text-blue-700',
  ADMIN: 'bg-blue-100 text-blue-700',
  AGENT: 'bg-green-100 text-green-700',
};

export default function ProfilePage() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [conversations, setConversations] = useState<RecentConversation[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setName(user.name);

    const fetchData = async () => {
      try {
        const [perfRes, convsRes] = await Promise.all([
          api.get('/dashboard/agent-performance'),
          api.get('/conversations', {
            params: { assignedTo: user.id, limit: 5 },
          }),
        ]);

        const myStats = perfRes.data.find(
          (a: any) => a.id === user.id,
        );
        if (myStats) {
          setStats(myStats);
        }

        setConversations(convsRes.data.conversations || []);
      } catch (error) {
        console.error(error);
        toast.error('Veriler yüklenemedi');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  const handleSave = async () => {
    if (!user || !name.trim()) return;
    try {
      await api.patch(`/users/${user.id}`, { name: name.trim() });
      toast.success('Profil güncellendi');
      setEditing(false);
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        parsed.name = name.trim();
        localStorage.setItem('user', JSON.stringify(parsed));
      }
    } catch {
      toast.error('Güncellenemedi');
    }
  };

  if (!user || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-whatsapp border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profilim</h1>
        <p className="text-gray-500 text-sm mt-1">
          Hesap bilgileri ve performans istatistikleri
        </p>
      </div>

      {/* Profile Card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-whatsapp to-emerald-400" />
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4 -mt-10">
            <div className="w-20 h-20 bg-white rounded-2xl border-4 border-white shadow-lg flex items-center justify-center">
              <span className="text-3xl font-bold text-whatsapp">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 pb-1">
              <div className="flex items-center gap-2">
                {editing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="text-xl font-bold text-gray-900 border-b-2 border-whatsapp focus:outline-none bg-transparent"
                    />
                    <button
                      onClick={handleSave}
                      className="p-1 text-whatsapp hover:text-green-700"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl font-bold text-gray-900">
                      {user.name}
                    </h2>
                    <button
                      onClick={() => setEditing(true)}
                      className="p-1 text-gray-400 hover:text-gray-600"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Mail className="w-3.5 h-3.5" />
                  {user.email}
                </span>
                <span
                  className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                    roleColors[user.role] || 'bg-gray-100 text-gray-600'
                  }`}
                >
                  <Shield className="w-3 h-3 inline mr-1" />
                  {roleLabels[user.role] || user.role}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {stats?.messagesToday ?? 0}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Bugün gönderilen mesaj
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-green-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {stats?.totalMessages ?? 0}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Toplam mesaj</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center">
              <Target className="w-4 h-4 text-orange-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {stats?.activeAssignments ?? 0}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Aktif görüşme
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-purple-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {stats?.totalAssignments ?? 0}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Toplam atama
          </p>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Bana Atanan Son Görüşmeler
        </h3>
        {conversations.length === 0 ? (
          <p className="text-gray-400 text-sm py-4 text-center">
            Henüz atanmış görüşme yok
          </p>
        ) : (
          <div className="space-y-2">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-whatsapp/10 rounded-full flex items-center justify-center">
                    <span className="text-whatsapp font-bold text-sm">
                      {(
                        conv.contact.name ||
                        conv.contact.phone
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-gray-900">
                      {conv.contact.name || conv.contact.phone}
                    </p>
                    <p className="text-xs text-gray-400 truncate max-w-xs">
                      {conv.lastMessageText || 'Mesaj yok'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                    {conv.session.name}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="bg-whatsapp text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
