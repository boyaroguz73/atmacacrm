'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { getContactDisplayTitle, getContactSecondaryPhoneLine } from '@/lib/utils';
import {
  X,
  User,
  Users,
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
  Check,
  Trash2,
  ClipboardList,
  History,
  FileText,
  Truck,
  CreditCard,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, SOURCES } from '@/lib/constants';
import { TURKEY_CITIES, CITY_DISTRICTS } from '@/lib/turkish-locations';
import ContactAvatar from '@/components/ui/ContactAvatar';
import EcommerceCustomerBadge from '@/components/ui/EcommerceCustomerBadge';
import type { Contact } from '@/store/chat';

interface ContactPanelProps {
  conversationId: string;
  contact: Contact;
  assignments: any[];
  onClose: () => void;
  internalChatEnabled: boolean;
  userRole?: string;
  isGroup?: boolean;
  groupName?: string;
  groupParticipantCount?: number;
}

function isLeadStatusTransitionAllowed(from: string, to: string): boolean {
  if (!from || !to) return false;
  return from !== to;
}

function getMetaText(metadata: unknown, key: string): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export default function ContactPanel({
  conversationId,
  contact: initialContact,
  assignments,
  onClose,
  internalChatEnabled,
  userRole = 'AGENT',
  isGroup = false,
  groupName,
  groupParticipantCount,
}: ContactPanelProps) {
  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPERADMIN';
  const canAssign = isAdmin || isGroup;
  const [contact, setContact] = useState<Contact>(initialContact);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: '',
    surname: '',
    email: '',
    company: '',
    city: '',
    district: '',
    address: '',
    shippingAddress: '',
    billingAddress: '',
    billingEmail: '',
    taxOffice: '',
    taxNumber: '',
    identityNumber: '',
    source: '',
    notes: '',
  });

  const [lead, setLead] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [noteText, setNoteText] = useState('');
  const [assignmentHistory, setAssignmentHistory] = useState<any[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [noteActionBusyId, setNoteActionBusyId] = useState<string | null>(null);

  const [openSections, setOpenSections] = useState({
    info: true,
    lead: true,
    actions: true,
    notes: true,
  });

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchContact = useCallback(async () => {
    try {
      const { data } = await api.get(`/contacts/${initialContact.id}`);
      setContact(data);
      setLead(data.lead || null);
    } catch { /* ignore */ }
  }, [initialContact.id]);

  const fetchAgents = useCallback(async () => {
    try {
      const { data } = await api.get('/users/agents');
      setAgents(data);
    } catch { /* ignore */ }
  }, []);

  const fetchNotes = useCallback(async () => {
    if (!internalChatEnabled) return;
    try {
      const { data } = await api.get(`/conversations/${conversationId}/notes`);
      setNotes(data);
    } catch { /* ignore */ }
  }, [conversationId, internalChatEnabled]);

  const fetchAssignmentHistory = useCallback(async () => {
    try {
      const { data } = await api.get(`/conversations/${conversationId}/assignments`);
      setAssignmentHistory(Array.isArray(data) ? data : []);
    } catch { setAssignmentHistory([]); }
  }, [conversationId]);

  useEffect(() => {
    fetchContact();
    fetchAgents();
    fetchNotes();
    fetchAssignmentHistory();
  }, [fetchContact, fetchAgents, fetchNotes, fetchAssignmentHistory]);

  useEffect(() => {
    setContact((prev: Contact) => ({ ...prev, ...initialContact }));
  }, [initialContact.id, initialContact.phone, initialContact.name, initialContact.surname, initialContact.avatarUrl]);

  const availableDistricts = useMemo(() => {
    return CITY_DISTRICTS[editData.city] || [];
  }, [editData.city]);
  const secondaryPhoneLine = getContactSecondaryPhoneLine(contact);

  const startEdit = () => {
    setEditData({
      name: contact.name || '',
      surname: contact.surname || '',
      email: contact.email || '',
      company: contact.company || '',
      city: contact.city || '',
      district: getMetaText(contact.metadata, 'district'),
      address: contact.address || '',
      shippingAddress: contact.shippingAddress || '',
      billingAddress: contact.billingAddress || '',
      billingEmail: getMetaText(contact.metadata, 'billingEmail'),
      taxOffice: contact.taxOffice || '',
      taxNumber: contact.taxNumber || '',
      identityNumber: contact.identityNumber || '',
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
    } catch { toast.error('Güncellenemedi'); }
  };

  const handleSourceChange = async (source: string) => {
    try {
      await api.patch(`/contacts/${contact.id}`, { source });
      toast.success('Kaynak güncellendi');
      fetchContact();
    } catch { toast.error('Güncellenemedi'); }
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
    if (String(lead.status) === status) return;
    if (!isLeadStatusTransitionAllowed(String(lead.status), status)) {
      toast.error('Bu durum geçişine izin verilmiyor');
      return;
    }
    let lossReason: string | undefined;
    if (status === 'LOST') {
      const r = window.prompt('Kayıp nedeni (zorunlu, en az 2 karakter):');
      if (r === null) return;
      if (r.trim().length < 2) { toast.error('Kayıp nedeni en az 2 karakter olmalı'); return; }
      lossReason = r.trim();
    }
    try {
      const { data } = await api.patch(`/leads/${lead.id}/status`, { status, lossReason });
      if (data?.status) {
        setLead((prev: any) => (prev ? { ...prev, ...data } : data));
      }
      toast.success('Durum güncellendi');
      fetchContact();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Güncellenemedi');
    }
  };

  const assignAgent = async (userId: string) => {
    try {
      await api.post(`/conversations/${conversationId}/assign`, { userId });
      toast.success('Görüşme atandı');
    } catch { toast.error('Atama başarısız'); }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    try {
      await api.post(`/conversations/${conversationId}/notes`, { body: noteText });
      setNoteText('');
      fetchNotes();
    } catch { toast.error('Not eklenemedi'); }
  };

  const startEditNote = (note: any) => {
    setEditingNoteId(note.id);
    setEditingNoteText(String(note.body || ''));
  };

  const saveEditNote = async (noteId: string) => {
    const nextBody = editingNoteText.trim();
    if (!nextBody) {
      toast.error('Not boş olamaz');
      return;
    }
    setNoteActionBusyId(noteId);
    try {
      await api.patch(`/conversations/${conversationId}/notes/${noteId}`, { body: nextBody });
      toast.success('Not güncellendi');
      setEditingNoteId(null);
      setEditingNoteText('');
      fetchNotes();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Not güncellenemedi');
    } finally {
      setNoteActionBusyId(null);
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!window.confirm('Bu dahili not silinsin mi?')) return;
    setNoteActionBusyId(noteId);
    try {
      await api.delete(`/conversations/${conversationId}/notes/${noteId}`);
      toast.success('Not silindi');
      if (editingNoteId === noteId) {
        setEditingNoteId(null);
        setEditingNoteText('');
      }
      fetchNotes();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Not silinemedi');
    } finally {
      setNoteActionBusyId(null);
    }
  };

  const inputCls = 'w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 bg-white transition';
  const selectCls = `${inputCls} appearance-none`;
  const labelCls = 'text-[10px] font-semibold text-gray-500 uppercase tracking-wide';

  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50/40 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          {isGroup ? (
            <Users className="w-4 h-4 text-green-600" />
          ) : (
            <User className="w-4 h-4 text-gray-500" />
          )}
          <span className="text-sm font-semibold text-gray-900">
            {isGroup ? 'Grup Bilgileri' : 'Kişi Bilgileri'}
          </span>
        </div>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Grup özet kartı */}
        {isGroup && (
          <div className="px-4 py-4 border-b border-gray-100 bg-white">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 truncate">{groupName || 'WhatsApp Grubu'}</p>
                {typeof groupParticipantCount === 'number' && (
                  <p className="text-xs text-gray-400">{groupParticipantCount} üye</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Contact Info — gruplar için gizle */}
        {!isGroup && <div className="border-b border-gray-100">
          <button
            onClick={() => toggleSection('info')}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-white/60 transition"
          >
            Kişi Detayları
            {openSections.info ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {openSections.info && (
            <div className="px-4 pb-5 space-y-3">
              {/* Avatar + Name + Status */}
              <div className="flex items-start gap-3">
                <ContactAvatar name={contact.name} surname={contact.surname} phone={contact.phone} avatarUrl={contact.avatarUrl} size="lg" />
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      <input type="text" value={editData.name} onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))} placeholder="Ad" className={inputCls} />
                      <input type="text" value={editData.surname} onChange={(e) => setEditData((d) => ({ ...d, surname: e.target.value }))} placeholder="Soyad" className={inputCls} />
                    </div>
                  ) : (
                    <p className="text-base font-bold text-gray-900 truncate">{getContactDisplayTitle(contact)}</p>
                  )}
                  {secondaryPhoneLine && <p className="text-xs text-gray-500 truncate mt-0.5">{secondaryPhoneLine}</p>}
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <EcommerceCustomerBadge metadata={contact.metadata} />
                    {lead && (
                      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${LEAD_STATUS_COLORS[lead.status] || 'bg-gray-100 text-gray-600'}`}>
                        {LEAD_STATUS_LABELS[lead.status] || lead.status}
                      </span>
                    )}
                  </div>
                </div>
                {!editing ? (
                  <button onClick={startEdit} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg shrink-0" title="Düzenle">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button onClick={handleSave} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg shrink-0" title="Kaydet">
                    <Save className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {!editing && (
                <div className="grid grid-cols-1 gap-2">
                  <Link
                    href={`/quotes/new?contactId=${contact.id}`}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 transition"
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                    Teklif Oluştur
                  </Link>
                  {lead ? (
                    <select
                      value={lead.status}
                      onChange={(e) => updateLeadStatus(e.target.value)}
                      className={`w-full px-2.5 py-2.5 border rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white transition ${LEAD_STATUS_COLORS[lead.status]?.replace('bg-', 'border-').split(' ')[0] || 'border-gray-200'}`}
                    >
                      <option value={lead.status}>
                        {LEAD_STATUS_LABELS[lead.status] || lead.status} (Mevcut)
                      </option>
                      {LEAD_STATUSES.filter((s) => isLeadStatusTransitionAllowed(String(lead.status), s.value)).map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              )}

              {/* Fields */}
              <div className="space-y-2 text-sm">
                {editing ? (
                  <div className="space-y-3">
                    {/* E-posta */}
                    <div>
                      <p className={labelCls}>İletişim</p>
                      <div className="mt-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <input type="email" value={editData.email} onChange={(e) => setEditData((d) => ({ ...d, email: e.target.value }))} placeholder="E-posta" className={inputCls} />
                        </div>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <input type="text" value={editData.company} onChange={(e) => setEditData((d) => ({ ...d, company: e.target.value }))} placeholder="Şirket" className={inputCls} />
                        </div>
                      </div>
                    </div>

                    {/* Konum */}
                    <div>
                      <p className={labelCls}>Konum</p>
                      <div className="mt-1 grid grid-cols-2 gap-1.5">
                        <select value={editData.city} onChange={(e) => setEditData((d) => ({ ...d, city: e.target.value, district: '' }))} className={selectCls}>
                          <option value="">İl seçin</option>
                          {TURKEY_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {availableDistricts.length > 0 ? (
                          <select value={editData.district} onChange={(e) => setEditData((d) => ({ ...d, district: e.target.value }))} className={selectCls}>
                            <option value="">İlçe seçin</option>
                            {availableDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        ) : (
                          <input type="text" value={editData.district} onChange={(e) => setEditData((d) => ({ ...d, district: e.target.value }))} placeholder="İlçe" className={inputCls} />
                        )}
                      </div>
                      <textarea value={editData.address} onChange={(e) => setEditData((d) => ({ ...d, address: e.target.value }))} placeholder="Açık adres" rows={2} className={`${inputCls} mt-1.5 resize-none`} />
                    </div>

                    {/* Sevk Adresi */}
                    <div>
                      <p className={labelCls}>Sevk adresi</p>
                      <textarea value={editData.shippingAddress} onChange={(e) => setEditData((d) => ({ ...d, shippingAddress: e.target.value }))} placeholder="Teslimat / sevk adresi" rows={2} className={`${inputCls} mt-1 resize-none`} />
                    </div>

                    {/* Fatura / Firma */}
                    <div>
                      <p className={labelCls}>Fatura / Firma</p>
                      <div className="mt-1 space-y-1.5">
                        <textarea value={editData.billingAddress} onChange={(e) => setEditData((d) => ({ ...d, billingAddress: e.target.value }))} placeholder="Fatura adresi (boşsa genel adres)" rows={2} className={`${inputCls} resize-none`} />
                        <input type="email" value={editData.billingEmail} onChange={(e) => setEditData((d) => ({ ...d, billingEmail: e.target.value }))} placeholder="Fatura e-posta" className={inputCls} />
                        <input type="text" value={editData.taxOffice} onChange={(e) => setEditData((d) => ({ ...d, taxOffice: e.target.value }))} placeholder="Vergi dairesi" className={inputCls} />
                        <div className="grid grid-cols-2 gap-1.5">
                          <input type="text" value={editData.taxNumber} onChange={(e) => setEditData((d) => ({ ...d, taxNumber: e.target.value }))} placeholder="Vergi No (VKN)" className={inputCls} />
                          <input type="text" value={editData.identityNumber} onChange={(e) => setEditData((d) => ({ ...d, identityNumber: e.target.value }))} placeholder="TC Kimlik No" className={inputCls} />
                        </div>
                      </div>
                    </div>

                    {/* Notlar */}
                    <div>
                      <p className={labelCls}>Notlar</p>
                      <textarea value={editData.notes} onChange={(e) => setEditData((d) => ({ ...d, notes: e.target.value }))} placeholder="Not ekle..." rows={2} className={`${inputCls} mt-1 resize-none`} />
                    </div>

                    {/* Kaynak */}
                    <div>
                      <p className={labelCls}>Kaynak</p>
                      <select value={editData.source} onChange={(e) => setEditData((d) => ({ ...d, source: e.target.value }))} className={`${selectCls} mt-1`}>
                        <option value="">Seçiniz</option>
                        {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  </div>
                ) : (
                  /* Read-only display */
                  <>
                    {contact.email && (
                      <div className="flex items-center gap-2.5 text-gray-600">
                        <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="truncate text-xs">{contact.email}</span>
                      </div>
                    )}
                    {contact.company && (
                      <div className="flex items-center gap-2.5 text-gray-600">
                        <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="text-xs">{contact.company}</span>
                      </div>
                    )}
                    {(contact.city || getMetaText(contact.metadata, 'district')) && (
                      <div className="flex items-center gap-2.5 text-gray-600">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="text-xs">
                          {[getMetaText(contact.metadata, 'district'), contact.city].filter(Boolean).join(', ')}
                        </span>
                      </div>
                    )}
                    {contact.address && (
                      <div className="flex items-start gap-2.5 text-gray-600">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                        <span className="text-xs whitespace-pre-wrap">{contact.address}</span>
                      </div>
                    )}
                    {contact.shippingAddress && (
                      <div className="flex items-start gap-2.5 text-gray-600">
                        <Truck className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-gray-400 font-medium">Sevk</span>
                          <p className="text-xs whitespace-pre-wrap">{contact.shippingAddress}</p>
                        </div>
                      </div>
                    )}

                    {/* Fatura bilgileri kompakt */}
                    {(contact.billingAddress || getMetaText(contact.metadata, 'billingEmail') || contact.taxOffice || contact.taxNumber || contact.identityNumber) && (
                      <details className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 mt-1">
                        <summary className="cursor-pointer list-none text-[10px] font-semibold text-gray-500 uppercase flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Fatura / Firma
                        </summary>
                        <div className="pt-1.5 space-y-1">
                          {contact.billingAddress && (
                            <p className="text-xs text-gray-700 whitespace-pre-wrap">{contact.billingAddress}</p>
                          )}
                          {getMetaText(contact.metadata, 'billingEmail') && (
                            <p className="text-xs text-gray-600"><span className="text-gray-400">E-posta:</span> {getMetaText(contact.metadata, 'billingEmail')}</p>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {contact.taxOffice && <p className="text-xs text-gray-600"><span className="text-gray-400">VD:</span> {contact.taxOffice}</p>}
                            {contact.taxNumber && <p className="text-xs text-gray-600"><span className="text-gray-400">VKN:</span> {contact.taxNumber}</p>}
                            {contact.identityNumber && <p className="text-xs text-gray-600"><span className="text-gray-400">TC:</span> {contact.identityNumber}</p>}
                          </div>
                        </div>
                      </details>
                    )}

                    {contact.notes && (
                      <div className="flex items-start gap-2.5 text-gray-600">
                        <StickyNote className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                        <span className="text-xs">{contact.notes}</span>
                      </div>
                    )}

                    {/* Kaynak */}
                    <div className="flex items-center gap-2.5">
                      <Globe className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <select
                        value={contact.source || ''}
                        onChange={(e) => handleSourceChange(e.target.value)}
                        className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                      >
                        <option value="">Kaynak</option>
                        {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  </>
                )}

                {/* Tags */}
                {contact.tags && contact.tags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    <Tag className="w-3.5 h-3.5 text-gray-400" />
                    {contact.tags.map((tag: string) => (
                      <span key={tag} className="text-[10px] bg-whatsapp/10 text-whatsapp px-2 py-0.5 rounded-full font-medium">{tag}</span>
                    ))}
                  </div>
                )}

              </div>
            </div>
          )}
        </div>}

        {/* Lead / Pipeline — gruplar için gizle */}
        {!isGroup && <div className="border-b border-gray-100">
          <button
            onClick={() => toggleSection('lead')}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-white/60 transition"
          >
            Potansiyel Müşteri
            {openSections.lead ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {openSections.lead && (
            <div className="px-4 pb-5 space-y-2.5">
              {lead ? (
                <div className="space-y-2.5">
                  {/* Dropdown durum seçici */}
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Durum</p>
                    <select
                      value={lead.status}
                      onChange={(e) => updateLeadStatus(e.target.value)}
                      className={`w-full px-2.5 py-2 border rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white transition ${LEAD_STATUS_COLORS[lead.status]?.replace('bg-', 'border-').split(' ')[0] || 'border-gray-200'}`}
                    >
                      <option value={lead.status}>
                        {LEAD_STATUS_LABELS[lead.status] || lead.status} (Mevcut)
                      </option>
                      {LEAD_STATUSES.filter((s) => isLeadStatusTransitionAllowed(String(lead.status), s.value)).map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  {lead.value && (
                    <p className="text-xs text-gray-500">Değer: <span className="font-medium">{lead.value} TL</span></p>
                  )}
                  {lead.notes && (
                    <p className="text-xs text-gray-500">Not: {lead.notes}</p>
                  )}
                </div>
              ) : (
                <button
                  onClick={createLead}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition"
                >
                  <Target className="w-3.5 h-3.5" />
                  Potansiyel Müşteri Olarak İşaretle
                </button>
              )}

            </div>
          )}
        </div>}

        {/* Actions */}
        <div className="border-b border-gray-100">
          <button
            onClick={() => toggleSection('actions')}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-white/60 transition"
          >
            {isGroup ? 'Temsilci Atama' : 'Temsilci'}
            {openSections.actions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {openSections.actions && (
            <div className="px-4 pb-5 space-y-2.5">
              {assignments?.[0] && (
                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                  <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs text-blue-700 font-medium">Atanan: {assignments[0].user.name}</span>
                </div>
              )}

              {assignmentHistory.length > 1 && (
                <div className="rounded-lg border border-gray-100 bg-white p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                    <History className="w-3.5 h-3.5" /> Eski Atamalar
                  </div>
                  <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                    {assignmentHistory.slice(1).map((a: any) => (
                      <div key={a.id} className="text-xs text-gray-600 flex items-start justify-between gap-2">
                        <span className="truncate">{a.user?.name || '—'}</span>
                        <span className="shrink-0 text-[10px] text-gray-400">
                          {a.unassignedAt ? new Date(a.unassignedAt).toLocaleDateString('tr-TR') : new Date(a.assignedAt).toLocaleDateString('tr-TR')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canAssign && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Temsilci Ata</label>
                  <select
                    value={assignments?.[0]?.user?.id || ''}
                    onChange={(e) => { if (e.target.value) assignAgent(e.target.value); }}
                    className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                  >
                    <option value="">Temsilci Seç...</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}

              {!canAssign && !assignments?.[0] && (
                <p className="text-xs text-gray-400 text-center py-2">Otomatik atama bekleniyor</p>
              )}
            </div>
          )}
        </div>

        {/* Internal Notes */}
        {internalChatEnabled && (
          <div>
            <button
              onClick={() => toggleSection('notes')}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-white/60 transition"
            >
              Dahili Notlar
              {openSections.notes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {openSections.notes && (
              <div className="px-4 pb-5">
                <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
                  {notes.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">Henüz dahili not yok</p>
                  ) : (
                    notes.map((note: any) => (
                      <div key={note.id} className="p-2.5 bg-yellow-50 rounded-lg border border-yellow-100">
                        <div className="flex items-center gap-1.5 mb-1">
                          <MessageSquare className="w-3 h-3 text-yellow-600" />
                          <span className="text-[10px] font-medium text-yellow-700">{note.user.name}</span>
                          <span className="text-[10px] text-yellow-500 ml-auto">
                            {new Date(note.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {editingNoteId === note.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editingNoteText}
                              onChange={(e) => setEditingNoteText(e.target.value)}
                              rows={2}
                              className="w-full px-2 py-1.5 border border-yellow-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-none"
                            />
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingNoteId(null);
                                  setEditingNoteText('');
                                }}
                                className="p-1 text-gray-500 hover:text-gray-700 rounded"
                                title="Vazgeç"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={noteActionBusyId === note.id}
                                onClick={() => void saveEditNote(note.id)}
                                className="p-1 text-green-600 hover:text-green-700 rounded disabled:opacity-50"
                                title="Kaydet"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-gray-700">{note.body}</p>
                            <div className="mt-1.5 flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => startEditNote(note)}
                                className="p-1 text-yellow-700 hover:text-yellow-900 rounded"
                                title="Düzenle"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={noteActionBusyId === note.id}
                                onClick={() => void deleteNote(note.id)}
                                className="p-1 text-red-600 hover:text-red-700 rounded disabled:opacity-50"
                                title="Sil"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={addNote} className="space-y-2">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Bu kişiyle ilgili not ekleyin..."
                    rows={3}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-y"
                  />
                  <button type="submit" disabled={!noteText.trim()} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 text-xs font-semibold">
                    <Send className="w-3.5 h-3.5" />
                    Notu Kaydet
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
