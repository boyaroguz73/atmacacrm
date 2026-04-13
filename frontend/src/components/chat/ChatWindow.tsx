'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '@/store/chat';
import { getSocket } from '@/lib/socket';
import { cn, formatTime, formatPhone, digitsOnlyPhone } from '@/lib/utils';
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
  Archive,
  BookTemplate,
  Pencil,
  ListFilter,
} from 'lucide-react';
import ContactPanel from './ContactPanel';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';
import type { Message } from '@/store/chat';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:4000';

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
  } = useChatStore();
  const [text, setText] = useState('');
  const [composerNonce, setComposerNonce] = useState(0);
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

  useEffect(() => {
    setMounted(true);
    api
      .get('/templates?active=true')
      .then(({ data }) => setTemplates(data))
      .catch(() => {});
  }, []);

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
    setComposerNonce(0);
    setShowTemplates(false);
    setTemplateSearch('');
  }, [activeConversation?.id]);

  useEffect(() => {
    if (!activeConversation) return;
    let cancelled = false;
    const orgId =
      activeConversation.session?.organizationId ??
      activeConversation.contact?.organizationId ??
      null;
    try {
      const stored = localStorage.getItem('user');
      if (!stored) {
        setInboxPeers([]);
        return;
      }
      const u = JSON.parse(stored);
      let url = '/users/inbox-peers';
      if (u.role === 'SUPERADMIN') {
        if (!orgId) {
          setInboxPeers([]);
          return;
        }
        url += `?organizationId=${encodeURIComponent(orgId)}`;
      }
      api
        .get(url)
        .then(({ data }) => {
          if (!cancelled) setInboxPeers(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (!cancelled) setInboxPeers([]);
        });
    } catch {
      setInboxPeers([]);
    }
    return () => {
      cancelled = true;
    };
  }, [
    activeConversation?.id,
    activeConversation?.session?.organizationId,
    activeConversation?.contact?.organizationId,
  ]);

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

  const chatId = `${digitsOnlyPhone(contact.phone) || contact.phone}@c.us`;

  const submitComposer = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendMessage({
        conversationId: activeConversation.id,
        sessionName: activeConversation.session.name,
        chatId,
        body: trimmed,
      });
      setText('');
      setComposerNonce((n) => n + 1);
    } catch (err) {
      setText(trimmed);
      toast.error(getApiErrorMessage(err, 'Mesaj gönderilemedi'));
    } finally {
      setSending(false);
      queueMicrotask(() => composerRef.current?.focus());
    }
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

      const fullMediaUrl = `${BACKEND_URL}${uploadResult.url}`;

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
    if (url.startsWith('http')) return url;
    if (
      url.startsWith('/uploads/') ||
      url.startsWith('/api/') ||
      url.startsWith('uploads/')
    ) {
      const path = url.startsWith('/') ? url : `/${url}`;
      return `${BACKEND_URL}${path}`;
    }
    return url;
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
              onClick={async () => {
                if (!confirm('Bu sohbeti arşivlemek istediğinize emin misiniz?')) return;
                try {
                  await api.patch(`/conversations/${activeConversation.id}/archive`);
                  useChatStore.getState().fetchConversations(true);
                  toast.success('Sohbet arşivlendi');
                } catch {
                  toast.error('Arşivleme başarısız');
                }
              }}
              className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
              title="Sohbeti Arşivle"
            >
              <Archive className="w-4 h-4" />
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
                      {isOutgoing && msg.body && !msg.id.startsWith('temp-') && (
                        <button
                          onClick={() => {
                            setEditingMessage({ id: msg.id, body: msg.body || '' });
                            setEditText(msg.body || '');
                          }}
                          className="absolute -left-8 top-1/2 -translate-y-1/2 p-1 rounded-full bg-white shadow border border-gray-200 text-gray-400 hover:text-gray-600 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10"
                          title="Düzenle"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
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
                      {mediaUrlResolved && !isImage && msg.mediaType && (
                        <button
                          onClick={() => handleDownload(mediaUrlResolved, msg.body || undefined)}
                          className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg mb-1 hover:bg-gray-100 transition-colors border border-gray-100 w-full text-left"
                        >
                          <div className={cn(
                            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                            msg.mediaType === 'VIDEO' ? 'bg-purple-100' :
                            msg.mediaType === 'AUDIO' ? 'bg-orange-100' :
                            'bg-blue-100'
                          )}>
                            <FileText className={cn(
                              'w-5 h-5',
                              msg.mediaType === 'VIDEO' ? 'text-purple-600' :
                              msg.mediaType === 'AUDIO' ? 'text-orange-600' :
                              'text-blue-600'
                            )} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-medium text-gray-700 block truncate">
                              {msg.body && msg.body.match(/\.\w+$/)
                                ? msg.body
                                : msg.mediaType === 'VIDEO' ? '🎬 Video'
                                : msg.mediaType === 'AUDIO' ? '🎵 Ses dosyası'
                                : '📄 Belge'}
                            </span>
                            <span className="text-[10px] text-gray-400">İndirmek için tıklayın</span>
                          </div>
                        </button>
                      )}
                      {msg.body && (
                        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                          {msg.body}
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
              else void submitComposer();
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-whatsapp hover:bg-green-50 rounded-lg transition-colors"
              title="Görsel / Dosya Gönder"
            >
              <Paperclip className="w-5 h-5" />
            </button>
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
              }}
              className="p-2 text-gray-400 hover:text-whatsapp hover:bg-green-50 rounded-lg transition-colors"
              title="Görsel Gönder"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            {templates.length > 0 && (
              <button
                type="button"
                onClick={() => setShowTemplates(!showTemplates)}
                className="p-2 text-gray-400 hover:text-whatsapp hover:bg-green-50 rounded-lg transition-colors"
                title="Şablonlar"
              >
                <BookTemplate className="w-5 h-5" />
              </button>
            )}
            <div className="flex-1 relative">
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
                  key={`composer-${activeConversation.id}-${composerNonce}`}
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
                      void submitComposer();
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
