'use client';

import { useChatStore } from '@/store/chat';
import { cn, formatDate, truncate, formatPhone } from '@/lib/utils';
import { Search, Inbox } from 'lucide-react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';

/** URL filter → select value (tek seçim) */
function filterToSelectValue(filter: string | undefined, isAgent: boolean): string {
  if (!filter) return isAgent ? 'kutum' : 'all';
  if (filter === 'mine_and_unassigned') return 'kutum';
  return filter;
}

function selectValueToHref(value: string, isAgent: boolean): string {
  if (value === 'kutum') return isAgent ? '/inbox?filter=mine_and_unassigned' : '/inbox';
  if (value === 'all') return '/inbox?filter=all';
  if (value === 'mine' || value === 'unassigned' || value === 'unanswered' || value === 'answered' || value === 'followup') {
    return `/inbox?filter=${value}`;
  }
  return '/inbox';
}

export default function ConversationList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const filter = searchParams.get('filter') || undefined;

  const {
    conversations,
    activeConversation,
    setActiveConversation,
    isLoadingConversations,
    searchQuery,
    setSearchQuery,
    fetchConversations,
  } = useChatStore();

  const [user, setUser] = useState<{ role?: string } | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        /* ignore */
      }
    }
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const handleSearchInput = useCallback(
    (q: string) => {
      setSearchQuery(q);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        searchDebounceRef.current = null;
        fetchConversations(true);
      }, 400);
    },
    [setSearchQuery, fetchConversations],
  );

  const isAgent = user?.role === 'AGENT';
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';

  const selectValue = useMemo(
    () => filterToSelectValue(filter, isAgent),
    [filter, isAgent],
  );

  const filterLabel = useMemo(() => {
    const map: Record<string, string> = {
      kutum: isAgent ? 'Kutum' : 'Tüm sohbetler',
      all: 'Tüm sohbetler',
      mine: 'Bana atanan',
      unassigned: 'Atanmamış',
      unanswered: 'Cevapsızlar',
      answered: 'Cevaplananlar',
      followup: 'Takiptekiler',
      mine_and_unassigned: 'Kutum',
    };
    return map[selectValue] || 'Mesajlar';
  }, [selectValue, isAgent]);

  return (
    <div className="w-96 border-r border-gray-200 bg-white flex flex-col h-full min-w-0">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-gray-900">{filterLabel}</h2>
          <span className="text-[10px] px-2 py-1 rounded-full font-medium bg-gray-100 text-gray-600">
            {conversations.length}
          </span>
        </div>

        <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
          Görüşme filtresi
        </label>
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            router.push(selectValueToHref(v, isAgent));
          }}
          className="w-full mb-2 px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
        >
          {isAgent ? (
            <>
              <optgroup label="Kapsam">
                <option value="kutum">Kutum (atanmamış + bana atanan)</option>
                <option value="all">Tüm sohbetler</option>
                <option value="mine">Sadece bana atanan</option>
                <option value="unassigned">Sadece atanmamış</option>
              </optgroup>
              <optgroup label="Durum">
                <option value="unanswered">Cevapsızlar</option>
                <option value="answered">Cevaplananlar</option>
                <option value="followup">Takiptekiler</option>
              </optgroup>
            </>
          ) : (
            <>
              <optgroup label="Kapsam">
                <option value="all">Tüm sohbetler</option>
                <option value="unassigned">Atanmamış</option>
                <option value="mine">Bana atanan görüşmeler</option>
              </optgroup>
              <optgroup label="Durum">
                <option value="unanswered">Cevapsızlar</option>
                <option value="answered">Cevaplananlar</option>
                <option value="followup">Takiptekiler</option>
              </optgroup>
            </>
          )}
        </select>

        {!isAgent && !isAdmin && (
          <p className="text-[10px] text-amber-600 mb-2">Rol bilgisi yüklenemedi; sayfayı yenileyin.</p>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Kişi veya numara ara..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
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
              Bu filtreye uygun görüşme yok
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
