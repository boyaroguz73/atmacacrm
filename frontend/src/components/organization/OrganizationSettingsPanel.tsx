'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import { rewriteMediaUrlForClient } from '@/lib/utils';
import { HtmlEditor } from '@/components/HtmlEditor';
import {
  Building2,
  Palette,
  Upload,
  CreditCard,
  Save,
  Crown,
  ImageIcon,
  Loader2,
  ChevronLeft,
  LayoutGrid,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Shield,
  Users as UsersIcon,
  Trash2,
} from 'lucide-react';
import {
  MENU_CHILD_KEYS,
  MENU_KEYS,
  MENU_KEY_LABELS,
  MENU_KEY_DESCRIPTIONS,
  MENU_KEY_DEFAULT_ROLES,
} from '@/lib/menu-keys';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3002';

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  FREE: { label: 'Deneme', color: 'bg-gray-100 text-gray-700' },
  STARTER: { label: 'Başlangıç', color: 'bg-blue-100 text-blue-700' },
  PROFESSIONAL: { label: 'Profesyonel', color: 'bg-purple-100 text-purple-700' },
  ENTERPRISE: { label: 'Kurumsal', color: 'bg-amber-100 text-amber-800' },
};

export type OrganizationSettingsPanelProps = {
  backHref?: string;
  backLabel?: string;
};

type MenuTab = 'AGENT' | 'ACCOUNTANT' | 'ADMIN';
type SystemSettingItem = { key: string; value: string };

