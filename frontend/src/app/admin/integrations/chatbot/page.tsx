'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import {
  ArrowLeft, Bot, Save, Loader2, CheckCircle2, XCircle,
  ChevronDown, Play, RefreshCw, Plus, Trash2, Eye, Check, X,
} from 'lucide-react';
import toast from 'react-hot-toast';

function orgParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (user?.organizationId) return {};
    const org = JSON.parse(localStorage.getItem('organization') || 'null');
    if (org?.id) return { organizationId: String(org.id) };
  } catch { /* ignore */ }
  return {};
}

const TABS = [
  { key: 'general',    label: 'Genel Ayarlar' },
  { key: 'policies',   label: 'İzinler' },
  { key: 'memory',     label: 'İşletme Hafızası' },
  { key: 'prompts',    label: 'Promptlar' },
  { key: 'rules',      label: 'Otomasyon Kuralları' },
  { key: 'pending',    label: 'Onay Bekleyenler' },
  { key: 'logs',       label: 'Loglar' },
] as const;
type TabKey = typeof TABS[number]['key'];

const ACTION_LABELS: Record<string, string> = {
  send_message:        'Mesaj Gönder',
  ask_question:        'Soru Sor',
  suggest_product:     'Ürün Öner',
  create_offer:        'Teklif Oluştur',
  send_offer:          'Teklif Gönder',
  create_order:        'Sipariş Oluştur',
  send_payment_link:   'Ödeme Linki Gönder',
  update_customer_note:'Müşteri Notu Güncelle',
  assign_tag:          'Etiket Ata',
  handoff_to_human:    'İnsana Devret',
};

const MODE_OPTIONS = [
  { value: 'OFF',  label: 'Kapalı',   color: 'bg-gray-100 text-gray-600' },
  { value: 'ASK',  label: 'Onay İste', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'AUTO', label: 'Otomatik',  color: 'bg-green-100 text-green-700' },
];

/* ─── General Settings Tab ─── */
function GeneralTab() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; model?: string } | null>(null);
  const params = orgParams();

  useEffect(() => {
    api.get('/ai/config', { params }).then(({ data }) => setConfig(data)).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch('/ai/config', config, { params });
      setConfig(data);
      toast.success('Kaydedildi');
    } catch { toast.error('Kayıt başarısız'); }
    finally { setSaving(false); }
  };

  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/ai/test', {}, { params });
      setTestResult({ ok: true, model: data.model });
    } catch {
      setTestResult({ ok: false });
    } finally { setTesting(false); }
  };

  if (!config) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>;

  return (
    <div className="space-y-6">
      {/* Enable toggle */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">AI Chatbot Aktif</p>
            <p className="text-xs text-gray-400 mt-0.5">Gelen mesajlara otomatik yanıt verilsin mi?</p>
          </div>
          <button
            onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            className={`relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors ${config.enabled ? 'bg-green-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${config.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* OpenAI Key */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-900">OpenAI Bağlantısı</p>
        <div>
          <label className="block text-xs text-gray-500 mb-1">API Anahtarı</label>
          <input
            type="password"
            placeholder="sk-..."
            value={config.openaiKey ?? ''}
            onChange={(e) => setConfig({ ...config, openaiKey: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Model</label>
            <select
              value={config.model ?? 'gpt-4o-mini'}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
            >
              <option value="gpt-4o-mini">GPT-4o Mini</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mod</label>
            <select
              value={config.mode ?? 'SUPERVISED'}
              onChange={(e) => setConfig({ ...config, mode: e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
            >
              <option value="SUPERVISED">Denetimli</option>
              <option value="AUTONOMOUS">Otonom</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Temperature ({config.temperature ?? 0.7})</label>
            <input
              type="range" min="0" max="1" step="0.1"
              value={config.temperature ?? 0.7}
              onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Max Token</label>
            <input
              type="number" min="50" max="4000" step="50"
              value={config.maxTokens ?? 500}
              onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) })}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={testConn}
            disabled={testing}
            className="flex items-center gap-2 text-sm px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Bağlantıyı Test Et
          </button>
          {testResult && (
            <span className={`flex items-center gap-1.5 text-sm font-medium ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testResult.ok
                ? <><CheckCircle2 className="w-4 h-4" /> Bağlantı başarılı ({testResult.model})</>
                : <><XCircle className="w-4 h-4" /> Bağlantı başarısız</>
              }
            </span>
          )}
        </div>
      </div>

      {/* Customer memory */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Müşteri Hafızası</p>
            <p className="text-xs text-gray-400 mt-0.5">Müşteri geçmişi ve tercihlerini hatırla</p>
          </div>
          <button
            onClick={() => setConfig({ ...config, customerMemoryEnabled: !config.customerMemoryEnabled })}
            className={`relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors ${config.customerMemoryEnabled ? 'bg-green-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${config.customerMemoryEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 text-sm bg-gray-900 text-white px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Kaydet
      </button>
    </div>
  );
}

/* ─── Action Policies Tab ─── */
function PoliciesTab() {
  const [policies, setPolicies] = useState<Array<{ action: string; mode: string }>>([]);
  const [saving, setSaving] = useState(false);
  const params = orgParams();

  useEffect(() => {
    api.get('/ai/action-policies', { params }).then(({ data }) => setPolicies(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const setMode = (action: string, mode: string) => {
    setPolicies((prev) => prev.map((p) => p.action === action ? { ...p, mode } : p));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch('/ai/action-policies', { policies }, { params });
      setPolicies(Array.isArray(data) ? data : policies);
      toast.success('İzinler kaydedildi');
    } catch { toast.error('Kayıt başarısız'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">AI&apos;nın hangi aksiyonları otomatik yapabileceğini veya onay gerektireceğini belirleyin.</p>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {policies.map((p, i) => (
          <div key={p.action} className={`flex items-center gap-4 px-5 py-3.5 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
            <p className="flex-1 text-sm text-gray-800">{ACTION_LABELS[p.action] ?? p.action}</p>
            <div className="flex items-center gap-1.5">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setMode(p.action, opt.value)}
                  className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${p.mode === opt.value ? opt.color : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 text-sm bg-gray-900 text-white px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Kaydet
      </button>
    </div>
  );
}

