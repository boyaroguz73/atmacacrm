'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '@/store/chat';
import { getSocket } from '@/lib/socket';
import {
  cn,
  formatTime,
  formatPhone,
  getContactDisplayTitle,
  getContactSecondaryPhoneLine,
  phoneToWhatsappChatId,
  backendPublicUrl,
  rewriteMediaUrlForClient,
  displayCurrency,
} from '@/lib/utils';
import {
  Send,
  Paperclip,
  Check,
  CheckCheck,
  Image as ImageIcon,
  User,
  Users,
  PanelRightOpen,
  PanelRightClose,
  X,
  FileText,
  Loader2,
  BookTemplate,
  Pencil,
  ListTodo,
  Package,
  Search,
  Plus,
  Reply,
  Trash2,
  Smile,
  Forward,
  MapPin,
  FileUp,
  ArrowLeft,
  Info,
} from 'lucide-react';
import ContactPanel from './ContactPanel';
import { useAuthStore } from '@/store/auth';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';
import type { Message } from '@/store/chat';

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

function isLikelyEncodedPayload(text: string): boolean {
  const s = (text || '').trim();
  if (s.length < 400) return false;
  if (/^data:[^;]+;base64,/i.test(s)) return true;
  return /^[A-Za-z0-9+/=\s]+$/.test(s) && !/\s{2,}/.test(s.slice(0, 300));
}

