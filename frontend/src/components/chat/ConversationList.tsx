'use client';

import Link from 'next/link';
import { useChatStore } from '@/store/chat';
import { cn, formatDate, truncate, formatPhone } from '@/lib/utils';
import { Search, Inbox, User, Clock, MessageCircleReply, CalendarCheck, UserX } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';

const FILTER_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  unanswered: { label: 'Cevapsızlar', icon: Clock, color: 'bg-red-50 text-red-600' },
  answered: { label: 'Cevaplananlar', icon: MessageCircleReply, color: 'bg-green-50 text-green-600' },
  followup: { label: 'Takiptekiler', icon: CalendarCheck, color: 'bg-yellow-50 text-yellow-700' },
  unassigned: { label: 'Atanmamış', icon: UserX, color: 'bg-orange-50 text-orange-600' },
  mine: { label: 'Bana atananlar', icon: User, color: 'bg-blue-50 text-blue-600' },
};

export default function ConversationList() {
  const searchParams = useSearchParams();
  const filter = searchParams.get('filter') || undefined;
  const filterInfo = filter ? FILTER_LABELS[filter] : null;

  const {
    conversations,
    activeConversation,
    setActiveConversation,
    isLoadingConversations,
    searchQuery,
    setSearchQuery,
    fetchConversations,
  } = useChatStore();

  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    fetchConversations(filter);
  };

  const isAgent = user?.role === 'AGENT';
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';

  const chipClass = (active: boolean) =>
    cn(
      'text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors text-center',
      active
        ? 'bg-whatsapp text-white border-whatsapp shadow-sm'
        : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100 hover:border-gray-200',
    );

  return (
    <div className="w-96 border-r border-gray-200 bg-white flex flex-col h-full min-w-0">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-gray-900">
            {filterInfo ? filterInfo.label : 'Mesajlar'}
          </h2>
          <div className="flex items-center gap-1.5">
            {filterInfo && (
              <span className={`text-[10px] px-2 py-1 rounded-full font-medium flex items-center gap-1 shrink-0 ${filterInfo.color}`}>
                <filterInfo.icon className="w-3 h-3" />
                {conversations.length}
              </span>
            )}
          </div>
        </div>

        {isAgent && (
          <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Görüşme filtresi">
            <Link
              href="/inbox"
              className={chipClass(!filter)}
              role="tab"
              aria-selected={!filter}
            >
              Kutum
            </Link>
            <Link
              href="/inbox?filter=mine"
              className={chipClass(filter === 'mine')}
              role="tab"
              aria-selected={filter === 'mine'}
            >
              Bana atanan
            </Link>
            <Link
              href="/inbox?filter=unassigned"
              className={chipClass(filter === 'unassigned')}
              role="tab"
              aria-selected={filter === 'unassigned'}
            >
              Atanmamış
            </Link>
          </div>
        )}

        {isAdmin && (
          <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Görüşme filtresi">
            <Link
              href="/inbox"
              className={chipClass(!filter)}
              role="tab"
              aria-selected={!filter}
            >
              Tümü
            </Link>
            <Link
              href="/inbox?filter=unassigned"
              className={chipClass(filter === 'unassigned')}
              role="tab"
              aria-selected={filter === 'unassigned'}
            >
              Atanmamış
            </Link>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Kişi veya numara ara..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoadingConversations ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Inbox className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">
              {isAgent
                ? 'Bu listede görüşme yok (atanmamış veya size atanan)'
                : 'Henüz görüşme yok'}
            </p>
          </div>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveConversation(conv)}
              className={cn(
                'w-full flex items-start gap-3 p-4 border-b border-gray-50 hover:bg-gray-50 transition-colors text-left',
                activeConversation?.id === conv.id &&
                  'bg-whatsapp/5 border-l-2 border-l-whatsapp',
              )}
            >
              <ContactAvatar
                name={conv.contact.name}
                surname={conv.contact.surname}
                phone={conv.contact.phone}
                avatarUrl={conv.contact.avatarUrl}
                size="md"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-sm text-gray-900 truncate flex items-center gap-1.5 min-w-0">
                    <span className="truncate">
                      {[conv.contact.name, conv.contact.surname].filter(Boolean).join(' ') || formatPhone(conv.contact.phone)}
                    </span>
                    <EcommerceCustomerBadge metadata={conv.contact.metadata} />
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                    {formatDate(conv.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-gray-500 truncate">
                    {conv.lastMessageText
                      ? truncate(conv.lastMessageText, 45)
                      : 'Mesaj yok'}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="bg-whatsapp text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 ml-2 font-bold">
                      {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                    {/^default$/i.test(String(conv.session.name ?? ''))
                      ? 'Varsayılan'
                      : conv.session.name}
                  </span>
                  {conv.assignments?.[0] && (
                    <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                      {conv.assignments[0].user.name}
                    </span>
                  )}
                  {(conv.contact as any)?.source && (
                    <span className="text-[10px] bg-purple-50 text-purple-500 px-1.5 py-0.5 rounded">
                      {(conv.contact as any).source}
                    </span>
                  )}
                  {(conv.contact as any)?.lead && (
                    <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded">
                      Potansiyel Müşteri
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
