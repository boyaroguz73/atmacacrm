'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  GripVertical,
  MessageSquare,
  Plus,
  Tag,
  Target,
  UserPlus,
  X,
} from 'lucide-react';

export interface FlowStep {
  id: string;
  type: 'send_message' | 'wait' | 'condition' | 'add_tag' | 'set_lead_status' | 'assign_agent';
  data: Record<string, any>;
  nextStepId?: string | null;
}

interface Flow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  activeFrom?: string | null;
  trigger: string;
  conditions: any;
  steps: FlowStep[];
}

const TRIGGERS = [
  { value: 'new_message', label: 'Her yeni mesaj' },
  { value: 'keyword', label: 'Anahtar kelime eşleşmesi' },
  { value: 'first_message', label: 'İlk mesaj (yeni kişi)' },
  { value: 'order_status', label: 'Sipariş durumu değişti' },
  { value: 'quote_status', label: 'Teklif durumu değişti' },
];

const ORDER_STATUS_OPTIONS = [
  { value: 'AWAITING_CHECKOUT', label: 'Sepet Terk (Henüz Tamamlanmadı)' },
  { value: 'AWAITING_PAYMENT', label: 'Ödeme Bekleniyor' },
  { value: 'PREPARING', label: 'Ürün Hazırlanıyor' },
  { value: 'SHIPPED', label: 'Kargoya Verildi' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'CANCELLED', label: 'İptal / İade' },
];

const QUOTE_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Taslak' },
  { value: 'SENT', label: 'Gönderildi' },
  { value: 'ACCEPTED', label: 'Kabul Edildi' },
  { value: 'REJECTED', label: 'Reddedildi' },
  { value: 'EXPIRED', label: 'Süresi Doldu' },
];

const STEP_TYPES = [
  { value: 'send_message', label: 'Mesaj Gönder', icon: MessageSquare, color: 'bg-green-50 text-green-700' },
  { value: 'wait', label: 'Bekle', icon: Clock, color: 'bg-yellow-50 text-yellow-700' },
  { value: 'condition', label: 'Koşul Kontrolü', icon: Target, color: 'bg-amber-50 text-amber-700' },
  { value: 'add_tag', label: 'Etiket Ekle', icon: Tag, color: 'bg-blue-50 text-blue-700' },
  { value: 'set_lead_status', label: 'Müşteri Durumu Ayarla', icon: Target, color: 'bg-purple-50 text-purple-700' },
  { value: 'assign_agent', label: 'Temsilci Ata', icon: UserPlus, color: 'bg-orange-50 text-orange-700' },
];

const LEAD_STATUSES = [
  { value: 'NEW', label: 'Yeni' },
  { value: 'CONTACTED', label: 'İletişim Kuruldu' },
  { value: 'INTERESTED', label: 'İlgileniyor' },
  { value: 'OFFER_SENT', label: 'Teklif Gönderildi' },
  { value: 'WON', label: 'Kazanıldı' },
  { value: 'LOST', label: 'Kaybedildi' },
];

let stepCounter = 1;
function newStep(type: FlowStep['type']): FlowStep {
  const id = `step_${Date.now()}_${stepCounter++}`;
  const defaults: Record<string, Record<string, any>> = {
    send_message: { message: '' },
    wait: { seconds: 3 },
    condition: { field: 'conversation_last_message_older_than', days: 2, hours: 0, minutes: 0, seconds: 0 },
    add_tag: { tag: '' },
    set_lead_status: { status: 'CONTACTED' },
    assign_agent: { agentId: '' },
  };
  return { id, type, data: defaults[type] || {} };
}