/* ─── Memory Tab ─── */
function MemoryTab() {
  const [memory, setMemory] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const params = orgParams();

  const loadMemory = useCallback(async () => {
    const { data } = await api.get('/ai/memory', { params });
    setMemory(data);
    return data;
  }, []);

  useEffect(() => {
    loadMemory().catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadMemory]);

  const startAnalysis = async () => {
    setAnalyzing(true);
    try {
      await api.post('/ai/memory/analyze', {}, { params });
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get('/ai/memory/analyze/status', { params });
          setMemory((prev: any) => prev ? { ...prev, ...data } : data);
          if (data.status === 'done' || data.status === 'failed') {
            clearInterval(pollRef.current!);
            setAnalyzing(false);
            await loadMemory();
            if (data.status === 'done') toast.success('Analiz tamamlandı');
            else toast.error('Analiz başarısız: ' + (data.error ?? ''));
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch (err: any) {
      setAnalyzing(false);
      toast.error(err?.response?.data?.message ?? 'Analiz başlatılamadı');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch('/ai/memory', {
        rawMemory: memory.rawMemory,
        sector: memory.sector,
        tone: memory.tone,
        salesStyle: memory.salesStyle,
        pricingBehavior: memory.pricingBehavior,
        objectionPatterns: memory.objectionPatterns,
        closingPatterns: memory.closingPatterns,
      }, { params });
      setMemory(data);
      toast.success('Hafıza kaydedildi');
    } catch { toast.error('Kayıt başarısız'); }
    finally { setSaving(false); }
  };

  if (!memory) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>;

  const isRunning = memory.analyzeStatus === 'running';
  const progress = memory.analyzeProgress ?? 0;

  return (
    <div className="space-y-5">
      {/* Analyze button */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Otomatik Analiz</p>
            <p className="text-xs text-gray-400 mt-0.5">Son konuşmalar analiz edilerek işletme hafızası oluşturulur</p>
          </div>
          <button
            onClick={startAnalysis}
            disabled={analyzing || isRunning}
            className="flex items-center gap-2 text-sm px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {analyzing || isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Analiz Başlat
          </button>
        </div>
        {(analyzing || isRunning) && (
          <div className="space-y-1">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gray-900 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-gray-400">%{progress} tamamlandı...</p>
          </div>
        )}
        {memory.analyzedAt && !isRunning && (
          <p className="text-xs text-gray-400">Son analiz: {new Date(memory.analyzedAt).toLocaleString('tr-TR')}</p>
        )}
      </div>

      {/* Memory fields */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-900">İşletme Hafızası</p>
        {[
          { key: 'sector', label: 'Sektör' },
          { key: 'tone', label: 'İletişim Tonu' },
          { key: 'salesStyle', label: 'Satış Yaklaşımı' },
          { key: 'pricingBehavior', label: 'Fiyatlandırma Davranışı' },
          { key: 'objectionPatterns', label: 'Yaygın İtirazlar' },
          { key: 'closingPatterns', label: 'Kapanış Stratejileri' },
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="block text-xs text-gray-500 mb-1">{label}</label>
            <input
              type="text"
              value={(memory as any)[key] ?? ''}
              onChange={(e) => setMemory({ ...memory, [key]: e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        ))}
        <div>
          <label className="block text-xs text-gray-500 mb-1">İşletme Özeti</label>
          <textarea
            rows={4}
            value={memory.rawMemory ?? ''}
            onChange={(e) => setMemory({ ...memory, rawMemory: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 text-sm bg-gray-900 text-white px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Kaydet
      </button>
    </div>
  );
}

/* ─── Prompts Tab ─── */
function PromptsTab() {
  const [prompts, setPrompts] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const params = orgParams();

  useEffect(() => {
    api.get('/ai/prompts', { params }).then(({ data }) => setPrompts(data)).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch('/ai/prompts', prompts, { params });
      setPrompts(data);
      toast.success('Promptlar kaydedildi');
    } catch { toast.error('Kayıt başarısız'); }
    finally { setSaving(false); }
  };

  if (!prompts) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-5">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Sistem Promptu</label>
          <p className="text-xs text-gray-400 mb-2">AI&apos;nın temel davranışını ve kimliğini belirler</p>
          <textarea
            rows={5}
            value={prompts.systemPrompt ?? ''}
            onChange={(e) => setPrompts({ ...prompts, systemPrompt: e.target.value })}
            placeholder="Siz [şirket adı] müşteri hizmetleri asistanısınız..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Satış Promptu</label>
          <textarea
            rows={4}
            value={prompts.salesPrompt ?? ''}
            onChange={(e) => setPrompts({ ...prompts, salesPrompt: e.target.value })}
            placeholder="Müşteri ürün sorduğunda..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Destek Promptu</label>
          <textarea
            rows={4}
            value={prompts.supportPrompt ?? ''}
            onChange={(e) => setPrompts({ ...prompts, supportPrompt: e.target.value })}
            placeholder="Müşteri şikayet veya sorun bildirdiğinde..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ton</label>
            <select
              value={prompts.tone ?? 'PROFESSIONAL'}
              onChange={(e) => setPrompts({ ...prompts, tone: e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
            >
              <option value="PROFESSIONAL">Profesyonel</option>
              <option value="FRIENDLY">Samimi</option>
              <option value="FORMAL">Resmi</option>
              <option value="CASUAL">Gündelik</option>
              <option value="CUSTOM">Özel</option>
            </select>
          </div>
          {prompts.tone === 'CUSTOM' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Özel Ton Açıklaması</label>
              <input
                type="text"
                value={prompts.customTone ?? ''}
                onChange={(e) => setPrompts({ ...prompts, customTone: e.target.value })}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 text-sm bg-gray-900 text-white px-5 py-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Kaydet
      </button>
    </div>
  );
}

/* ─── Automation Rules Tab ─── */
function RulesTab() {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTrigger, setNewTrigger] = useState('');
  const params = orgParams();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/ai/automation-rules', { params });
      setRules(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!newTrigger.trim()) return;
    setCreating(true);
    try {
      await api.post('/ai/automation-rules', { trigger: newTrigger.trim() }, { params });
      setNewTrigger('');
      await load();
    } catch { toast.error('Kural eklenemedi'); }
    finally { setCreating(false); }
  };

  const toggle = async (rule: any) => {
    try {
      await api.patch(`/ai/automation-rules/${rule.id}`, { enabled: !rule.enabled }, { params });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    } catch { toast.error('Güncellenemedi'); }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/ai/automation-rules/${id}`, { params });
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch { toast.error('Silinemedi'); }
  };

  return (
    <div className="space-y-5">
      {/* Add rule */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <p className="text-sm font-semibold text-gray-900 mb-3">Yeni Kural</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newTrigger}
            onChange={(e) => setNewTrigger(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Tetikleyici tanımı (ör: müşteri iade istedi)"
            className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            onClick={create}
            disabled={creating || !newTrigger.trim()}
            className="flex items-center gap-1.5 text-sm px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Ekle
          </button>
        </div>
      </div>

      {/* Rules list */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
      ) : rules.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-400">Henüz otomasyon kuralı eklenmemiş.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {rules.map((rule, i) => (
            <div key={rule.id} className={`flex items-center gap-4 px-5 py-3.5 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{rule.trigger}</p>
              </div>
              <button
                onClick={() => toggle(rule)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${rule.enabled ? 'bg-green-500' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <button onClick={() => remove(rule.id)} className="shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Pending Actions Tab ─── */
function PendingTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('PENDING');
  const params = orgParams();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/ai/pending', { params: { ...params, status: filter } });
      setItems(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const review = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      await api.patch(`/ai/pending/${id}/review`, { decision }, { params });
      await load();
      toast.success(decision === 'APPROVED' ? 'Onaylandı' : 'Reddedildi');
    } catch { toast.error('İşlem yapılamadı'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${filter === s ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            {s === 'PENDING' ? 'Bekleyenler' : s === 'APPROVED' ? 'Onaylananlar' : 'Reddedilenler'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-400">Kayıt bulunamadı.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {items.map((item, i) => (
            <div key={item.id} className={`px-5 py-4 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{ACTION_LABELS[item.action] ?? item.action}</p>
                  {item.payload && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{JSON.stringify(item.payload)}</p>
                  )}
                  <p className="text-xs text-gray-300 mt-1">{new Date(item.createdAt).toLocaleString('tr-TR')}</p>
                </div>
                {item.status === 'PENDING' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => review(item.id, 'APPROVED')}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors font-medium"
                    >
                      <Check className="w-3 h-3" /> Onayla
                    </button>
                    <button
                      onClick={() => review(item.id, 'REJECTED')}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors font-medium"
                    >
                      <X className="w-3 h-3" /> Reddet
                    </button>
                  </div>
                )}
                {item.status !== 'PENDING' && (
                  <span className={`shrink-0 text-xs px-2.5 py-1 rounded-lg font-medium ${item.status === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {item.status === 'APPROVED' ? 'Onaylandı' : 'Reddedildi'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Logs Tab ─── */
function LogsTab() {
  const [logs, setLogs] = useState<{ total: number; items: any[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const params = orgParams();
  const take = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/ai/logs', { params: { ...params, skip: page * take, take } });
      setLogs(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      SUCCESS: 'bg-green-100 text-green-700',
      FAILED:  'bg-red-100 text-red-600',
      PENDING: 'bg-yellow-100 text-yellow-700',
    };
    return map[status] ?? 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
      ) : logs.items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-400">Log kaydı bulunamadı.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {logs.items.map((log, i) => (
              <div key={log.id} className={`flex items-start gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm text-gray-800">{ACTION_LABELS[log.action] ?? log.action}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${statusBadge(log.status)}`}>{log.status}</span>
                  </div>
                  {log.error && <p className="text-xs text-red-400 truncate">{log.error}</p>}
                  <p className="text-xs text-gray-300">{new Date(log.createdAt).toLocaleString('tr-TR')}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Toplam {logs.total} kayıt</span>
            <div className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Önceki</button>
              <span>{page + 1} / {Math.max(1, Math.ceil(logs.total / take))}</span>
              <button disabled={(page + 1) * take >= logs.total} onClick={() => setPage(page + 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">Sonraki</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function ChatbotPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('general');

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Back + header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/admin/integrations')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Modüller
          </button>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gray-900 flex items-center justify-center">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">AI Chatbot</h1>
              <p className="text-sm text-gray-400 mt-0.5">GPT tabanlı akıllı müşteri yanıtlayıcı</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 text-xs font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'general'  && <GeneralTab />}
        {tab === 'policies' && <PoliciesTab />}
        {tab === 'memory'   && <MemoryTab />}
        {tab === 'prompts'  && <PromptsTab />}
        {tab === 'rules'    && <RulesTab />}
        {tab === 'pending'  && <PendingTab />}
        {tab === 'logs'     && <LogsTab />}
      </div>
    </div>
  );
}
