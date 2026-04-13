'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import { Search, MessageSquare, User, Clock, ChevronRight } from 'lucide-react';
import DateRangePicker from '@/components/ui/DateRangePicker';

interface ConversationHistory {
  id: string;
  lastMessageAt: string;
  lastMessageText: string | null;
  unreadCount: number;
  isClosed: boolean;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    surname: string | null;
  };
  session: { id: string; name: string };
  assignments: { user: { id: string; name: string } }[];
  _count?: { messages: number };
  messageCount?: number;
}

export default function ConversationHistoryPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.role === 'AGENT') {
          router.replace('/inbox');
          return;
        }
      }
    } catch {}
  }, [router]);

  const fetchData = async (q?: string) => {
    setLoading(true);
    try {
      const params: any = { limit: '100' };
      if (q) params.search = q;
      if (dateFrom) params.from = dateFrom + 'T00:00:00';
      if (dateTo) params.to = dateTo + 'T23:59:59';
      const { data } = await api.get('/conversations/history', { params });
      setConversations(data.conversations || []);
      setTotal(data.total || 0);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const timer = setTimeout(() => fetchData(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Konuşma Geçmişi</h1>
          <p className="text-gray-500 text-sm mt-1">
            Tüm konuşmalar ({total})
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

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="İsim, telefon ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">
                Kişi
              </th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">
                Oturum
              </th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">
                Atanan Temsilci
              </th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">
                Son Mesaj
              </th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">
                Mesaj Sayısı
              </th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">
                Tarih
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">
                  <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : conversations.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="text-center py-12 text-gray-400 text-sm"
                >
                  Konuşma bulunamadı
                </td>
              </tr>
            ) : (
              conversations.map((conv) => (
                <tr
                  key={conv.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/inbox`)}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-whatsapp/10 rounded-full flex items-center justify-center">
                        <span className="text-whatsapp font-bold text-sm">
                          {(conv.contact.name || conv.contact.phone)
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-sm text-gray-900">
                          {[conv.contact.name, conv.contact.surname]
                            .filter(Boolean)
                            .join(' ') || formatPhone(conv.contact.phone)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatPhone(conv.contact.phone)}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {conv.session.name}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {conv.assignments?.[0] ? (
                      <span className="flex items-center gap-1 text-xs text-blue-600">
                        <User className="w-3 h-3" />
                        {conv.assignments[0].user.name}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">Atanmamış</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-xs text-gray-600 truncate max-w-[200px]">
                      {conv.lastMessageText || '—'}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <MessageSquare className="w-3 h-3" />
                      {conv.messageCount ?? '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(conv.lastMessageAt).toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
