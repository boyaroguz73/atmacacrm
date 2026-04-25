'use client';

import { useEffect, useState, useCallback } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import { PLAN_LABELS } from '@/lib/constants';
import {
  MessageSquare,
  Bot,
  ShoppingCart,
  Lock,
  Crown,
  ToggleLeft,
  ToggleRight,
  ShoppingBag,
  X,
  Wifi,
  WifiOff,
  Play,
  Square,
  QrCode,
  Trash2,
  Plus,
  RefreshCw,
  Loader2,
  RotateCcw,
  ArrowLeft,
  Settings,
  ExternalLink,
  Save,
  Key,
  Globe,
  Bug,
  ImageIcon,
  MessageSquareMore,
} from 'lucide-react';
import toast from 'react-hot-toast';

/** JWT’de organizationId yoksa (çoğunlukla SUPERADMIN) seçili org’u query ile gönder */
function integrationOrgParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    /** JWT’de org varsa backend zaten kullanır; yoksa (SUPERADMIN veya eksik kayıt) seçili org’u query ile gönder */
    if (user?.organizationId) return {};
    const org = JSON.parse(localStorage.getItem('organization') || 'null');
    if (org?.id) return { organizationId: String(org.id) };
  } catch {
    /* ignore */
  }
  return {};
}

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

interface Session {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  wahaStatus: string | null;
}

const AVATAR_REFRESH_FORCE_KEY = 'crm_settings_avatar_refresh_force';

const CATEGORY_ICONS: Record<string, any> = {
  messaging: MessageSquare,
  ai: Bot,
  ecommerce: ShoppingCart,
};

const INTEGRATION_COLORS: Record<string, string> = {
  whatsapp: 'from-green-500 to-green-600',
  instagram: 'from-pink-500 to-purple-500',
  facebook: 'from-blue-600 to-blue-700',
  telegram: 'from-sky-400 to-sky-500',
  chatbot: 'from-violet-500 to-purple-600',
  tsoft: 'from-orange-500 to-orange-600',
  ticimax: 'from-red-500 to-red-600',
  ikas: 'from-indigo-500 to-indigo-600',
  shopify: 'from-lime-500 to-green-500',
  ideasoft: 'from-cyan-500 to-blue-500',
};

const ACTIVE_INTEGRATION_KEYS = new Set(['whatsapp', 'tsoft']);

function BrandLogo({ k, size = 20 }: { k: string; size?: number }) {
  const s = size;
  switch (k) {
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} fill="white">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} fill="white">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} fill="white">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
      );
    case 'telegram':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} fill="white">
          <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
      );
    case 'chatbot':
      return <Bot size={s} className="text-white" />;
    case 'shopify':
      return (
        <svg viewBox="0 0 24 24" width={s} height={s} fill="white">
          <path d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.74c-.018-.126-.114-.196-.196-.238-.084-.042-.168-.042-.168-.042s-1.394-.084-2.247-.168c-.42-.042-.629-.294-.671-.588-.126-.042-.252-.042-.378-.084a3.146 3.146 0 00-.126-.504c-.378-.924-1.092-1.428-1.89-1.428-.084 0-.168 0-.252.042-.042-.042-.084-.084-.126-.126C13.538 1.122 13.034.87 12.446.87c-1.134 0-2.226.882-3.108 2.478-.63 1.134-1.092 2.562-1.218 3.654-.126.042-1.26.378-1.26.378-.378.126-.42.126-.462.504-.042.252-1.05 8.064-1.05 8.064l8.989 1.656V23.979zm-2.52-17.74c-.042 0-.588.168-1.428.462.294-1.218.882-2.394 1.596-3.15.294-.294.672-.588 1.092-.756.378.756.546 1.848.546 3.024 0 .126 0 .252-.042.42h-.042c-.588 0-1.218 0-1.722 0zm1.974-.294c0 .168 0 .336-.042.546-.462.126-.966.294-1.512.42.294-1.134.84-2.268 1.386-2.94.21-.252.504-.462.84-.63.21.588.328 1.386.328 2.604zm-1.176-3.864c.252 0 .504.084.714.252-.378.168-.714.462-1.05.84-.756.84-1.344 2.142-1.638 3.402-.42.126-.798.252-1.176.336.378-2.184 1.848-4.83 3.15-4.83z"/>
        </svg>
      );
    case 'tsoft':
      return <span className="text-white font-black text-[10px] leading-none">TS</span>;
    case 'ticimax':
      return <span className="text-white font-black text-[10px] leading-none">TX</span>;
    case 'ikas':
      return <span className="text-white font-black text-[9px] leading-none tracking-tight">ikas</span>;
    case 'ideasoft':
      return <span className="text-white font-black text-[9px] leading-none">IS</span>;
    default:
      return <ShoppingBag size={s} className="text-white" />;
  }
}

