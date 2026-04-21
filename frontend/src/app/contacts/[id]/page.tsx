'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  MessageSquare,
  Pencil,
  Save,
  Loader2,
  User,
  Phone,
  Mail,
  Building2,
  MapPin,
  Globe,
  StickyNote,
  FileText,
  ShoppingCart,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';
import { LEAD_STATUSES, SOURCES } from '@/lib/constants';
import { useChatStore } from '@/store/chat';

type Assignment = {
  id: string;
  user: { id: string; name: string; avatar: string | null };
};

type Conv = {
  id: string;
  sessionId: string;
  lastMessageAt: string;
  lastMessageText: string | null;
  unreadCount: number;
  session: { id: string; name: string; phone: string | null; organizationId?: string | null };
  assignments: Assignment[];
};

type QuoteRow = {
  id: string;
  quoteNumber: number;
  status: string;
  grandTotal: number;
  currency: string;
  createdAt: string;
};

type OrderRow = {
  id: string;
  orderNumber: number;
  status: string;
  grandTotal: number;
  currency: string;
  createdAt: string;
};

type ContactDetail = {
  id: string;
  phone: string;
  name: string | null;
  surname: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  address: string | null;
  billingAddress: string | null;
  taxOffice: string | null;
  taxNumber: string | null;
  identityNumber: string | null;
  source: string | null;
  notes: string | null;
  tags: string[];
  avatarUrl: string | null;
  metadata?: unknown;
  lead: {
    id: string;
    status: string;
    value?: number | null;
    source?: string | null;
    notes?: string | null;
    lossReason?: string | null;
    closedAt?: string | null;
  } | null;
  conversations: Conv[];
  quotes?: QuoteRow[];
  orders?: OrderRow[];
};

