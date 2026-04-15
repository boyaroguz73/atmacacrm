'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import {
  X,
  User,
  Phone,
  Mail,
  Building2,
  MapPin,
  Tag,
  Globe,
  Target,
  StickyNote,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Save,
  Pencil,
  MessageSquare,
  Send,
  Store,
    Loader2,
    ClipboardList,
  } from 'lucide-react';
import toast from 'react-hot-toast';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, SOURCES } from '@/lib/constants';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';
import { getEcommerceCustomerLabel } from '@/lib/ecommerceBadge';

interface ContactPanelProps {
  conversationId: string;
  contact: any;
  assignments: any[];
  onClose: () => void;
  internalChatEnabled: boolean;
  userRole?: string;
}

export default function ContactPanel({
  conversationId,
  contact: initialContact,
  assignments,
  onClose,
  internalChatEnabled,
  userRole = 'AGENT',
}: ContactPanelProps) {
  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPERADMIN';
  const [contact, setContact] = useState(initialContact);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: '',
    surname: '',
    email: '',
    company: '',
    city: '',
    source: '',
    notes: '',
  });

  const [lead, setLead] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [noteText, setNoteText] = useState('');

  const [openSections, setOpenSections] = useState({
    info: true,
    lead: true,
    actions: true,
    notes: true,
  });

  const [ecommerceStatus, setEcommerceStatus] = useState<{
    canPushCustomer?: boolean;
  } | null>(null);
  const [tsoftOpen, setTsoftOpen] = useState(false);
  const [tsoftSubmitting, setTsoftSubmitting] = useState(false);
  const [tsoftForm, setTsoftForm] = useState({
    name: '',
    surname: '',
    email: '',
    password: '',
    address: '',
    countryCode: 'TR',
    cityCode: '',
    districtCode: '',
    company: '',
  });

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchContact = useCallback(async () => {
    try {
      const { data } = await api.get(`/contacts/${initialContact.id}`);
      setContact(data);
      setLead(data.lead || null);
    } catch {
      /* ignore */
    }
  }, [initialContact.id]);

  const fetchAgents = useCallback(async () => {
    try {
      const { data } = await api.get('/users/agents');
      setAgents(data);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchNotes = useCallback(async () => {
    if (!internalChatEnabled) return;
    try {
      const { data } = await api.get(`/conversations/${conversationId}/notes`);
      setNotes(data);
    } catch {
      /* ignore */
    }
  }, [conversationId, internalChatEnabled]);

  useEffect(() => {
    fetchContact();
    fetchAgents();
    fetchNotes();
  }, [fetchContact, fetchAgents, fetchNotes]);

  useEffect(() => {
    api
      .get('/ecommerce/status')
      .then(({ data }) => setEcommerceStatus(data))
      .catch(() => setEcommerceStatus(null));
  }, []);

  const openTsoftModal = () => {
    setTsoftForm({
      name: contact.name || '',
      surname: contact.surname || '',
      email: contact.email || '',
      password: '',
      address: '',
      countryCode: 'TR',
      cityCode: contact.city || '',
      districtCode: '',
      company: contact.company || '',
    });
    setTsoftOpen(true);
  };

  const submitTsoftCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tsoftForm.email.trim() || tsoftForm.password.length < 8) {
      toast.error('E-posta ve en az 8 karakter şifre gerekli');
      return;
    }
    setTsoftSubmitting(true);
    try {
      await api.post(`/ecommerce/tsoft/contacts/${contact.id}/customer`, {
        email: tsoftForm.email.trim(),
        password: tsoftForm.password,
        name: tsoftForm.name.trim() || 'Müşteri',
        surname: tsoftForm.surname.trim() || '—',
        address: tsoftForm.address.trim() || undefined,
        countryCode: tsoftForm.countryCode.trim() || 'TR',
        cityCode: tsoftForm.cityCode.trim() || undefined,
        districtCode: tsoftForm.districtCode.trim() || undefined,
        company: tsoftForm.company.trim() || undefined,
      });
      toast.success('T-Soft müşterisi oluşturuldu');
      setTsoftOpen(false);
      fetchContact();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'İşlem başarısız');
    } finally {
      setTsoftSubmitting(false);
    }
  };

  const ecommerceLinked = !!getEcommerceCustomerLabel(contact.metadata);
  const canTsoftCreate =
    ecommerceStatus?.canPushCustomer &&
    !ecommerceLinked &&
    (userRole === 'ADMIN' || userRole === 'AGENT');

  const startEdit = () => {
    setEditData({
      name: contact.name || '',
      surname: contact.surname || '',
      email: contact.email || '',
      company: contact.company || '',
      city: contact.city || '',
      source: contact.source || '',
      notes: contact.notes || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    try {
      await api.patch(`/contacts/${contact.id}`, editData);
      toast.success('Kişi güncellendi');
      setEditing(false);
      fetchContact();
    } catch {
      toast.error('Güncellenemedi');
    }
  };

  const handleSourceChange = async (source: string) => {
    try {
      await api.patch(`/contacts/${contact.id}`, { source });
      toast.success('Kaynak güncellendi');
      fetchContact();
    } catch {
      toast.error('Güncellenemedi');
    }
  };

  const createLead = async () => {
    try {
      const { data } = await api.post('/leads', { contactId: contact.id });
      setLead(data);
      toast.success('Potansiyel müşteri olarak işaretlendi');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Potansiyel müşteri oluşturulamadı');
    }
  };

  const updateLeadStatus = async (status: string) => {
    if (!lead) return;
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
      await api.patch(`/leads/${lead.id}/status`, { status, lossReason });
      toast.success('Durum güncellendi');
      fetchContact();
    } catch {
      toast.error('Güncellenemedi');
    }
  };

  const assignAgent = async (userId: string) => {
    try {
      await api.post(`/conversations/${conversationId}/assign`, { userId });
      toast.success('Görüşme atandı');
    } catch {
      toast.error('Atama başarısız');
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    try {
      await api.post(`/conversations/${conversationId}/notes`, {
        body: noteText,
      });
      setNoteText('');
      fetchNotes();
    } catch {
      toast.error('Not eklenemedi');
    }
  };

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-900">Kişi Bilgileri</span>
        </div>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Contact Info */}
        <div className="border-b border-gray-50">
          <button
            onClick={() => toggleSection('info')}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50"
          >
            Kişi Detayları
            {openSections.info ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {openSections.info && (
            <div className="px-4 pb-4">
              {/* Avatar */}
              <div className="flex items-center gap-3 mb-4">
                <ContactAvatar
                  name={contact.name}
                  surname={contact.surname}
                  phone={contact.phone}
                  avatarUrl={contact.avatarUrl}
                  size="lg"
                />
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={editData.name}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, name: e.target.value }))
                        }
                        placeholder="Ad"
                        className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-500"
                      />
                      <input
                        type="text"
                        value={editData.surname}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, surname: e.target.value }))
                        }
                        placeholder="Soyad"
                        className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  ) : (
                    <p className="font-semibold text-gray-900 truncate">
                      {[contact.name, contact.surname].filter(Boolean).join(' ') || formatPhone(contact.phone)}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 truncate">
                    {formatPhone(contact.phone)}
                  </p>
                  <div className="mt-1.5">
                    <EcommerceCustomerBadge metadata={contact.metadata} />
                  </div>
                  {lead ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          LEAD_STATUS_COLORS[lead.status] || 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        Huní: {LEAD_STATUS_LABELS[lead.status] || lead.status}
                      </span>
                      <Link
                        href="/leads"
                        className="text-[10px] font-medium text-whatsapp hover:underline"
                      >
                        Huniyi aç →
                      </Link>
                    </div>
                  ) : null}
                </div>
                {!editing ? (
                  <button
                    onClick={startEdit}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center gap-2.5 text-gray-600">
                  <Phone className="w-3.5 h-3.5 text-gray-400" />
                  <span>{formatPhone(contact.phone)}</span>
                </div>
                {editing ? (
                  <>
                    <div className="flex items-center gap-2.5">
                      <Mail className="w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="email"
                        value={editData.email}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, email: e.target.value }))
                        }
                        placeholder="E-posta"
                        className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Building2 className="w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="text"
                        value={editData.company}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, company: e.target.value }))
                        }
                        placeholder="Şirket"
                        className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="text"
                        value={editData.city}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, city: e.target.value }))
                        }
                        placeholder="Şehir"
                        className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-start gap-2.5">
                      <StickyNote className="w-3.5 h-3.5 text-gray-400 mt-1" />
                      <textarea
                        value={editData.notes}
                        onChange={(e) =>
                          setEditData((d) => ({ ...d, notes: e.target.value }))
                        }
                        placeholder="Notlar"
                        rows={2}
                        className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:border-blue-500 resize-none"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {contact.email && (
                      <div className="flex items-center gap-2.5 text-gray-600">
                        <Mail className="w-3.5 h-3.5 text-gray-400" />
                        <span className="truncate">{contact.email}</span>
                      </div>
                    )}
                    {contact.company && (
                      <div className="flex items-center gap-2.5 text-gray-600">
                        <Building2 className="w-3.5 h-3.5 text-gray-400" />
                        <span>{contact.company}</span>
                      </div>
                    )}
                    {contact.city && (
                      <div className="flex items-center gap-2.5 text-gray-600">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        <span>{contact.city}</span>
                      </div>
                    )}
                    {contact.notes && (
                      <div className="flex items-start gap-2.5 text-gray-600">
                        <StickyNote className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
                        <span className="text-xs">{contact.notes}</span>
                      </div>
                    )}
                  </>
                )}

                {/* Source */}
                <div className="flex items-center gap-2.5">
                  <Globe className="w-3.5 h-3.5 text-gray-400" />
                  <select
                    value={contact.source || ''}
                    onChange={(e) => handleSourceChange(e.target.value)}
                    className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">Kaynak Seç</option>
                    {SOURCES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tags */}
                {contact.tags && contact.tags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tag className="w-3.5 h-3.5 text-gray-400" />
                    {contact.tags.map((tag: string) => (
                      <span
                        key={tag}
                        className="text-[10px] bg-whatsapp/10 text-whatsapp px-2 py-0.5 rounded-full font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {canTsoftCreate && (
                  <button
                    type="button"
                    onClick={openTsoftModal}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 mt-2 bg-orange-50 text-orange-900 rounded-xl text-xs font-medium border border-orange-200 hover:bg-orange-100 transition-colors"
                  >
                    <Store className="w-3.5 h-3.5" />
                    T-Soft&apos;ta müşteri oluştur
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Lead */}
        <div className="border-b border-gray-50">
          <button
            onClick={() => toggleSection('lead')}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50"
          >
            Potansiyel Müşteri
            {openSections.lead ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {openSections.lead && (
            <div className="px-4 pb-4">
              {lead ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {LEAD_STATUSES.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => updateLeadStatus(s.value)}
                        className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-all ${
                          lead.status === s.value
                            ? s.color + ' ring-2 ring-offset-1 ring-current'
                            : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {lead.value && (
                    <p className="text-xs text-gray-500">
                      Değer: <span className="font-medium">{lead.value} TL</span>
                    </p>
                  )}
                  {lead.notes && (
                    <p className="text-xs text-gray-500">
                      Not: {lead.notes}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={createLead}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-50 text-blue-700 rounded-xl text-xs font-medium hover:bg-blue-100 transition-colors"
                >
                  <Target className="w-3.5 h-3.5" />
                  Potansiyel Müşteri Olarak İşaretle
                </button>
              )}

              <Link
                href={`/quotes/new?contactId=${contact.id}`}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-purple-50 text-purple-700 rounded-xl text-xs font-medium hover:bg-purple-100 transition-colors"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                Teklif Oluştur
              </Link>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-b border-gray-50">
          <button
            onClick={() => toggleSection('actions')}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50"
          >
            Görüşme İşlemleri
            {openSections.actions ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {openSections.actions && (
            <div className="px-4 pb-4 space-y-3">
              {assignments?.[0] && (
                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                  <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs text-blue-700 font-medium">
                    Atanan: {assignments[0].user.name}
                  </span>
                </div>
              )}

              {isAdmin && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">
                    Temsilci Ata
                  </label>
                  <select
                    value={assignments?.[0]?.user?.id || ''}
                    onChange={(e) => {
                      if (e.target.value) assignAgent(e.target.value);
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">Temsilci Seç...</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!isAdmin && !assignments?.[0] && (
                <p className="text-xs text-gray-400 text-center py-2">
                  Otomatik atama bekleniyor
                </p>
              )}
            </div>
          )}
        </div>

        {/* Internal Notes / Team Chat */}
        {internalChatEnabled && (
          <div>
            <button
              onClick={() => toggleSection('notes')}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50"
            >
              Dahili Notlar
              {openSections.notes ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {openSections.notes && (
              <div className="px-4 pb-4">
                <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
                  {notes.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">
                      Henüz dahili not yok
                    </p>
                  ) : (
                    notes.map((note: any) => (
                      <div
                        key={note.id}
                        className="p-2.5 bg-yellow-50 rounded-lg border border-yellow-100"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <MessageSquare className="w-3 h-3 text-yellow-600" />
                          <span className="text-[10px] font-medium text-yellow-700">
                            {note.user.name}
                          </span>
                          <span className="text-[10px] text-yellow-500 ml-auto">
                            {new Date(note.createdAt).toLocaleString('tr-TR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-gray-700">{note.body}</p>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={addNote} className="flex gap-2">
                  <input
                    type="text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Dahili not yaz..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-yellow-500"
                  />
                  <button
                    type="submit"
                    disabled={!noteText.trim()}
                    className="p-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>

      {tsoftOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">T-Soft site müşterisi</h3>
              <button
                type="button"
                onClick={() => setTsoftOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Cep numarası WhatsApp kaydından alınır. Site hesabı için e-posta ve şifre zorunludur; adres ve plaka
              kodları isteğe bağlıdır (
              <a
                href="https://developer.tsoft.com.tr/docs/api/customer/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-600 hover:underline"
              >
                müşteri API
              </a>
              ).
            </p>
            <form onSubmit={submitTsoftCustomer} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  placeholder="Ad"
                  value={tsoftForm.name}
                  onChange={(e) => setTsoftForm((f) => ({ ...f, name: e.target.value }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                <input
                  required
                  placeholder="Soyad"
                  value={tsoftForm.surname}
                  onChange={(e) => setTsoftForm((f) => ({ ...f, surname: e.target.value }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <input
                type="email"
                required
                placeholder="E-posta (giriş için)"
                value={tsoftForm.email}
                onChange={(e) => setTsoftForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Şifre (min. 8 karakter)"
                value={tsoftForm.password}
                onChange={(e) => setTsoftForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <textarea
                placeholder="Adres (sokak, mahalle, bina)"
                value={tsoftForm.address}
                onChange={(e) => setTsoftForm((f) => ({ ...f, address: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  placeholder="Ülke (TR)"
                  value={tsoftForm.countryCode}
                  onChange={(e) => setTsoftForm((f) => ({ ...f, countryCode: e.target.value }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                <input
                  placeholder="İl plaka (örn. 34)"
                  value={tsoftForm.cityCode}
                  onChange={(e) => setTsoftForm((f) => ({ ...f, cityCode: e.target.value }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                <input
                  placeholder="İlçe kodu (ops.)"
                  value={tsoftForm.districtCode}
                  onChange={(e) => setTsoftForm((f) => ({ ...f, districtCode: e.target.value }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <input
                placeholder="Şirket adı (opsiyonel)"
                value={tsoftForm.company}
                onChange={(e) => setTsoftForm((f) => ({ ...f, company: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTsoftOpen(false)}
                  className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={tsoftSubmitting}
                  className="flex-1 py-2.5 text-sm font-medium text-white bg-orange-500 rounded-xl hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {tsoftSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Oluştur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