const statusConfig: Record<string, { label: string; color: string }> = {
  WORKING: { label: 'Bağlı', color: 'text-green-600 bg-green-50' },
  SCAN_QR: { label: 'QR Bekliyor', color: 'text-yellow-600 bg-yellow-50' },
  SCAN_QR_CODE: { label: 'QR Bekliyor', color: 'text-yellow-600 bg-yellow-50' },
  STARTING: { label: 'Başlatılıyor', color: 'text-blue-600 bg-blue-50' },
  STOPPED: { label: 'Durduruldu', color: 'text-gray-600 bg-gray-50' },
  FAILED: { label: 'Hata', color: 'text-red-600 bg-red-50' },
};

export default function IntegrationsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [plan, setPlan] = useState('FREE');
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const fetchCatalog = useCallback(async () => {
    try {
      const { data } = await api.get('/integrations', {
        params: integrationOrgParams(),
      });
      setCategories(Array.isArray(data?.categories) ? data.categories : []);
      setPlan(typeof data?.plan === 'string' ? data.plan : 'FREE');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Entegrasyonlar yüklenemedi'));
      setCategories([]);
      setPlan('FREE');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const handleToggle = async (key: string, enable: boolean) => {
    setToggling(key);
    try {
      await api.post(`/integrations/${key}/toggle`, { enable }, { params: integrationOrgParams() });
      await fetchCatalog();
      toast.success(enable ? 'Entegrasyon aktif edildi' : 'Entegrasyon pasif yapıldı');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'İşlem başarısız'));
    } finally {
      setToggling(null);
    }
  };

  const handlePurchase = async (integration: Integration) => {
    if (!confirm(`${integration.name} eklentisini ${integration.addonPrice} TL/ay karşılığında satın almak istiyor musunuz?`)) return;
    setPurchasing(integration.key);
    try {
      await api.post(
        `/integrations/${integration.key}/purchase`,
        {},
        { params: integrationOrgParams() },
      );
      await fetchCatalog();
      toast.success(`${integration.name} eklentisi satın alındı`);
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Satın alma başarısız'));
    } finally {
      setPurchasing(null);
    }
  };

  const allIntegrations = categories.flatMap((c) =>
    Array.isArray(c?.integrations) ? c.integrations : [],
  );
  const visibleCategories = categories
    .map((c) => ({
      ...c,
      integrations: (Array.isArray(c?.integrations) ? c.integrations : []).filter((i) =>
        ACTIVE_INTEGRATION_KEYS.has(i.key),
      ),
    }))
    .filter((c) => c.integrations.length > 0);
  const visibleIntegrations = visibleCategories.flatMap((c) => c.integrations);
  const hiddenIntegrations = allIntegrations.filter((i) => !ACTIVE_INTEGRATION_KEYS.has(i.key));
  const selected = visibleIntegrations.find((i) => i.key === selectedKey) || null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left: Card Grid */}
      <div className={`flex-1 overflow-y-auto p-6 space-y-6 transition-all ${selected ? 'max-w-[50%]' : ''}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Entegrasyonlar</h1>
            <p className="text-gray-500 mt-1">
              Mesajlaşma kanalları, e-ticaret ve yapay zeka entegrasyonlarınızı yönetin
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-xl">
            <Crown className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-medium text-gray-700">
              {PLAN_LABELS[plan] || plan} Paket
            </span>
          </div>
        </div>

        {visibleCategories.map((category) => {
          const CatIcon = CATEGORY_ICONS[category.key] || ShoppingBag;
          const items = Array.isArray(category?.integrations) ? category.integrations : [];
          return (
            <div key={category.key}>
              <div className="flex items-center gap-2 mb-2">
                <CatIcon className="w-4 h-4 text-gray-400" />
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{category.label}</h2>
              </div>
              <div className={`grid gap-2 ${selected ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'}`}>
                {items.map((integration) => (
                  <IntegrationCard
                    key={integration.key}
                    integration={integration}
                    isSelected={selectedKey === integration.key}
                    onSelect={() => setSelectedKey(selectedKey === integration.key ? null : integration.key)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {hiddenIntegrations.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
            <p className="text-xs font-semibold text-amber-800">Yakında</p>
            <p className="text-xs text-amber-700 mt-1">
              {hiddenIntegrations.map((i) => i.name).join(', ')} entegrasyonları yakında eklenecek.
            </p>
          </div>
        ) : null}
      </div>

      {/* Right: Detail Panel */}
      {selected && (
        <div className="w-[50%] border-l border-gray-200 bg-gray-50 overflow-y-auto flex flex-col">
          <DetailPanel
            integration={selected}
            onClose={() => setSelectedKey(null)}
            onToggle={handleToggle}
            onPurchase={handlePurchase}
            toggling={toggling === selected.key}
            purchasing={purchasing === selected.key}
            onRefreshCatalog={fetchCatalog}
          />
        </div>
      )}
    </div>
  );
}

function IntegrationCard({
  integration,
  isSelected,
  onSelect,
}: {
  integration: Integration;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const gradient = INTEGRATION_COLORS[integration.key] || 'from-gray-500 to-gray-600';

  const statusDot = integration.comingSoon
    ? 'bg-amber-400'
    : integration.isEnabled
    ? 'bg-green-500'
    : !integration.available
    ? 'bg-gray-300'
    : 'bg-gray-300';

  return (
    <div
      onClick={integration.comingSoon ? undefined : onSelect}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
        isSelected
          ? 'border-green-400 bg-green-50/50 ring-1 ring-green-200'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
      } ${integration.comingSoon ? 'opacity-60' : 'cursor-pointer'}`}
    >
      <div className={`w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center`}>
        <BrandLogo k={integration.key} size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{integration.name}</p>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {integration.comingSoon ? (
          <span className="text-[10px] text-amber-500 font-medium">Yakında</span>
        ) : !integration.available ? (
          <Lock className="w-3 h-3 text-gray-400" />
        ) : null}
        <div className={`w-2 h-2 rounded-full ${statusDot}`} />
      </div>
    </div>
  );
}

function DetailPanel({
  integration,
  onClose,
  onToggle,
  onPurchase,
  toggling,
  purchasing,
  onRefreshCatalog,
}: {
  integration: Integration;
  onClose: () => void;
  onToggle: (key: string, enable: boolean) => void;
  onPurchase: (integration: Integration) => void;
  toggling: boolean;
  purchasing: boolean;
  onRefreshCatalog: () => void;
}) {
  const gradient = INTEGRATION_COLORS[integration.key] || 'from-gray-500 to-gray-600';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-5 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Geri
          </button>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm`}>
            <BrandLogo k={integration.key} size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900">{integration.name}</h2>
            <p className="text-xs text-gray-500 truncate">{integration.description}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {integration.available && !integration.comingSoon ? (
            <>
              <button
                onClick={() => onToggle(integration.key, !integration.isEnabled)}
                disabled={toggling}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  integration.isEnabled
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
              >
                {toggling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : integration.isEnabled ? (
                  <ToggleRight className="w-4 h-4" />
                ) : (
                  <ToggleLeft className="w-4 h-4" />
                )}
                {integration.isEnabled ? 'Aktif' : 'Pasif'}
              </button>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                integration.isEnabled ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'
              }`}>
                {integration.isEnabled ? 'Bağlı' : 'Bağlı değil'}
              </span>
            </>
          ) : !integration.comingSoon ? (
            <button
              onClick={() => onPurchase(integration)}
              disabled={purchasing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 transition-all"
            >
              {purchasing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
              Satın Al {integration.addonPrice > 0 ? `— ${integration.addonPrice} TL/ay` : ''}
            </button>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {integration.key === 'whatsapp' ? (
          <WhatsAppPanel integration={integration} onRefreshCatalog={onRefreshCatalog} />
        ) : integration.key === 'chatbot' ? (
          <ChatbotPanel integration={integration} />
        ) : integration.category === 'messaging' ? (
          <MessagingPanel integration={integration} />
        ) : integration.category === 'ecommerce' ? (
          <EcommercePanel integration={integration} />
        ) : (
          <GenericPanel integration={integration} />
        )}
      </div>
    </div>
  );
}

/* ─────── WhatsApp Panel ─────── */
function WhatsAppPanel({ integration, onRefreshCatalog }: { integration: Integration; onRefreshCatalog: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingMessages, setSyncingMessages] = useState(false);
  const [syncingAvatars, setSyncingAvatars] = useState(false);
  const [resettingAvatars, setResettingAvatars] = useState(false);
  const [avatarRefreshForce, setAvatarRefreshForce] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [qrData, setQrData] = useState<Record<string, string>>({});
  const [qrLoading, setQrLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      if (localStorage.getItem(AVATAR_REFRESH_FORCE_KEY) === '1') {
        setAvatarRefreshForce(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setAvatarRefreshForcePersist = (value: boolean) => {
    setAvatarRefreshForce(value);
    try {
      if (value) localStorage.setItem(AVATAR_REFRESH_FORCE_KEY, '1');
      else localStorage.removeItem(AVATAR_REFRESH_FORCE_KEY);
    } catch {
      /* ignore */
    }
  };

  const fetchSessions = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions');
      setSessions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const syncFromWaha = async () => {
    setSyncing(true);
    try {
      await api.post('/sessions/sync');
      await fetchSessions();
      toast.success('Oturumlar WAHA ile senkronize edildi');
    } catch {
      toast.error('Senkronizasyon başarısız');
    } finally {
      setSyncing(false);
    }
  };

  const startSession = async (name: string) => {
    try {
      await api.post('/sessions/start', { name });
      toast.success(`${name} oturumu başlatıldı`);
      setTimeout(fetchSessions, 2000);
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Oturum başlatılamadı'));
    }
  };

  const stopSession = async (name: string) => {
    try {
      await api.post('/sessions/stop', { name });
      toast.success(`${name} oturumu durduruldu`);
      fetchSessions();
    } catch {
      toast.error('Oturum durdurulamadı');
    }
  };

  const fetchQrForSession = async (session: Session) => {
    const name = session.name;
    const enc = encodeURIComponent(name);
    setQrLoading((p) => ({ ...p, [name]: true }));
    try {
      const tryOnce = async () => {
        const { data } = await api.get(`/sessions/${enc}/qr`);
        return data?.qr as string | undefined;
      };

      let qr = await tryOnce().catch(() => undefined);
      if (qr) {
        setQrData((prev) => ({ ...prev, [name]: qr! }));
        return;
      }

      const eff = session.wahaStatus || session.status;
      const needsStart = eff === 'STOPPED' || eff === 'FAILED';

      if (needsStart) {
        try {
          await api.post('/sessions/start', { name });
          toast.success('Oturum başlatıldı, QR hazırlanıyor…');
          await new Promise((r) => setTimeout(r, 2800));
          await fetchSessions();
          qr = await tryOnce().catch(() => undefined);
          if (qr) {
            setQrData((prev) => ({ ...prev, [name]: qr! }));
            return;
          }
        } catch (err: unknown) {
          const msg =
            err && typeof err === 'object' && 'response' in err
              ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
              : undefined;
          toast.error(msg || 'Oturum başlatılamadı');
          return;
        }
      }

      toast.error('QR kodu alınamadı. Birkaç saniye sonra tekrar deneyin.');
    } finally {
      setQrLoading((p) => ({ ...p, [name]: false }));
    }
  };

  const removeSession = async (name: string) => {
    if (!confirm(`"${name}" oturumu silinecek. Emin misiniz?`)) return;
    try {
      await api.delete(`/sessions/${encodeURIComponent(name)}`);
      setQrData((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      toast.success('Oturum silindi');
      await fetchSessions();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(msg || 'Oturum silinemedi');
    }
  };

  const handleNewSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;
    await startSession(newSessionName.trim());
    setNewSessionName('');
  };

  const syncMessages = async () => {
    setSyncingMessages(true);
    try {
      const { data } = await api.post('/conversations/sync-all');
      toast.success(data?.message || `${data?.totalSynced ?? 0} mesaj senkronize edildi`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Mesaj senkronizasyonu başarısız'));
    } finally {
      setSyncingMessages(false);
    }
  };

  const syncAvatars = async () => {
    setSyncingAvatars(true);
    try {
      const { data } = await api.post('/contacts/refresh-all-avatars', {
        force: !!avatarRefreshForce,
      });
      toast.success(data?.message || 'Fotoğraf güncelleme başlatıldı');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Fotoğraf güncelleme başarısız'));
    } finally {
      setSyncingAvatars(false);
    }
  };

  const resetAndSyncAvatars = async () => {
    if (!confirm('Tüm kişi fotoğrafları sıfırlanacak ve yeniden indirilecek. Devam edilsin mi?')) return;
    setResettingAvatars(true);
    try {
      await api.post('/contacts/reset-all-avatars', {});
      const { data } = await api.post('/contacts/refresh-all-avatars', { force: true });
      toast.success(data?.message || 'Fotoğraflar sıfırlandı ve güncelleme başlatıldı');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'İşlem başarısız'));
    } finally {
      setResettingAvatars(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-green-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* New Session Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Yeni Oturum Oluştur</h3>
        <form onSubmit={handleNewSession} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Oturum adı
            </label>
            <input
              type="text"
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value.replace(/\s+/g, '-').toLowerCase())}
              placeholder="ornek-oturum"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 bg-green-500 text-white rounded-xl text-sm font-medium hover:bg-green-600 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Başlat
          </button>
        </form>
      </div>

      {/* Session Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={syncFromWaha}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          Senkronize et
        </button>
        <button
          onClick={fetchSessions}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Yenile
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Veri Senkronizasyonu</h3>

        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
          <div>
            <p className="font-medium text-sm text-gray-900">Mesajları Senkronize Et</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Bu organizasyona ait çalışan oturumlar ve konuşmalar için WAHA&apos;dan eksik mesajları çeker.
            </p>
          </div>
          <button
            onClick={syncMessages}
            disabled={syncingMessages}
            className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-100 transition-colors disabled:opacity-50"
          >
            {syncingMessages ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquareMore className="w-4 h-4" />}
            Senkronize Et
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
          <div>
            <p className="font-medium text-sm text-gray-900">Profil Fotoğraflarını Güncelle</p>
            <p className="text-xs text-gray-400 mt-0.5">Fotoğrafı olmayan kişiler için güncelleme yapar.</p>
            <label className="flex items-center gap-2 mt-2 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={avatarRefreshForce}
                onChange={(e) => setAvatarRefreshForcePersist(e.target.checked)}
                className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp"
              />
              Fotoğrafı olanları da yenile (değişen fotoğraflar güncellenir)
            </label>
          </div>
          <button
            onClick={syncAvatars}
            disabled={syncingAvatars}
            className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            {syncingAvatars ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            Güncelle
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-100">
          <div>
            <p className="font-medium text-sm text-amber-800">Kişi Fotoğraflarını Sıfırla ve Güncelle</p>
            <p className="text-xs text-amber-600 mt-0.5">Tüm fotoğrafları temizler ve yeniden indirir.</p>
          </div>
          <button
            onClick={resetAndSyncAvatars}
            disabled={resettingAvatars}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-200 transition-colors disabled:opacity-50"
          >
            {resettingAvatars ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            Sıfırla ve Güncelle
          </button>
        </div>
      </div>

      {/* Sessions List */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Oturumlar ({sessions.length})</h3>
        {sessions.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
            <WifiOff className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Henüz oturum yok</p>
            <p className="text-gray-300 text-xs mt-1">Yukarıdan yeni bir oturum oluşturun</p>
          </div>
        ) : (
          sessions.map((session) => {
            const eff = session.wahaStatus || session.status;
            const sc = statusConfig[eff] || statusConfig.STOPPED;
            const isConnected = eff === 'WORKING';
            const isStopped = eff === 'STOPPED' || eff === 'FAILED';

            return (
              <div key={session.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isConnected ? 'bg-green-100' : 'bg-gray-100'}`}>
                      {isConnected ? <Wifi className="w-5 h-5 text-green-600" /> : <WifiOff className="w-5 h-5 text-gray-400" />}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-gray-900">{session.name}</p>
                      <p className="text-xs text-gray-400">{session.phone ? `+${session.phone}` : 'Telefon bağlı değil'}</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${sc.color}`}>
                      {sc.label}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {!isConnected && (
                    <button
                      type="button"
                      disabled={!!qrLoading[session.name]}
                      onClick={() => fetchQrForSession(session)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-200 disabled:opacity-50"
                    >
                      {qrLoading[session.name] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                      QR al
                    </button>
                  )}
                  {isStopped ? (
                    <button onClick={() => startSession(session.name)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-xs font-medium hover:bg-green-200">
                      <Play className="w-3.5 h-3.5" /> Başlat
                    </button>
                  ) : isConnected ? (
                    <button onClick={() => stopSession(session.name)} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200">
                      <Square className="w-3.5 h-3.5" /> Durdur
                    </button>
                  ) : null}
                  <button
                    onClick={() => removeSession(session.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-red-100 hover:text-red-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Sil
                  </button>
                </div>

                {qrData[session.name] && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-xl text-center relative">
                    <button
                      type="button"
                      onClick={() => setQrData((prev) => { const n = { ...prev }; delete n[session.name]; return n; })}
                      className="absolute top-2 right-2 p-1 rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <p className="text-xs font-medium text-gray-600 mb-2">WhatsApp ile tarayın</p>
                    <img
                      src={`data:image/png;base64,${qrData[session.name]}`}
                      alt="WhatsApp QR"
                      className="mx-auto w-52 h-52 max-w-full"
                    />
                    <p className="text-[11px] text-gray-400 mt-2">
                      WhatsApp &rarr; Bağlı cihazlar &rarr; Cihaz bağla
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─────── Chatbot AI Panel ─────── */
function ChatbotPanel({ integration }: { integration: Integration }) {
  const [model, setModel] = useState(integration.config?.model || 'gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState(integration.config?.systemPrompt || 'Sen yardımcı bir müşteri destek asistanısın. Kibarca ve profesyonelce cevap ver.');
  const [autoReply, setAutoReply] = useState(integration.config?.autoReply ?? true);
  const [maxTokens, setMaxTokens] = useState(integration.config?.maxTokens || 500);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post(
        `/integrations/${integration.key}/config`,
        { model, systemPrompt, autoReply, maxTokens },
        { params: integrationOrgParams() },
      );
      toast.success('Chatbot yapılandırması kaydedildi');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Kaydetme başarısız'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Settings className="w-4 h-4 text-violet-500" />
          Chatbot Ayarları
        </h3>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-violet-500"
          >
            <option value="gpt-4o-mini">GPT-4o Mini (Hızlı &amp; Ekonomik)</option>
            <option value="gpt-4o">GPT-4o (Gelişmiş)</option>
            <option value="gpt-4-turbo">GPT-4 Turbo</option>
            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Sistem Promptu</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={4}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 resize-none"
            placeholder="Chatbot'un davranışını tanımlayın..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Maksimum Yanıt Uzunluğu (token)</label>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            min={50}
            max={4000}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-violet-500"
          />
        </div>
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
          <div>
            <p className="text-sm font-medium text-gray-900">Otomatik Yanıt</p>
          </div>
          <button onClick={() => setAutoReply(!autoReply)} className="text-gray-400 hover:text-gray-600">
            {autoReply ? <ToggleRight className="w-10 h-6 text-violet-500" /> : <ToggleLeft className="w-10 h-6" />}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-500 text-white rounded-xl text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Kaydet
        </button>
      </div>
    </div>
  );
}

/* ─────── Messaging Panel (Instagram, Facebook, Telegram) ─────── */
function MessagingPanel({ integration }: { integration: Integration }) {
  const [token, setToken] = useState(integration.config?.accessToken || '');
  const [saving, setSaving] = useState(false);

  const placeholders: Record<string, { tokenLabel: string; tokenPlaceholder: string; helpUrl: string }> = {
    instagram: { tokenLabel: 'Instagram Access Token', tokenPlaceholder: 'IGQV...', helpUrl: 'https://developers.facebook.com/docs/instagram-api/' },
    facebook: { tokenLabel: 'Page Access Token', tokenPlaceholder: 'EAA...', helpUrl: 'https://developers.facebook.com/docs/messenger-platform/' },
    telegram: { tokenLabel: 'Bot Token', tokenPlaceholder: '123456:ABC-DEF...', helpUrl: 'https://core.telegram.org/bots/api' },
  };

  const cfg = placeholders[integration.key] || { tokenLabel: 'API Token', tokenPlaceholder: '', helpUrl: '#' };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post(
        `/integrations/${integration.key}/config`,
        { accessToken: token },
        { params: integrationOrgParams() },
      );
      toast.success('Yapılandırma kaydedildi');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Kaydetme başarısız'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Key className="w-4 h-4 text-blue-500" />
          Bağlantı Ayarları
        </h3>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{cfg.tokenLabel}</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={cfg.tokenPlaceholder}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Kaydet
          </button>
          <a
            href={cfg.helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Dokümantasyon
          </a>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <p className="text-xs text-amber-800">Yakında aktif — token şimdiden kaydedilebilir.</p>
      </div>
    </div>
  );
}

/* ─────── E-commerce Panel ─────── */
type TsoftSyncStatus = {
  products: { total: number; active: number; lastPulledAt: string | null };
  variants: { total: number; active: number };
  orders: { lastSyncedAt: string | null; tsoftLinked: number };
  customers: { matched: number };
  pushQueue: {
    pending: number;
    running: number;
    failed: number;
    done24h: number;
    lastError: string | null;
    lastFailedAt: string | null;
  };
};

type TsoftSyncFlags = {
  products: boolean;
  variants: boolean;
  orders: boolean;
  customers: boolean;
  images: boolean;
  push: boolean;
  cartAbandonTasks: boolean;
};

function readSyncFlags(config: any): TsoftSyncFlags {
  const s = (config?.sync || {}) as Record<string, unknown>;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    products: bool(s.products, true),
    variants: bool(s.variants, true),
    orders: bool(s.orders, true),
    customers: bool(s.customers, true),
    images: bool(s.images, true),
    push: bool(s.push, true),
    cartAbandonTasks: bool(s.cartAbandonTasks, true),
  };
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Hiç senkronize edilmedi';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'şimdi';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.round(hr / 24);
  return `${day} gün önce`;
}

function TsoftPanel({ integration }: { integration: Integration }) {
  const ic = integration.config || {};
  const [baseUrl, setBaseUrl] = useState(String(ic.baseUrl || ic.storeUrl || ''));
  const [apiEmail, setApiEmail] = useState(String(ic.apiEmail || ic.username || ''));
  const [apiPassword, setApiPassword] = useState('');
  const [orderWsEnabled, setOrderWsEnabled] = useState(ic.orderWsEnabled === true);
  const [orderWsUrl, setOrderWsUrl] = useState(String(ic.orderWsUrl || ''));
  const [orderWsToken, setOrderWsToken] = useState('');
  const [orderWsReconnectSeconds, setOrderWsReconnectSeconds] = useState(
    Number(ic.orderWsReconnectSeconds ?? 15) || 15,
  );
  const [orderWsLookbackMinutes, setOrderWsLookbackMinutes] = useState(
    Number(ic.orderWsLookbackMinutes ?? 90) || 90,
  );
  const [usePanelApi, setUsePanelApi] = useState(
    ic.pathPrefix === '/panel' || String(ic.pathPrefix || '').toLowerCase() === 'panel',
  );
  const [flags, setFlags] = useState<TsoftSyncFlags>(readSyncFlags(integration.config));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [productSyncPeriod, setProductSyncPeriod] = useState<string>('all');
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnoseOut, setDiagnoseOut] = useState<string | null>(null);
  const [status, setStatus] = useState<TsoftSyncStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const { data } = await api.get<TsoftSyncStatus>('/ecommerce/tsoft/sync-status');
      setStatus(data);
    } catch {
      /* status alınamazsa sessiz geç */
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 15_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const configSnapshot = JSON.stringify(integration.config ?? {});
  useEffect(() => {
    const c = integration.config || {};
    setBaseUrl(String(c.baseUrl || c.storeUrl || ''));
    setApiEmail(String(c.apiEmail || c.username || ''));
    setApiPassword('');
    setOrderWsEnabled(c.orderWsEnabled === true);
    setOrderWsUrl(String(c.orderWsUrl || ''));
    setOrderWsToken('');
    setOrderWsReconnectSeconds(Number(c.orderWsReconnectSeconds ?? 15) || 15);
    setOrderWsLookbackMinutes(Number(c.orderWsLookbackMinutes ?? 90) || 90);
    setUsePanelApi(c.pathPrefix === '/panel' || String(c.pathPrefix || '').toLowerCase() === 'panel');
    setFlags(readSyncFlags(c));
  }, [integration.key, configSnapshot]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post(
        `/integrations/${integration.key}/config`,
        {
          baseUrl: baseUrl.trim(),
          apiEmail: apiEmail.trim(),
          apiPassword,
          pathPrefix: usePanelApi ? '/panel' : '',
          orderWsEnabled,
          orderWsUrl: orderWsUrl.trim(),
          orderWsToken,
          orderWsReconnectSeconds: Math.max(5, Number(orderWsReconnectSeconds) || 15),
          orderWsLookbackMinutes: Math.max(5, Number(orderWsLookbackMinutes) || 90),
          sync: flags,
        },
        { params: integrationOrgParams() },
      );
      toast.success('T-Soft yapılandırması kaydedildi');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Kaydetme başarısız'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await api.post('/ecommerce/tsoft/test');
      toast.success('T-Soft API bağlantısı başarılı');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Bağlantı testi başarısız'));
    } finally {
      setTesting(false);
    }
  };

  const handleSyncCustomers = async () => {
    setSyncingCustomers(true);
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-customers');
      toast.success(
        `Eşleşen kişi: ${data.matched ?? 0} (T-Soft müşteri: ${data.tsoftCustomerCount ?? 0})`,
      );
      await fetchStatus();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Senkronizasyon başarısız'));
    } finally {
      setSyncingCustomers(false);
    }
  };

  const handleSyncProducts = async () => {
    setSyncingProducts(true);
    try {
      const { data } = await api.post(
        '/ecommerce/tsoft/sync-products',
        { period: productSyncPeriod },
        { timeout: 300_000 },
      );
      toast.success(
        `Ürün: ${data?.upsertedProducts ?? 0} · Varyant: ${data?.upsertedVariants ?? 0}`,
      );
      await fetchStatus();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Ürün senkronizasyonu başarısız'));
    } finally {
      setSyncingProducts(false);
    }
  };

  const handleSyncOrders = async () => {
    setSyncingOrders(true);
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-orders', {}, { timeout: 180_000 });
      toast.success(`Oluşturulan: ${data?.created ?? 0} · Güncellenen: ${data?.updated ?? 0}`);
      await fetchStatus();
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Sipariş senkronizasyonu başarısız'));
    } finally {
      setSyncingOrders(false);
    }
  };

  const handleDiagnose = async () => {
    setDiagnosing(true);
    setDiagnoseOut(null);
    try {
      const { data } = await api.post('/ecommerce/tsoft/diagnose', {}, { timeout: 120_000 });
      setDiagnoseOut(JSON.stringify(data, null, 2));
      toast.success('Teşhis hazır');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Teşhis başarısız'));
    } finally {
      setDiagnosing(false);
    }
  };

  const toggleFlag = (key: keyof TsoftSyncFlags) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSyncNow = async () => {
    setSyncingNow(true);
    try {
      if (flags.products) {
        await api.post('/ecommerce/tsoft/sync-products', { period: productSyncPeriod }, { timeout: 300_000 });
      }
      if (flags.orders) {
        await api.post('/ecommerce/tsoft/sync-orders', {}, { timeout: 180_000 });
      }
      if (flags.customers) {
        await api.post('/ecommerce/tsoft/sync-customers');
      }
      await fetchStatus();
      toast.success('Guncelleme baslatildi');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Guncelleme basarisiz'));
    } finally {
      setSyncingNow(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Globe className="w-5 h-5 text-orange-500" />
            T-Soft Entegrasyonu
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Siparis, urun ve musteri verileriniz otomatik olarak guncellenir.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Baglanti Bilgileri</p>
            <p className="text-xs text-gray-500 mt-0.5">Bu bilgiler sadece baglanti kurmak icin kullanilir.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Site adresi (domain)</label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://magazam.com"
                className="w-full md:max-w-2xl px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Kullanici adi</label>
              <input
                type="text"
                value={apiEmail}
                onChange={(e) => setApiEmail(e.target.value)}
                placeholder="kullaniciadi"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Sifre</label>
              <input
                type="password"
                value={apiPassword}
                onChange={(e) => setApiPassword(e.target.value)}
                placeholder="Sifreniz"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">
            {statusLoading ? 'Baglanti kontrol ediliyor' : integration.isEnabled ? 'Bagli' : 'Baglanti kuruluyor'}
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Son guncelleme: {formatRelative(status?.orders.lastSyncedAt ?? status?.products.lastPulledAt ?? null)}
          </p>
          <p className="text-xs text-gray-500 mt-1.5">Verileriniz otomatik olarak guncellenir.</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900">Senkron Kapsami</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <FlagToggle
              label="Siparisler"
              description="Siparis bilgilerini gunceller"
              checked={flags.orders}
              onToggle={() => toggleFlag('orders')}
            />
            <FlagToggle
              label="Urunler"
              description="Urun bilgilerini gunceller"
              checked={flags.products}
              onToggle={() => toggleFlag('products')}
            />
            <FlagToggle
              label="Musteriler"
              description="Musteri bilgilerini gunceller"
              checked={flags.customers}
              onToggle={() => toggleFlag('customers')}
            />
          </div>
          <p className="text-xs text-gray-500">
            Hangi verilerin guncellenecegini secebilirsiniz.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Kaydet ve Baglan
          </button>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncingNow}
            className="flex items-center gap-2 px-4 py-2.5 border border-orange-200 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-50 disabled:opacity-50"
          >
            {syncingNow ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Simdi guncelle
          </button>
        </div>
      </div>
    </div>
  );
}

function FlagToggle({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`text-left flex items-start gap-3 p-3 rounded-xl border transition-all ${
        checked
          ? 'border-orange-300 bg-orange-50/60'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {checked ? (
          <ToggleRight className="w-8 h-5 text-orange-500" />
        ) : (
          <ToggleLeft className="w-8 h-5 text-gray-400" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{description}</p>
      </div>
    </button>
  );
}

function StatusCard({
  title,
  primary,
  secondary,
  footer,
  action,
  accent,
}: {
  title: string;
  primary: string;
  secondary?: string;
  footer?: string;
  action?: React.ReactNode;
  accent: 'orange' | 'blue' | 'violet' | 'red' | 'amber' | 'green';
}) {
  const accentBadge: Record<string, string> = {
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${accentBadge[accent]}`}>{title}</div>
        {action}
      </div>
      <p className="mt-2 text-sm font-semibold text-gray-900">{primary}</p>
      {secondary ? <p className="text-[11px] text-gray-600 mt-1">{secondary}</p> : null}
      {footer ? <p className="text-[11px] text-gray-500 mt-1.5">{footer}</p> : null}
    </div>
  );
}

function EcommercePanel({ integration }: { integration: Integration }) {
  const [storeUrl, setStoreUrl] = useState(integration.config?.storeUrl || '');
  const [apiKey, setApiKey] = useState(integration.config?.apiKey || '');
  const [apiSecret, setApiSecret] = useState(integration.config?.apiSecret || '');
  const [saving, setSaving] = useState(false);

  if (integration.key === 'tsoft') {
    return <TsoftPanel integration={integration} />;
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post(
        `/integrations/${integration.key}/config`,
        { storeUrl, apiKey, apiSecret },
        { params: integrationOrgParams() },
      );
      toast.success('Yapılandırma kaydedildi');
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'Kaydetme başarısız'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Globe className="w-4 h-4 text-orange-500" />
          Mağaza Bağlantısı
        </h3>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mağaza URL</label>
          <input
            type="url"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder="https://magaza.com"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">API Anahtarı</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API anahtarınız"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">API Secret</label>
          <input
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="API secret anahtarınız"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Kaydet
        </button>
      </div>
    </div>
  );
}

/* ─────── Generic Panel (fallback) ─────── */
function GenericPanel({ integration }: { integration: Integration }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Settings className="w-4 h-4 text-gray-500" />
        Yapılandırma
      </h3>
      <p className="text-sm text-gray-500">
        Bu entegrasyon için yapılandırma seçenekleri yakında eklenecek.
      </p>
    </div>
  );
}
