'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import {
  Search,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  UserPlus,
  MessageSquare,
  Loader2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useChatStore } from '@/store/chat';
import DateRangePicker from '@/components/ui/DateRangePicker';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';
import { LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '@/lib/constants';

type LeadStatus = 'NEW' | 'CONTACTED' | 'INTERESTED' | 'OFFER_SENT' | 'WON' | 'LOST';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  surname: string | null;
  avatarUrl: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  source: string | null;
  metadata?: unknown;
  lead: { id: string; status: string } | null;
  createdAt: string;
}

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [refreshingAvatars, setRefreshingAvatars] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [showLeadFields, setShowLeadFields] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; name: string; status: string }[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [form, setForm] = useState({
    phone: '',
    name: '',
    surname: '',
    email: '',
    city: '',
    district: '',
    notes: '',
    address: '',
    billingAddress: '',
    billingEmail: '',
    source: '',
    openChat: true,
    sessionId: '',
    organizationId: '',
    leadStatus: 'NEW' as LeadStatus,
    leadValue: '',
    leadSource: '',
    leadNotes: '',
  });

  const loadSessionsForModal = async () => {
    try {
      const { data } = await api.get('/sessions');
      const list = Array.isArray(data) ? data : [];
      setSessions(
        list
          .filter((s: { status?: string }) => s.status === 'WORKING')
          .map((s: { id: string; name: string; status: string }) => ({
            id: s.id,
            name: s.name,
            status: s.status,
          })),
      );
    } catch {
      setSessions([]);
    }
  };

  const openCreateModal = () => {
    try {
      const raw = localStorage.getItem('user');
      if (raw) setUserRole(JSON.parse(raw).role ?? null);
    } catch {
      setUserRole(null);
    }
    setForm({
      phone: '',
      name: '',
      surname: '',
      email: '',
      city: '',
      district: '',
      notes: '',
      address: '',
      billingAddress: '',
      billingEmail: '',
      source: '',
      openChat: true,
      sessionId: '',
      organizationId: '',
      leadStatus: 'NEW',
      leadValue: '',
      leadSource: '',
      leadNotes: '',
    });
    setShowLeadFields(false);
    setCreateOpen(true);
    loadSessionsForModal();
  };

  const submitCreate = async (opts?: { forceOpenChat?: boolean }) => {
    const openChat = opts?.forceOpenChat ?? form.openChat;
    if (!form.phone.trim()) {
      toast.error('Telefon numarası gerekli');
      return;
    }
    if (userRole === 'SUPERADMIN' && !form.organizationId.trim()) {
      toast.error('Organizasyon ID gerekli');
      return;
    }
    setCreateSubmitting(true);
    try {
      const { data } = await api.post('/contacts', {
        phone: form.phone.trim(),
        name: form.name.trim() || undefined,
        surname: form.surname.trim() || undefined,
        email: form.email.trim() || undefined,
        city: form.city.trim() || undefined,
        district: form.district.trim() || undefined,
        notes: form.notes.trim() || undefined,
        address: form.address.trim() || undefined,
        billingAddress: form.billingAddress.trim() || undefined,
        billingEmail: form.billingEmail.trim() || undefined,
        source: form.source.trim() || undefined,
        openChat,
        sessionId: form.sessionId || undefined,
        organizationId:
          userRole === 'SUPERADMIN' ? form.organizationId.trim() : undefined,
        lead: showLeadFields
          ? {
              status: form.leadStatus || 'NEW',
              value: form.leadValue.trim() ? Number(form.leadValue) : undefined,
              source: form.leadSource.trim() || undefined,
              notes: form.leadNotes.trim() || undefined,
            }
          : undefined,
      });

      toast.success('Kişi kaydedildi');
      setCreateOpen(false);
      fetchContacts(search, page);

      if (data.conversation) {
        useChatStore.getState().setListFilter(undefined);
        useChatStore.getState().setActiveConversation(data.conversation);
        useChatStore.getState().fetchConversations(true);
        router.push('/inbox');
      } else if (openChat) {
        toast('Çalışan WhatsApp oturumu yok; kişi kaydı tamam, sohbet açılamadı', {
          icon: 'ℹ️',
        });
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Kayıt başarısız');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const fetchContacts = async (q?: string, p?: number) => {
    setLoading(true);
    try {
      const params: any = { page: p ?? page, limit: perPage };
      if (q) params.search = q;
      if (dateFrom) params.from = dateFrom + 'T00:00:00';
      if (dateTo) params.to = dateTo + 'T23:59:59';
      const { data } = await api.get('/contacts', { params });
      setContacts(data.contacts);
      setTotal(data.total);
      setTotalPages(data.totalPages || 1);
    } catch (error) {
      console.error(error);
      toast.error('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    fetchContacts(search, 1);
  }, [dateFrom, dateTo, perPage]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchContacts(search, 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchContacts(search, page);
  }, [page]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kişiler</h1>
          <p className="text-gray-500 text-sm mt-1">
            Toplam {total} kişi{totalPages > 1 ? ` · Sayfa ${page}/${totalPages}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-whatsapp text-white rounded-xl text-sm font-medium hover:opacity-95 shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Yeni kişi
          </button>
          <button
            onClick={async () => {
              setRefreshingAvatars(true);
              try {
                const { data } = await api.post('/contacts/refresh-all-avatars');
                toast.success(`${data.updated} kişinin fotoğrafı güncellendi`);
                fetchContacts(search);
              } catch {
                toast.error('Fotoğraflar güncellenemedi');
              } finally {
                setRefreshingAvatars(false);
              }
            }}
            disabled={refreshingAvatars}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            title="Profil fotoğraflarını güncelle"
          >
            <RefreshCw className={`w-4 h-4 ${refreshingAvatars ? 'animate-spin' : ''}`} />
            {refreshingAvatars ? 'Güncelleniyor...' : 'Fotoğrafları Güncelle'}
          </button>
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onChange={(f, t) => {
              setDateFrom(f);
              setDateTo(t);
            }}
          />
        </div>
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          role="presentation"
          onClick={() => !createSubmitting && setCreateOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto border border-gray-100"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="create-contact-title"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 id="create-contact-title" className="text-lg font-bold text-gray-900">
                Yeni kişi kaydı
              </h2>
              <button
                type="button"
                disabled={createSubmitting}
                onClick={() => setCreateOpen(false)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {userRole === 'SUPERADMIN' && (
                <label className="block text-sm">
                  <span className="text-gray-600 font-medium">Organizasyon ID</span>
                  <input
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                    value={form.organizationId}
                    onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))}
                    placeholder="UUID"
                  />
                </label>
              )}
              <label className="block text-sm">
                <span className="text-gray-600 font-medium">Telefon *</span>
                <input
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="Örn. 0555 123 45 67"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  <span className="text-gray-600 font-medium">Ad</span>
                  <input
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-600 font-medium">Soyad</span>
                  <input
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                    value={form.surname}
                    onChange={(e) => setForm((f) => ({ ...f, surname: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-gray-600 font-medium">E-posta</span>
                <input
                  type="email"
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  <span className="text-gray-600 font-medium">İl</span>
                  <input
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-600 font-medium">İlçe</span>
                  <input
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                    value={form.district}
                    onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-gray-600 font-medium">Açık adres</span>
                <textarea
                  rows={2}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-y"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 font-medium">Fatura e-posta</span>
                <input
                  type="email"
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                  value={form.billingEmail}
                  onChange={(e) => setForm((f) => ({ ...f, billingEmail: e.target.value }))}
                  placeholder="Boşsa kişi e-postası kullanılır"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 font-medium">Fatura adresi</span>
                <textarea
                  rows={2}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-y"
                  value={form.billingAddress}
                  onChange={(e) => setForm((f) => ({ ...f, billingAddress: e.target.value }))}
                  placeholder="Boşsa açık adres kullanılır"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 font-medium">Kaynak</span>
                <input
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                  placeholder="Opsiyonel"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 font-medium">Not</span>
                <textarea
                  rows={2}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-y"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showLeadFields}
                  onChange={(e) => setShowLeadFields(e.target.checked)}
                  className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp"
                />
                Bu kişi için lead kaydı da oluştur
              </label>
              {showLeadFields && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-sm">
                      <span className="text-gray-600 font-medium">Lead durumu</span>
                      <select
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
                        value={form.leadStatus}
                        onChange={(e) => setForm((f) => ({ ...f, leadStatus: e.target.value as LeadStatus }))}
                      >
                        <option value="NEW">Yeni</option>
                        <option value="CONTACTED">İletişim kuruldu</option>
                        <option value="INTERESTED">İlgileniyor</option>
                        <option value="OFFER_SENT">Teklif gönderildi</option>
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="text-gray-600 font-medium">Potansiyel değer</span>
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                        value={form.leadValue}
                        onChange={(e) => setForm((f) => ({ ...f, leadValue: e.target.value }))}
                        placeholder="Opsiyonel"
                      />
                    </label>
                  </div>
                  <label className="block text-sm">
                    <span className="text-gray-600 font-medium">Lead kaynağı</span>
                    <input
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                      value={form.leadSource}
                      onChange={(e) => setForm((f) => ({ ...f, leadSource: e.target.value }))}
                      placeholder="Örn. WhatsApp, Web Form"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-600 font-medium">Lead notu</span>
                    <textarea
                      rows={2}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-y"
                      value={form.leadNotes}
                      onChange={(e) => setForm((f) => ({ ...f, leadNotes: e.target.value }))}
                    />
                  </label>
                </div>
              )}
              {sessions.length > 0 && (
                <label className="block text-sm">
                  <span className="text-gray-600 font-medium">WhatsApp oturumu (sohbet için)</span>
                  <select
                    className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
                    value={form.sessionId}
                    onChange={(e) => setForm((f) => ({ ...f, sessionId: e.target.value }))}
                  >
                    <option value="">Varsayılan (en son aktif)</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {sessions.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Çalışan WhatsApp oturumu yok. Kişi yine de kaydedilir; sohbet açmak için oturumu bağlayın.
                </p>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.openChat}
                  onChange={(e) => setForm((f) => ({ ...f, openChat: e.target.checked }))}
                  className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp"
                />
                Kayıttan sonra gelen kutusunda sohbeti aç
              </label>
            </div>
            <div className="flex flex-wrap gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                type="button"
                disabled={createSubmitting}
                onClick={() => submitCreate()}
                className="flex-1 min-w-[120px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-300 disabled:opacity-50"
              >
                {createSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Kaydet
              </button>
              <button
                type="button"
                disabled={createSubmitting || sessions.length === 0}
                onClick={() => submitCreate({ forceOpenChat: true })}
                className="flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-medium hover:opacity-95 disabled:opacity-50"
              >
                <MessageSquare className="w-4 h-4" />
                Kaydet ve mesaj gönder
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="İsim, telefon veya e-posta ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Kişi</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Telefon</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Kaynak</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Not</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Durum</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Tarih</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">
                  <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                  Kişi bulunamadı
                </td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr
                  key={contact.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/contacts/${contact.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(`/contacts/${contact.id}`);
                    }
                  }}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ContactAvatar
                        name={contact.name}
                        surname={contact.surname}
                        phone={contact.phone}
                        avatarUrl={contact.avatarUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm text-gray-900">
                            {[contact.name, contact.surname].filter(Boolean).join(' ') || 'İsimsiz'}
                          </p>
                          <EcommerceCustomerBadge metadata={contact.metadata} />
                        </div>
                        {contact.email && (
                          <p className="text-xs text-gray-400">{contact.email}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">
                    {formatPhone(contact.phone)}
                  </td>
                  <td className="px-5 py-3">
                    {contact.source ? (
                      <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium">
                        {contact.source}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {contact.notes ? (
                      <span className="text-xs text-gray-600 line-clamp-2" title={contact.notes}>
                        {contact.notes}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {contact.lead ? (
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${LEAD_STATUS_COLORS[contact.lead.status] || 'bg-gray-100 text-gray-600'}`}>
                        {LEAD_STATUS_LABELS[contact.lead.status] || contact.lead.status}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {new Date(contact.createdAt).toLocaleDateString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-3">
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/30">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>Sayfa başına:</span>
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:border-whatsapp"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="ml-2">
                {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} / {total}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="İlk sayfa"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Önceki sayfa"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | string)[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, i) =>
                  item === '...' ? (
                    <span key={`dots-${i}`} className="px-1 text-gray-400 text-sm">…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => setPage(item as number)}
                      className={`min-w-[32px] h-8 rounded-lg text-sm font-medium transition-colors ${
                        page === item
                          ? 'bg-whatsapp text-white'
                          : 'hover:bg-gray-200 text-gray-600'
                      }`}
                    >
                      {item}
                    </button>
                  ),
                )}

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Sonraki sayfa"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Son sayfa"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
