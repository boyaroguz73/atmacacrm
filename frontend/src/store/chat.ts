import { create } from 'zustand';
import api from '@/lib/api';

/** Gelen kutusu liste boyutu (API `limit`; backend üst sınırı 2000) */
const CONVERSATIONS_LIST_LIMIT = 1000;

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  surname?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  tags: string[];
  source?: string | null;
  company?: string | null;
  city?: string | null;
  notes?: string | null;
  metadata?: unknown;
  organizationId?: string | null;
  lead?: any;
}

interface Assignment {
  id: string;
  user: { id: string; name: string; avatar: string | null };
}

interface Conversation {
  id: string;
  contactId: string;
  sessionId: string;
  lastMessageAt: string;
  lastMessageText: string | null;
  unreadCount: number;
  contact: Contact;
  session: { id: string; name: string; phone: string | null; organizationId?: string | null };
  assignments: Assignment[];
  /** WhatsApp grup sohbeti mi? */
  isGroup?: boolean;
  /** Grup adı */
  groupName?: string | null;
  /** WhatsApp grup JID */
  waGroupId?: string | null;
  /** WAHA grup meta (zayıf başlık düzeltildiğinde) */
  groupParticipantCount?: number;
}

interface Reaction {
  emoji: string;
  sender: string;
  senderName: string;
}

export interface Message {
  id: string;
  conversationId: string;
  waMessageId?: string | null;
  direction: 'INCOMING' | 'OUTGOING';
  body: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  mediaMimeType?: string | null;
  status: string;
  timestamp: string;
  reactions?: Reaction[] | null;
  isEdited?: boolean;
  sentBy: { id: string; name: string } | null;
  /** Grup mesajlarında gönderenin telefon numarası */
  participantPhone?: string | null;
  /** Grup mesajlarında gönderenin adı */
  participantName?: string | null;
}

interface ChatState {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  searchQuery: string;
  sessionFilter: string | null;
  /** Gelen kutusu URL filtresi (senkron / arama sonrası liste için korunur) */
  listFilter: string | undefined;

