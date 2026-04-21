'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useChatStore } from '@/store/chat';
import { connectSocket, getSocket } from '@/lib/socket';
import ConversationList from '@/components/chat/ConversationList';
import ChatWindow from '@/components/chat/ChatWindow';

export default function InboxPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = searchParams.get('filter') || undefined;
  const contactId = searchParams.get('contactId') || undefined;
  const [mobileShowChat, setMobileShowChat] = useState(false);

  // Temsilci (AGENT) varsayılan filtresi: sadece kendine atananlar
  useEffect(() => {
    if (filter !== undefined) return;
    if (pathname !== '/inbox') return;
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u?.role === 'AGENT') {
          router.replace('/inbox?filter=mine');
        }
      }
    } catch {
      /* ignore */
    }
  // Yalnızca ilk render'da çalışsın
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    activeConversation,
    conversations,
    isLoadingConversations,
    fetchConversations,
    setListFilter,
    setActiveConversation,
    addMessage,
    updateConversation,
    updateMessageStatus,
    updateMessageReactions,
    updateMessageEdit,
    updateMessageDeleted,
  } = useChatStore();

  const inboxLoadedOnce = useRef(false);
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    if (!activeConversation && conversations.length > 0 && !isLoadingConversations && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
      setActiveConversation(conversations[0]);
    }
  }, [conversations, activeConversation, isLoadingConversations, setActiveConversation]);

  useEffect(() => {
    if (!contactId) return;
    if (!conversations.length) return;
    const found = conversations.find((c) => c.contactId === contactId);
    if (found) setActiveConversation(found);
  }, [contactId, conversations, setActiveConversation]);

  /** lg (1024px) altında: sohbet seçilince tam ekran chat. Üstünde: sol liste asla kaybolmaz (md=768 çok dar kalıyordu). */
  useEffect(() => {
    if (!activeConversation) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setMobileShowChat(true);
    } else {
      setMobileShowChat(false);
    }
  }, [activeConversation]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncLayoutMode = () => {
      if (window.matchMedia('(min-width: 1024px)').matches) {
        setMobileShowChat(false);
      }
    };
    syncLayoutMode();
    window.addEventListener('resize', syncLayoutMode);
    const mq = window.matchMedia('(min-width: 1024px)');
    mq.addEventListener('change', syncLayoutMode);
    return () => {
      window.removeEventListener('resize', syncLayoutMode);
      mq.removeEventListener('change', syncLayoutMode);
    };
  }, []);

  useEffect(() => {
    setListFilter(filter);
    const silent = inboxLoadedOnce.current;
    inboxLoadedOnce.current = true;
    autoSelectedRef.current = false;
    fetchConversations(silent);

    const socket = connectSocket();
    socket.emit('join:inbox');

    socket.on('conversation:updated', (conversation: any) => {
      updateConversation(conversation);
    });

    socket.on('message:new', (data: any) => {
      addMessage(data.message);
      updateConversation(data.conversation);
    });

    socket.on('message:status', (data: any) => {
      updateMessageStatus(data.messageId, data.status, data.waMessageId);
    });

    socket.on('message:reaction', (data: any) => {
      updateMessageReactions(data.messageId, data.reactions);
    });

    socket.on('message:edited', (data: any) => {
      updateMessageEdit(data.messageId, data.body);
    });
    socket.on('message:deleted', (data: any) => {
      if (data?.messageId) updateMessageDeleted(data.messageId);
    });

    return () => {
      socket.off('conversation:updated');
      socket.off('message:new');
      socket.off('message:status');
      socket.off('message:reaction');
      socket.off('message:edited');
      socket.off('message:deleted');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, updateMessageDeleted]);

  return (
    <div className="flex h-full min-h-0">
      {/* Conversation List — lg+ her zaman görünür; küçük ekranda chat odaklıyken gizlenir */}
      <div className={`${mobileShowChat ? 'hidden lg:flex' : 'flex'} lg:flex min-h-0`}>
        <ConversationList />
      </div>

      {activeConversation ? (
        /* Sohbet: tablet (md+) her zaman görünsün; yalnızca dar mobilde liste açıkken gizlenir */
        <div
          className={`flex flex-1 min-h-0 min-w-0 flex-col ${mobileShowChat ? '' : 'hidden md:flex'}`}
        >
          <ChatWindow onMobileBack={() => setMobileShowChat(false)} />
        </div>
      ) : (
        <div className="hidden md:flex flex-1 min-h-0 items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-12 h-12 text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-500">
              Bir görüşme seçin
            </h3>
            <p className="text-sm text-gray-400 mt-1">
              Sol panelden bir görüşme seçerek mesajlaşmaya başlayın
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