function getMetaText(metadata: unknown, key: string): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('AGENT');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [editData, setEditData] = useState({
    name: '',
    surname: '',
    email: '',
    company: '',
    city: '',
    district: '',
    address: '',
    billingAddress: '',
    billingEmail: '',
    taxOffice: '',
    taxNumber: '',
    identityNumber: '',
    source: '',
    notes: '',
  });

  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPERADMIN';
  const primaryConv = contact?.conversations?.[0] ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ContactDetail>(`/contacts/${id}`);
      setContact(data);
      setEditData({
        name: data.name || '',
        surname: data.surname || '',
        email: data.email || '',
        company: data.company || '',
        city: data.city || '',
        district: getMetaText(data.metadata, 'district'),
        address: data.address || '',
        billingAddress: data.billingAddress || '',
        billingEmail: getMetaText(data.metadata, 'billingEmail'),
        taxOffice: data.taxOffice || '',
        taxNumber: data.taxNumber || '',
        identityNumber: data.identityNumber || '',
        source: data.source || '',
        notes: data.notes || '',
      });
    } catch {
      toast.error('Kişi yüklenemedi');
      setContact(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('user');
      if (raw) setUserRole(JSON.parse(raw).role || 'AGENT');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get('/users/agents')
      .then(({ data }) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, [isAdmin]);

  const handleSave = async () => {
    if (!contact) return;
    setSaving(true);
    try {
      await api.patch(`/contacts/${contact.id}`, editData);
      toast.success('Kişi güncellendi');
      setEditing(false);
      load();
    } catch {
      toast.error('Güncellenemedi');
    } finally {
      setSaving(false);
    }
  };

  const updateLeadStatus = async (status: string) => {
    if (!contact?.lead) return;
    let lossReason: string | undefined;
    if (status === 'LOST') {
      const r = window.prompt('Kayıp nedeni (zorunlu, en az 2 karakter):');
      if (r === null) return;
      if (r.trim().length < 2) {
        toast.error('Kayıp nedeni en az 2 karakter olmalı');
        return;
      }
      lossReason = r.trim();
    }
    try {
      await api.patch(`/leads/${contact.lead.id}/status`, { status, lossReason });
      toast.success('Durum güncellendi');
      load();
    } catch {
      toast.error('Güncellenemedi');
    }
  };

  const createLead = async () => {
    if (!contact) return;
    try {
      await api.post('/leads', { contactId: contact.id });
      toast.success('Potansiyel müşteri oluşturuldu');
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Oluşturulamadı');
    }
  };

  const assignAgent = async (userId: string) => {
    if (!primaryConv) {
      toast.error('Önce bir görüşme gerekli');
      return;
    }
    try {
      await api.post(`/conversations/${primaryConv.id}/assign`, { userId });
      toast.success('Görüşme atandı');
      load();
    } catch {
      toast.error('Atama başarısız');
    }
  };

  const goToInbox = async () => {
    if (!primaryConv) {
      toast.error('Bu kişi için henüz görüşme yok');
      return;
    }
    setOpeningChat(true);
    try {
      const { data } = await api.get(`/conversations/${primaryConv.id}`);
      useChatStore.getState().setActiveConversation(data);
      router.push('/inbox');
    } catch {
      toast.error('Görüşme açılamadı');
    } finally {
      setOpeningChat(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 text-whatsapp animate-spin" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="p-6">
        <Link href="/contacts" className="text-sm text-whatsapp hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" />
          Kişilere dön
        </Link>
        <p className="mt-4 text-gray-500">Kişi bulunamadı.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/contacts"
          className="text-sm text-gray-600 hover:text-whatsapp inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          Kişiler
        </Link>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={goToInbox}
            disabled={!primaryConv || openingChat}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-whatsapp text-white text-sm font-medium hover:opacity-95 disabled:opacity-50"
          >
            {openingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
            Mesajlara git
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex flex-wrap items-start gap-4">
          <ContactAvatar
            name={contact.name}
            surname={contact.surname}
            phone={contact.phone}
            avatarUrl={contact.avatarUrl}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {[contact.name, contact.surname].filter(Boolean).join(' ') || formatPhone(contact.phone)}
                </h1>
                <p className="text-sm text-gray-500 mt-0.5">{formatPhone(contact.phone)}</p>
                <div className="mt-2">
                  <EcommerceCustomerBadge metadata={contact.metadata} />
                </div>
              </div>
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                  title="Düzenle"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"
                  title="Kaydet"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3 text-sm">
              {editing ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs text-gray-500">Ad</span>
                      <input
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                        value={editData.name}
                        onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-gray-500">Soyad</span>
                      <input
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                        value={editData.surname}
                        onChange={(e) => setEditData((d) => ({ ...d, surname: e.target.value }))}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> İlçe
                      </span>
                      <input
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                        value={editData.district}
                        onChange={(e) => setEditData((d) => ({ ...d, district: e.target.value }))}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Mail className="w-3 h-3" /> E-posta
                    </span>
                    <input
                      type="email"
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                      value={editData.email}
                      onChange={(e) => setEditData((d) => ({ ...d, email: e.target.value }))}
                    />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> Şirket
                      </span>
                      <input
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                        value={editData.company}
                        onChange={(e) => setEditData((d) => ({ ...d, company: e.target.value }))}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Şehir
                      </span>
                      <input
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                        value={editData.city}
                        onChange={(e) => setEditData((d) => ({ ...d, city: e.target.value }))}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Açık adres
                    </span>
                    <textarea
                      rows={3}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg resize-y"
                      value={editData.address}
                      onChange={(e) => setEditData((d) => ({ ...d, address: e.target.value }))}
                    />
                  </label>
                  <p className="text-xs font-semibold text-gray-700 pt-1">Fatura / firma (PDF, muhasebe)</p>
                  <label className="block">
                    <span className="text-xs text-gray-500">Fatura adresi</span>
                    <textarea
                      rows={3}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg resize-y"
                      placeholder="Boşsa açık adres kullanılır"
                      value={editData.billingAddress}
                      onChange={(e) => setEditData((d) => ({ ...d, billingAddress: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">Fatura e-posta</span>
                    <input
                      type="email"
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                      placeholder="Boşsa kişi e-postası kullanılır"
                      value={editData.billingEmail}
                      onChange={(e) => setEditData((d) => ({ ...d, billingEmail: e.target.value }))}
                    />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="block">
                      <span className="text-xs text-gray-500">Vergi dairesi</span>
                      <input
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                        value={editData.taxOffice}
                        onChange={(e) => setEditData((d) => ({ ...d, taxOffice: e.target.value }))}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-gray-500">VKN</span>
                      <input
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                        value={editData.taxNumber}
                        onChange={(e) => setEditData((d) => ({ ...d, taxNumber: e.target.value }))}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-gray-500">TC Kimlik No</span>
                      <input
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                        value={editData.identityNumber}
                        onChange={(e) => setEditData((d) => ({ ...d, identityNumber: e.target.value }))}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Globe className="w-3 h-3" /> Kaynak
                    </span>
                    <select
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg bg-white"
                      value={editData.source}
                      onChange={(e) => setEditData((d) => ({ ...d, source: e.target.value }))}
                    >
                      <option value="">Seçin</option>
                      {SOURCES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <StickyNote className="w-3 h-3" /> Notlar
                    </span>
                    <textarea
                      rows={4}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg resize-y"
                      value={editData.notes}
                      onChange={(e) => setEditData((d) => ({ ...d, notes: e.target.value }))}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setEditData({
                        name: contact.name || '',
                        surname: contact.surname || '',
                        email: contact.email || '',
                        company: contact.company || '',
                        city: contact.city || '',
                        district: getMetaText(contact.metadata, 'district'),
                        address: contact.address || '',
                        billingAddress: contact.billingAddress || '',
                        billingEmail: getMetaText(contact.metadata, 'billingEmail'),
                        taxOffice: contact.taxOffice || '',
                        taxNumber: contact.taxNumber || '',
                        identityNumber: contact.identityNumber || '',
                        source: contact.source || '',
                        notes: contact.notes || '',
                      });
                    }}
                    className="text-sm text-gray-500 hover:text-gray-800"
                  >
                    İptal
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-4 h-4 text-gray-400" />
                    {formatPhone(contact.phone)}
                  </div>
                  {contact.email && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Mail className="w-4 h-4 text-gray-400" />
                      {contact.email}
                    </div>
                  )}
                  {(contact.company || contact.city || getMetaText(contact.metadata, 'district')) && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <User className="w-4 h-4 text-gray-400" />
                      {[contact.company, contact.city, getMetaText(contact.metadata, 'district')]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
                  {contact.address && (
                    <div className="flex items-start gap-2 text-gray-600">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <span className="whitespace-pre-wrap">{contact.address}</span>
                    </div>
                  )}
                  {(contact.billingAddress ||
                    getMetaText(contact.metadata, 'billingEmail') ||
                    contact.taxOffice ||
                    contact.taxNumber ||
                    contact.identityNumber) && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3 space-y-1.5 text-sm">
                      <p className="text-xs font-semibold text-amber-900 uppercase">Fatura / firma</p>
                      {contact.billingAddress && (
                        <p className="text-gray-700 whitespace-pre-wrap">
                          <span className="text-gray-500">Fatura adresi: </span>
                          {contact.billingAddress}
                        </p>
                      )}
                      {getMetaText(contact.metadata, 'billingEmail') && (
                        <p className="text-gray-700">
                          <span className="text-gray-500">Fatura e-posta: </span>
                          {getMetaText(contact.metadata, 'billingEmail')}
                        </p>
                      )}
                      {contact.taxOffice && (
                        <p className="text-gray-700">
                          <span className="text-gray-500">VD: </span>
                          {contact.taxOffice}
                        </p>
                      )}
                      {contact.taxNumber && (
                        <p className="text-gray-700">
                          <span className="text-gray-500">VKN: </span>
                          {contact.taxNumber}
                        </p>
                      )}
                      {contact.identityNumber && (
                        <p className="text-gray-700">
                          <span className="text-gray-500">TC: </span>
                          {contact.identityNumber}
                        </p>
                      )}
                    </div>
                  )}
                  {contact.source && (
                    <span className="inline-block text-xs bg-purple-50 text-purple-600 px-2 py-1 rounded-full">
                      {contact.source}
                    </span>
                  )}
                  {contact.notes && (
                    <p className="text-gray-600 whitespace-pre-wrap border-t border-gray-50 pt-3">{contact.notes}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4 border-b border-gray-100 bg-gray-50/40">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Potansiyel müşteri</h2>
          {contact.lead ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-600">
                  Durum:
                  <select
                    className="ml-2 px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm"
                    value={contact.lead.status}
                    onChange={(e) => updateLeadStatus(e.target.value)}
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Link href="/leads" className="text-sm text-whatsapp hover:underline">
                  Huniye git
                </Link>
              </div>
              {contact.lead.status === 'LOST' && contact.lead.lossReason && (
                <div className="rounded-xl border border-red-100 bg-red-50/70 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-red-800">Kayıp nedeni</p>
                      <p className="text-red-700 whitespace-pre-wrap mt-1">{contact.lead.lossReason}</p>
                      {contact.lead.closedAt && (
                        <p className="text-red-400 text-xs mt-1">
                          {new Date(contact.lead.closedAt).toLocaleDateString('tr-TR')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {contact.lead.notes && (
                <p className="text-sm text-gray-600 border-t border-gray-100 pt-2">
                  <span className="text-gray-400 text-xs uppercase font-semibold">Lead notu:</span>{' '}
                  {contact.lead.notes}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={createLead}
              className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Potansiyel müşteri olarak işaretle
            </button>
          )}
        </div>

        {(primaryConv || isAdmin) && (
          <div className="p-6 space-y-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              Görüşme
            </h2>
            {primaryConv ? (
              <>
                <p className="text-sm text-gray-600">
                  Oturum: <span className="font-medium">{primaryConv.session?.name || '—'}</span>
                  {primaryConv.assignments?.[0] && (
                    <span className="ml-2 text-xs text-blue-600">
                      Atanan: {primaryConv.assignments[0].user.name}
                    </span>
                  )}
                </p>
                {primaryConv.lastMessageAt && (
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Son mesaj: {new Date(primaryConv.lastMessageAt).toLocaleDateString('tr-TR')}{' '}
                    {new Date(primaryConv.lastMessageAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
                {isAdmin && agents.length > 0 && (
                  <label className="block text-sm text-gray-600 max-w-md">
                    Temsilci ata
                    <select
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg bg-white"
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) assignAgent(v);
                        e.target.value = '';
                      }}
                    >
                      <option value="">Seçin…</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">Bu kişi için henüz görüşme kaydı yok.</p>
            )}
          </div>
        )}

        {/* Teklifler */}
        <div className="p-6 space-y-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" />
            Teklifler
            {(contact.quotes?.length ?? 0) > 0 && (
              <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                {contact.quotes!.length}
              </span>
            )}
          </h2>
          {contact.quotes && contact.quotes.length > 0 ? (
            <div className="space-y-2">
              {contact.quotes.map((q) => (
                <Link
                  key={q.id}
                  href={`/quotes/${q.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-white border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-800">#{q.quoteNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      q.status === 'ACCEPTED' ? 'bg-green-50 text-green-700'
                        : q.status === 'REJECTED' ? 'bg-red-50 text-red-600'
                        : q.status === 'SENT' ? 'bg-blue-50 text-blue-600'
                        : 'bg-gray-50 text-gray-600'
                    }`}>
                      {q.status === 'DRAFT' ? 'Taslak' : q.status === 'SENT' ? 'Gönderildi'
                        : q.status === 'ACCEPTED' ? 'Kabul' : q.status === 'REJECTED' ? 'Red'
                        : q.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {q.grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {q.currency}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(q.createdAt).toLocaleDateString('tr-TR')}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Bu kişiye henüz teklif gönderilmemiş.</p>
          )}
        </div>

        {/* Siparişler */}
        <div className="p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-gray-400" />
            Siparişler
            {(contact.orders?.length ?? 0) > 0 && (
              <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">
                {contact.orders!.length}
              </span>
            )}
          </h2>
          {contact.orders && contact.orders.length > 0 ? (
            <div className="space-y-2">
              {contact.orders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-white border border-gray-100 hover:border-green-200 hover:bg-green-50/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-800">#{o.orderNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      o.status === 'COMPLETED' ? 'bg-green-50 text-green-700'
                        : o.status === 'CANCELLED' ? 'bg-red-50 text-red-600'
                        : o.status === 'PREPARING' ? 'bg-yellow-50 text-yellow-700'
                        : o.status === 'SHIPPED' ? 'bg-blue-50 text-blue-600'
                        : o.status === 'AWAITING_CHECKOUT' ? 'bg-orange-50 text-orange-600'
                        : 'bg-gray-50 text-gray-600'
                    }`}>
                      {o.status === 'AWAITING_PAYMENT' ? 'Ödeme Bekl.'
                        : o.status === 'AWAITING_CHECKOUT' ? 'Sepet Terk'
                        : o.status === 'PREPARING' ? 'Hazırlanıyor'
                        : o.status === 'SHIPPED' ? 'Kargoda'
                        : o.status === 'COMPLETED' ? 'Tamamlandı'
                        : o.status === 'CANCELLED' ? 'İptal' : o.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {o.grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {o.currency}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(o.createdAt).toLocaleDateString('tr-TR')}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Bu kişinin henüz siparişi yok.</p>
          )}
        </div>
      </div>
    </div>
  );
}