  setSearchQuery: (q: string) => void;
  setSessionFilter: (id: string | null) => void;
  setListFilter: (filter: string | undefined) => void;
  fetchConversations: (silent?: boolean) => Promise<void>;
  setActiveConversation: (conv: Conversation) => void;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (params: {
    conversationId: string;
    sessionName: string;
    chatId: string;
    body: string;
  }) => Promise<void>;
  sendMediaMessage: (params: {
    conversationId: string;
    sessionName: string;
    chatId: string;
    mediaUrl: string;
    caption?: string;
  }) => Promise<void>;
  /** Ürün görseli + açıklama (sohbetten paylaşım) */
  sendProductShare: (params: {
    conversationId: string;
    productId: string;
    sessionName?: string;
    chatId?: string;
  }) => Promise<void>;
  addMessage: (message: Message) => void;
  updateConversation: (conversation: Conversation) => void;
  updateMessageStatus: (messageId: string, status: string) => void;
  updateMessageReactions: (messageId: string, reactions: Reaction[]) => void;
  updateMessageEdit: (messageId: string, body: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversation: null,
  messages: [],
  isLoadingConversations: false,
  isLoadingMessages: false,
  searchQuery: '',
  sessionFilter: null,
  listFilter: undefined,

  setSearchQuery: (q) => set({ searchQuery: q }),
  setSessionFilter: (id) => set({ sessionFilter: id }),
  setListFilter: (filter) => set({ listFilter: filter }),

  fetchConversations: async (silent?: boolean) => {
    if (!silent) set({ isLoadingConversations: true });
    try {
      const params: Record<string, string | number> = {
        limit: CONVERSATIONS_LIST_LIMIT,
      };
      const { searchQuery, sessionFilter, listFilter } = get();
      if (searchQuery) params.search = searchQuery;
      if (sessionFilter) params.sessionId = sessionFilter;
      if (listFilter) params.filter = listFilter;

      const { data } = await api.get('/conversations', { params });
      // WhatsApp kanallarını filtrele (newsletter ve broadcast)
      // Gruplar (@g.us) ve bireysel sohbetler (@c.us) görünür
      const filtered = (data.conversations || []).filter((c: Conversation) => {
        const phone = c.contact?.phone || '';
        return !phone.includes('@newsletter') && !phone.includes('@broadcast');
      });
      const sorted = [...filtered].sort(
        (a: Conversation, b: Conversation) =>
          new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
      );
      set({ conversations: sorted, isLoadingConversations: false });
    } catch {
      set((state) => ({
        isLoadingConversations: false,
        conversations: silent ? state.conversations : [],
      }));
    }
  },

  setActiveConversation: (conv) => {
    const updated = { ...conv, unreadCount: 0 };
    set((state) => ({
      activeConversation: updated,
      messages: [],
      conversations: state.conversations.map((c) =>
        c.id === conv.id ? { ...c, unreadCount: 0 } : c,
      ),
    }));
    api.patch(`/conversations/${conv.id}/read`).catch(() => {});
  },

  fetchMessages: async (conversationId) => {
    set({ isLoadingMessages: true });
    try {
      const { data: convDetail } = await api
        .get(`/conversations/${conversationId}`)
        .catch(() => ({ data: null }));
      if (convDetail) {
        set((state) => {
          const patchActive =
            state.activeConversation?.id === conversationId
              ? {
                  activeConversation: {
                    ...state.activeConversation,
                    ...convDetail,
                    contact:
                      convDetail.contact ?? state.activeConversation.contact,
                  },
                }
              : {};
          const conversations = state.conversations.map((c) =>
            c.id === conversationId ? { ...c, ...convDetail, contact: convDetail.contact ?? c.contact } : c,
          );
          return { ...patchActive, conversations };
        });
      }
      const { data } = await api.get(`/messages/conversation/${conversationId}`);
      set({ messages: data.messages || [], isLoadingMessages: false });

      api
        .post(`/conversations/${conversationId}/sync`)
        .then(() =>
          Promise.all([
            api.get(`/messages/conversation/${conversationId}`),
            api.get(`/conversations/${conversationId}`),
          ]),
        )
        .then(([msgRes, convRes]) => {
          const freshMsgs = msgRes.data.messages || [];
          const conv = convRes.data;
          set((state) => {
            const patchActive =
              state.activeConversation?.id === conversationId && conv
                ? {
                    activeConversation: {
                      ...state.activeConversation,
                      ...conv,
                      contact: conv.contact ?? state.activeConversation!.contact,
                    },
                  }
                : {};
            const conversations = conv
              ? state.conversations.map((c) =>
                  c.id === conversationId
                    ? { ...c, ...conv, contact: conv.contact ?? c.contact }
                    : c,
                )
              : state.conversations;
            return {
              messages: freshMsgs,
              ...patchActive,
              conversations,
            };
          });
        })
        .catch(() => {});
    } catch {
      set({ isLoadingMessages: false });
    }
  },

  sendMessage: async (params) => {
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      conversationId: params.conversationId,
      direction: 'OUTGOING',
      body: params.body,
      mediaType: null,
      mediaUrl: null,
      status: 'PENDING',
      timestamp: new Date().toISOString(),
      sentBy: null,
    };
    set((state) => ({ messages: [...state.messages, optimisticMsg] }));

    try {
      const { data } = await api.post('/messages/send', params);
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === tempId ? { ...data } : m,
        ),
      }));

      const preview = (data.body as string | null) ?? '';
      const ts = (data.timestamp as string) || new Date().toISOString();
      set((state) => {
        const idx = state.conversations.findIndex((c) => c.id === params.conversationId);
        if (idx < 0) return {};
        const prevConv = state.conversations[idx];
        const bumped: Conversation = {
          ...prevConv,
          lastMessageAt: ts,
          lastMessageText: preview || prevConv.lastMessageText,
        };
        const others = state.conversations.filter((c) => c.id !== params.conversationId);
        const conversations = [...others, bumped].sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        );
        let activeConversation = state.activeConversation;
        if (activeConversation?.id === bumped.id) {
          activeConversation = {
            ...activeConversation,
            lastMessageAt: bumped.lastMessageAt,
            lastMessageText: bumped.lastMessageText,
          };
        }
        return { conversations, activeConversation };
      });
    } catch (error) {
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempId),
      }));
      throw error;
    }
  },

  sendMediaMessage: async (params) => {
    const tempId = `temp-media-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      conversationId: params.conversationId,
      direction: 'OUTGOING',
      body: params.caption || null,
      mediaType: 'IMAGE',
      mediaUrl: params.mediaUrl,
      status: 'PENDING',
      timestamp: new Date().toISOString(),
      sentBy: null,
    };
    set((state) => ({ messages: [...state.messages, optimisticMsg] }));

    try {
      const { data } = await api.post('/messages/send-media', params);
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === tempId ? { ...data } : m,
        ),
      }));

      const preview =
        (data.body as string | null) ||
        (data.mediaType === 'IMAGE' ? '📷 Görsel' : '📎 Medya');
      const ts = (data.timestamp as string) || new Date().toISOString();
      set((state) => {
        const idx = state.conversations.findIndex((c) => c.id === params.conversationId);
        if (idx < 0) return {};
        const prevConv = state.conversations[idx];
        const bumped: Conversation = {
          ...prevConv,
          lastMessageAt: ts,
          lastMessageText: preview || prevConv.lastMessageText,
        };
        const others = state.conversations.filter((c) => c.id !== params.conversationId);
        const conversations = [...others, bumped].sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        );
        let activeConversation = state.activeConversation;
        if (activeConversation?.id === bumped.id) {
          activeConversation = {
            ...activeConversation,
            lastMessageAt: bumped.lastMessageAt,
            lastMessageText: bumped.lastMessageText,
          };
        }
        return { conversations, activeConversation };
      });
    } catch (error) {
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempId),
      }));
      throw error;
    }
  },

  sendProductShare: async (params) => {
    const tempId = `temp-product-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      conversationId: params.conversationId,
      direction: 'OUTGOING',
      body: 'Ürün gönderiliyor…',
      mediaType: 'IMAGE',
      mediaUrl: null,
      status: 'PENDING',
      timestamp: new Date().toISOString(),
      sentBy: null,
    };
    set((state) => ({ messages: [...state.messages, optimisticMsg] }));

    try {
      const { data } = await api.post('/messages/send-product', params);
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === tempId ? { ...data } : m,
        ),
      }));

      const preview = (data.body as string | null) || '📷 Ürün';
      const ts = (data.timestamp as string) || new Date().toISOString();
      set((state) => {
        const idx = state.conversations.findIndex((c) => c.id === params.conversationId);
        if (idx < 0) return {};
        const prevConv = state.conversations[idx];
        const bumped: Conversation = {
          ...prevConv,
          lastMessageAt: ts,
          lastMessageText: preview || prevConv.lastMessageText,
        };
        const others = state.conversations.filter((c) => c.id !== params.conversationId);
        const conversations = [...others, bumped].sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        );
        let activeConversation = state.activeConversation;
        if (activeConversation?.id === bumped.id) {
          activeConversation = {
            ...activeConversation,
            lastMessageAt: bumped.lastMessageAt,
            lastMessageText: bumped.lastMessageText,
          };
        }
        return { conversations, activeConversation };
      });
    } catch (error) {
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempId),
      }));
      throw error;
    }
  },

  addMessage: (message) => {
    const { activeConversation } = get();
    if (activeConversation?.id === message.conversationId) {
      set((state) => {
        // 1. waMessageId bazlı duplicate kontrolü (en güvenilir)
        if (message.waMessageId) {
          const waIdx = state.messages.findIndex(
            (m) => m.waMessageId && m.waMessageId === message.waMessageId
          );
          if (waIdx >= 0) {
            const updated = [...state.messages];
            updated[waIdx] = message;
            return { messages: updated };
          }
        }
        
        // 2. Aynı DB ID'li mesaj varsa güncelle
        const existingIdx = state.messages.findIndex((m) => m.id === message.id);
        if (existingIdx >= 0) {
          const updated = [...state.messages];
          updated[existingIdx] = message;
          return { messages: updated };
        }
        
        // 3. Temp mesaj ara (optimistic update için)
        const tempIdx = state.messages.findIndex(
          (m) =>
            m.id.startsWith('temp-') &&
            m.direction === message.direction &&
            m.status === 'PENDING' &&
            (m.body === message.body ||
              (m.mediaUrl && message.mediaUrl) ||
              (m.body?.includes('Ürün gönderiliyor') && message.mediaType === 'IMAGE')),
        );
        if (tempIdx >= 0) {
          const updated = [...state.messages];
          updated[tempIdx] = message;
          return { messages: updated };
        }
        
        // 4. waMessageId ile temp eşleştir (optimistic -> real)
        if (message.waMessageId && message.direction === 'OUTGOING') {
          const pendingIdx = state.messages.findIndex(
            (m) =>
              m.id.startsWith('temp-') &&
              m.direction === 'OUTGOING' &&
              m.status === 'PENDING' &&
              Math.abs(new Date(m.timestamp).getTime() - new Date(message.timestamp).getTime()) < 30000
          );
          if (pendingIdx >= 0) {
            const updated = [...state.messages];
            updated[pendingIdx] = message;
            return { messages: updated };
          }
        }
        
        // 5. Aynı içerikli ve yakın zamanlı giden mesaj varsa (socket duplicate) atla
        const recentDuplicate = state.messages.some((m) => {
          if (m.direction !== message.direction) return false;
          if (m.id.startsWith('temp-')) return false;
          const timeDiff = Math.abs(
            new Date(m.timestamp).getTime() - new Date(message.timestamp).getTime()
          );
          if (timeDiff > 5000) return false;
          return m.body === message.body && m.mediaUrl === message.mediaUrl;
        });
        if (recentDuplicate) return state;
        
        return { messages: [...state.messages, message] };
      });
    }
  },

  updateConversation: (conversation) => {
    set((state) => {
      // WhatsApp kanallarını filtrele (newsletter ve broadcast)
      const phone = conversation.contact?.phone || '';
      if (phone.includes('@newsletter') || phone.includes('@broadcast')) {
        return state;
      }

      const index = state.conversations.findIndex(
        (c) => c.id === conversation.id,
      );
      const conversations = [...state.conversations];
      if (index >= 0) {
        conversations[index] = conversation;
      } else {
        conversations.unshift(conversation);
      }
      conversations.sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime(),
      );

      let activeConversation = state.activeConversation;
      if (activeConversation?.id === conversation.id) {
        activeConversation = {
          ...conversation,
          unreadCount: 0,
          contact: conversation.contact ?? activeConversation.contact,
        };
      }

      return { conversations, activeConversation };
    });
  },

  updateMessageStatus: (messageId, status) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, status } : m,
      ),
    }));
  },

  updateMessageReactions: (messageId, reactions) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, reactions } : m,
      ),
    }));
  },

  updateMessageEdit: (messageId, body) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, body, isEdited: true } : m,
      ),
    }));
  },
}));
