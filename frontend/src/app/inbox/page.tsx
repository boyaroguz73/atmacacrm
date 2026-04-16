'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useChatStore } from '@/store/chat';
import { connectSocket, getSocket } from '@/lib/socket';
import ConversationList from '@/components/chat/ConversationList';
import ChatWindow from '@/components/chat/ChatWindow';

export default function InboxPage() {
  const searchParams = useSearchParams();
  const filter = searchParams.get('filter') || undefined;
  const [mobileShowChat, setMobileShowChat] = useState(false);

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
    if (activeConversation) {
      setMobileShowChat(true);
    }
  }, [activeConversation]);

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
      updateMessageStatus(data.messageId, data.status);
    });

    socket.on('message:reaction', (data: any) => {
      updateMessageReactions(data.messageId, data.reactions);
    });

    socket.on('message:edited', (data: any) => {
      updateMessageEdit(data.messageId, data.body);
    });

    return () => {
      socket.off('conversation:updated');
      socket.off('message:new');
      socket.off('message:status');
      socket.off('message:reaction');
      socket.off('message:edited');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="flex h-full">
      {/* Conversation List - mobilde chat açıksa gizle */}
      <div className={`${mobileShowChat ? 'hidden md:flex' : 'flex'} md:flex`}>
        <ConversationList />
      </div>
      
      {/* Chat Window - mobilde liste açıksa gizle */}
      {activeConversation ? (
        <div className={`${mobileShowChat ? 'flex' : 'hidden md:flex'} flex-1`}>
          <ChatWindow onMobileBack={() => setMobileShowChat(false)} />
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center bg-gray-50">
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
