'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import { PLAN_LABELS } from '@/lib/constants';
import {
  MessageSquareMore,
  ShoppingCart,
  ImageIcon,
  MessageSquare,
  Boxes,
  Truck,
  Bot,
  FileText,
  Crown,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

function integrationOrgParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (user?.organizationId) return {};
    const org = JSON.parse(localStorage.getItem('organization') || 'null');
    if (org?.id) return { organizationId: String(org.id) };
  } catch { /* ignore */ }
  return {};
}

type ModuleToggleKey =
  | 'whatsapp' | 'tsoft' | 'kartelas' | 'templates'
  | 'suppliers' | 'cargoCompanies' | 'automation' | 'quotes';

interface Integration {
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  includedInPlan: boolean;
  purchased: boolean;
  isEnabled: boolean;
  available: boolean;
  addonPrice: number;
  comingSoon: boolean;
  config: any;
}

interface Category {
  key: string;
  label: string;
  integrations: Integration[];
}

const MODULE_META: Array<{
  key: ModuleToggleKey;
  label: string;
  description: string;
  icon: any;
  detailPath: string;
}> = [
  { key: 'whatsapp',       label: 'WhatsApp',         description: 'Oturum ve mesaj akışı yönetimi',          icon: MessageSquareMore, detailPath: '/admin/integrations/whatsapp' },
  { key: 'tsoft',          label: 'T-Soft',            description: 'Sipariş, ürün ve müşteri senkronizasyonu', icon: ShoppingCart,      detailPath: '/admin/integrations/tsoft' },
  { key: 'kartelas',       label: 'Kartela',           description: 'Kartela yükleme ve sohbetten gönderim',   icon: ImageIcon,         detailPath: '/admin/integrations/kartelas' },
  { key: 'templates',      label: 'Mesaj Şablonları',  description: 'Hazır mesaj şablon yönetimi',             icon: MessageSquare,     detailPath: '/admin/integrations/templates' },
  { key: 'suppliers',      label: 'Tedarikçiler',      description: 'Tedarikçi kayıtları ve ayarları',         icon: Boxes,             detailPath: '/admin/integrations/suppliers' },
  { key: 'cargoCompanies', label: 'Kargo Firmaları',   description: 'Kargo firma tanımları',                   icon: Truck,             detailPath: '/admin/integrations/cargoCompanies' },
  { key: 'automation',     label: 'Otomasyon',         description: 'Otomatik yanıt kuralları',                icon: Bot,               detailPath: '/admin/integrations/automation' },
  { key: 'quotes',         label: 'Teklifler',         description: 'Teklif menüsü ve sohbet aksiyonları',     icon: FileText,          detailPath: '/admin/integrations/quotes' },
];

const MODULE_GROUPS: Array<{ label: string; keys: ModuleToggleKey[] }> = [
  { label: 'Mesajlaşma',    keys: ['whatsapp', 'templates', 'automation', 'kartelas'] },
  { label: 'E-Ticaret',     keys: ['tsoft'] },
  { label: 'Ek Modüller',   keys: ['suppliers', 'cargoCompanies', 'quotes'] },
];

const ACTIVE_INTEGRATION_KEYS = new Set(['whatsapp', 'tsoft']);

const INTEGRATION_COLORS: Record<string, string> = {
  whatsapp: 'from-green-500 to-green-600',
  tsoft:    'from-orange-500 to-orange-600',
};

