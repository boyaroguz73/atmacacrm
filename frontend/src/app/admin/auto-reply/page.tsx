'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import {
  Plus,
  Edit2,
  Trash2,
  Zap,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Clock,
  Tag,
  Target,
  UserPlus,
  GripVertical,
  X,
} from 'lucide-react';

interface FlowStep {
  id: string;
  type: 'send_message' | 'wait' | 'add_tag' | 'set_lead_status' | 'assign_agent';
  data: Record<string, any>;
  nextStepId?: string | null;
}

interface Flow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  trigger: string;
  conditions: any;
  steps: FlowStep[];
  createdAt: string;
  creator: { id: string; name: string };
}

const TRIGGERS = [
  { value: 'new_message', label: 'Her yeni mesaj' },
  { value: 'keyword', label: 'Anahtar kelime eşleşmesi' },
  { value: 'first_message', label: 'İlk mesaj (yeni kişi)' },
  { value: 'order_status', label: 'Sipariş durumu değişti' },
];

const ORDER_STATUS_OPTIONS = [
  { value: 'AWAITING_CHECKOUT', label: 'Sepet Terk (Henüz Tamamlanmadı)' },
  { value: 'AWAITING_PAYMENT', label: 'Ödeme Bekleniyor' },
  { value: 'PREPARING', label: 'Ürün Hazırlanıyor' },
  { value: 'SHIPPED', label: 'Kargoya Verildi' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'CANCELLED', label: 'İptal / İade' },
];

const STEP_TYPES = [
  { value: 'send_message', label: 'Mesaj Gönder', icon: MessageSquare, color: 'bg-green-50 text-green-700' },
  { value: 'wait', label: 'Bekle', icon: Clock, color: 'bg-yellow-50 text-yellow-700' },
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
    add_tag: { tag: '' },
    set_lead_status: { status: 'CONTACTED' },
    assign_agent: { agentId: '' },
  };
  return { id, type, data: defaults[type] || {} };
}