function toLocalInputValue(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function FlowEditorPage({ flowId }: { flowId?: string }) {
  const router = useRouter();
  const isEdit = !!flowId;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    name: '',
    description: '',
    activeFrom: '',
    isActive: true,
    trigger: 'keyword',
    conditions: [{ field: 'message_contains', operator: 'contains', value: '' }] as any,
    steps: [newStep('send_message')] as FlowStep[],
  });

  useEffect(() => {
    api.get('/users').then(({ data }) => {
      setAgents(data.filter((u: any) => u.role === 'AGENT' && u.isActive));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!flowId) return;
    api.get(`/auto-reply/${flowId}`)
      .then(({ data }: { data: Flow }) => {
        setForm({
          name: data.name || '',
          description: data.description || '',
          activeFrom: toLocalInputValue(data.activeFrom),
          isActive: data.isActive,
          trigger: data.trigger,
          conditions:
            data.trigger === 'order_status' || data.trigger === 'quote_status'
              ? (data.conditions as any) || { statuses: [] }
              : (data.conditions as any[]) || [{ field: 'message_contains', operator: 'contains', value: '' }],
          steps: (data.steps as FlowStep[]) || [newStep('send_message')],
        });
      })
      .finally(() => setLoading(false));
  }, [flowId]);

  const title = useMemo(() => isEdit ? 'Akışı Düzenle' : 'Yeni Akış Oluştur', [isEdit]);

  const addStep = (type: FlowStep['type']) => setForm((p) => ({ ...p, steps: [...p.steps, newStep(type)] }));
  const removeStep = (idx: number) => setForm((p) => ({ ...p, steps: p.steps.filter((_, i) => i !== idx) }));
  const updateStepData = (idx: number, data: Record<string, any>) =>
    setForm((p) => ({ ...p, steps: p.steps.map((s, i) => (i === idx ? { ...s, data: { ...s.data, ...data } } : s)) }));
  const moveStep = (idx: number, dir: -1 | 1) => {
    const n = idx + dir;
    if (n < 0 || n >= form.steps.length) return;
    setForm((p) => {
      const arr = [...p.steps];
      [arr[idx], arr[n]] = [arr[n], arr[idx]];
      return { ...p, steps: arr };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        activeFrom: form.activeFrom ? new Date(form.activeFrom).toISOString() : null,
        isActive: form.isActive,
        trigger: form.trigger,
        conditions:
          form.trigger === 'keyword'
            ? form.conditions
            : form.trigger === 'order_status' || form.trigger === 'quote_status'
              ? { statuses: Array.isArray(form.conditions?.statuses) ? form.conditions.statuses : [] }
              : undefined,
        steps: form.steps,
      };
      if (isEdit) await api.patch(`/auto-reply/${flowId}`, payload);
      else await api.post('/auto-reply', payload);
      router.push('/admin/auto-reply');
      router.refresh();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6"><div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/auto-reply')} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim() || form.steps.length === 0}
          className="px-4 py-2 bg-whatsapp text-white rounded-lg text-sm hover:bg-green-600 disabled:opacity-50"
        >
          {saving ? 'Kaydediliyor...' : isEdit ? 'Güncelle' : 'Oluştur'}
        </button>
      </div>

      <div className="bg-white border rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Akış Adı *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Açıklama</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Başlangıç zamanı</label>
            <input type="datetime-local" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Akış aktif
            </label>
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-xl p-4 space-y-4">
        <label className="block text-sm font-medium">Tetikleyici</label>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          {TRIGGERS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setForm({
                ...form,
                trigger: t.value,
                conditions: t.value === 'keyword'
                  ? [{ field: 'message_contains', operator: 'contains', value: '' }]
                  : t.value === 'order_status' || t.value === 'quote_status'
                    ? { statuses: [] }
                    : [],
              })}
              className={`p-3 border rounded-lg text-sm ${form.trigger === t.value ? 'border-whatsapp bg-green-50 text-green-700' : 'border-gray-200 text-gray-600'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(form.trigger === 'order_status' || form.trigger === 'quote_status') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(form.trigger === 'order_status' ? ORDER_STATUS_OPTIONS : QUOTE_STATUS_OPTIONS).map((st) => {
              const selected = Array.isArray((form.conditions as any)?.statuses) && (form.conditions as any).statuses.includes(st.value);
              return (
                <label key={st.value} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${selected ? 'border-whatsapp bg-green-50 text-green-700' : 'border-gray-200 text-gray-600'}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => {
                      const prev = Array.isArray((form.conditions as any)?.statuses) ? ([...(form.conditions as any).statuses] as string[]) : [];
                      const next = e.target.checked ? Array.from(new Set([...prev, st.value])) : prev.filter((x) => x !== st.value);
                      setForm({ ...form, conditions: { statuses: next } as any });
                    }}
                  />
                  {st.label}
                </label>
              );
            })}
          </div>
        )}

        {form.trigger === 'keyword' && (
          <div className="space-y-2">
            {(form.conditions as any[]).map((cond, idx) => (
              <div key={idx} className="flex gap-2">
                <select
                  value={cond.operator}
                  onChange={(e) => {
                    const next = [...(form.conditions as any[])];
                    next[idx] = { ...cond, operator: e.target.value };
                    setForm({ ...form, conditions: next });
                  }}
                  className="px-2 py-2 border rounded-lg text-sm"
                >
                  <option value="contains">İçeriyorsa</option>
                  <option value="equals">Tam eşleşiyorsa</option>
                  <option value="starts_with">İle başlıyorsa</option>
                  <option value="not_contains">İçermiyorsa</option>
                </select>
                <input
                  value={cond.value}
                  onChange={(e) => {
                    const next = [...(form.conditions as any[])];
                    next[idx] = { ...cond, value: e.target.value };
                    setForm({ ...form, conditions: next });
                  }}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                />
                {(form.conditions as any[]).length > 1 && (
                  <button type="button" onClick={() => setForm({ ...form, conditions: (form.conditions as any[]).filter((_, i) => i !== idx) })} className="p-2 text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setForm({ ...form, conditions: [...(form.conditions as any[]), { field: 'message_contains', operator: 'contains', value: '' }] })} className="text-sm text-whatsapp">
              + Koşul Ekle
            </button>
          </div>
        )}
      </div>

      <div className="bg-white border rounded-xl p-4 space-y-3">
        <label className="block text-sm font-medium">Akış Adımları</label>
        {form.steps.map((step, idx) => {
          const st = STEP_TYPES.find((x) => x.value === step.type) || STEP_TYPES[0];
          const Icon = st.icon;
          return (
            <div key={step.id} className="border rounded-lg p-3 bg-gray-50">
              <div className="flex items-center gap-2 mb-2">
                <GripVertical className="w-4 h-4 text-gray-300" />
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${st.color}`}>
                  <Icon className="w-3 h-3" />
                  {st.label}
                </span>
                <div className="flex-1" />
                <button type="button" onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="p-1 text-gray-500 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                <button type="button" onClick={() => moveStep(idx, 1)} disabled={idx === form.steps.length - 1} className="p-1 text-gray-500 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                <button type="button" onClick={() => removeStep(idx)} className="p-1 text-red-500"><X className="w-4 h-4" /></button>
              </div>

              {step.type === 'send_message' && (
                <textarea value={step.data?.message || ''} onChange={(e) => updateStepData(idx, { message: e.target.value })} rows={4} className="w-full px-3 py-2 border rounded-lg text-sm" />
              )}
              {step.type === 'wait' && (
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={30} value={step.data?.seconds || 0} onChange={(e) => updateStepData(idx, { seconds: parseInt(e.target.value || '0', 10) || 0 })} className="w-24 px-3 py-2 border rounded-lg text-sm" />
                  <span className="text-sm text-gray-500">saniye (maks. 30)</span>
                </div>
              )}
              {step.type === 'condition' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <input type="number" min={0} value={step.data?.days || 0} onChange={(e) => updateStepData(idx, { days: parseInt(e.target.value || '0', 10) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Gün" />
                  <input type="number" min={0} value={step.data?.hours || 0} onChange={(e) => updateStepData(idx, { hours: parseInt(e.target.value || '0', 10) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Saat" />
                  <input type="number" min={0} value={step.data?.minutes || 0} onChange={(e) => updateStepData(idx, { minutes: parseInt(e.target.value || '0', 10) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Dakika" />
                  <input type="number" min={0} value={step.data?.seconds || 0} onChange={(e) => updateStepData(idx, { seconds: parseInt(e.target.value || '0', 10) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Saniye" />
                </div>
              )}
              {step.type === 'add_tag' && (
                <input value={step.data?.tag || ''} onChange={(e) => updateStepData(idx, { tag: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
              )}
              {step.type === 'set_lead_status' && (
                <select value={step.data?.status || 'CONTACTED'} onChange={(e) => updateStepData(idx, { status: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                  {LEAD_STATUSES.map((ls) => <option key={ls.value} value={ls.value}>{ls.label}</option>)}
                </select>
              )}
              {step.type === 'assign_agent' && (
                <select value={step.data?.agentId || ''} onChange={(e) => updateStepData(idx, { agentId: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">Temsilci seçin</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2 mt-2">
          {STEP_TYPES.map((st) => (
            <button key={st.value} type="button" onClick={() => addStep(st.value as FlowStep['type'])} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${st.color}`}>
              <st.icon className="w-3.5 h-3.5" />
              {st.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

