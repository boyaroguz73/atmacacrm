'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone, phoneToWhatsappChatId, rewriteMediaUrlForClient } from '@/lib/utils';
import { Loader2, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';

type ConvOption = {
  id: string;
  lastMessageAt: string;
  lastMessagePreview?: string | null;
  isGroup: boolean;
  waGroupId: string | null;
  groupName: string | null;
  session: { id: string; name: string; phone: string };
  contactPhone: string;
};

type Msg = {
  id: string;
  direction: string;
  body: string | null;
  mediaType?: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  timestamp: string;
};

function sessionLabel(c: ConvOption, index: number): string {
  const recent = index === 0 ? 'En son konuşulan · ' : '';
  if (c.isGroup) {
    const title = c.groupName?.trim() || c.waGroupId || 'WhatsApp grubu';
    return `${recent}Grup: ${title}`;
  }
  const num = c.session.phone ? formatPhone(c.session.phone) : formatPhone(c.contactPhone);
  const sess = c.session.name?.trim() || 'Oturum';
  return `${recent}${num} · ${sess}`;
}

export function QuoteEmbeddedChat({
  contactId,
  contactPhone,
}: {
  contactId: string;
  contactPhone: string;
}) {
  const [options, setOptions] = useState<ConvOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [noConv, setNoConv] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === selectedId) ?? null;

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ conversations?: ConvOption[] }>(
        `/conversations/for-contact/${contactId}/list`,
      );
      const list = Array.isArray(data?.conversations) ? data.conversations : [];
      setOptions(list);
      if (list.length === 0) {
        setSelectedId(null);
        setNoConv(true);
        setMessages([]);
        return;
      }
      setNoConv(false);
      setSelectedId(list[0].id);
    } catch {
      setOptions([]);
      setSelectedId(null);
      setNoConv(true);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      setMessagesLoading(true);
      try {
        const msgRes = await api.get(`/messages/conversation/${conversationId}`, {
          params: { limit: 80 },
        });
        setMessages(msgRes.data.messages || []);
      } catch {
        setMessages([]);
      } finally {
        setMessagesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const t = text.trim();
    if (!t || !selected || sending) return;
    const chatId =
      selected.isGroup && selected.waGroupId
        ? selected.waGroupId
        : phoneToWhatsappChatId(contactPhone) ||
          `${String(contactPhone).replace(/\D/g, '')}@c.us`;
    setSending(true);
    setText('');
    try {
      const { data } = await api.post('/messages/send', {
        conversationId: selected.id,
        sessionName: selected.session.name,
        chatId,
        body: t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t,
      });
      setMessages((m) => [...m, data]);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Mesaj gönderilemedi'));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (noConv || !selectedId || !selected) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4 text-center text-xs text-gray-500">
        <MessageCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        Bu kişiyle henüz bir WhatsApp görüşmesi yok. Gelen kutusundan yazışmaya başlayın.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[min(420px,50vh)] rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      {options.length > 1 ? (
        <div className="px-2.5 pt-2.5 pb-1 border-b border-gray-100 bg-gray-50/80">
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Hangi hat / oturum?
          </label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-whatsapp/25 focus:border-whatsapp"
          >
            {options.map((c, idx) => (
              <option key={c.id} value={c.id}>
                {sessionLabel(c, idx)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="px-2.5 pt-2 pb-1 border-b border-gray-100 bg-gray-50/50">
          <p className="text-[10px] text-gray-500 leading-snug">
            <span className="font-semibold text-gray-600">Sohbet:</span>{' '}
            {sessionLabel(selected, 0).replace(/^En son konuşulan · /, '')}
          </p>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs relative min-h-[120px]">
        {messagesLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-[1]">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[92%] rounded-lg px-2.5 py-1.5 ${
              m.direction === 'OUTGOING'
                ? 'ml-auto bg-green-100 text-gray-900'
                : 'mr-auto bg-gray-100 text-gray-800'
            }`}
          >
            {m.mediaUrl && m.mediaType === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={rewriteMediaUrlForClient(m.mediaUrl)}
                alt=""
                className="max-h-44 w-auto rounded-md object-contain mb-1"
              />
            ) : null}
            {m.mediaUrl && m.mediaType === 'VIDEO' ? (
              <video
                controls
                playsInline
                preload="metadata"
                className="max-h-44 w-auto rounded-md bg-black mb-1"
              >
                <source
                  src={rewriteMediaUrlForClient(m.mediaUrl)}
                  type={m.mediaMimeType || 'video/mp4'}
                />
              </video>
            ) : null}
            {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
            <p className="text-[9px] text-gray-400 mt-0.5">
              {new Date(m.timestamp).toLocaleTimeString('tr-TR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="border-t border-gray-100 p-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Mesaj yazın…"
          className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
        />
        <button
          type="button"
          disabled={sending || !text.trim()}
          onClick={() => void send()}
          className="px-3 py-1.5 rounded-lg bg-whatsapp text-white text-xs font-medium disabled:opacity-50 shrink-0"
        >
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Gönder'}
        </button>
      </div>
    </div>
  );
}