export default function AutoReplyPage() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingFlow, setEditingFlow] = useState<Flow | null>(null);
  const [expandedFlow, setExpandedFlow] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    trigger: 'keyword',
    conditions: [{ field: 'message_contains', operator: 'contains', value: '' }] as any,
    steps: [newStep('send_message')] as FlowStep[],
  });

  useEffect(() => {
    fetchFlows();
    fetchAgents();
  }, []);

  const fetchFlows = async () => {
    try {
      const { data } = await api.get('/auto-reply');
      setFlows(data);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const { data } = await api.get('/users');
      setAgents(data.filter((u: any) => u.role === 'AGENT' && u.isActive));
    } catch {}
  };

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        trigger: form.trigger,
        conditions:
          form.trigger === 'keyword'
            ? form.conditions
            : form.trigger === 'order_status'
              ? {
                  statuses: Array.isArray(form.conditions?.statuses)
                    ? form.conditions.statuses
                    : [],
                }
              : undefined,
        steps: form.steps,
      };

      if (editingFlow) {
        await api.patch(`/auto-reply/${editingFlow.id}`, payload);
      } else {
        await api.post('/auto-reply', payload);
      }
      setShowModal(false);
      setEditingFlow(null);
      fetchFlows();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Hata oluştu');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu akışı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/auto-reply/${id}`);
      fetchFlows();
    } catch {}
  };

  const handleToggle = async (flow: Flow) => {
    try {
      await api.patch(`/auto-reply/${flow.id}/toggle`);
      fetchFlows();
    } catch {}
  };

  const openEdit = (f: Flow) => {
    setEditingFlow(f);
    setForm({
      name: f.name,
      description: f.description || '',
      trigger: f.trigger,
      conditions:
        f.trigger === 'order_status'
          ? (f.conditions as any) || { statuses: [] }
          : (f.conditions as any[]) || [
              { field: 'message_contains', operator: 'contains', value: '' },
            ],
      steps: (f.steps as FlowStep[]) || [],
    });
    setShowModal(true);
  };

  const openNew = () => {
    setEditingFlow(null);
    setForm({
      name: '',
      description: '',
      trigger: 'keyword',
      conditions: [{ field: 'message_contains', operator: 'contains', value: '' }],
      steps: [newStep('send_message')],
    });
    setShowModal(true);
  };

  const addStep = (type: FlowStep['type']) => {
    setForm((prev) => ({ ...prev, steps: [...prev.steps, newStep(type)] }));
  };

  const removeStep = (idx: number) => {
    setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }));
  };

  const updateStepData = (idx: number, data: Record<string, any>) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === idx ? { ...s, data: { ...s.data, ...data } } : s)),
    }));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= form.steps.length) return;
    setForm((prev) => {
      const arr = [...prev.steps];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return { ...prev, steps: arr };
    });
  };

  const getStepType = (type: string) =>
    STEP_TYPES.find((s) => s.value === type) || STEP_TYPES[0];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Otomasyon</h1>
          <p className="text-sm text-gray-500 mt-1">
            Mesaj ve sipariş durumuna göre otomatik aksiyon akışları oluşturun. Sipariş durumlarında farklı senaryolarla temsilci ataması ve kişiselleştirilmiş WhatsApp mesajları gönderin.
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-whatsapp text-white rounded-lg hover:bg-green-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Akış
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
        </div>
      ) : flows.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Zap className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Henüz otomatik yanıt akışı oluşturulmamış</p>
        </div>
      ) : (
        <div className="space-y-3">
          {flows.map((f) => {
            const isExpanded = expandedFlow === f.id;
            return (
              <div
                key={f.id}
                className={`bg-white border rounded-xl overflow-hidden transition-shadow hover:shadow-sm ${!f.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between p-4">
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer"
                    onClick={() => setExpandedFlow(isExpanded ? null : f.id)}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${f.isActive ? 'bg-green-50' : 'bg-gray-100'}`}
                    >
                      <Zap
                        className={`w-5 h-5 ${f.isActive ? 'text-green-600' : 'text-gray-400'}`}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{f.name}</h3>
                      <p className="text-xs text-gray-400">
                        Tetikleyici: {TRIGGERS.find((t) => t.value === f.trigger)?.label || f.trigger}
                        {' · '}
                        {(f.steps as FlowStep[])?.length || 0} adım
                        {' · '}
                        {f.creator.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggle(f)}
                      className={`p-2 rounded-lg transition-colors ${f.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-50'}`}
                      title={f.isActive ? 'Durdur' : 'Başlat'}
                    >
                      {f.isActive ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => openEdit(f)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setExpandedFlow(isExpanded ? null : f.id)}
                      className="p-2 text-gray-400"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t bg-gray-50">
                    {f.description && (
                      <p className="text-sm text-gray-600 py-3">{f.description}</p>
                    )}
                    <div className="space-y-2 pt-2">
                      {((f.steps as FlowStep[]) || []).map((step, idx) => {
                        const st = getStepType(step.type);
                        const Icon = st.icon;
                        return (
                          <div
                            key={step.id}
                            className="flex items-center gap-2 bg-white rounded-lg p-3 border"
                          >
                            <span className="text-xs text-gray-400 font-mono w-6">{idx + 1}</span>
                            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${st.color}`}>
                              <Icon className="w-3.5 h-3.5" />
                              {st.label}
                            </div>
                            <span className="text-sm text-gray-600 truncate flex-1">
                              {step.type === 'send_message' && `"${step.data?.message?.slice(0, 60) || '...'}"`}
                              {step.type === 'wait' && `${step.data?.seconds || 0} saniye`}
                              {step.type === 'add_tag' && `Etiket: ${step.data?.tag || '-'}`}
                              {step.type === 'set_lead_status' &&
                                `Durum: ${LEAD_STATUSES.find((l) => l.value === step.data?.status)?.label || step.data?.status}`}
                              {step.type === 'assign_agent' && `Temsilci ID: ${step.data?.agentId || '-'}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Flow Builder Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
            <div className="p-5 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingFlow ? 'Akışı Düzenle' : 'Yeni Akış Oluştur'}
              </h2>
              <button
                onClick={() => { setShowModal(false); setEditingFlow(null); }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Akış Adı *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Örn: Hoş geldiniz mesajı"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Açıklama</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Bu akış ne yapıyor?"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
                  />
                </div>
              </div>

              {form.trigger === 'order_status' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sipariş Durumları
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ORDER_STATUS_OPTIONS.map((st) => {
                      const selected = Array.isArray((form.conditions as any)?.statuses)
                        ? (form.conditions as any).statuses.includes(st.value)
                        : false;
                      return (
                        <label
                          key={st.value}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ${
                            selected
                              ? 'border-whatsapp bg-green-50 text-green-700'
                              : 'border-gray-200 text-gray-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp"
                            checked={selected}
                            onChange={(e) => {
                              const prev = Array.isArray((form.conditions as any)?.statuses)
                                ? ([...(form.conditions as any).statuses] as string[])
                                : [];
                              const next = e.target.checked
                                ? Array.from(new Set([...prev, st.value]))
                                : prev.filter((x) => x !== st.value);
                              setForm({ ...form, conditions: { statuses: next } as any });
                            }}
                          />
                          {st.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Trigger */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tetikleyici *</label>
                <div className="grid grid-cols-3 gap-2">
                  {TRIGGERS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          trigger: t.value,
                          conditions:
                            t.value === 'keyword'
                              ? [{ field: 'message_contains', operator: 'contains', value: '' }]
                              : t.value === 'order_status'
                                ? { statuses: [] }
                                : [],
                        })
                      }
                      className={`p-3 border rounded-lg text-sm text-center transition-colors ${
                        form.trigger === t.value
                          ? 'border-whatsapp bg-green-50 text-green-700 font-medium'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conditions (only for keyword trigger) */}
              {form.trigger === 'keyword' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Koşullar</label>
                  <div className="space-y-2">
                    {form.conditions.map((cond: any, idx: number) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <select
                          value={cond.operator}
                          onChange={(e) => {
                            const newConds = [...form.conditions];
                            newConds[idx] = { ...cond, operator: e.target.value };
                            setForm({ ...form, conditions: newConds });
                          }}
                          className="px-2 py-2 border rounded-lg text-sm"
                        >
                          <option value="contains">İçeriyorsa</option>
                          <option value="equals">Tam eşleşiyorsa</option>
                          <option value="starts_with">İle başlıyorsa</option>
                          <option value="not_contains">İçermiyorsa</option>
                        </select>
                        <input
                          type="text"
                          value={cond.value}
                          onChange={(e) => {
                            const newConds = [...form.conditions];
                            newConds[idx] = { ...cond, value: e.target.value };
                            setForm({ ...form, conditions: newConds });
                          }}
                          placeholder="Anahtar kelime"
                          className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
                        />
                        {form.conditions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setForm({
                                ...form,
                                conditions: form.conditions.filter((_: any, i: number) => i !== idx),
                              });
                            }}
                            className="p-1.5 text-red-400 hover:text-red-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          conditions: [
                            ...form.conditions,
                            { field: 'message_contains', operator: 'contains', value: '' },
                          ],
                        })
                      }
                      className="text-sm text-whatsapp hover:text-green-700"
                    >
                      + Koşul Ekle
                    </button>
                  </div>
                </div>
              )}

              {/* Steps */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Akış Adımları</label>
                <div className="space-y-2">
                  {form.steps.map((step, idx) => {
                    const st = getStepType(step.type);
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
                          <button
                            type="button"
                            onClick={() => moveStep(idx, -1)}
                            disabled={idx === 0}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStep(idx, 1)}
                            disabled={idx === form.steps.length - 1}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeStep(idx)}
                            className="p-1 text-red-400 hover:text-red-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {step.type === 'send_message' && (
                          <div className="space-y-2">
                            <textarea
                              value={step.data?.message || ''}
                              onChange={(e) => updateStepData(idx, { message: e.target.value })}
                              rows={4}
                              placeholder="Gönderilecek mesaj..."
                              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20 resize-none"
                            />
                            <p className="text-[11px] text-gray-500">
                              Değişkenler: {'{Temsilci Adı}'}, {'{Ürünler}'}, {'{Sipariş Durumu}'}
                            </p>
                          </div>
                        )}
                        {step.type === 'wait' && (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={step.data?.seconds || 0}
                              onChange={(e) =>
                                updateStepData(idx, { seconds: parseInt(e.target.value) || 0 })
                              }
                              min={1}
                              max={30}
                              className="w-24 px-3 py-2 border rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-500">saniye (maks. 30)</span>
                          </div>
                        )}
                        {step.type === 'add_tag' && (
                          <input
                            type="text"
                            value={step.data?.tag || ''}
                            onChange={(e) => updateStepData(idx, { tag: e.target.value })}
                            placeholder="Etiket adı"
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                          />
                        )}
                        {step.type === 'set_lead_status' && (
                          <select
                            value={step.data?.status || 'CONTACTED'}
                            onChange={(e) => updateStepData(idx, { status: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                          >
                            {LEAD_STATUSES.map((ls) => (
                              <option key={ls.value} value={ls.value}>
                                {ls.label}
                              </option>
                            ))}
                          </select>
                        )}
                        {step.type === 'assign_agent' && (
                          <select
                            value={step.data?.agentId || ''}
                            onChange={(e) => updateStepData(idx, { agentId: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                          >
                            <option value="">Temsilci seçin</option>
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  {STEP_TYPES.map((st) => (
                    <button
                      key={st.value}
                      type="button"
                      onClick={() => addStep(st.value as FlowStep['type'])}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:shadow-sm ${st.color}`}
                    >
                      <st.icon className="w-3.5 h-3.5" />
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-5 border-t flex justify-end gap-2">
              <button
                onClick={() => { setShowModal(false); setEditingFlow(null); }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg text-sm"
              >
                İptal
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || form.steps.length === 0}
                className="px-4 py-2 bg-whatsapp text-white rounded-lg text-sm hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {editingFlow ? 'Güncelle' : 'Oluştur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
