'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import { phoneToWhatsappChatId } from '@/lib/utils';
import { Loader2, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';

type Conv = {
  id: string;
  session: { name: string };
  contact: { phone: string };
};

type Msg = {
  id: string;
  direction: string;
  body: string | null;
  timestamp: string;
};

export function QuoteEmbeddedChat({
  contactId,
  contactPhone,
}: {
  contactId: string;
  contactPhone: string;
}) {
  const [conv, setConv] = useState<Conv | null>(null);
  const [noConv, setNoConv] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/conversations/for-contact/${contactId}`);
      if (!data?.id) {
        setConv(null);
        setNoConv(true);
        setMessages([]);
        return;
      }
      setNoConv(false);
      setConv({
        id: data.id,
        session: data.session,
        contact: data.contact,
      });
      const msgRes = await api.get(`/messages/conversation/${data.id}`, { params: { limit: 80 } });
      setMessages(msgRes.data.messages || []);
    } catch {
      setConv(null);
      setNoConv(true);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const t = text.trim();
    if (!t || !conv || sending) return;
    const chatId =
      phoneToWhatsappChatId(contactPhone) ||
      `${String(contactPhone).replace(/\D/g, '')}@c.us`;
    setSending(true);
    setText('');
    try {
      const { data } = await api.post('/messages/send', {
        conversationId: conv.id,
        sessionName: conv.session.name,
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

  if (noConv || !conv) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4 text-center text-xs text-gray-500">
        <MessageCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        Bu kişiyle henüz bir WhatsApp görüşmesi yok. Gelen kutusundan yazışmaya başlayın.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[min(420px,50vh)] rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[92%] rounded-lg px-2.5 py-1.5 ${
              m.direction === 'OUTGOING'
                ? 'ml-auto bg-green-100 text-gray-900'
                : 'mr-auto bg-gray-100 text-gray-800'
            }`}
          >
            <p className="whitespace-pre-wrap break-words">{m.body || ''}</p>
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