function Toggle({ enabled, loading, onToggle }: { enabled: boolean; loading: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      disabled={loading}
      aria-label={enabled ? 'Kapat' : 'Aç'}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
        enabled ? 'bg-green-500' : 'bg-gray-200'
      }`}
    >
      {loading ? (
        <Loader2 className="absolute inset-0 m-auto w-3 h-3 text-white animate-spin" />
      ) : (
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      )}
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="flex items-center gap-4 p-4 rounded-2xl border border-gray-100 bg-white animate-pulse">
      <div className="w-10 h-10 rounded-xl bg-gray-100 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-gray-100 rounded w-1/3" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
      </div>
      <div className="w-9 h-5 bg-gray-100 rounded-full shrink-0" />
    </div>
  );
}

export default function IntegrationsPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [plan, setPlan] = useState('FREE');
  const [loading, setLoading] = useState(true);
  const [moduleToggles, setModuleToggles] = useState<Record<ModuleToggleKey, boolean> | null>(null);
  const [savingKey, setSavingKey] = useState<ModuleToggleKey | null>(null);

  const fetchCatalog = useCallback(async () => {
    try {
      const { data } = await api.get('/integrations', { params: integrationOrgParams() });
      setCategories(Array.isArray(data?.categories) ? data.categories : []);
      setPlan(typeof data?.plan === 'string' ? data.plan : 'FREE');
    } catch (err) {
      toast.error('Entegrasyonlar yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  useEffect(() => {
    api.get<{ toggles?: Record<ModuleToggleKey, boolean> }>('/organizations/my/module-toggles')
      .then(({ data }) => { if (data?.toggles) setModuleToggles(data.toggles); })
      .catch(() => {});
  }, []);

  const persistToggles = useCallback(async (next: Record<ModuleToggleKey, boolean>) => {
    await api.patch('/organizations/my/module-toggles', next);
    if (next.quotes === false || next.quotes === true) {
      const { data } = await api.get<{ preview?: Record<string, string[]> }>('/organizations/my/menu-visibility');
      const preview = data?.preview || {};
      const update = (arr?: string[]) => {
        const base = (arr || []).filter((k) => k !== 'quotes');
        return next.quotes ? [...base, 'quotes'] : base;
      };
      await api.patch('/organizations/my/menu-visibility', {
        AGENT: update(preview.AGENT),
        ACCOUNTANT: update(preview.ACCOUNTANT),
        ADMIN: update(preview.ADMIN),
      });
    }
    window.dispatchEvent(new Event('crm-menu-visibility-changed'));
  }, []);

  const handleToggle = async (key: ModuleToggleKey) => {
    if (!moduleToggles || savingKey) return;
    const next = { ...moduleToggles, [key]: !moduleToggles[key] };
    setModuleToggles(next);
    setSavingKey(key);
    try {
      await persistToggles(next);
      const label = MODULE_META.find((m) => m.key === key)?.label || 'Modül';
      toast.success(`${label} ${next[key] ? 'aktif edildi' : 'devre dışı bırakıldı'}`);
    } catch (err) {
      setModuleToggles(moduleToggles);
      toast.error('Bir sorun oluştu, lütfen tekrar deneyin');
    } finally {
      setSavingKey(null);
    }
  };

  const handleIntegrationToggle = async (key: string, currentEnabled: boolean) => {
    const moduleKey = key as ModuleToggleKey;
    if (!moduleToggles || savingKey) return;
    const next = { ...moduleToggles, [moduleKey]: !currentEnabled };
    setModuleToggles(next);
    setSavingKey(moduleKey);
    try {
      await api.post(`/integrations/${key}/toggle`, { enable: !currentEnabled }, { params: integrationOrgParams() });
      await persistToggles(next);
      await fetchCatalog();
      toast.success(!currentEnabled ? 'Entegrasyon aktif edildi' : 'Entegrasyon devre dışı bırakıldı');
    } catch (err) {
      setModuleToggles(moduleToggles);
      toast.error('Bir sorun oluştu, lütfen tekrar deneyin');
    } finally {
      setSavingKey(null);
    }
  };

  const integrationMap = useMemo(() => {
    const map: Record<string, Integration> = {};
    for (const cat of categories) {
      for (const integ of cat.integrations ?? []) {
        if (ACTIVE_INTEGRATION_KEYS.has(integ.key)) map[integ.key] = integ;
      }
    }
    return map;
  }, [categories]);

  const metaByKey = useMemo(
    () => Object.fromEntries(MODULE_META.map((m) => [m.key, m])) as Record<ModuleToggleKey, typeof MODULE_META[number]>,
    [],
  );

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Modüller ve Entegrasyonlar</h1>
            <p className="text-sm text-gray-500 mt-0.5">Kullandığınız özellikleri açın, kapatın veya yapılandırın.</p>
          </div>
          {!loading && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-xl shrink-0">
              <Crown className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-xs font-medium text-gray-600">{PLAN_LABELS[plan] || plan}</span>
            </div>
          )}
        </div>

        {/* Groups */}
        {loading ? (
          <div className="space-y-8">
            {[4, 1, 3].map((count, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 bg-gray-200 rounded w-24 animate-pulse mb-3" />
                {Array.from({ length: count }).map((_, j) => <SkeletonCard key={j} />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {MODULE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{group.label}</p>
                <div className="space-y-2">
                  {group.keys.map((key) => {
                    const meta = metaByKey[key];
                    const Icon = meta.icon;
                    const integ = integrationMap[key];
                    const isIntegration = ACTIVE_INTEGRATION_KEYS.has(key);
                    const enabled = moduleToggles?.[key] ?? false;
                    const isSaving = savingKey === key;
                    const color = INTEGRATION_COLORS[key];

                    return (
                      <div
                        key={key}
                        onClick={() => router.push(meta.detailPath)}
                        className="group flex items-center gap-4 p-4 rounded-2xl border border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer active:scale-[0.995]"
                      >
                        {/* Icon */}
                        {key === 'whatsapp' || key === 'tsoft' ? (
                          <img
                            src={`/module-logos/${key}.png`}
                            alt={meta.label}
                            className="w-10 h-10 shrink-0 rounded-xl object-contain border border-gray-100 p-1.5 bg-white"
                          />
                        ) : (
                          <div
                            className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center"
                            style={{
                              backgroundColor: enabled
                                ? 'color-mix(in srgb, var(--color-primary, #25D366) 12%, white)'
                                : '#f3f4f6',
                              color: enabled ? 'var(--color-primary, #25D366)' : '#9ca3af',
                            }}
                          >
                            <Icon className="w-5 h-5" />
                          </div>
                        )}

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{meta.label}</p>
                          <p className="text-xs text-gray-400 truncate mt-0.5">{meta.description}</p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3 shrink-0">
                          <Toggle
                            enabled={enabled}
                            loading={isSaving}
                            onToggle={() => {
                              if (isIntegration && integ) {
                                void handleIntegrationToggle(key, integ.isEnabled);
                              } else {
                                void handleToggle(key);
                              }
                            }}
                          />
                          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-400 transition-colors" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