export default function OrganizationSettingsPanel({
  backHref,
  backLabel = 'Geri',
}: OrganizationSettingsPanelProps) {
  const router = useRouter();
  const { user, updateOrganization } = useAuthStore();
  const isTenantAdmin = user?.role === 'ADMIN';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [opResetPassword, setOpResetPassword] = useState('');
  const [opResetRunning, setOpResetRunning] = useState(false);

  const [name, setName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#25D366');
  const [secondaryColor, setSecondaryColor] = useState('#111827');
  const [logo, setLogo] = useState<string | null>(null);
  const [plan, setPlan] = useState('FREE');

  const [billingEmail, setBillingEmail] = useState('');
  const [billingName, setBillingName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [defaultMapsUrl, setDefaultMapsUrl] = useState('');
  const [defaultLocationTitle, setDefaultLocationTitle] = useState('Mağaza Konumu');
  const [defaultLocationAddress, setDefaultLocationAddress] = useState('');
  const [showBillingGuardWarning, setShowBillingGuardWarning] = useState(false);
  const [billingGuardShakeKey, setBillingGuardShakeKey] = useState(0);
  const [initialFormState, setInitialFormState] = useState({
    name: '',
    primaryColor: '#25D366',
    secondaryColor: '#111827',
    billingEmail: '',
    billingName: '',
    billingAddress: '',
    taxNumber: '',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [menuTab, setMenuTab] = useState<MenuTab>('AGENT');
  const [menuSelections, setMenuSelections] = useState<Record<MenuTab, string[]>>({
    AGENT: [],
    ACCOUNTANT: [],
    ADMIN: [],
  });
  const [menuCfgLoading, setMenuCfgLoading] = useState(false);
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuSuborder, setMenuSuborder] = useState<Record<string, string[]>>({});
  const [menuSubHidden, setMenuSubHidden] = useState<Record<string, string[]>>({});
  const [pdfSettings, setPdfSettings] = useState<SystemSettingItem[]>([]);
  const canManagePdfSettings = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';

  useEffect(() => {
    fetchOrg();
    fetchPdfSettings();
  }, []);

  const currentFormState = {
    name: name.trim(),
    primaryColor: primaryColor.trim(),
    secondaryColor: secondaryColor.trim(),
    billingEmail: billingEmail.trim(),
    billingName: billingName.trim(),
    billingAddress: billingAddress.trim(),
    taxNumber: taxNumber.trim(),
  };

  const hasUnsavedBillingChanges =
    currentFormState.name !== initialFormState.name ||
    currentFormState.primaryColor !== initialFormState.primaryColor ||
    currentFormState.secondaryColor !== initialFormState.secondaryColor ||
    currentFormState.billingEmail !== initialFormState.billingEmail ||
    currentFormState.billingName !== initialFormState.billingName ||
    currentFormState.billingAddress !== initialFormState.billingAddress ||
    currentFormState.taxNumber !== initialFormState.taxNumber;

  useEffect(() => {
    if (!hasUnsavedBillingChanges || saving) return;
    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);
    return () => window.removeEventListener('beforeunload', beforeUnloadHandler);
  }, [hasUnsavedBillingChanges, saving]);

  useEffect(() => {
    if (!hasUnsavedBillingChanges) {
      setShowBillingGuardWarning(false);
    }
  }, [hasUnsavedBillingChanges]);

  useEffect(() => {
    if (!isTenantAdmin) return;
    let cancelled = false;
    setMenuCfgLoading(true);
    api
      .get<{
        preview?: Record<string, string[]>;
      }>('/organizations/my/menu-visibility')
      .then(({ data }) => {
        if (cancelled || !data?.preview) return;
        setMenuSelections({
          AGENT: data.preview.AGENT ?? [],
          ACCOUNTANT: data.preview.ACCOUNTANT ?? [],
          ADMIN: data.preview.ADMIN ?? [],
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMenuCfgLoading(false);
      });
    api
      .get<{ suborder?: Record<string, string[]> }>('/organizations/my/menu-suborder')
      .then(({ data }) => {
        if (!cancelled) setMenuSuborder(data?.suborder || {});
      })
      .catch(() => {});
    api
      .get<{ subHidden?: Record<string, string[]> }>('/organizations/my/menu-sub-hidden')
      .then(({ data }) => {
        if (!cancelled) setMenuSubHidden(data?.subHidden || {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isTenantAdmin]);

  const moveInList = (list: string[], key: string, dir: -1 | 1) => {
    const idx = list.indexOf(key);
    if (idx < 0) return list;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= list.length) return list;
    const out = [...list];
    [out[idx], out[nextIdx]] = [out[nextIdx], out[idx]];
    return out;
  };

  const fetchOrg = async () => {
    try {
      const { data } = await api.get('/organizations/my');
      setName(data.name || '');
      setPrimaryColor(data.primaryColor || '#25D366');
      setSecondaryColor(data.secondaryColor || '#111827');
      setLogo(data.logo || null);
      setPlan(data.plan || 'FREE');
      setBillingEmail(data.billingEmail || '');
      setBillingName(data.billingName || '');
      setBillingAddress(data.billingAddress || '');
      setTaxNumber(data.taxNumber || '');
      try {
        const { data: loc } = await api.get('/organizations/my/default-location');
        setDefaultMapsUrl(typeof loc?.mapsUrl === 'string' ? loc.mapsUrl : '');
        setDefaultLocationTitle(
          typeof loc?.title === 'string' && loc.title.trim()
            ? loc.title.trim()
            : 'Mağaza Konumu',
        );
        setDefaultLocationAddress(
          typeof loc?.address === 'string' ? loc.address : '',
        );
      } catch {
        // Opsiyonel ayar: yüklenemezse sessizce boş kalır.
      }
      setInitialFormState({
        name: (data.name || '').trim(),
        primaryColor: (data.primaryColor || '#25D366').trim(),
        secondaryColor: (data.secondaryColor || '#111827').trim(),
        billingEmail: (data.billingEmail || '').trim(),
        billingName: (data.billingName || '').trim(),
        billingAddress: (data.billingAddress || '').trim(),
        taxNumber: (data.taxNumber || '').trim(),
      });
      setShowBillingGuardWarning(false);
    } catch {
      toast.error('Organizasyon bilgileri yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const fetchPdfSettings = async () => {
    try {
      const { data } = await api.get<SystemSettingItem[]>('/system-settings');
      setPdfSettings(Array.isArray(data) ? data : []);
    } catch {
      // Sessiz geçiyoruz; PDF ayarları yüklenemese de organizasyon ekranı kullanılabilir kalsın.
    }
  };

  const upsertPdfSetting = (key: string, value: string) => {
    setPdfSettings((prev) => [...prev.filter((s) => s.key !== key), { key, value }]);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Organizasyon adı zorunludur');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.patch('/organizations/my', {
        name: name.trim(),
        primaryColor,
        secondaryColor,
        billingEmail: billingEmail.trim() || null,
        billingName: billingName.trim() || null,
        billingAddress: billingAddress.trim() || null,
        taxNumber: taxNumber.trim() || null,
      });
      await api.patch('/organizations/my/default-location', {
        latitude: null,
        longitude: null,
        mapsUrl: defaultMapsUrl.trim() || null,
        title: defaultLocationTitle.trim() || 'Mağaza Konumu',
        address: defaultLocationAddress.trim() || null,
      });

      updateOrganization({
        name: data.name,
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        logo: data.logo,
        plan: data.plan,
      });
      setInitialFormState({
        name: (data.name || '').trim(),
        primaryColor: (data.primaryColor || '#25D366').trim(),
        secondaryColor: (data.secondaryColor || '#111827').trim(),
        billingEmail: (data.billingEmail || '').trim(),
        billingName: (data.billingName || '').trim(),
        billingAddress: (data.billingAddress || '').trim(),
        taxNumber: (data.taxNumber || '').trim(),
      });
      setShowBillingGuardWarning(false);

      toast.success('Ayarlar başarıyla kaydedildi');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Kaydetme sırasında hata oluştu');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Lütfen geçerli bir resim dosyası seçin');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Dosya boyutu 5MB'dan küçük olmalıdır");
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const { data } = await api.post('/organizations/my/logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLogo(data.logo);
      updateOrganization({ logo: data.logo });
      toast.success('Logo başarıyla güncellendi');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Logo yüklenirken hata oluştu');
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOperationalReset = async () => {
    if (!opResetPassword.trim()) {
      toast.error('Şifre zorunlu');
      return;
    }
    const ok = window.confirm(
      'Bu işlem teklifleri, siparişleri, görev/takvim kayıtlarını, muhasebe kayıtlarını ve potansiyel müşteri kayıtlarını sıfırlar; ardından 0415/0456/0440 eşleştirmesine göre konuşma atamalarını yeniden uygular. Devam edilsin mi?',
    );
    if (!ok) return;

    setOpResetRunning(true);
    try {
      const { data } = await api.post('/organizations/my/reset-operational-data', {
        password: opResetPassword,
      });
      setOpResetPassword('');
      toast.success(
        `Sıfırlama tamamlandı · Teklif: ${data?.reset?.quotes ?? 0}, Sipariş: ${data?.reset?.orders ?? 0}, Görev: ${data?.reset?.tasks ?? 0}, Muhasebe: ${(data?.reset?.cashEntries ?? 0) + (data?.reset?.accountingInvoices ?? 0) + (data?.reset?.ledgerEntries ?? 0)}, Potansiyel: ${data?.reset?.leads ?? 0}`,
      );
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, 'İşlem başarısız'));
    } finally {
      setOpResetRunning(false);
    }
  };

  const toggleMenuKey = (key: string) => {
    setMenuSelections((prev) => {
      const cur = new Set(prev[menuTab]);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      return { ...prev, [menuTab]: Array.from(cur) };
    });
  };

  const moveTopMenu = (key: string, dir: -1 | 1) => {
    setMenuSelections((prev) => ({ ...prev, [menuTab]: moveInList(prev[menuTab], key, dir) }));
  };

  const toggleSubItemVisibility = (parentKey: string, childKey: string) => {
    setMenuSubHidden((prev) => {
      const hiddenForParent = prev[parentKey] || [];
      const isHidden = hiddenForParent.includes(childKey);
      const updated = isHidden
        ? hiddenForParent.filter((k) => k !== childKey)
        : [...hiddenForParent, childKey];
      if (!updated.length) {
        const { [parentKey]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [parentKey]: updated };
    });
  };

  const moveSubMenu = (parentKey: string, childKey: string, dir: -1 | 1) => {
    setMenuSuborder((prev) => {
      const current = prev[parentKey] || (MENU_CHILD_KEYS[parentKey] || []).map((x) => x.key);
      return { ...prev, [parentKey]: moveInList(current, childKey, dir) };
    });
  };

  const saveMenuVisibility = async () => {
    setMenuSaving(true);
    try {
      await api.patch('/organizations/my/menu-visibility', {
        AGENT: menuSelections.AGENT,
        ACCOUNTANT: menuSelections.ACCOUNTANT,
        ADMIN: menuSelections.ADMIN,
      });
      await api.patch('/organizations/my/menu-suborder', menuSuborder);
      await api.patch('/organizations/my/menu-sub-hidden', menuSubHidden);
      window.dispatchEvent(new Event('crm-menu-visibility-changed'));
      toast.success('Menü görünürlüğü ve sırası kaydedildi');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Menü ayarları kaydedilemedi');
    } finally {
      setMenuSaving(false);
    }
  };

  const planInfo = PLAN_LABELS[plan] || PLAN_LABELS.FREE;

  const triggerBillingGuardWarning = () => {
    setShowBillingGuardWarning(true);
    setBillingGuardShakeKey((prev) => prev + 1);
    toast.error('Firma/fatura bilgilerini kaydetmeden ilerleyemezsiniz');
  };

  const handleBackNavigation = () => {
    if (hasUnsavedBillingChanges) {
      triggerBillingGuardWarning();
      return;
    }
    if (backHref) {
      router.push(backHref);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-whatsapp border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {backHref ? (
        <button
          type="button"
          onClick={handleBackNavigation}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-whatsapp transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {backLabel}
        </button>
      ) : null}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organizasyon Ayarları</h1>
        <p className="text-sm text-gray-500 mt-1">
          Organizasyonunuzun adını, logosunu, marka renklerini ve fatura bilgilerini yönetin.
        </p>
      </div>

      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <Crown className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Mevcut Plan</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${planInfo.color}`}
                >
                  {planInfo.label}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-red-200 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-red-700">Operasyonel Sıfırlama</h2>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              Bu işlem <span className="font-semibold">teklifleri, siparişleri, görev/takvim kayıtlarını, muhasebe kayıtlarını ve potansiyel müşteri kayıtlarını</span> temizler
              ve konuşma atamalarını şu eşleştirmeye göre tekrar uygular: 0415 → Umeyma, 0456 → Betül, 0440 → Sümeyye.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
              <input
                type="password"
                value={opResetPassword}
                onChange={(e) => setOpResetPassword(e.target.value)}
                placeholder="Onay şifresi"
                className="w-full sm:w-64 px-3 py-2 border border-red-200 rounded-lg text-sm focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-100"
              />
              <button
                type="button"
                onClick={handleOperationalReset}
                disabled={opResetRunning || !opResetPassword.trim()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {opResetRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Sıfırla ve Eşleştirmeyi Çalıştır
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <ImageIcon className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Logo</h2>
        </div>
        <div className="flex items-center gap-6">
          <div className="relative group">
            {logo ? (
              <img
                src={`${BACKEND_URL}${logo}`}
                alt="Organizasyon logosu"
                className="w-24 h-24 rounded-2xl object-cover border-2 border-gray-100"
              />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-200 flex items-center justify-center">
                <Building2 className="w-8 h-8 text-gray-300" />
              </div>
            )}
            {uploadingLogo && (
              <div className="absolute inset-0 bg-white/80 rounded-2xl flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-whatsapp animate-spin" />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploadingLogo ? 'Yükleniyor...' : 'Logo Yükle'}
            </button>
            <p className="text-xs text-gray-400">PNG, JPG veya SVG. Maks. 5MB.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Marka Bilgileri</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Organizasyon Adı *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Şirket adınızı girin"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ana Renk (Vurgu)</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">Butonlar, aktif menü, vurgu rengi</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İkincil Renk (Sidebar)</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">Sidebar arka plan rengi</p>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <span className="text-xs text-gray-500">Önizleme:</span>
            <div className="h-8 w-20 rounded-lg shadow-sm border" style={{ backgroundColor: primaryColor }} />
            <div className="h-8 w-20 rounded-lg shadow-sm border" style={{ backgroundColor: secondaryColor }} />
            <div
              className="h-8 flex-1 rounded-lg shadow-sm border"
              style={{
                background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
              }}
            />
          </div>
        </div>
      </div>

      <div
        className={`bg-white border rounded-xl p-5 transition-colors ${
          showBillingGuardWarning ? 'border-red-500 ring-2 ring-red-100 animate-crm-shake' : ''
        }`}
        key={billingGuardShakeKey}
      >
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Fatura Bilgileri</h2>
        </div>
        {showBillingGuardWarning ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Kaydedilmemiş firma/fatura bilgisi var. Devam etmeden önce lütfen kaydedin.
          </div>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fatura E-posta</label>
            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="fatura@sirket.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fatura Adı / Ünvanı</label>
            <input
              type="text"
              value={billingName}
              onChange={(e) => setBillingName(e.target.value)}
              placeholder="Şirket Ünvanı A.Ş."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Fatura Adresi</label>
            <textarea
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              rows={2}
              placeholder="Fatura adresi"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vergi Numarası</label>
            <input
              type="text"
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value)}
              placeholder="1234567890"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <LayoutGrid className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Sabit konum (WhatsApp)</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Konum gönder dediğinizde koordinat yerine Google Maps bağlantısı ve adres metin olarak paylaşılır.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Google Maps linki</label>
            <input
              type="url"
              value={defaultMapsUrl}
              onChange={(e) => setDefaultMapsUrl(e.target.value)}
              placeholder="https://maps.app.goo.gl/..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Başlık</label>
            <input
              type="text"
              value={defaultLocationTitle}
              onChange={(e) => setDefaultLocationTitle(e.target.value)}
              placeholder="Mağaza Konumu"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Adres</label>
            <input
              type="text"
              value={defaultLocationAddress}
              onChange={(e) => setDefaultLocationAddress(e.target.value)}
              placeholder="Açık adres"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
        </div>
      </div>

      {isTenantAdmin ? (
        <div className="bg-white border rounded-xl p-5 space-y-5">
          {/* Başlık */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-gray-400" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Menü Görünürlüğü ve Sırası</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Her rol için hangi modüllerin görüneceğini ve sırasını belirleyin.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void saveMenuVisibility()}
              disabled={menuSaving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition"
            >
              {menuSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Kaydet
            </button>
          </div>

          {menuCfgLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-whatsapp" />
            </div>
          ) : (
            <>
              {/* Rol Sekmeleri */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                {([
                  { key: 'AGENT' as MenuTab, label: 'Temsilci', desc: 'Müşteri temsilcileri', icon: UsersIcon, color: 'blue' },
                  { key: 'ACCOUNTANT' as MenuTab, label: 'Muhasebe', desc: 'Muhasebe personeli', icon: CreditCard, color: 'emerald' },
                  { key: 'ADMIN' as MenuTab, label: 'Yönetici', desc: 'Tam yetki', icon: Shield, color: 'amber' },
                ]).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setMenuTab(t.key)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      menuTab === t.key
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <t.icon className="w-4 h-4" />
                    <span>{t.label}</span>
                    <span className="text-[10px] font-normal text-gray-400 hidden sm:inline">
                      ({menuSelections[menuTab === t.key ? t.key : menuTab].length === 0 && menuTab !== t.key
                        ? 'varsayılan'
                        : `${menuSelections[t.key].length} modül`})
                    </span>
                  </button>
                ))}
              </div>

              {/* Bilgi notu */}
              <div className="bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700 flex items-start gap-2">
                <Eye className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>{menuTab === 'AGENT' ? 'Temsilci' : menuTab === 'ACCOUNTANT' ? 'Muhasebe' : 'Yönetici'}</strong> rolündeki
                  kullanıcılar aşağıda işaretli modülleri görecek.
                  {menuSelections[menuTab].length === 0 && ' Liste boş olursa varsayılan menü uygulanır.'}
                </span>
              </div>

              {/* Birleşik görünürlük + sıralama listesi */}
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-50">
                {(() => {
                  const selected = menuSelections[menuTab];
                  const unselected = MENU_KEYS.filter((k) => !selected.includes(k));
                  const allKeys = [...selected, ...unselected];

                  return allKeys.map((key, idx) => {
                    const isEnabled = selected.includes(key);
                    const enabledIdx = selected.indexOf(key);
                    const defaultRoles = MENU_KEY_DEFAULT_ROLES[key] || [];
                    const hasChildren = !!MENU_CHILD_KEYS[key]?.length;

                    return (
                      <div
                        key={`${menuTab}-${key}`}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                          isEnabled ? 'bg-white' : 'bg-gray-50/60'
                        }`}
                      >
                        {/* Toggle */}
                        <button
                          type="button"
                          onClick={() => toggleMenuKey(key)}
                          className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${
                            isEnabled ? 'bg-whatsapp' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                              isEnabled ? 'left-[18px]' : 'left-0.5'
                            }`}
                          />
                        </button>

                        {/* Label + desc */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${isEnabled ? 'text-gray-900' : 'text-gray-400'}`}>
                              {MENU_KEY_LABELS[key] || key}
                            </span>
                            {defaultRoles.length > 0 && (
                              <span className="inline-flex text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 uppercase tracking-wide">
                                {defaultRoles.includes('ADMIN') && defaultRoles.includes('ACCOUNTANT')
                                  ? 'Yönetici / Muhasebe'
                                  : defaultRoles.includes('ADMIN')
                                    ? 'Yönetici'
                                    : 'Muhasebe'}
                              </span>
                            )}
                            {hasChildren && (
                              <span className="text-[9px] text-gray-400 font-medium">
                                +{MENU_CHILD_KEYS[key].length} alt menü
                              </span>
                            )}
                          </div>
                          {MENU_KEY_DESCRIPTIONS[key] && (
                            <p className={`text-[11px] mt-0.5 ${isEnabled ? 'text-gray-500' : 'text-gray-300'}`}>
                              {MENU_KEY_DESCRIPTIONS[key]}
                            </p>
                          )}
                        </div>

                        {/* Sıralama ok butonları (sadece etkin olanlar) */}
                        {isEnabled && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => moveTopMenu(key, -1)}
                              disabled={enabledIdx === 0}
                              className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 transition"
                              title="Yukarı taşı"
                            >
                              <ArrowUp className="w-3.5 h-3.5 text-gray-500" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveTopMenu(key, 1)}
                              disabled={enabledIdx === selected.length - 1}
                              className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 transition"
                              title="Aşağı taşı"
                            >
                              <ArrowDown className="w-3.5 h-3.5 text-gray-500" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Alt menü sırası — sadece etkin ve alt menüsü olanlar */}
              {(() => {
                const selected = menuSelections[menuTab];
                const parentsWithChildren = selected.filter((k) => MENU_CHILD_KEYS[k]?.length);
                if (!parentsWithChildren.length) return null;
                return (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                      <ChevronRight className="w-3.5 h-3.5" />
                      Alt menü sırası
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {parentsWithChildren.map((parentKey) => {
                        const children = MENU_CHILD_KEYS[parentKey] || [];
                        const ordered = (menuSuborder[parentKey] || children.map((c) => c.key))
                          .filter((k) => children.some((c) => c.key === k));
                        if (!ordered.length) return null;
                        return (
                          <div key={`sub-${parentKey}`} className="border border-gray-100 rounded-lg p-3">
                            <p className="text-xs font-semibold text-gray-700 mb-2">{MENU_KEY_LABELS[parentKey] || parentKey}</p>
                            <div className="space-y-1">
                              {ordered.map((childKey, idx) => {
                                const childLabel = children.find((c) => c.key === childKey)?.label || childKey;
                                const isChildHidden = (menuSubHidden[parentKey] || []).includes(childKey);
                                return (
                                  <div
                                    key={`${parentKey}-${childKey}`}
                                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${
                                      isChildHidden ? 'bg-gray-50 opacity-60' : 'bg-gray-50 hover:bg-gray-100'
                                    }`}
                                  >
                                    <span className={`text-xs ${isChildHidden ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                                      {childLabel}
                                    </span>
                                    <div className="flex items-center gap-0.5">
                                      <button
                                        type="button"
                                        onClick={() => toggleSubItemVisibility(parentKey, childKey)}
                                        className="p-0.5 rounded hover:bg-white transition"
                                        title={isChildHidden ? 'Göster' : 'Gizle'}
                                      >
                                        {isChildHidden
                                          ? <EyeOff className="w-3 h-3 text-gray-400" />
                                          : <Eye className="w-3 h-3 text-gray-500" />
                                        }
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveSubMenu(parentKey, childKey, -1)}
                                        disabled={idx === 0}
                                        className="p-0.5 rounded hover:bg-white disabled:opacity-20 transition"
                                        title="Yukarı taşı"
                                      >
                                        <ArrowUp className="w-3 h-3 text-gray-500" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveSubMenu(parentKey, childKey, 1)}
                                        disabled={idx === ordered.length - 1}
                                        className="p-0.5 rounded hover:bg-white disabled:opacity-20 transition"
                                        title="Aşağı taşı"
                                      >
                                        <ArrowDown className="w-3 h-3 text-gray-500" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      ) : null}

      {canManagePdfSettings ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">PDF Şablon Ayarları</h2>
            <p className="text-sm text-gray-500 mt-1">Fatura ve teklif PDF&apos;lerinde görünecek bilgileri düzenleyin.</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Firma Bilgileri</p>
              <p className="text-xs text-gray-500 mt-0.5">PDF üst bilgisinde ve firma bloğunda görünen temel bilgiler.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { key: 'pdf_company_name', label: 'Firma Adı *', placeholder: 'Firma adı' },
                { key: 'pdf_company_phone', label: 'Telefon', placeholder: 'Telefon numarası' },
                { key: 'pdf_company_email', label: 'E-posta', placeholder: 'ornek@firma.com' },
                { key: 'pdf_company_website', label: 'Web Sitesi', placeholder: 'https://firma.com' },
                { key: 'pdf_company_tax_office', label: 'Vergi Dairesi', placeholder: 'Vergi dairesi' },
                { key: 'pdf_company_tax_number', label: 'Vergi No', placeholder: 'Vergi numarası' },
                { key: 'pdf_company_mersis_no', label: 'Mersis No', placeholder: 'Mersis numarası' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">{field.label}</label>
                  <input
                    type="text"
                    defaultValue={pdfSettings.find((s) => s.key === field.key)?.value || ''}
                    placeholder={field.placeholder}
                    onBlur={async (e) => {
                      try {
                        await api.patch('/system-settings', { key: field.key, value: e.target.value });
                        upsertPdfSetting(field.key, e.target.value);
                        toast.success(`${field.label} güncellendi`);
                      } catch {
                        toast.error('Güncellenemedi');
                      }
                    }}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                  />
                </div>
              ))}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Firma Adresi</label>
                <textarea
                  defaultValue={pdfSettings.find((s) => s.key === 'pdf_company_address')?.value || ''}
                  placeholder="Firma adresi"
                  onBlur={async (e) => {
                    try {
                      await api.patch('/system-settings', { key: 'pdf_company_address', value: e.target.value });
                      upsertPdfSetting('pdf_company_address', e.target.value);
                      toast.success('Adres güncellendi');
                    } catch {
                      toast.error('Güncellenemedi');
                    }
                  }}
                  rows={3}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp resize-y"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Logo Ayarları</p>
              <p className="text-xs text-gray-500 mt-0.5">PDF üst kısmında kullanılacak logo görseli ve boyutu.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4 items-start">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Logo URL (https://... veya /uploads/...)</label>
                <input
                  type="text"
                  defaultValue={pdfSettings.find((s) => s.key === 'pdf_logo_url')?.value || ''}
                  onBlur={async (e) => {
                    try {
                      await api.patch('/system-settings', { key: 'pdf_logo_url', value: e.target.value });
                      upsertPdfSetting('pdf_logo_url', e.target.value);
                      toast.success('Logo URL güncellendi');
                    } catch {
                      toast.error('Güncellenemedi');
                    }
                  }}
                  placeholder="https://example.com/logo.png"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                />
                <p className="text-xs text-gray-400 mt-1.5">Logo PNG/JPG formatında olmalı. Tarayıcıdan erişilebilir bir URL girin.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Yükseklik (px)</label>
                <input
                  type="number"
                  min={20}
                  max={120}
                  defaultValue={pdfSettings.find((s) => s.key === 'pdf_logo_height')?.value || '44'}
                  onBlur={async (e) => {
                    const nextValue = String(Math.max(20, Math.min(120, Number(e.target.value) || 44)));
                    e.target.value = nextValue;
                    try {
                      await api.patch('/system-settings', { key: 'pdf_logo_height', value: nextValue });
                      upsertPdfSetting('pdf_logo_height', nextValue);
                      toast.success('Logo boyutu güncellendi');
                    } catch {
                      toast.error('Güncellenemedi');
                    }
                  }}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                />
                <p className="text-xs text-gray-400 mt-1.5">20 - 120 px arası. Varsayılan: 44.</p>
              </div>
            </div>
            {pdfSettings.find((s) => s.key === 'pdf_logo_url')?.value ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-2">Logo önizleme</p>
                <img
                  src={pdfSettings.find((s) => s.key === 'pdf_logo_url')?.value}
                  alt="Logo önizleme"
                  className="h-14 object-contain border border-gray-200 rounded-lg bg-white p-1"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Banka Bilgileri</p>
              <p className="text-xs text-gray-500 mt-0.5">IBAN ve hesap bilgileri PDF&apos;de ödeme alanında gösterilir.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { key: 'pdf_bank_info', label: 'Banka 1 (IBAN, Hesap No vb.)' },
                { key: 'pdf_bank2_info', label: 'Banka 2 (opsiyonel)' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">{field.label}</label>
                  <textarea
                    defaultValue={pdfSettings.find((s) => s.key === field.key)?.value || ''}
                    onBlur={async (e) => {
                      try {
                        await api.patch('/system-settings', { key: field.key, value: e.target.value });
                        upsertPdfSetting(field.key, e.target.value);
                        toast.success('Banka bilgisi güncellendi');
                      } catch {
                        toast.error('Güncellenemedi');
                      }
                    }}
                    rows={4}
                    placeholder="Banka Adı: ...\nIBAN: TR..."
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp resize-y font-mono leading-6"
                  />
                </div>
              ))}
              <div className="md:col-span-2 rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                <label className="block text-xs font-medium text-gray-600 mb-2">Banka QR (FAST / EFT - PDF sağ alt)</label>
                <p className="text-xs text-gray-500 mb-3">
                  Teklif ve sipariş PDF&apos;lerinde banka metinleriyle aynı blokta, sağ altta basılır. PNG veya JPG yükleyin.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors">
                    <ImageIcon className="w-4 h-4 text-gray-500" />
                    Görsel seç
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        const fd = new FormData();
                        fd.append('file', file);
                        try {
                          const { data } = await api.post<{ url: string }>('/system-settings/upload-bank-qr', fd, {
                            headers: { 'Content-Type': 'multipart/form-data' },
                          });
                          upsertPdfSetting('pdf_bank_qr_url', data.url);
                          toast.success('Banka QR kaydedildi');
                        } catch (err) {
                          toast.error(getApiErrorMessage(err, 'Yüklenemedi'));
                        }
                      }}
                    />
                  </label>
                  {pdfSettings.find((s) => s.key === 'pdf_bank_qr_url')?.value ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.patch('/system-settings', { key: 'pdf_bank_qr_url', value: '' });
                          setPdfSettings((prev) => prev.filter((s) => s.key !== 'pdf_bank_qr_url'));
                          toast.success('QR kaldırıldı');
                        } catch {
                          toast.error('Kaldırılamadı');
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-100"
                    >
                      <Trash2 className="w-4 h-4" />
                      Kaldır
                    </button>
                  ) : null}
                </div>
                {pdfSettings.find((s) => s.key === 'pdf_bank_qr_url')?.value ? (
                  <div className="mt-3 flex items-start gap-3">
                    <img
                      src={rewriteMediaUrlForClient(pdfSettings.find((s) => s.key === 'pdf_bank_qr_url')!.value)}
                      alt="Banka QR önizleme"
                      className="w-28 h-28 object-contain border border-gray-200 rounded-lg bg-white p-1"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <p className="text-[11px] text-gray-400 pt-1">
                      {pdfSettings.find((s) => s.key === 'pdf_bank_qr_url')?.value}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">PDF Metinleri (Koşullar & Notlar)</p>
              <p className="text-xs text-gray-500 mt-0.5">PDF&apos;de görünecek metinler</p>
            </div>
            <div className="space-y-4">
              {[
                { key: 'pdf_terms', label: 'Ödeme Koşulları', minHeight: '110px' },
                { key: 'pdf_footer_note', label: 'Alt Not (PDF footer)', minHeight: '80px' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">{field.label}</label>
                  <HtmlEditor
                    value={pdfSettings.find((s) => s.key === field.key)?.value || ''}
                    onChange={() => {}}
                    onBlurSave={async (html) => {
                      try {
                        await api.patch('/system-settings', { key: field.key, value: html });
                        upsertPdfSetting(field.key, html);
                        toast.success(`${field.label} güncellendi`);
                      } catch {
                        toast.error('Güncellenemedi');
                      }
                    }}
                    placeholder={`${field.label} girin...`}
                    minHeight={field.key === 'pdf_terms' ? '150px' : field.minHeight}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Görünüm Ayarları</p>
              <p className="text-xs text-gray-500 mt-0.5">Renk, para birimi konumu ve görünüm tercihleri.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Ana Renk (HEX)</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    defaultValue={pdfSettings.find((s) => s.key === 'pdf_primary_color')?.value || '#1a7a4a'}
                    onBlur={async (e) => {
                      try {
                        await api.patch('/system-settings', { key: 'pdf_primary_color', value: e.target.value });
                        upsertPdfSetting('pdf_primary_color', e.target.value);
                        toast.success('Renk güncellendi');
                      } catch {
                        toast.error('Güncellenemedi');
                      }
                    }}
                    className="h-10 w-14 rounded border border-gray-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    defaultValue={pdfSettings.find((s) => s.key === 'pdf_primary_color')?.value || '#1a7a4a'}
                    onBlur={async (e) => {
                      try {
                        await api.patch('/system-settings', { key: 'pdf_primary_color', value: e.target.value });
                        upsertPdfSetting('pdf_primary_color', e.target.value);
                        toast.success('Renk güncellendi');
                      } catch {
                        toast.error('Güncellenemedi');
                      }
                    }}
                    placeholder="#1a7a4a"
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Para Birimi Konumu</label>
                <select
                  defaultValue={pdfSettings.find((s) => s.key === 'pdf_currency_position')?.value || 'after'}
                  onChange={async (e) => {
                    try {
                      await api.patch('/system-settings', { key: 'pdf_currency_position', value: e.target.value });
                      upsertPdfSetting('pdf_currency_position', e.target.value);
                      toast.success('Güncellendi');
                    } catch {
                      toast.error('Güncellenemedi');
                    }
                  }}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                >
                  <option value="after">Sonra (1.000,00 TL)</option>
                  <option value="before">Önce (TL 1.000,00)</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
                <label className="text-xs font-medium text-gray-700">İmza Alanı Göster</label>
                <button
                  onClick={async () => {
                    const current = pdfSettings.find((s) => s.key === 'pdf_show_signature')?.value !== 'false';
                    try {
                      const next = current ? 'false' : 'true';
                      await api.patch('/system-settings', { key: 'pdf_show_signature', value: next });
                      upsertPdfSetting('pdf_show_signature', next);
                      toast.success('Güncellendi');
                    } catch {
                      toast.error('Güncellenemedi');
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    pdfSettings.find((s) => s.key === 'pdf_show_signature')?.value !== 'false' ? 'bg-whatsapp' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      pdfSettings.find((s) => s.key === 'pdf_show_signature')?.value !== 'false' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
                <label className="text-xs font-medium text-gray-700">Yetkili İmza Alanı Göster</label>
                <button
                  onClick={async () => {
                    const current = pdfSettings.find((s) => s.key === 'pdf_show_authorized_signature')?.value !== 'false';
                    try {
                      const next = current ? 'false' : 'true';
                      await api.patch('/system-settings', { key: 'pdf_show_authorized_signature', value: next });
                      upsertPdfSetting('pdf_show_authorized_signature', next);
                      toast.success('Güncellendi');
                    } catch {
                      toast.error('Güncellenemedi');
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    pdfSettings.find((s) => s.key === 'pdf_show_authorized_signature')?.value !== 'false' ? 'bg-whatsapp' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      pdfSettings.find((s) => s.key === 'pdf_show_authorized_signature')?.value !== 'false' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-whatsapp text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-all font-medium"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
        </button>
      </div>
    </div>
  );
}
