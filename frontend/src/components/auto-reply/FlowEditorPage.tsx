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
  Target,
  UserPlus,
  X,
} from 'lucide-react';

export interface FlowStep {
  id: string;
  type: 'send_message' | 'wait' | 'condition' | 'set_lead_status' | 'assign_agent';
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
  { value: 'quote_converted_to_order', label: 'Teklif siparişe dönüştü' },
  { value: 'delivery_due', label: 'Teslim tarihine göre' },
];

const TRIGGER_HELP: Record<string, string> = {
  new_message: 'Gelen her mesajda çalışır.',
  keyword: 'Belirlediğiniz kelimeler geçtiğinde çalışır.',
  first_message: 'Yeni bir kişi ilk kez mesaj attığında çalışır.',
  order_status: 'Sipariş durumu seçtiğiniz aşamaya geldiğinde çalışır.',
  quote_status: 'Teklif durumu seçtiğiniz aşamaya geldiğinde çalışır.',
  quote_converted_to_order: 'Teklif siparişe dönüştürüldüğünde çalışır.',
  delivery_due: 'Siparişin teslim tarihine X gün kala çalışır.',
};

const ORDER_STATUS_OPTIONS = [
  { value: 'AWAITING_CHECKOUT', label: 'Sepet Terk (Henüz Tamamlanmadı)' },
  { value: 'AWAITING_PAYMENT', label: 'Ödeme Bekleniyor' },
  { value: 'PREPARING', label: 'Ürün Hazırlanıyor' },
  { value: 'READY_TO_SHIP', label: 'Gönderime Hazır' },
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
    wait: { hours: 1 },
    condition: { field: 'conversation_last_message_older_than', days: 2, hours: 0, minutes: 0, seconds: 0 },
    set_lead_status: { status: 'CONTACTED' },
    assign_agent: { mode: 'round_robin', agentId: '' },
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
              : data.trigger === 'delivery_due'
                ? (data.conditions as any) || { daysBefore: 0 }
              : (data.conditions as any[]) || [{ field: 'message_contains', operator: 'contains', value: '' }],
          steps: (data.steps as FlowStep[]) || [newStep('send_message')],
        });
      })
      .finally(() => setLoading(false));
  }, [flowId]);

  const title = useMemo(() => isEdit ? 'Akışı Düzenle' : 'Yeni Otomasyon Oluştur', [isEdit]);

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
              : form.trigger === 'delivery_due'
                ? {
                    daysBefore: Math.max(0, parseInt(String((form.conditions as any)?.daysBefore || '0'), 10) || 0),
                  }
              : undefined,
        steps: form.steps,
      };
      if (isEdit) await api.patch(`/auto-reply/${flowId}`, payload);
      else await api.post('/auto-reply', payload);
      router.back();
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            {!isEdit ? (
              <p className="text-sm text-gray-500 mt-0.5">
                Belirli bir olaya göre otomatik mesaj ve islemler olusturun.
              </p>
            ) : null}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim() || form.steps.length === 0}
          className="px-4 py-2 bg-whatsapp text-white rounded-lg text-sm hover:bg-green-600 disabled:opacity-50"
        >
          {saving ? 'Kaydediliyor...' : isEdit ? 'Güncelle' : 'Oluştur'}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">1) Akış Bilgileri</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Akisin adini ve ne zaman aktif olacagini belirleyin.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Akış Adı *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              placeholder="Orn: Yeni musteri karsilama mesaji"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Açıklama</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
              placeholder="Bu akis ne zaman ve neden calisir?"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Başlangıç zamanı</label>
            <input type="datetime-local" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50/60">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Akış aktif
            </label>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">2) Ne zaman başlasın (Tetikleyici)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Akisin hangi olayla tetiklenecegini secin.
          </p>
        </div>
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
                    : t.value === 'delivery_due'
                      ? { daysBefore: 0 }
                    : [],
              })}
              className={`p-3 border rounded-lg text-left text-sm ${form.trigger === t.value ? 'border-whatsapp bg-green-50 text-green-700 shadow-sm' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              <p className="font-medium">{t.label}</p>
              <p className="text-[11px] mt-1 opacity-80">{TRIGGER_HELP[t.value]}</p>
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

        {form.trigger === 'delivery_due' && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Teslim tarihine kaç gün kala çalışsın?
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={365}
                value={Math.max(0, parseInt(String((form.conditions as any)?.daysBefore || '0'), 10) || 0)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    conditions: {
                      daysBefore: Math.max(0, parseInt(e.target.value || '0', 10) || 0),
                    } as any,
                  })
                }
                className="w-24 px-3 py-2 border rounded-lg text-sm"
              />
              <span className="text-sm text-gray-600">gün</span>
              <span className="text-xs text-gray-400">
                (0 = teslim günü, 1 = bir gün önce)
              </span>
            </div>
          </div>
        )}

        {form.trigger === 'keyword' && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Mesaj su kelimeleri iceriyorsa</label>
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
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  placeholder="Orn: fiyat, kampanya, teslimat"
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

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">3) Ne yapsın (Akış Adımları)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Adim adim ne olacagini belirleyin: Mesaj gonder, bekle, durum/temsilci ata...
          </p>
        </div>
        {form.steps.map((step, idx) => {
          const st = STEP_TYPES.find((x) => x.value === step.type) || STEP_TYPES[0];
          const Icon = st.icon;
          return (
            <div key={step.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50/60 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <GripVertical className="w-4 h-4 text-gray-300" />
                <span className="text-xs font-semibold text-gray-500">Adım {idx + 1}</span>
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
                <textarea
                  value={step.data?.message || ''}
                  onChange={(e) => updateStepData(idx, { message: e.target.value })}
                  rows={5}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm"
                  placeholder="Gonderilecek mesaji yazin..."
                />
              )}
              {step.type === 'wait' && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={
                      Math.max(
                        1,
                        Math.ceil(
                          (Number(step.data?.days || 0) * 24) +
                            Number(step.data?.hours || 0) +
                            Number(step.data?.minutes || 0) / 60 +
                            Number(step.data?.seconds || 0) / 3600,
                        ),
                      )
                    }
                    onChange={(e) =>
                      updateStepData(idx, {
                        days: 0,
                        hours: parseInt(e.target.value || '1', 10) || 1,
                        minutes: 0,
                        seconds: 0,
                      })
                    }
                    className="w-24 px-3 py-2 border rounded-lg text-sm"
                  />
                  <span className="text-sm text-gray-500">saat (maks. 720)</span>
                </div>
              )}
              {step.type === 'condition' && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600">
                    Bu adım, müşteriden gelen son mesajın ne kadar eski olduğunu kontrol eder.
                    Girilen süre dolmuşsa akış bir sonraki adıma geçer.
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Örnek: <span className="font-medium">2 gün 0 saat 0 dk 0 sn</span> = Son müşteri mesajı en az 2 gün önceyse çalışır.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="text-xs text-gray-600">
                      Gün
                      <input type="number" min={0} value={step.data?.days || 0} onChange={(e) => updateStepData(idx, { days: parseInt(e.target.value || '0', 10) || 0 })} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" placeholder="0" />
                    </label>
                    <label className="text-xs text-gray-600">
                      Saat
                      <input type="number" min={0} value={step.data?.hours || 0} onChange={(e) => updateStepData(idx, { hours: parseInt(e.target.value || '0', 10) || 0 })} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" placeholder="0" />
                    </label>
                    <label className="text-xs text-gray-600">
                      Dakika
                      <input type="number" min={0} value={step.data?.minutes || 0} onChange={(e) => updateStepData(idx, { minutes: parseInt(e.target.value || '0', 10) || 0 })} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" placeholder="0" />
                    </label>
                    <label className="text-xs text-gray-600">
                      Saniye
                      <input type="number" min={0} value={step.data?.seconds || 0} onChange={(e) => updateStepData(idx, { seconds: parseInt(e.target.value || '0', 10) || 0 })} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" placeholder="0" />
                    </label>
                  </div>
                </div>
              )}
              {step.type === 'set_lead_status' && (
                <select value={step.data?.status || 'CONTACTED'} onChange={(e) => updateStepData(idx, { status: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                  {LEAD_STATUSES.map((ls) => <option key={ls.value} value={ls.value}>{ls.label}</option>)}
                </select>
              )}
              {step.type === 'assign_agent' && (
                <select
                  value={
                    step.data?.mode === 'round_robin'
                      ? '__round_robin__'
                      : (step.data?.agentId || '')
                  }
                  onChange={(e) => {
                    if (e.target.value === '__round_robin__') {
                      updateStepData(idx, { mode: 'round_robin', agentId: '' });
                      return;
                    }
                    updateStepData(idx, { mode: 'specific', agentId: e.target.value });
                  }}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="__round_robin__">Sıradaki temsilci (round robin)</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>
          );
        })}

        <div className="mt-1 space-y-3">
          <p className="text-xs font-semibold text-gray-600">+ Adım ekle</p>
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Mesaj islemleri</p>
            <div className="flex flex-wrap gap-2">
              {STEP_TYPES.filter((s) => s.value === 'send_message').map((st) => (
                <button key={st.value} type="button" onClick={() => addStep(st.value as FlowStep['type'])} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${st.color}`}>
                  <st.icon className="w-3.5 h-3.5" />
                  {st.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Zaman islemleri</p>
            <div className="flex flex-wrap gap-2">
              {STEP_TYPES.filter((s) => s.value === 'wait' || s.value === 'condition').map((st) => (
                <button key={st.value} type="button" onClick={() => addStep(st.value as FlowStep['type'])} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${st.color}`}>
                  <st.icon className="w-3.5 h-3.5" />
                  {st.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Musteri islemleri</p>
            <div className="flex flex-wrap gap-2">
              {STEP_TYPES.filter((s) => s.value === 'set_lead_status' || s.value === 'assign_agent').map((st) => (
                <button key={st.value} type="button" onClick={() => addStep(st.value as FlowStep['type'])} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${st.color}`}>
                  <st.icon className="w-3.5 h-3.5" />
                  {st.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