function dayKey(input: string | Date): string {
  const d = new Date(input);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dayLabel(input: string | Date): string {
  const d = new Date(input);
  const now = new Date();
  const today = dayKey(now);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const yesterday = dayKey(y);
  const key = dayKey(d);
  if (key === today) return 'Bugün';
  if (key === yesterday) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface ChatWindowProps {
  onMobileBack?: () => void;
}

export default function ChatWindow({ onMobileBack }: ChatWindowProps) {
  const {
    activeConversation,
    messages,
    isLoadingMessages,
    fetchMessages,
    sendMessage,
    sendMediaMessage,
    sendProductShare,
    sendContactCard,
  } = useChatStore();
  const authUser = useAuthStore((s) => s.user);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showPanel, setShowPanel] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 1024px)').matches;
  });
  const [internalChatEnabled, setInternalChatEnabled] = useState(false);
  const [userRole, setUserRole] = useState('AGENT');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
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
      property2?: string | null;
      imageUrl?: string | null;
      unitPrice: number;
      salePriceAmount?: number | null;
      currency: string;
      category?: string | null;
      metadata?: unknown;
    }[]
  >([]);
  const [productCategoryFilter, setProductCategoryFilter] = useState('');
  const [productCategories, setProductCategories] = useState<{ category: string; count: number }[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [variantPickerFor, setVariantPickerFor] = useState<{
    productId: string;
    productName: string;
    productImageUrl?: string | null;
  } | null>(null);
  const [variantHits, setVariantHits] = useState<
    {
      id: string | null;
      name: string;
      imageUrl?: string | null;
      unitPrice: number;
      salePriceAmount?: number | null;
      property2?: string | null;
      currency: string;
      stock: number | null;
    }[]
  >([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const productProperty2Text = useCallback((p: { property2?: string | null; metadata?: unknown } & Record<string, unknown>) => {
    if (typeof p.property2 === 'string' && p.property2.trim()) return p.property2.trim();
    const topLevel = p.Property2;
    if (typeof topLevel === 'string' && topLevel.trim()) return topLevel.trim();
    const meta =
      p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
        ? (p.metadata as Record<string, unknown>)
        : null;
    const v = meta?.Property2 ?? meta?.property2;
    return typeof v === 'string' ? v.trim() : '';
  }, []);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactHits, setContactHits] = useState<
    { id: string; name: string | null; surname?: string | null; phone: string }[]
  >([]);
  const [contactSearchLoading, setContactSearchLoading] = useState(false);
  const [kartelaPickerOpen, setKartelaPickerOpen] = useState(false);
  const [kartelaSearch, setKartelaSearch] = useState('');
  const [kartelaItems, setKartelaItems] = useState<
    { id: string; name: string; fileUrl: string; fileName: string; mimeType: string }[]
  >([]);
  const [kartelaLoading, setKartelaLoading] = useState(false);

  const [actionTrayOpen, setActionTrayOpen] = useState(false);
  const actionTrayRef = useRef<HTMLDivElement>(null);

  const [contextMenuMsg, setContextMenuMsg] = useState<{ id: string; body: string | null; x: number; y: number } | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<{ id: string; body: string | null } | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardConvs, setForwardConvs] = useState<any[]>([]);
  const [forwardConvsLoading, setForwardConvsLoading] = useState(false);
  const [forwardSelected, setForwardSelected] = useState<Set<string>>(new Set());
  const [forwardSending, setForwardSending] = useState(false);
  /** Eski istekleri yoksaymak için ilet modalı liste fetch */
  const forwardFetchGen = useRef(0);
  const [replyingTo, setReplyingTo] = useState<{ id: string; body: string | null } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [groupDetailOpen, setGroupDetailOpen] = useState(false);
  const [groupParticipants, setGroupParticipants] = useState<
    { jid: string; phone: string | null; role: string; contactId: string | null; name: string | null }[]
  >([]);
  const [groupParticipantsLoading, setGroupParticipantsLoading] = useState(false);
  const [defaultLocation, setDefaultLocation] = useState<{
    latitude: number | null;
    longitude: number | null;
    mapsUrl?: string;
    title?: string;
    address?: string;
  } | null>(null);
  const [moduleToggles, setModuleToggles] = useState<Record<string, boolean> | null>(null);
  const [mobileKeyboardInset, setMobileKeyboardInset] = useState(0);
  const [composerStickyHeight, setComposerStickyHeight] = useState(0);

  useEffect(() => {
    setMounted(true);
    api
      .get('/templates?active=true')
      .then(({ data }) => setTemplates(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const measure = () => {
      const h = composerWrapRef.current?.offsetHeight ?? 0;
      setComposerStickyHeight(h);
    };
    measure();
    const el = composerWrapRef.current;
    if (!el) return;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [selectedFile, replyingTo, editingMessage, productPickerOpen, contactPickerOpen, kartelaPickerOpen, showTemplates, productHits.length, variantHits.length, contactHits.length, kartelaItems.length]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    const updateInset = () => {
      const isMobile = window.matchMedia('(max-width: 767px)').matches;
      if (!isMobile) {
        setMobileKeyboardInset(0);
        return;
      }
      const layoutH = window.innerHeight;
      const viewportBottom = vv.height + vv.offsetTop;
      const inset = Math.max(0, Math.round(layoutH - viewportBottom));
      setMobileKeyboardInset(inset);
    };
    updateInset();
    vv.addEventListener('resize', updateInset);
    vv.addEventListener('scroll', updateInset);
    window.addEventListener('orientationchange', updateInset);
    window.addEventListener('resize', updateInset);
    return () => {
      vv.removeEventListener('resize', updateInset);
      vv.removeEventListener('scroll', updateInset);
      window.removeEventListener('orientationchange', updateInset);
      window.removeEventListener('resize', updateInset);
    };
  }, []);

  useEffect(() => {
    if (!kartelaPickerOpen) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        setKartelaLoading(true);
        try {
          const { data } = await api.get('/kartelas', {
            params: { search: kartelaSearch.trim() || undefined },
          });
          if (!cancelled) setKartelaItems(Array.isArray(data) ? data : []);
        } catch {
          if (!cancelled) setKartelaItems([]);
        } finally {
          setKartelaLoading(false);
        }
      })();
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [kartelaPickerOpen, kartelaSearch]);

  useEffect(() => {
    if (moduleToggles?.quotes === false) {
      setProductPickerOpen(false);
      setVariantPickerFor(null);
    }
    if (moduleToggles?.kartelas === false) {
      setKartelaPickerOpen(false);
    }
    if (moduleToggles?.templates === false) {
      setShowTemplates(false);
    }
  }, [moduleToggles]);

  useEffect(() => {
    if (!productPickerOpen) return;
    let cancelled = false;
    const q = productSearch.trim();
    const t = setTimeout(() => {
      void (async () => {
        setProductSearchLoading(true);
        try {
          const { data } = await api.get('/products', {
            params: {
              search: q || undefined,
              category: productCategoryFilter || undefined,
              isActive: true,
              limit: 24,
              page: 1,
              matchExact: true,
            },
          });
          if (!cancelled) setProductHits(data.products || []);
        } catch {
          if (!cancelled) setProductHits([]);
        } finally {
          setProductSearchLoading(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [productSearch, productPickerOpen, productCategoryFilter]);

  useEffect(() => {
    if (!contactPickerOpen) return;
    let cancelled = false;
    const q = contactSearch.trim();
    const t = setTimeout(() => {
      void (async () => {
        if (q.length < 2) {
          if (!cancelled) setContactHits([]);
          setContactSearchLoading(false);
          return;
        }
        setContactSearchLoading(true);
        try {
          const { data } = await api.get('/contacts', { params: { search: q, limit: 20 } });
          if (!cancelled) setContactHits(data.contacts || []);
        } catch {
          if (!cancelled) setContactHits([]);
        } finally {
          setContactSearchLoading(false);
        }
      })();
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [contactSearch, contactPickerOpen]);

  useEffect(() => {
    if (!productPickerOpen) return;
    api
      .get('/products/categories-summary')
      .then(({ data }) => setProductCategories(Array.isArray(data) ? data : []))
      .catch(() => setProductCategories([]));
  }, [productPickerOpen]);

  useEffect(() => {
    useAuthStore.getState().loadFromStorage();
  }, []);

  useEffect(() => {
    api
      .get('/organizations/my/module-toggles')
      .then(({ data }) => {
        setModuleToggles(data?.toggles || null);
      })
      .catch(() => setModuleToggles(null));

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
    api
      .get('/organizations/my/default-location')
      .then(({ data }) => {
        setDefaultLocation({
          latitude: Number.isFinite(Number(data?.latitude)) ? Number(data.latitude) : null,
          longitude: Number.isFinite(Number(data?.longitude)) ? Number(data.longitude) : null,
          mapsUrl: typeof data?.mapsUrl === 'string' ? data.mapsUrl : '',
          title: typeof data?.title === 'string' ? data.title : '',
          address: typeof data?.address === 'string' ? data.address : '',
        });
      })
      .catch(() => setDefaultLocation(null));
  }, []);

  const moduleEnabled = (key: string) => moduleToggles?.[key] !== false;

  useEffect(() => {
    setText('');
    setShowTemplates(false);
    setTemplateSearch('');
    setProductPickerOpen(false);
    setProductSearch('');
    setProductHits([]);
    setProductCategoryFilter('');
    setContactPickerOpen(false);
    setContactSearch('');
    setContactHits([]);
    setKartelaPickerOpen(false);
    setKartelaSearch('');
    setKartelaItems([]);
    setActionTrayOpen(false);
    setReplyingTo(null);
    setContextMenuMsg(null);
    setEmojiPickerOpen(null);
    setGroupDetailOpen(false);
    setGroupParticipants([]);
    if (typeof window !== 'undefined') {
      setShowPanel(window.matchMedia('(min-width: 1024px)').matches);
    }
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

  const displayMessages = messages;

  const timelineItems = useMemo(() => {
    const out: Array<{ type: 'day'; key: string; label: string } | { type: 'msg'; message: Message }> = [];
    let lastDay = '';
    for (const m of displayMessages) {
      const k = dayKey(m.timestamp);
      if (k !== lastDay) {
        out.push({ type: 'day', key: k, label: dayLabel(m.timestamp) });
        lastDay = k;
      }
      out.push({ type: 'msg', message: m });
    }
    return out;
  }, [displayMessages]);

  const loadForwardTargets = useCallback(
    async (query: string) => {
      if (!activeConversation) return;
      const gen = ++forwardFetchGen.current;
      setForwardConvsLoading(true);
      try {
        const params: Record<string, string | number> = {
          limit: 200,
          page: 1,
          filter: 'all',
        };
        const q = query.trim();
        if (q) params.search = q;
        const { data } = await api.get('/conversations', { params });
        const list = Array.isArray(data) ? data : (data?.conversations ?? data?.items ?? []);
        if (gen !== forwardFetchGen.current) return;
        setForwardConvs((list as any[]).filter((c) => c.id !== activeConversation.id));
      } catch {
        if (gen === forwardFetchGen.current) toast.error('Konuşmalar yüklenemedi');
      } finally {
        if (gen === forwardFetchGen.current) setForwardConvsLoading(false);
      }
    },
    [activeConversation],
  );

  useEffect(() => {
    if (!forwardingMsg) return;
    const delay = forwardSearch.trim() ? 380 : 0;
    const t = setTimeout(() => {
      loadForwardTargets(forwardSearch);
    }, delay);
    return () => clearTimeout(t);
  }, [forwardingMsg, forwardSearch, loadForwardTargets]);

  if (!activeConversation) return null;

  const contact = activeConversation.contact;
  if (!contact?.phone) return null;

  const headerPhoneSubline = getContactSecondaryPhoneLine(contact);

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

    // WhatsApp uygulaması resmi olarak belge için 100MB'a kadar izin verir;
    // güvenli bir üst sınır olarak 64MB koyuyoruz (video/görsel için yeterli).
    const MAX_SIZE = 64 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      toast.error(
        `Dosya çok büyük (${(file.size / (1024 * 1024)).toFixed(1)} MB). Üst sınır 64 MB.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
    setCaption('');

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setFilePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
      // Video/audio için object URL ile preview — <video>/<audio> etiketi tüketir.
      try {
        const objectUrl = URL.createObjectURL(file);
        setFilePreview(objectUrl);
      } catch {
        setFilePreview(null);
      }
    } else {
      setFilePreview(null);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const cancelFileSelect = () => {
    // Video/audio için ObjectURL kullandıysak bellek sızıntısı olmaması adına iade et.
    if (filePreview && filePreview.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(filePreview);
      } catch {
        /* noop */
      }
    }
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

      const { data: uploadResult } = await api.post('/messages/upload', formData, {
        timeout: 120_000,
      });

      const fullMediaUrl = `${backendPublicUrl()}${uploadResult.url}`;

      // Optimistic render için MIME tipinden dosya türünü çıkar; backend doğru tipi yine döndürür.
      const m = (selectedFile.type || '').toLowerCase();
      const mediaTypeHint: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' =
        m.startsWith('image/')
          ? 'IMAGE'
          : m.startsWith('video/')
            ? 'VIDEO'
            : m.startsWith('audio/')
              ? 'AUDIO'
              : 'DOCUMENT';

      await sendMediaMessage({
        conversationId: activeConversation.id,
        sessionName: activeConversation.session.name,
        chatId,
        mediaUrl: fullMediaUrl,
        caption: caption || undefined,
        mediaTypeHint,
      });

      cancelFileSelect();
    } catch (err: any) {
      console.error('Medya gönderim hatası:', err?.response?.data || err.message);
      toast.error(getApiErrorMessage(err, 'Medya gönderilemedi'));
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

  const openForwardModal = (msg: { id: string; body: string | null }) => {
    setForwardingMsg(msg);
    setForwardSelected(new Set());
    setForwardSearch('');
  };

  const handleForwardSend = async () => {
    if (!forwardingMsg || forwardSelected.size === 0) return;
    setForwardSending(true);
    try {
      const { data } = await api.post(
        `/conversations/${activeConversation.id}/forward-message`,
        { messageId: forwardingMsg.id, toConversationIds: Array.from(forwardSelected) },
      );
      const failed = (data.results as any[]).filter((r) => !r.success);
      if (failed.length === 0) {
        toast.success(`Mesaj ${forwardSelected.size} kişiye iletildi`);
      } else {
        toast.success(`${forwardSelected.size - failed.length} kişiye iletildi, ${failed.length} başarısız`);
      }
      setForwardingMsg(null);
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Mesaj iletilemedi'));
    } finally {
      setForwardSending(false);
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

  const handleSendLocation = async () => {
    const sendPayload = async (lat: number, lng: number, title?: string, address?: string) => {
      await api.post('/messages/send-location', {
        conversationId: activeConversation.id,
        sessionName: activeConversation.session.name,
        chatId,
        latitude: lat,
        longitude: lng,
        title: title || 'Konum',
        address,
      });
    };

    const maps = (defaultLocation?.mapsUrl || '').trim();
    if (maps) {
      const title = (defaultLocation?.title || '').trim() || 'Konum';
      const address = (defaultLocation?.address || '').trim();
      const body = address
        ? `📍 ${title}\n${address}\n${maps}`
        : `📍 ${title}\n${maps}`;
      try {
        setSending(true);
        await sendMessage({
          conversationId: activeConversation.id,
          sessionName: activeConversation.session.name,
          chatId,
          body,
        });
        toast.success('Konum gönderildi');
      } catch (err: any) {
        toast.error(getApiErrorMessage(err, 'Konum gönderilemedi'));
      } finally {
        setSending(false);
      }
      return;
    }

    if (
      defaultLocation &&
      Number.isFinite(Number(defaultLocation.latitude)) &&
      Number.isFinite(Number(defaultLocation.longitude))
    ) {
      try {
        await sendPayload(
          Number(defaultLocation.latitude),
          Number(defaultLocation.longitude),
          defaultLocation.title || 'Sabit Konum',
          defaultLocation.address || undefined,
        );
        toast.success('Sabit konum gönderildi');
        return;
      } catch (err: any) {
        toast.error(getApiErrorMessage(err, 'Sabit konum gönderilemedi'));
      }
    }

    const raw = window.prompt(
      'Konum girin: "lat,lng" veya Google Maps linki',
      '',
    );
    if (!raw) return;
    const value = raw.trim();
    const coordMatch = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    const linkMatch = value.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || value.match(/q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const lat = Number(coordMatch?.[1] || linkMatch?.[1]);
    const lng = Number(coordMatch?.[2] || linkMatch?.[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error('Geçerli koordinat bulunamadı');
      return;
    }
    try {
      await sendPayload(lat, lng, 'Konum', value.startsWith('http') ? value : undefined);
      toast.success('Konum gönderildi');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Konum gönderilemedi'));
    }
  };

  const openGroupDetail = async () => {
    if (!activeConversation?.isGroup) return;
    setGroupDetailOpen(true);
    setGroupParticipantsLoading(true);
    try {
      const { data } = await api.get(`/conversations/${activeConversation.id}/group-participants`);
      setGroupParticipants(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Grup katılımcıları alınamadı'));
      setGroupParticipants([]);
    } finally {
      setGroupParticipantsLoading(false);
    }
  };

  const isVcardMessage = (msg: Message) =>
    msg.metadata?.kind === 'vcard' || /^BEGIN:VCARD/i.test(String(msg.body || ''));
  const locationInfo = (msg: Message) => {
    const m = (msg.metadata || {}) as any;
    const lat = Number(m.latitude);
    const lng = Number(m.longitude);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const title = typeof m.title === 'string' ? m.title.trim() : '';
    const address = typeof m.address === 'string' ? m.address.trim() : '';
    const urlFromMeta = typeof m.mapsUrl === 'string' ? m.mapsUrl.trim() : '';
    const urlFromBody = String(msg.body || '').match(/https?:\/\/(?:www\.)?(?:google\.[^/\s]+\/maps|maps\.app\.goo\.gl)[^\s]*/i)?.[0] || '';
    const mapsUrl = hasCoords
      ? `https://maps.google.com/?q=${lat},${lng}`
      : (urlFromMeta || urlFromBody || '');
    const isLocation =
      m.kind === 'location' ||
      hasCoords ||
      !!mapsUrl ||
      /^📍/.test(String(msg.body || '').trim());
    return { isLocation, hasCoords, lat, lng, title, address, mapsUrl };
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

  /** Sunucuda statik servis edilen `/uploads/...` (JWT gerektirmez). */
  const isLikelyPublicUploadMediaUrl = (url: string) => {
    const u = url.split('?')[0];
    return (
      u.startsWith('/uploads/') ||
      u.startsWith('uploads/') ||
      /^https?:\/\/[^/]+\/uploads\//i.test(u)
    );
  };

  const resolveMediaUrl = (msg: Message) => {
    const meta = msg.metadata as Record<string, unknown> | undefined;
    const storedTrim = String(msg.mediaUrl ?? '').trim();
    const originalTrim =
      typeof meta?.originalMediaUrl === 'string'
        ? String(meta.originalMediaUrl).trim()
        : '';
    // Backfill sonrası mediaUrl `/uploads/...` olur; metadata.originalMediaUrl çoğu zaman eski `/api/files/...` kalır.
    // Önce eski proxy URL’sini seçmek JWT olmadan yeni sekmede/RGB fetch’te PDF’nin açılmamasına yol açar.
    const preferred =
      storedTrim && isLikelyPublicUploadMediaUrl(storedTrim)
        ? storedTrim
        : originalTrim || storedTrim;
    if (!preferred) return null;
    const t = String(preferred).trim();
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

  const apiFilesNeedsBearer = (url: string) => url.includes('/api/files/');

  const fetchMediaAuthenticated = async (url: string): Promise<Blob | null> => {
    try {
      const headers: HeadersInit = {};
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return res.blob();
    } catch {
      return null;
    }
  };

  const openResolvedMediaTab = async (url: string) => {
    if (!apiFilesNeedsBearer(url)) {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      return !!opened;
    }
    const blob = await fetchMediaAuthenticated(url);
    if (!blob) return false;
    const blobUrl = URL.createObjectURL(blob);
    const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      URL.revokeObjectURL(blobUrl);
      return false;
    }
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
    return true;
  };

  const handleDownload = async (url: string, filename?: string) => {
    try {
      const headers: HeadersInit = {};
      if (typeof window !== 'undefined' && apiFilesNeedsBearer(url)) {
        const token = localStorage.getItem('token');
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(url, { headers });
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

  const inferDownloadFilename = (msg: Message, url: string): string => {
    const named = String(msg.body || '').trim();
    if (named && /\.[a-z0-9]{2,8}$/i.test(named)) return named;

    const meta = msg.metadata as Record<string, unknown> | undefined;
    const metaName =
      typeof meta?.filename === 'string'
        ? meta.filename.trim()
        : typeof meta?.originalFilename === 'string'
          ? String(meta.originalFilename).trim()
          : '';
    if (metaName && /\.[a-z0-9]{2,8}$/i.test(metaName)) return metaName;

    const mime =
      String(msg.mediaMimeType || msg.metadata?.originalMimeType || '').toLowerCase().trim();
    const extFromMime = (() => {
      const clean = mime.split(';')[0].trim();
      const map: Record<string, string> = {
        'application/pdf': '.pdf',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.ms-powerpoint': '.ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'text/plain': '.txt',
        'text/csv': '.csv',
        'application/zip': '.zip',
        'application/x-rar-compressed': '.rar',
        'application/x-7z-compressed': '.7z',
        'application/json': '.json',
      };
      return map[clean] || '';
    })();
    const looksPdf =
      mime.includes('pdf') || /\.pdf(\?|$)/i.test(url.split('?')[0] || '');
    if (looksPdf) {
      const bodyText = String(msg.body || '');
      const tkl = bodyText.match(/TKL-(\d+)/i);
      if (tkl) return `Teklif-${tkl[1]}.pdf`;
      const ftr = bodyText.match(/FTR-(\d+)/i);
      if (ftr) return `Fatura-${ftr[1]}.pdf`;
    }
    if (mime.includes('pdf')) return `dosya-${msg.id}.pdf`;
    if (mime.startsWith('audio/')) {
      if (mime.includes('mpeg')) return `ses-${msg.id}.mp3`;
      if (mime.includes('mp4')) return `ses-${msg.id}.m4a`;
      return `ses-${msg.id}.ogg`;
    }
    if (mime.startsWith('video/')) return `video-${msg.id}.mp4`;
    if (mime.startsWith('image/')) return `gorsel-${msg.id}.jpg`;

    const tail = url.split('/').pop() || '';
    if (tail.toLowerCase().endsWith('.bin') && extFromMime) {
      return tail.replace(/\.bin$/i, extFromMime);
    }
    if (tail && /\.[a-z0-9]{2,8}$/i.test(tail)) return tail;
    if (extFromMime) return `dosya-${msg.id}${extFromMime}`;
    return `dosya-${msg.id}`;
  };

  return (
    <div className="flex-1 flex h-full">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col h-full bg-[#efeae2] min-h-0">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-3 lg:px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            {/* Mobile back button */}
            {onMobileBack && (
              <button
                onClick={onMobileBack}
                className="lg:hidden p-2 -ml-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Geri"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            {activeConversation.isGroup ? (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5 text-white" />
              </div>
            ) : (
              <ContactAvatar
                name={contact.name}
                surname={contact.surname}
                phone={contact.phone}
                avatarUrl={contact.avatarUrl}
                size="sm"
              />
            )}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {activeConversation.isGroup && (
                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                    Grup
                  </span>
                )}
                <h3 className="font-semibold text-gray-900">
                  {activeConversation.isGroup
                    ? (activeConversation.groupName || contact.name || 'WhatsApp Grubu')
                    : getContactDisplayTitle(contact)
                  }
                </h3>
                {!activeConversation.isGroup && <EcommerceCustomerBadge metadata={contact.metadata} />}
              </div>
              {(activeConversation.isGroup || headerPhoneSubline) && (
                <p className="text-xs text-gray-400">
                  {activeConversation.isGroup
                    ? (typeof activeConversation.groupParticipantCount === 'number'
                        ? `Grup · ${activeConversation.groupParticipantCount} üye`
                        : 'WhatsApp Grup Sohbeti')
                    : headerPhoneSubline}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 md:gap-2">
            {/* Mobilde gizle: tags, assignment, source */}
            <div className="hidden md:flex items-center gap-2">
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
            </div>
            {(contact as any).source && (
              <span className="hidden md:inline-flex text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium">
                {(contact as any).source}
              </span>
            )}
            {activeConversation.isGroup && (
              <button
                type="button"
                onClick={() => void openGroupDetail()}
                className="p-2 text-gray-400 hover:text-whatsapp hover:bg-green-50 rounded-lg transition-colors"
                title="Grup detayları"
              >
                <Info className="w-4 h-4" />
              </button>
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

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin"
          style={{ paddingBottom: `calc(1rem + ${composerStickyHeight}px + ${mobileKeyboardInset}px)` }}
        >
          {isLoadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {timelineItems.map((item) => {
                if (item.type === 'day') {
                  return (
                    <div key={`day-${item.key}`} className="flex justify-center py-1">
                      <span className="text-[11px] text-gray-600 bg-white/70 border border-gray-200 rounded-full px-3 py-1">
                        {item.label}
                      </span>
                    </div>
                  );
                }
                const msg = item.message;
                const isOutgoing = msg.direction === 'OUTGOING';
                const mediaUrlResolved = resolveMediaUrl(msg);
                const resolvedMime = String(
                  msg.mediaMimeType || msg.metadata?.originalMimeType || '',
                )
                  .toLowerCase()
                  .split(';')[0]
                  .trim();
                const metadata = (msg.metadata || {}) as Record<string, unknown>;
                const filenameHint = String(
                  (typeof metadata.filename === 'string' ? metadata.filename : '') ||
                  (typeof metadata.originalFilename === 'string' ? metadata.originalFilename : '') ||
                  msg.body ||
                  '',
                ).toLowerCase();
                const urlHint = String(mediaUrlResolved || '').toLowerCase();
                const isPdf =
                  resolvedMime === 'application/pdf' ||
                  /\.pdf(\?|$)/i.test(urlHint) ||
                  /\.pdf\b/i.test(filenameHint);
                const isAudio =
                  msg.mediaType === 'AUDIO' ||
                  resolvedMime.startsWith('audio/') ||
                  /\.(ogg|opus|mp3|m4a|aac|wav|webm)(\?|$)/i.test(urlHint);
                const isVideo =
                  msg.mediaType === 'VIDEO' ||
                  resolvedMime.startsWith('video/') ||
                  /\.(mp4|mov|m4v|webm|3gp)(\?|$)/i.test(urlHint);
                const looksLikeDocumentByName =
                  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z)(\?|$)/i.test(urlHint) ||
                  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z)\b/i.test(filenameHint);
                const isDocumentLike =
                  isPdf ||
                  msg.mediaType === 'DOCUMENT' ||
                  looksLikeDocumentByName ||
                  (resolvedMime.startsWith('application/') &&
                    !resolvedMime.startsWith('application/json'));
                const isImage =
                  !isDocumentLike &&
                  !isAudio &&
                  !isVideo &&
                  (
                    msg.mediaType === 'IMAGE' ||
                    resolvedMime.startsWith('image/') ||
                    /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)(\?|$)/i.test(urlHint)
                  );
                const isImageMessage = !!(mediaUrlResolved && isImage);
                const replyPreview =
                  msg.metadata?.replyToBody?.trim() ||
                  (msg.metadata?.replyToMediaType ? `📎 ${msg.metadata.replyToMediaType}` : '');
                const isDeletedMessage = !!msg.metadata?.deleted;
                const loc = locationInfo(msg);
                /** Webhook sadece "📎 AUDIO" yazdıysa gerçek metin yok say */
                const isMediaTypeOnlyPlaceholder =
                  !!msg.mediaType &&
                  /^📎\s*(AUDIO|VIDEO|IMAGE|DOCUMENT)$/i.test(String(msg.body || '').trim());

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex group/msg',
                      isOutgoing ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'relative',
                        isImageMessage
                          ? isOutgoing
                            ? 'w-full max-w-[min(82vw,560px)] sm:max-w-[min(72vw,620px)]'
                            : 'w-full max-w-[min(82vw,560px)] sm:max-w-[min(72vw,620px)]'
                          : 'max-w-[65%]',
                      )}
                    >
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
                        {!msg.id.startsWith('temp-') && (
                          <button
                            onClick={() => openForwardModal({ id: msg.id, body: msg.body })}
                            className="p-1.5 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-md transition-colors"
                            title="İlet"
                          >
                            <Forward className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div
                        className={cn(
                          'rounded-2xl shadow-sm',
                          isImageMessage && !msg.body?.trim()
                            ? 'p-1'
                            : 'px-3 py-2',
                          isOutgoing
                            ? 'bg-[#d9fdd3] rounded-tr-md'
                            : 'bg-white rounded-tl-md',
                        )}
                      >
                      {/* Grup: her mesajda gönderen (giden: Siz / temsilci) */}
                      {activeConversation?.isGroup && (
                        <div className="text-xs font-semibold text-green-600 mb-1 truncate">
                          {isOutgoing
                            ? (msg.participantName || msg.sentBy?.name || 'Siz')
                            : (msg.participantName || formatPhone(msg.participantPhone) || msg.sentBy?.name || 'Katılımcı')}
                        </div>
                      )}
                      {/* Bire bir: aynı müşteriye birden fazla temsilci yazabildiği için gönderen adı */}
                      {!activeConversation?.isGroup && isOutgoing && (
                        <div className="text-xs font-semibold text-emerald-800 mb-1 truncate">
                          {msg.sentBy?.name?.trim() ||
                            (msg.id.startsWith('temp-')
                              ? authUser?.name?.trim() || 'Gönderiliyor…'
                              : '—')}
                        </div>
                      )}
                      {mediaUrlResolved && isImage && (
                        <div
                          onClick={() => setLightboxUrl(mediaUrlResolved)}
                          className="cursor-pointer"
                        >
                          <img
                            src={mediaUrlResolved}
                            alt=""
                            className="block w-auto max-w-full h-auto max-h-[min(52vh,520px)] rounded-lg object-contain mx-auto hover:opacity-95 transition-opacity"
                            loading="lazy"
                            decoding="async"
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
                      {isAudio && !mediaUrlResolved && (
                        <div className="mb-1 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                          🎵 Ses dosyası sunucuya alınamadı. Sohbeti kapatıp tekrar açın veya sayfayı yenileyin.
                        </div>
                      )}
                      {isAudio && mediaUrlResolved && (
                        <div className="mb-1">
                          {(() => {
                            const url = mediaUrlResolved.split('?')[0] || '';
                            const ext = (url.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
                            // WhatsApp sesleri çoğunlukla OGG/Opus (PTT) olarak gelir.
                            // mediaMimeType boşsa uzantıya göre akıllı bir tahmin yapıyoruz.
                            const extMime =
                              ext === 'ogg' || ext === 'opus' ? 'audio/ogg; codecs=opus'
                              : ext === 'mp3' ? 'audio/mpeg'
                              : ext === 'm4a' || ext === 'mp4' || ext === 'aac' ? 'audio/mp4'
                              : ext === 'wav' ? 'audio/wav'
                              : ext === 'webm' ? 'audio/webm'
                              : undefined;
                            const primaryType =
                              (msg.mediaMimeType && msg.mediaMimeType.toLowerCase().startsWith('audio/'))
                                ? msg.mediaMimeType
                                : (extMime || 'audio/ogg; codecs=opus');
                            return (
                              <audio
                                controls
                                preload="metadata"
                                className="max-w-[min(280px,85vw)] h-10"
                                src={mediaUrlResolved}
                              >
                                <source src={mediaUrlResolved} type={primaryType} />
                                Tarayıcınız ses oynatmayı desteklemiyor.
                              </audio>
                            );
                          })()}
                        </div>
                      )}
                      {isVideo && !mediaUrlResolved && (
                        <div className="mb-1 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                          🎬 Video sunucuya alınamadı. Sohbeti kapatıp tekrar açın veya sayfayı yenileyin.
                        </div>
                      )}
                      {isVideo && mediaUrlResolved && (
                        <div className="mb-1">
                          <video
                            controls
                            playsInline
                            preload="metadata"
                            className="block w-auto max-w-full h-auto max-h-[min(46vh,420px)] rounded-lg bg-black mx-auto"
                          >
                            <source src={mediaUrlResolved} type={msg.mediaMimeType || 'video/mp4'} />
                            Tarayıcınız video oynatmayı desteklemiyor.
                          </video>
                        </div>
                      )}
                      {mediaUrlResolved && !isImage && !isAudio && !isVideo && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            void (async () => {
                              const opened = await openResolvedMediaTab(mediaUrlResolved);
                              if (!opened) {
                                handleDownload(mediaUrlResolved, inferDownloadFilename(msg, mediaUrlResolved));
                              }
                            })();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              void (async () => {
                                const opened = await openResolvedMediaTab(mediaUrlResolved);
                                if (!opened) {
                                  handleDownload(mediaUrlResolved, inferDownloadFilename(msg, mediaUrlResolved));
                                }
                              })();
                            }
                          }}
                          className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg mb-1 hover:bg-gray-100 transition-colors border border-gray-100 w-full text-left cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-100">
                            <FileText className="w-5 h-5 text-blue-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-medium text-gray-700 block truncate">
                              {msg.body && msg.body.match(/\.\w+$/) ? msg.body : '📄 Belge'}
                            </span>
                            <span className="text-[10px] text-gray-400">Önizlemek için tıklayın</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(mediaUrlResolved, inferDownloadFilename(msg, mediaUrlResolved));
                              }}
                              className="ml-2 text-[10px] text-blue-600 hover:text-blue-700 underline"
                            >
                              İndir
                            </button>
                          </div>
                        </div>
                      )}
                      {replyPreview ? (
                        <div className="mb-2 border-l-2 border-green-400 bg-green-50/70 rounded-r-md px-2 py-1">
                          <div className="text-[10px] font-semibold text-green-700">Yanıtlanan mesaj</div>
                          <div className="text-xs text-gray-700 truncate">{replyPreview}</div>
                        </div>
                      ) : null}
                      {loc.isLocation ? (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-2.5 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
                            <MapPin className="w-3.5 h-3.5" />
                            Konum
                          </div>
                          {loc.title ? <div className="text-sm font-medium text-gray-800">{loc.title}</div> : null}
                          {loc.address ? <div className="text-xs text-gray-600 break-all">{loc.address}</div> : null}
                          {loc.hasCoords ? (
                            <div className="text-[11px] text-gray-500">
                              {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
                            </div>
                          ) : null}
                          {loc.mapsUrl ? (
                            <a
                              href={loc.mapsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-xs text-green-700 hover:text-green-800 underline"
                            >
                              Haritada aç
                            </a>
                          ) : null}
                        </div>
                      ) : isVcardMessage(msg) ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                          <div className="text-xs text-gray-500">Kişi kartı</div>
                          <div className="text-sm font-semibold text-gray-800">
                            {msg.metadata?.contactName || 'Kişi'}
                          </div>
                          {msg.metadata?.contactPhone ? (
                            <div className="text-xs text-gray-600">{formatPhone(msg.metadata.contactPhone)}</div>
                          ) : null}
                        </div>
                      ) : msg.body && !isMediaTypeOnlyPlaceholder ? (
                        <div>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
                            {isDeletedMessage
                              ? 'Bu mesaj silindi'
                              : renderMessageBody(
                                  isLikelyEncodedPayload(msg.body) && !expandedMessages.has(msg.id)
                                    ? `${msg.body.slice(0, 420)}...`
                                    : msg.body,
                                )}
                          </p>
                          {isLikelyEncodedPayload(msg.body) && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMessages((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(msg.id)) next.delete(msg.id);
                                  else next.add(msg.id);
                                  return next;
                                })
                              }
                              className="mt-1 text-[11px] text-blue-600 hover:text-blue-800"
                            >
                              {expandedMessages.has(msg.id) ? 'Daha az göster' : 'Devamını göster'}
                            </button>
                          )}
                        </div>
                      ) : null}
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

        <div
          ref={composerWrapRef}
          className="sticky bottom-0 z-30"
          style={{ bottom: `${mobileKeyboardInset}px` }}
        >
        {/* File Preview */}
        {selectedFile && (
          <div className="bg-white border-t border-gray-200 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="relative flex-shrink-0">
                {filePreview && selectedFile.type.startsWith('image/') ? (
                  <img
                    src={filePreview}
                    alt=""
                    className="max-h-56 max-w-[min(280px,45vw)] w-auto h-auto object-contain rounded-xl border border-gray-200 bg-gray-50"
                  />
                ) : filePreview && selectedFile.type.startsWith('video/') ? (
                  <video
                    src={filePreview}
                    controls
                    className="max-h-56 max-w-[min(280px,45vw)] rounded-xl border border-gray-200 bg-black"
                  />
                ) : filePreview && selectedFile.type.startsWith('audio/') ? (
                  <div className="px-3 py-2 bg-gray-50 rounded-xl border border-gray-200 min-w-[240px]">
                    <audio src={filePreview} controls className="w-full" />
                  </div>
                ) : (
                  <div className="w-24 h-24 min-h-[120px] bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200">
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
            className="bg-white border-t border-gray-200 px-4 py-3 flex items-end gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
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
                  setContactPickerOpen(false);
                  setKartelaPickerOpen(false);
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
                        setKartelaPickerOpen(true);
                        setContactPickerOpen(false);
                        setProductPickerOpen(false);
                        setActionTrayOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-fuchsia-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-full bg-fuchsia-100 flex items-center justify-center group-hover:bg-fuchsia-200 transition-colors">
                        <ImageIcon className="w-5 h-5 text-fuchsia-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Kartela</span>
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
                        if (!moduleEnabled('quotes')) return;
                        setProductPickerOpen(true);
                        setContactPickerOpen(false);
                        setKartelaPickerOpen(false);
                        setActionTrayOpen(false);
                      }}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors group ${
                        moduleEnabled('quotes') ? 'hover:bg-orange-50' : 'opacity-40 cursor-not-allowed'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center group-hover:bg-orange-200 transition-colors">
                        <Package className="w-5 h-5 text-orange-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Ürün</span>
                    </button>
                    
                    {moduleEnabled('kartelas') && <button
                      type="button"
                      onClick={() => {
                        setContactPickerOpen(true);
                        setProductPickerOpen(false);
                        setKartelaPickerOpen(false);
                        setActionTrayOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-cyan-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center group-hover:bg-cyan-200 transition-colors">
                        <User className="w-5 h-5 text-cyan-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Kişi</span>
                    </button>}
                    
                    {moduleEnabled('templates') && <button
                      type="button"
                      onClick={() => {
                        void handleSendLocation();
                        setActionTrayOpen(false);
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-green-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-colors">
                        <MapPin className="w-5 h-5 text-green-600" />
                      </div>
                      <span className="text-xs text-gray-600 font-medium">Konum</span>
                    </button>}
                    
                    <button
                      type="button"
                      onClick={() => {
                        setShowTemplates(true);
                        setKartelaPickerOpen(false);
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
              {productPickerOpen && variantPickerFor && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden flex flex-col max-h-80">
                  <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setVariantPickerFor(null);
                        setVariantHits([]);
                      }}
                      className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-50"
                    >
                      ← Geri
                    </button>
                    <span className="text-sm font-medium text-gray-800 truncate flex-1">
                      {variantPickerFor.productName} — Varyant seç
                    </span>
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {variantLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="w-6 h-6 text-whatsapp animate-spin" />
                      </div>
                    ) : variantHits.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6 px-3">
                        Varyant bulunamadı
                      </p>
                    ) : (
                      variantHits.map((v, idx) => (
                        <button
                          key={v.id ?? `base-${idx}`}
                          type="button"
                          disabled={sending}
                          onClick={() => {
                            setSending(true);
                            sendProductShare({
                              conversationId: activeConversation.id,
                              productId: variantPickerFor.productId,
                              productVariantId: v.id ?? undefined,
                              sessionName: activeConversation.session?.name,
                              chatId: `${activeConversation.contact.phone}@c.us`,
                            })
                              .then(() => {
                                setProductPickerOpen(false);
                                setProductSearch('');
                                setVariantPickerFor(null);
                                setVariantHits([]);
                              })
                              .catch((err) => {
                                toast.error(getApiErrorMessage(err, 'Ürün gönderilemedi'));
                              })
                              .finally(() => setSending(false));
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 text-left disabled:opacity-50"
                        >
                          <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden shrink-0 border border-gray-100">
                            {v.imageUrl || variantPickerFor.productImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={rewriteMediaUrlForClient(
                                  (v.imageUrl || variantPickerFor.productImageUrl) as string,
                                )}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">—</div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{v.name}</p>
                            {v.property2?.trim() ? <p className="text-[11px] text-gray-500 mt-0.5 truncate">{v.property2.trim()}</p> : null}
                            <p className="text-[11px] text-gray-500 flex items-center gap-1 flex-wrap">
                              {v.salePriceAmount != null && v.salePriceAmount !== v.unitPrice ? (
                                <>
                                  <span className="text-green-600 font-semibold">
                                    {v.salePriceAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {displayCurrency(v.currency)}
                                  </span>
                                  <span className="line-through text-gray-400">
                                    {v.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                                  </span>
                                </>
                              ) : (
                                <span>
                                  {v.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {displayCurrency(v.currency)}
                                </span>
                              )}
                              {v.stock != null ? <span>• Stok: {v.stock}</span> : null}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
              {productPickerOpen && !variantPickerFor && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden flex flex-col max-h-72">
                  <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                    <Search className="w-4 h-4 text-gray-400 shrink-0" />
                    <input
                      type="search"
                      autoComplete="off"
                      placeholder="Tam ürün adı veya SKU (tam eşleşme)"
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
                          onClick={async () => {
                            // Önce varyantları yükle; varsa varyant seçim ekranına geç, yoksa direkt gönder.
                            setVariantLoading(true);
                            setVariantPickerFor({
                              productId: p.id,
                              productName: p.name,
                              productImageUrl: p.imageUrl ?? null,
                            });
                            try {
                              const { data } = await api.get(`/products/${p.id}/variants`);
                              const list = Array.isArray(data) ? data : [];
                              const hasReal = list.some((v: any) => v?.id);
                              if (hasReal) {
                                setVariantHits(
                                  list.map((v: any) => ({
                                    id: v.id ?? null,
                                    name: String(v.name ?? ''),
                                    imageUrl: v.imageUrl ?? null,
                                    unitPrice: Number(v.unitPrice ?? 0),
                                    salePriceAmount: v.salePriceAmount != null ? Number(v.salePriceAmount) : null,
                                    property2: v.property2 ? String(v.property2) : null,
                                    currency: String(v.currency ?? 'TRY'),
                                    stock: v.stock == null ? null : Number(v.stock),
                                  })),
                                );
                                setVariantLoading(false);
                                return;
                              }
                            } catch (e) {
                              // varyant çekilemedi — ana ürünü direkt gönder
                            }
                            setVariantLoading(false);
                            setVariantPickerFor(null);
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
                          <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0 border border-gray-100">
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
                            {productProperty2Text(p) ? (
                              <p className="text-[11px] text-gray-500 truncate">{productProperty2Text(p)}</p>
                            ) : null}
                            {p.category ? (
                              <p className="text-[11px] text-gray-400 truncate">{p.category}</p>
                            ) : null}
                            {p.salePriceAmount != null && p.salePriceAmount > 0 ? (
                              <p className="text-[11px] flex items-center gap-1">
                                <span className="text-green-600 font-semibold">
                                  {p.salePriceAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {displayCurrency(p.currency)}
                                </span>
                                <span className="text-gray-400 line-through">
                                  {p.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                                </span>
                              </p>
                            ) : p.unitPrice > 0 ? (
                              <p className="text-[11px] text-gray-500">
                                {p.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {displayCurrency(p.currency)}
                              </p>
                            ) : null}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
              {contactPickerOpen && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden flex flex-col max-h-72">
                  <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                    <Search className="w-4 h-4 text-gray-400 shrink-0" />
                    <input
                      type="search"
                      autoComplete="off"
                      placeholder="Kişi adı veya telefon..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      className="flex-1 min-w-0 text-sm py-1.5 px-1 border-0 focus:ring-0 focus:outline-none bg-transparent"
                    />
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {contactSearchLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="w-6 h-6 text-whatsapp animate-spin" />
                      </div>
                    ) : contactHits.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6 px-3">
                        En az 2 karakterle arayın
                      </p>
                    ) : (
                      contactHits.map((c) => {
                        const label = [c.name, c.surname].filter(Boolean).join(' ').trim() || formatPhone(c.phone);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={sending}
                            onClick={() => {
                              setSending(true);
                              sendContactCard({
                                conversationId: activeConversation.id,
                                sessionName: activeConversation.session?.name,
                                chatId: `${activeConversation.contact.phone}@c.us`,
                                contactName: label,
                                contactPhone: c.phone,
                              })
                                .then(() => {
                                  setContactPickerOpen(false);
                                  setContactSearch('');
                                })
                                .catch((err) => {
                                  toast.error(getApiErrorMessage(err, 'Kişi kartı gönderilemedi'));
                                })
                                .finally(() => setSending(false));
                            }}
                            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 text-left disabled:opacity-50"
                          >
                            <div>
                              <p className="text-sm font-medium text-gray-900">{label}</p>
                              <p className="text-[11px] text-gray-400">{formatPhone(c.phone)}</p>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
              {kartelaPickerOpen && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden flex flex-col max-h-[28rem]">
                  <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                    <Search className="w-4 h-4 text-gray-400 shrink-0" />
                    <input
                      type="search"
                      autoComplete="off"
                      placeholder="Kartela ara..."
                      value={kartelaSearch}
                      onChange={(e) => setKartelaSearch(e.target.value)}
                      className="flex-1 min-w-0 text-sm py-1.5 px-1 border-0 focus:ring-0 focus:outline-none bg-transparent"
                    />
                  </div>
                  <div className="overflow-y-auto flex-1 p-2">
                    {kartelaLoading ? (
                      <div className="flex justify-center py-10">
                        <Loader2 className="w-6 h-6 text-whatsapp animate-spin" />
                      </div>
                    ) : kartelaItems.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-10 px-3">
                        Kartela bulunamadi
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {kartelaItems.map((k) => {
                          const fullMediaUrl = `${backendPublicUrl()}${k.fileUrl}`;
                          const isPdf = String(k.mimeType || '').toLowerCase().includes('pdf');
                          return (
                            <button
                              key={k.id}
                              type="button"
                              disabled={sending}
                              onClick={() => {
                                setSending(true);
                                sendMediaMessage({
                                  conversationId: activeConversation.id,
                                  sessionName: activeConversation.session.name,
                                  chatId,
                                  mediaUrl: fullMediaUrl,
                                  caption: k.name || undefined,
                                  mediaTypeHint: isPdf ? 'DOCUMENT' : 'IMAGE',
                                })
                                  .then(() => {
                                    setKartelaPickerOpen(false);
                                    setKartelaSearch('');
                                  })
                                  .catch((err) => {
                                    toast.error(getApiErrorMessage(err, 'Kartela gonderilemedi'));
                                  })
                                  .finally(() => setSending(false));
                              }}
                              className="rounded-lg border border-gray-200 overflow-hidden bg-white hover:border-whatsapp/40 hover:shadow-sm transition-all text-left disabled:opacity-60"
                            >
                              <div className="aspect-[4/3] bg-gray-50 border-b border-gray-100 flex items-center justify-center">
                                {isPdf ? (
                                  <FileText className="w-8 h-8 text-gray-400" />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={fullMediaUrl} alt={k.name} className="w-full h-full object-cover" />
                                )}
                              </div>
                              <div className="p-2">
                                <p className="text-xs font-medium text-gray-800 line-clamp-2">{k.name}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
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
                      if (editingMessage) void handleEditMessage();
                      else if (replyingTo) void handleSendReply();
                      else submitComposer();
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
      </div>

      {/* Right Panel */}
      {showPanel && (
        <>
          <div className="hidden md:flex h-full">
            <ContactPanel
              key={activeConversation.id}
              conversationId={activeConversation.id}
              contact={contact}
              assignments={activeConversation.assignments}
              onClose={() => setShowPanel(false)}
              internalChatEnabled={internalChatEnabled}
              userRole={userRole}
              isGroup={!!activeConversation.isGroup}
              groupName={activeConversation.groupName ?? undefined}
              groupParticipantCount={activeConversation.groupParticipantCount ?? undefined}
            />
          </div>
          <div className="md:hidden fixed inset-0 z-[80] bg-white">
            <ContactPanel
              key={`${activeConversation.id}-mobile`}
              conversationId={activeConversation.id}
              contact={contact}
              assignments={activeConversation.assignments}
              onClose={() => setShowPanel(false)}
              internalChatEnabled={internalChatEnabled}
              userRole={userRole}
              isGroup={!!activeConversation.isGroup}
              groupName={activeConversation.groupName ?? undefined}
              groupParticipantCount={activeConversation.groupParticipantCount ?? undefined}
            />
          </div>
        </>
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
            <div
              data-lightbox-stage=""
              className="absolute inset-0 flex items-center justify-center p-4 pt-20 pointer-events-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxUrl}
                alt=""
                className="max-h-[calc(100vh-10rem)] max-w-[min(100vw-8rem,1100px)] w-auto h-auto object-contain rounded-lg shadow-2xl pointer-events-auto cursor-default"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>,
          document.body,
        )}
      {groupDetailOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl border border-gray-100 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Grup katılımcıları</h3>
                <p className="text-xs text-gray-500">
                  {activeConversation.groupName || contact.name || 'WhatsApp Grubu'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGroupDetailOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              {groupParticipantsLoading ? (
                <div className="py-10 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-whatsapp" />
                </div>
              ) : groupParticipants.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">Katılımcı bulunamadı</p>
              ) : (
                groupParticipants.map((p) => (
                  <div
                    key={p.jid}
                    className="px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">
                        {p.name || (p.phone ? formatPhone(p.phone) : p.jid)}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">{p.phone ? formatPhone(p.phone) : p.jid}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
                      {p.role === 'admin' ? 'Yönetici' : 'Üye'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Forward Message Modal ─── */}
      {forwardingMsg && mounted && createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Forward className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-semibold text-gray-900">Mesajı İlet</h2>
            </div>
            <button onClick={() => setForwardingMsg(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mesaj önizleme */}
          {forwardingMsg.body && (
            <div className="mx-5 mt-3 px-3 py-2 bg-gray-50 rounded-xl text-xs text-gray-500 border border-gray-200 line-clamp-2">
              {forwardingMsg.body}
            </div>
          )}

          {/* Arama */}
          <div className="px-5 py-3">
            <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="İsim, telefon veya grup adı ara..."
                value={forwardSearch}
                onChange={(e) => setForwardSearch(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400"
              />
            </div>
          </div>

          {/* Konuşma listesi */}
          <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-1">
            {forwardConvsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              </div>
            ) : forwardConvs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                {forwardSearch.trim() ? 'Eşleşen konuşma yok. Aramayı değiştirmeyi deneyin.' : 'Konuşma bulunamadı.'}
              </p>
            ) : (
              forwardConvs.map((c: any) => {
                const isGroup = !!c.isGroup;
                const title = isGroup
                  ? (c.groupName || c.contact?.name || 'WhatsApp Grubu')
                  : (getContactDisplayTitle(c.contact) ?? c.contact?.phone ?? 'İsimsiz');
                const phone = c.contact?.phone ?? '';
                const subline = isGroup
                  ? phone.includes('@g.us')
                    ? 'Grup'
                    : phone
                      ? formatPhone(phone)
                      : ''
                  : phone
                    ? formatPhone(phone)
                    : '';
                const isChecked = forwardSelected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      const next = new Set(forwardSelected);
                      if (isChecked) next.delete(c.id); else next.add(c.id);
                      setForwardSelected(next);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left ${isChecked ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isChecked ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300'}`}>
                      {isChecked && <Check className="w-3 h-3 text-white" />}
                    </div>
                    {isGroup ? (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4 text-white" />
                      </div>
                    ) : (
                      <ContactAvatar name={c.contact?.name} surname={c.contact?.surname} phone={c.contact?.phone} avatarUrl={c.contact?.avatarUrl} size="sm" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                        {isGroup && (
                          <span className="text-[10px] bg-green-100 text-green-700 px-1 py-0.5 rounded font-medium shrink-0">
                            Grup
                          </span>
                        )}
                        <span className="truncate">{title}</span>
                      </p>
                      {subline ? <p className="text-xs text-gray-400 truncate">{subline}</p> : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {forwardSelected.size > 0 ? `${forwardSelected.size} kişi seçildi` : 'Kişi seçin'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setForwardingMsg(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
              >
                İptal
              </button>
              <button
                onClick={handleForwardSend}
                disabled={forwardSelected.size === 0 || forwardSending}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {forwardSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Forward className="w-3.5 h-3.5" />}
                İlet
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    )}
    </div>
  );
}
