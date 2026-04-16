'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '@/store/chat';
import { getSocket } from '@/lib/socket';
import {
  cn,
  formatTime,
  formatPhone,
  phoneToWhatsappChatId,
  backendPublicUrl,
  rewriteMediaUrlForClient,
} from '@/lib/utils';
import {
  Send,
  Paperclip,
  Check,
  CheckCheck,
  Image as ImageIcon,
  User,
  PanelRightOpen,
  PanelRightClose,
  X,
  FileText,
  Loader2,
  BookTemplate,
  Pencil,
  ListFilter,
  ListTodo,
  Package,
  Search,
  Plus,
  Reply,
  Trash2,
  Smile,
  MapPin,
  FileUp,
} from 'lucide-react';
import ContactPanel from './ContactPanel';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';
import type { Message } from '@/store/chat';

function filterMessagesByAuthor(
  msgs: Message[],
  filter: 'all' | 'me' | string,
  myUserId: string | null,
): Message[] {
  if (filter === 'all') return msgs;
  const targetId = filter === 'me' ? myUserId : filter;
  if (!targetId) return msgs;
  return msgs.filter((m) => {
    if (m.direction === 'INCOMING') return true;
    if (m.direction === 'OUTGOING') {
      if (!m.sentBy?.id) return false;
      return m.sentBy.id === targetId;
    }
    return true;
  });
}

function groupReactions(reactions: { emoji: string; senderName?: string }[]) {
  const map = new Map<string, string[]>();
  for (const r of reactions) {
    if (!r.emoji) continue;
    const list = map.get(r.emoji) || [];
    list.push(r.senderName || '');
    map.set(r.emoji, list);
  }
  return Array.from(map.entries()).map(([emoji, senders]) => ({
    emoji,
    count: senders.length,
    names: senders.filter(Boolean).join(', '),
  }));
}

