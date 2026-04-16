'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import api, { getApiErrorMessage } from '@/lib/api';
import { formatPhone } from '@/lib/utils';
import { Search, DollarSign, LayoutGrid, List, Table2, GripVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import DateRangePicker from '@/components/ui/DateRangePicker';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Lead {
  id: string;
  status: string;
  value: number | null;
  source: string | null;
  notes: string | null;
  lossReason?: string | null;
  contact: { id: string; name: string | null; phone: string };
  updatedAt: string;
}

const STAGES = [
  { key: 'NEW', label: 'Yeni', color: 'border-blue-400 bg-blue-50' },
  { key: 'CONTACTED', label: 'İletişim Kuruldu', color: 'border-yellow-400 bg-yellow-50' },
  { key: 'INTERESTED', label: 'İlgileniyor', color: 'border-purple-400 bg-purple-50' },
  { key: 'OFFER_SENT', label: 'Teklif Gönderildi', color: 'border-orange-400 bg-orange-50' },
  { key: 'WON', label: 'Kazanıldı', color: 'border-green-400 bg-green-50' },
  { key: 'LOST', label: 'Kaybedildi', color: 'border-red-400 bg-red-50' },
];

type PipelineView = 'board' | 'list' | 'table';
const STORAGE_KEY = 'leads_view_mode';

function DraggableLeadCard({ lead }: { lead: Lead }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id, data: { lead } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <div {...attributes} {...listeners} className="mt-1 text-gray-300 hover:text-gray-500">
          <GripVertical className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/contacts/${lead.contact.id}`}
            className="font-medium text-sm text-whatsapp hover:underline truncate block"
            onClick={(e) => e.stopPropagation()}
          >
            {lead.contact.name || formatPhone(lead.contact.phone)}
          </Link>
          <p className="text-xs text-gray-400 mt-0.5">{formatPhone(lead.contact.phone)}</p>
          {lead.value && (
            <div className="flex items-center gap-1 mt-2">
              <DollarSign className="w-3 h-3 text-green-500" />
              <span className="text-xs font-semibold text-green-600">
                {lead.value.toLocaleString()} TL
              </span>
            </div>
          )}
          <Link
            href={`/contacts/${lead.contact.id}`}
            className="mt-2 inline-block text-[11px] font-medium text-gray-500 hover:text-whatsapp"
            onClick={(e) => e.stopPropagation()}
          >
            Detay →
          </Link>
        </div>
      </div>
    </div>
  );
}

function LeadCardPreview({ lead }: { lead: Lead }) {
  return (
    <div className="bg-white rounded-lg p-3 shadow-lg border-2 border-whatsapp/50 w-64">
      <div className="flex items-start gap-2">
        <GripVertical className="w-4 h-4 mt-1 text-gray-300" />
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm text-whatsapp truncate block">
            {lead.contact.name || formatPhone(lead.contact.phone)}
          </span>
          <p className="text-xs text-gray-400 mt-0.5">{formatPhone(lead.contact.phone)}</p>
          {lead.value && (
            <div className="flex items-center gap-1 mt-2">
              <DollarSign className="w-3 h-3 text-green-500" />
              <span className="text-xs font-semibold text-green-600">
                {lead.value.toLocaleString()} TL
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<PipelineView>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'board' || saved === 'list' || saved === 'table') {
        return saved;
      }
    }
    return 'board';
  });
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleViewModeChange = (mode: PipelineView) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY, mode);
    if (mode !== 'table') setStatusFilter(null);
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (viewMode === 'table' && statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      if (dateFrom) params.from = dateFrom + 'T00:00:00';
      if (dateTo) params.to = dateTo + 'T23:59:59';
      const { data } = await api.get('/leads', { params });
      setLeads(data.leads);
    } catch (error) {
      console.error(error);
      toast.error('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [statusFilter, dateFrom, dateTo, viewMode]);

  useEffect(() => {
    const timer = setTimeout(fetchLeads, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const updateStatus = async (leadId: string, newStatus: string) => {
    let lossReason: string | undefined;
    if (newStatus === 'LOST') {
      const r = window.prompt('Kayıp nedeni (zorunlu, en az 2 karakter):');
      if (r === null) {
        fetchLeads();
        return;
      }
      if (r.trim().length < 2) {
        toast.error('Kayıp nedeni en az 2 karakter olmalı');
        fetchLeads();
        return;
      }
      lossReason = r.trim();
    }
    try {
      await api.patch(`/leads/${leadId}/status`, { status: newStatus, lossReason });
      toast.success('Durum güncellendi');
      fetchLeads();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Güncellenemedi'));
      fetchLeads();
    }
  };

  const groupedLeads = useMemo(() => STAGES.map((stage) => ({
    ...stage,
    leads: leads.filter((l) => l.status === stage.key),
  })), [leads]);

  const activeLead = useMemo(() => {
    if (!activeId) return null;
    return leads.find((l) => l.id === activeId) || null;
  }, [activeId, leads]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    
    if (!over) return;
    
    const leadId = active.id as string;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    
    // over.id bir stage key mi yoksa başka bir lead id mi kontrol et
    let newStatus: string | null = null;
    
    // over.id direkt stage key ise
    if (STAGES.some((s) => s.key === over.id)) {
      newStatus = over.id as string;
    } else {
      // over.id bir lead ise, o lead'in stage'ini bul
      const overLead = leads.find((l) => l.id === over.id);
      if (overLead) {
        newStatus = overLead.status;
      }
    }
    
    if (newStatus && newStatus !== lead.status) {
      await updateStatus(leadId, newStatus);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    // Sadece visual feedback için, gerçek güncelleme dragEnd'de
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Potansiyel Müşteriler</h1>
          <p className="text-gray-500 text-sm mt-1">Satış hunisi yönetimi</p>
        </div>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => {
            setDateFrom(f);
            setDateTo(t);
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Müşteri ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-whatsapp focus:ring-1 focus:ring-whatsapp/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 shrink-0">
            {(
              [
                { key: 'board' as const, icon: LayoutGrid, label: 'Kart' },
                { key: 'list' as const, icon: List, label: 'Liste' },
                { key: 'table' as const, icon: Table2, label: 'Tablo' },
              ] as const
            ).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                title={label}
                onClick={() => handleViewModeChange(key)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === key
                    ? 'bg-whatsapp text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => {
              handleViewModeChange('table');
              setStatusFilter(null);
            }}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'table' && !statusFilter
                ? 'bg-whatsapp text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Tümü
          </button>
          {STAGES.map((stage) => (
            <button
              type="button"
              key={stage.key}
              onClick={() => {
                handleViewModeChange('table');
                setStatusFilter(stage.key);
              }}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                viewMode === 'table' && statusFilter === stage.key
                  ? 'bg-whatsapp text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {stage.label}
            </button>
          ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-whatsapp border-t-transparent rounded-full animate-spin" />
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Kişi</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Telefon</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Değer</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Kaynak</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400 text-sm">
                    {loading ? (
                      <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin mx-auto" />
                    ) : 'Lead bulunamadı'}
                  </td>
                </tr>
              )}
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-3 text-sm font-medium text-gray-900">
                    <Link
                      href={`/contacts/${lead.contact.id}`}
                      className="text-whatsapp hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {lead.contact.name || 'İsimsiz'}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">
                    {formatPhone(lead.contact.phone)}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">
                    {lead.value ? `${lead.value.toLocaleString()} TL` : '—'}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">{lead.source || '—'}</td>
                  <td className="px-5 py-3">
                    <select
                      value={lead.status}
                      onChange={(e) => updateStatus(lead.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-whatsapp"
                    >
                      {STAGES.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-6">
          {groupedLeads.map((stage) => (
            <div key={stage.key} className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <div className={`px-4 py-2.5 border-l-4 ${stage.color} bg-gray-50/80 flex items-center justify-between`}>
                <h3 className="font-semibold text-sm text-gray-800">{stage.label}</h3>
                <span className="text-xs font-bold text-gray-500 tabular-nums">{stage.leads.length}</span>
              </div>
              <ul className="divide-y divide-gray-50">
                {stage.leads.length === 0 ? (
                  <li className="px-4 py-6 text-center text-xs text-gray-400">Kayıt yok</li>
                ) : (
                  stage.leads.map((lead) => (
                    <li key={lead.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-gray-50/60">
                      <div>
                        <Link
                          href={`/contacts/${lead.contact.id}`}
                          className="font-medium text-sm text-whatsapp hover:underline"
                        >
                          {lead.contact.name || formatPhone(lead.contact.phone)}
                        </Link>
                        <p className="text-xs text-gray-400 mt-0.5">{formatPhone(lead.contact.phone)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {lead.value != null && lead.value > 0 ? (
                          <span className="text-xs font-semibold text-green-600 tabular-nums">
                            {lead.value.toLocaleString('tr-TR')} TL
                          </span>
                        ) : null}
                        <select
                          value={lead.status}
                          onChange={(e) => updateStatus(lead.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-whatsapp"
                        >
                          {STAGES.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {groupedLeads.map((stage) => (
              <div 
                key={stage.key} 
                id={stage.key}
                className={`rounded-xl border-t-4 ${stage.color} p-4 min-h-[200px]`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-gray-700">{stage.label}</h3>
                  <span className="text-xs bg-white rounded-full px-2 py-0.5 font-bold text-gray-600 shadow-sm">
                    {stage.leads.length}
                  </span>
                </div>
                <SortableContext 
                  items={stage.leads.map(l => l.id)} 
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2 min-h-[100px]">
                    {stage.leads.map((lead) => (
                      <DraggableLeadCard key={lead.id} lead={lead} />
                    ))}
                  </div>
                </SortableContext>
              </div>
            ))}
          </div>
          <DragOverlay>
            {activeLead ? <LeadCardPreview lead={activeLead} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