export default function ChatWindow() {
  const {
    activeConversation,
    messages,
    isLoadingMessages,
    fetchMessages,
    sendMessage,
    sendMediaMessage,
    sendProductShare,
  } = useChatStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [internalChatEnabled, setInternalChatEnabled] = useState(false);
  const [userRole, setUserRole] = useState('AGENT');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messageAuthorFilter, setMessageAuthorFilter] = useState<'all' | string>('all');
  const [inboxPeers, setInboxPeers] = useState<{ id: string; name: string; email: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevConversationId = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const [templates, setTemplates] = useState<{ id: string; title: string; body: string; shortcut: string | null; category: string | null }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  const [editingMessage, setEditingMessage] = useState<{ id: string; body: string } | null>(null);
  const [editText, setEditText] = useState('');

  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productHits, setProductHits] = useState<
    {
      id: string;
      name: string;
      sku: string;
      imageUrl?: string | null;
      unitPrice: number;
      currency: string;
      category?: string | null;
    }[]
  >([]);
  const [productCategoryFilter, setProductCategoryFilter] = useState('');
  const [productCategories, setProductCategories] = useState<{ category: string; count: number }[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);

  const [actionTrayOpen, setActionTrayOpen] = useState(false);
  const actionTrayRef = useRef<HTMLDivElement>(null);

  const [contextMenuMsg, setContextMenuMsg] = useState<{ id: string; body: string | null; x: number; y: number } | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; body: string | null } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    api
      .get('/templates?active=true')
      .then(({ data }) => setTemplates(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!productPickerOpen) return;
    const q = productSearch.trim();
    const t = setTimeout(() => {
      setProductSearchLoading(true);
      api
        .get('/products', {
          params: {
            search: q || undefined,
            category: productCategoryFilter || undefined,
            isActive: true,
            limit: 24,
            page: 1,
          },
        })
        .then(({ data }) => setProductHits(data.products || []))
        .catch(() => setProductHits([]))
        .finally(() => setProductSearchLoading(false));
    }, 280);
    return () => clearTimeout(t);
  }, [productSearch, productPickerOpen, productCategoryFilter]);

  useEffect(() => {
    if (!productPickerOpen) return;
    api
      .get('/products/categories-summary')
      .then(({ data }) => setProductCategories(Array.isArray(data) ? data : []))
      .catch(() => setProductCategories([]));
  }, [productPickerOpen]);

  useEffect(() => {
    api
      .get('/system-settings')
      .then(({ data }) => {
        const ic = data.find((s: any) => s.key === 'internal_chat_enabled');
        setInternalChatEnabled(ic?.value === 'true');
      })
      .catch(() => {});

    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.role) setUserRole(u.role);
        if (u.id) setCurrentUserId(String(u.id));
      }
    } catch {}
  }, []);

  useEffect(() => {
    setMessageAuthorFilter('all');
    setText('');
    setShowTemplates(false);
    setTemplateSearch('');
    setProductPickerOpen(false);
    setProductSearch('');
    setProductHits([]);
    setProductCategoryFilter('');
    setActionTrayOpen(false);
    setReplyingTo(null);
    setContextMenuMsg(null);
    setEmojiPickerOpen(null);
  }, [activeConversation?.id]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionTrayRef.current && !actionTrayRef.current.contains(e.target as Node)) {
        setActionTrayOpen(false);
      }
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(null);
      }
      if (contextMenuMsg) {
        setContextMenuMsg(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenuMsg]);

  useEffect(() => {
    if (!activeConversation) return;
    let cancelled = false;
    api
      .get('/users/inbox-peers')
      .then(({ data }) => {
        if (!cancelled) setInboxPeers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setInboxPeers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversation?.id]);

  const activeConvId = activeConversation?.id;
  useEffect(() => {
    if (!activeConvId) return;

    if (prevConversationId.current && prevConversationId.current !== activeConvId) {
      const socket = getSocket();
      socket.emit('leave:conversation', prevConversationId.current);
    }

    fetchMessages(activeConvId);
    const socket = getSocket();
    socket.emit('join:conversation', activeConvId);
    prevConversationId.current = activeConvId;

    return () => {
      if (prevConversationId.current) {
        socket.emit('leave:conversation', prevConversationId.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const displayMessages = useMemo(
    () => filterMessagesByAuthor(messages, messageAuthorFilter, currentUserId),
    [messages, messageAuthorFilter, currentUserId],
  );

  if (!activeConversation) return null;

  const contact = activeConversation.contact;
  if (!contact?.phone) return null;

  const chatId =
    phoneToWhatsappChatId(contact.phone) ||
    `${String(contact.phone).replace(/\D/g, '')}@c.us`;

  // Mesaj formatı: ilk harf büyük, kdv -> KDV
  const formatMessage = (msg: string) => {
    let formatted = msg.trim();
    if (formatted.length > 0) {
      formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    }
    formatted = formatted.replace(/\bkdv\b/gi, 'KDV');
    return formatted;
  };

  // URL'leri tıklanabilir linklere dönüştür
  const renderMessageBody = (body: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = body.split(urlRegex);
    return parts.map((part, i) =>
      urlRegex.test(part) ? (
        <a 
          key={i} 
          href={part} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline break-all"
        >
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  const submitComposer = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const formattedMessage = formatMessage(trimmed);

    setText('');
    if (composerRef.current) composerRef.current.value = '';

    setSending(true);

    sendMessage({
      conversationId: activeConversation.id,
      sessionName: activeConversation.session.name,
      chatId,
      body: formattedMessage,
    })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, 'Mesaj gönderilemedi'));
      })
      .finally(() => {
        setSending(false);
        queueMicrotask(() => composerRef.current?.focus());
      });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setCaption('');

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setFilePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const cancelFileSelect = () => {
    setSelectedFile(null);
    setFilePreview(null);
    setCaption('');
  };

  const handleSendMedia = async () => {
    if (!selectedFile || uploading) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const { data: uploadResult } = await api.post('/messages/upload', formData);

      const fullMediaUrl = `${backendPublicUrl()}${uploadResult.url}`;

      await sendMediaMessage({
        conversationId: activeConversation.id,
        sessionName: activeConversation.session.name,
        chatId,
        mediaUrl: fullMediaUrl,
        caption: caption || undefined,
      });

      cancelFileSelect();
    } catch (err: any) {
      console.error('Medya gönderim hatası:', err?.response?.data || err.message);
      alert('Görsel gönderilemedi: ' + (err?.response?.data?.message || err.message));
    } finally {
      setUploading(false);
    }
  };

  const handleEditMessage = async () => {
    if (!editingMessage || !editText.trim()) return;
    try {
      await api.patch(`/messages/${editingMessage.id}/edit`, {
        sessionName: activeConversation.session.name,
        chatId,
        newBody: editText.trim(),
      });
      setEditingMessage(null);
      setEditText('');
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Mesaj düzenlenemedi');
    }
  };

  const handleSendReply = async () => {
    if (!replyingTo || !text.trim()) return;
    setSending(true);
    try {
      await api.post('/messages/send-reply', {
        conversationId: activeConversation.id,
        sessionName: activeConversation.session.name,
        chatId,
        body: formatMessage(text.trim()),
        quotedMessageId: replyingTo.id,
      });
      setText('');
      setReplyingTo(null);
      queueMicrotask(() => composerRef.current?.focus());
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Yanıt gönderilemedi'));
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!confirm('Bu mesajı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/messages/${messageId}`, {
        data: {
          sessionName: activeConversation.session.name,
          chatId,
        },
      });
      toast.success('Mesaj silindi');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Mesaj silinemedi'));
    }
  };

  const handleSendReaction = async (messageId: string, emoji: string) => {
    try {
      await api.post(`/messages/${messageId}/reaction`, {
        sessionName: activeConversation.session.name,
        chatId,
        emoji,
      });
      setEmojiPickerOpen(null);
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Tepki gönderilemedi'));
    }
  };

  const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <div className="w-3.5 h-3.5 rounded-full border border-gray-300 border-t-transparent animate-spin" />
        );
      case 'SENT':
        return <Check className="w-3.5 h-3.5 text-gray-400" />;
      case 'DELIVERED':
        return <CheckCheck className="w-3.5 h-3.5 text-gray-400" />;
      case 'READ':
        return <CheckCheck className="w-3.5 h-3.5 text-blue-500" />;
      default:
        return <Check className="w-3.5 h-3.5 text-gray-300" />;
    }
  };

  const resolveMediaUrl = (url: string | null) => {
    if (!url) return null;
    const t = url.trim();
    if (t.startsWith('http')) return rewriteMediaUrlForClient(t);
    if (
      t.startsWith('/uploads/') ||
      t.startsWith('/api/') ||
      t.startsWith('uploads/')
    ) {
      const path = t.startsWith('/') ? t : `/${t}`;
      return `${backendPublicUrl()}${path}`;
    }
    return t;
  };

  const handleDownload = async (url: string, filename?: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        toast.error('Dosya bulunamadı — WAHA oturumu yeniden başlatılmış olabilir');
        return;
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || url.split('/').pop() || 'dosya';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Dosya indirilemedi');
    }
  };

  return (
    <div className="flex-1 flex h-full">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col h-full bg-[#efeae2]">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ContactAvatar
              name={contact.name}
              surname={contact.surname}
              phone={contact.phone}
              avatarUrl={contact.avatarUrl}
              size="sm"
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900">
                  {[contact.name, contact.surname].filter(Boolean).join(' ') || formatPhone(contact.phone)}
                </h3>
                <EcommerceCustomerBadge metadata={contact.metadata} />
              </div>
              <p className="text-xs text-gray-400">
                {formatPhone(contact.phone)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {contact.tags?.map((tag: string) => (
              <span
                key={tag}
                className="text-[10px] bg-whatsapp/10 text-whatsapp px-2 py-0.5 rounded-full font-medium"
              >
                {tag}
              </span>
            ))}
            {activeConversation.assignments?.[0] && (
              <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                <User className="w-3 h-3" />
                {activeConversation.assignments[0].user.name}
              </span>
            )}
            <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
              <ListFilter className="w-3.5 h-3.5 text-gray-400" aria-hidden />
              <select
                value={messageAuthorFilter}
                onChange={(e) => setMessageAuthorFilter(e.target.value)}
                className="max-w-[200px] sm:max-w-[240px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-whatsapp/40"
                title="Mesajları kime göre süz"
              >
                <option value="all">Tüm mesajlar</option>
                <option value="me">Müşteri + benim yanıtlarım</option>
                {inboxPeers
                  .filter((p) => p.id !== currentUserId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      Müşteri + {(p.name || p.email || 'Temsilci').slice(0, 28)} yanıtları
                    </option>
                  ))}
              </select>
            </label>
            {(contact as any).source && (
              <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium">
                {(contact as any).source}
              </span>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!currentUserId) {
                  toast.error('Oturum bilgisi yok');
                  return;
                }
                const due = new Date();
                due.setHours(due.getHours() + 24);
                const label =
                  [contact.name, contact.surname].filter(Boolean).join(' ') ||
                  formatPhone(contact.phone);
                try {
                  await api.post('/tasks', {
                    contactId: activeConversation.contactId,
                    title: `${label} — dönüş`,
                    description: 'Gelen kutusundan hızlı görev (24 saat)',
                    dueAt: due.toISOString(),
                  });
                  toast.success('Görev oluşturuldu');
                } catch (err) {
                  toast.error(getApiErrorMessage(err, 'Görev oluşturulamadı'));
                }
              }}
              className="p-2 text-gray-400 hover:text-whatsapp hover:bg-green-50 rounded-lg transition-colors"
              title="24 saat sonra dönüş görevi"
            >
              <ListTodo className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowPanel(!showPanel)}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors ml-1"
              title={showPanel ? 'Paneli Kapat' : 'Kişi Detayı'}
            >
              {showPanel ? (
                <PanelRightClose className="w-4.5 h-4.5" />
              ) : (
                <PanelRightOpen className="w-4.5 h-4.5" />
              )}
            </button>
          </div>
        </div>

        {messageAuthorFilter !== 'all' && messages.length > 0 && (
          <div className="bg-amber-50/90 border-b border-amber-100 px-4 py-1.5 text-center text-[11px] text-amber-900">
            {displayMessages.length} / {messages.length} mesaj gösteriliyor (gelen müşteri mesajları her zaman
            dahil)
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
          {isLoadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {displayMessages.map((msg) => {
                const isOutgoing = msg.direction === 'OUTGOING';
                const mediaUrlResolved = resolveMediaUrl(msg.mediaUrl);
                const isImage =
                  msg.mediaType === 'IMAGE' ||
                  mediaUrlResolved?.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex group/msg',
                      isOutgoing ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div className="relative max-w-[65%]">
                      {/* Hover Actions Bar */}
                      <div className={cn(
                        'absolute top-0 flex items-center gap-0.5 bg-white rounded-lg shadow-md border border-gray-200 p-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity z-20',
                        isOutgoing ? '-left-24' : '-right-24'
                      )}>
                        <button
                          onClick={() => {
                            setReplyingTo({ id: msg.id, body: msg.body });
                            queueMicrotask(() => composerRef.current?.focus());
                          }}
                          className="p-1.5 text-gray-400 hover:text-whatsapp hover:bg-green-50 rounded-md transition-colors"
                          title="Yanıtla"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => setEmojiPickerOpen(emojiPickerOpen === msg.id ? null : msg.id)}
                            className="p-1.5 text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 rounded-md transition-colors"
                            title="Tepki"
                          >
                            <Smile className="w-3.5 h-3.5" />
                          </button>
                          {emojiPickerOpen === msg.id && (
                            <div 
                              ref={emojiPickerRef}
                              className={cn(
                                'absolute top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-30',
                                isOutgoing ? 'right-0' : 'left-0'
                              )}
                            >
                              <div className="flex gap-1">
                                {quickEmojis.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleSendReaction(msg.id, emoji)}
                                    className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-100 rounded-md transition-colors"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        {isOutgoing && msg.body && !msg.id.startsWith('temp-') && (
                          <button
                            onClick={() => {
                              setEditingMessage({ id: msg.id, body: msg.body || '' });
                              setEditText(msg.body || '');
                            }}
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors"
                            title="Düzenle"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isOutgoing && !msg.id.startsWith('temp-') && (
                          <button
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                            title="Sil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div
                        className={cn(
                          'rounded-2xl px-3 py-2 shadow-sm',
                          isOutgoing
                            ? 'bg-[#d9fdd3] rounded-tr-md'
                            : 'bg-white rounded-tl-md',
                        )}
                      >
                      {mediaUrlResolved && isImage && (
                        <div
                          onClick={() => setLightboxUrl(mediaUrlResolved)}
                          className="cursor-pointer"
                        >
                          <img
                            src={mediaUrlResolved}
                            alt=""
                            style={{ maxWidth: '100%', width: 'auto', height: 'auto', minWidth: 120, minHeight: 80 }}
                            className="rounded-lg mb-1 hover:opacity-90 transition-opacity"
                            loading="lazy"
                            onError={(e) => {
                              const target = e.currentTarget;
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent) {
                                parent.innerHTML = '<div class="flex items-center gap-2 p-3 bg-gray-100 rounded-lg text-xs text-gray-400"><span>📷 Görsel yüklenemedi</span></div>';
                                parent.style.cursor = 'default';
                                parent.onclick = null;
                              }
                            }}
                          />
                        </div>
                      )}
                      {msg.mediaType === 'AUDIO' && mediaUrlResolved && (
                        <div className="mb-1">
                          <audio controls className="max-w-[240px] h-10">
                            <source src={mediaUrlResolved} type={msg.mediaMimeType || 'audio/ogg'} />
                            Tarayıcınız ses oynatmayı desteklemiyor.
                          </audio>
                        </div>
                      )}
                      {mediaUrlResolved && !isImage && msg.mediaType && msg.mediaType !== 'AUDIO' && (
                        <button
                          onClick={() => handleDownload(mediaUrlResolved, msg.body || undefined)}
                          className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg mb-1 hover:bg-gray-100 transition-colors border border-gray-100 w-full text-left"
                        >
                          <div className={cn(
                            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                            msg.mediaType === 'VIDEO' ? 'bg-purple-100' : 'bg-blue-100'
                          )}>
                            <FileText className={cn(
                              'w-5 h-5',
                              msg.mediaType === 'VIDEO' ? 'text-purple-600' : 'text-blue-600'
                            )} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-medium text-gray-700 block truncate">
                              {msg.body && msg.body.match(/\.\w+$/)
                                ? msg.body
                                : msg.mediaType === 'VIDEO' ? '🎬 Video' : '📄 Belge'}
                            </span>
                            <span className="text-[10px] text-gray-400">İndirmek için tıklayın</span>
                          </div>
                        </button>
                      )}
                      {msg.body && (
                        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                          {renderMessageBody(msg.body)}
                        </p>
                      )}
                      {(msg as any).reactions?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {groupReactions((msg as any).reactions).map(({ emoji, count, names }) => (
                            <span
                              key={emoji}
                              title={names}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/80 border border-gray-200 rounded-full text-xs cursor-default hover:bg-gray-100 transition-colors"
                            >
                              <span className="text-sm">{emoji}</span>
                              {count > 1 && (
                                <span className="text-[10px] text-gray-500 font-medium">{count}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      <div
                        className={cn(
                          'flex items-center gap-1 mt-1',
                          isOutgoing ? 'justify-end' : 'justify-start',
                        )}
                      >
                        {(msg as any).isEdited && (
                          <span className="text-[10px] text-gray-400 italic">düzenlendi</span>
                        )}
                        <span className="text-[10px] text-gray-400">
                          {formatTime(msg.timestamp)}
                        </span>
                        {isOutgoing && getStatusIcon(msg.status)}
                      </div>
                    </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* File Preview */}
        {selectedFile && (
          <div className="bg-white border-t border-gray-200 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="relative flex-shrink-0">
                {filePreview ? (
                  <img
                    src={filePreview}
                    alt=""
                    className="w-20 h-20 object-cover rounded-xl border border-gray-200"
                  />
                ) : (
                  <div className="w-20 h-20 bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200">
                    <FileText className="w-8 h-8 text-gray-400" />
                  </div>
                )}
                <button
                  onClick={cancelFileSelect}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 truncate mb-2">
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
                </p>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Açıklama ekle (opsiyonel)..."
                  className="w-full px-3 py-2 bg-gray-50 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-whatsapp/30 border border-gray-100"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSendMedia();
                    }
                  }}
                />
              </div>
              <button
                onClick={handleSendMedia}
                disabled={uploading}
                className="p-2.5 bg-whatsapp text-white rounded-full hover:bg-green-600 transition-colors disabled:opacity-50 flex-shrink-0"
              >
                {uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Reply Banner */}
        {replyingTo && (
          <div className="bg-green-50 border-t border-green-200 px-4 py-2 flex items-center gap-3">
            <Reply className="w-4 h-4 text-green-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-green-600 font-medium">Yanıtlanıyor</p>
              <p className="text-xs text-green-500 truncate">{replyingTo.body || '(medya mesajı)'}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1 text-green-400 hover:text-green-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Edit Banner */}
        {editingMessage && (
          <div className="bg-blue-50 border-t border-blue-200 px-4 py-2 flex items-center gap-3">
            <Pencil className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-blue-600 font-medium">Mesajı düzenle</p>
              <p className="text-xs text-blue-400 truncate">{editingMessage.body}</p>
            </div>
            <button
              type="button"
              onClick={() => { setEditingMessage(null); setEditText(''); }}
              className="p-1 text-blue-400 hover:text-blue-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Input */}
        {!selectedFile && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editingMessage) void handleEditMessage();
              else if (replyingTo) void handleSendReply();
              else submitComposer();
            }}
            className="bg-white border-t border-gray-200 px-4 py-3 flex items-end gap-3"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.mp4,.mp3,.ogg,.txt,.csv,.zip,.rar"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            {/* Action Tray */}
            <div ref={actionTrayRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setActionTrayOpen(!actionTrayOpen);
                  setShowTemplates(false);
                  setProductPickerOpen(false);
                }}
                className={cn(
                  'p-2 rounded-lg transition-all duration-200',
                  actionTrayOpen
                    ? 'text-white bg-whatsapp rotate-45'
                    : 'text-gray-400 hover:text-whatsapp hover:bg-green-50'
                )}
                title="Ekle"
              >
                <Plus className="w-5 h-5" />
              </button>
              
              {actionTrayOpen && (
                <div className="absolute bottom-full mb-2 left-0 bg-white rounded-xl shadow-lg border border-gray-200 p-3 z-30 min-w-[280px]">
                  <p className="text-xs text-gray-500 font-medium mb-2 px-1">Ekle</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = 'image/*';
                          fileInputRef.current.click();
                          setTimeout(() => {
                            if (fileInputRef.current) fileInputRef.current.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.mp4,.mp3,.ogg,.txt,.csv,.zip,.rar';
                          }, 100);
                        }
                        setActionTrayOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-purple-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                        <ImageIcon className="w-5 h-5 text-purple-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Görsel</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar';
                          fileInputRef.current.click();
                          setTimeout(() => {
                            if (fileInputRef.current) fileInputRef.current.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.mp4,.mp3,.ogg,.txt,.csv,.zip,.rar';
                          }, 100);
                        }
                        setActionTrayOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-blue-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                        <FileUp className="w-5 h-5 text-blue-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Belge</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setProductPickerOpen(true);
                        setActionTrayOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-orange-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center group-hover:bg-orange-200 transition-colors">
                        <Package className="w-5 h-5 text-orange-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Ürün</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        toast('Konum gönderme yakında eklenecek', { icon: '📍' });
                        setActionTrayOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-green-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-colors">
                        <MapPin className="w-5 h-5 text-green-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Konum</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setShowTemplates(true);
                        setActionTrayOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-amber-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                        <BookTemplate className="w-5 h-5 text-amber-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Şablon</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1 relative">
              {productPickerOpen && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden flex flex-col max-h-72">
                  <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                    <Search className="w-4 h-4 text-gray-400 shrink-0" />
                    <input
                      type="search"
                      autoComplete="off"
                      placeholder="Ürün adı veya SKU ara…"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="flex-1 min-w-0 text-sm py-1.5 px-1 border-0 focus:ring-0 focus:outline-none bg-transparent"
                    />
                    <select
                      value={productCategoryFilter}
                      onChange={(e) => setProductCategoryFilter(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white max-w-[45%]"
                      title="Kategoriye göre filtrele"
                    >
                      <option value="">Tüm kategoriler</option>
                      {productCategories.map((c) => (
                        <option key={c.category} value={c.category}>
                          {c.category} ({c.count})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {productSearchLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="w-6 h-6 text-whatsapp animate-spin" />
                      </div>
                    ) : productHits.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6 px-3">
                        {productSearch.trim() ? 'Sonuç yok' : 'Aramaya başlayın veya boş aramada liste gelir'}
                      </p>
                    ) : (
                      productHits.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={sending}
                          onClick={() => {
                            setSending(true);
                            sendProductShare({
                              conversationId: activeConversation.id,
                              productId: p.id,
                              sessionName: activeConversation.session?.name,
                              chatId: `${activeConversation.contact.phone}@c.us`,
                            })
                              .then(() => {
                                setProductPickerOpen(false);
                                setProductSearch('');
                              })
                              .catch((err) => {
                                toast.error(getApiErrorMessage(err, 'Ürün gönderilemedi'));
                              })
                              .finally(() => setSending(false));
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 text-left disabled:opacity-50"
                        >
                          <div className="w-11 h-11 rounded-lg bg-gray-100 overflow-hidden shrink-0 border border-gray-100">
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={rewriteMediaUrlForClient(p.imageUrl)}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">
                                —
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                            <p className="text-[11px] text-gray-500 font-mono truncate">{p.sku}</p>
                            {p.category ? (
                              <p className="text-[11px] text-gray-400 truncate">{p.category}</p>
                            ) : null}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
              {showTemplates && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border rounded-xl shadow-lg max-h-64 overflow-y-auto z-20">
                  <div className="p-2 border-b">
                    <p className="text-xs text-gray-500 font-medium px-2 py-1">Mesaj Şablonları</p>
                  </div>
                  {templates
                    .filter((t) => {
                      const q = templateSearch.toLowerCase();
                      return (
                        t.title.toLowerCase().includes(q) ||
                        t.body.toLowerCase().includes(q) ||
                        (t.shortcut && t.shortcut.toLowerCase().includes(q))
                      );
                    })
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          const contactName = [contact.name, contact.surname].filter(Boolean).join(' ') || '';
                          const replaced = t.body
                            .replace(/\{isim\}/g, contactName)
                            .replace(/\{telefon\}/g, contact.phone);
                          setText(replaced);
                          setShowTemplates(false);
                          setTemplateSearch('');
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b last:border-b-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800">{t.title}</span>
                          {t.shortcut && (
                            <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">
                              /{t.shortcut}
                            </span>
                          )}
                          {t.category && (
                            <span className="text-[10px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded">
                              {t.category}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{t.body}</p>
                      </button>
                    ))}
                  {templates.filter((t) => {
                    const q = templateSearch.toLowerCase();
                    return t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
                  }).length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-3">Şablon bulunamadı</p>
                  )}
                </div>
              )}
              {editingMessage ? (
                <input
                  ref={editInputRef}
                  type="text"
                  autoComplete="off"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditingMessage(null);
                      setEditText('');
                    }
                  }}
                  placeholder="Düzenlenmiş mesajı yazın..."
                  className="w-full px-4 py-2.5 rounded-full text-sm focus:outline-none focus:ring-1 border bg-blue-50 border-blue-200 focus:ring-blue-300"
                />
              ) : (
                <textarea
                  key={`composer-${activeConversation.id}`}
                  ref={composerRef}
                  autoComplete="off"
                  name="chat-composer"
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    const val = e.target.value;
                    setText(val);
                    if (val.startsWith('/') && templates.length > 0) {
                      setShowTemplates(true);
                      setTemplateSearch(val.slice(1));
                      const matched = templates.find(
                        (t) => t.shortcut && val === `/${t.shortcut}`,
                      );
                      if (matched) {
                        const contactName = [contact.name, contact.surname].filter(Boolean).join(' ') || '';
                        const replaced = matched.body
                          .replace(/\{isim\}/g, contactName)
                          .replace(/\{telefon\}/g, contact.phone);
                        setText(replaced);
                        setShowTemplates(false);
                        setTemplateSearch('');
                      }
                    } else {
                      setShowTemplates(false);
                      setTemplateSearch('');
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitComposer();
                    }
                  }}
                  placeholder="Mesaj yazın… Enter gönderir, Shift+Enter satır atlar. (/ ile şablon)"
                  className="w-full min-h-[44px] max-h-36 px-4 py-2.5 rounded-2xl text-sm focus:outline-none focus:ring-1 border bg-gray-50 border-gray-100 focus:ring-whatsapp/30 resize-y leading-snug"
                />
              )}
            </div>
            <button
              type="submit"
              disabled={editingMessage ? !editText.trim() : (!text.trim() || sending)}
              className="p-2.5 bg-whatsapp text-white rounded-full hover:bg-green-600 transition-colors disabled:opacity-50"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        )}
      </div>

      {/* Right Panel */}
      {showPanel && (
        <ContactPanel
          key={activeConversation.id}
          conversationId={activeConversation.id}
          contact={contact}
          assignments={activeConversation.assignments}
          onClose={() => setShowPanel(false)}
          internalChatEnabled={internalChatEnabled}
          userRole={userRole}
        />
      )}

      {/* Lightbox via Portal */}
      {mounted && lightboxUrl &&
        createPortal(
          <div
            data-lightbox-overlay=""
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99999,
              background: 'rgba(0,0,0,0.92)',
              cursor: 'pointer',
            }}
            onClick={() => setLightboxUrl(null)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxUrl(null);
              }}
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                padding: 12,
                background: 'rgba(255,255,255,0.15)',
                borderRadius: '50%',
                border: 'none',
                cursor: 'pointer',
                zIndex: 10,
              }}
            >
              <X className="w-7 h-7" style={{ color: 'white' }} />
            </button>
            <div data-lightbox-stage="">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxUrl}
                alt=""
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  borderRadius: 8,
                  pointerEvents: 'auto',
                  cursor: 'default',
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
