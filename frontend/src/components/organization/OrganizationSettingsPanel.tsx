'use client';

import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
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
} from 'lucide-react';
import { MENU_KEYS, MENU_KEY_LABELS } from '@/lib/menu-keys';

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

export default function OrganizationSettingsPanel({
  backHref,
  backLabel = 'Geri',
}: OrganizationSettingsPanelProps) {
  const { user, updateOrganization } = useAuthStore();
  const isTenantAdmin = user?.role === 'ADMIN';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [name, setName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#25D366');
  const [secondaryColor, setSecondaryColor] = useState('#111827');
  const [logo, setLogo] = useState<string | null>(null);
  const [plan, setPlan] = useState('FREE');

  const [billingEmail, setBillingEmail] = useState('');
  const [billingName, setBillingName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [taxNumber, setTaxNumber] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [menuTab, setMenuTab] = useState<MenuTab>('AGENT');
  const [menuSelections, setMenuSelections] = useState<Record<MenuTab, string[]>>({
    AGENT: [],
    ACCOUNTANT: [],
    ADMIN: [],
  });
  const [menuCfgLoading, setMenuCfgLoading] = useState(false);
  const [menuSaving, setMenuSaving] = useState(false);

  useEffect(() => {
    fetchOrg();
  }, []);

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
    return () => {
      cancelled = true;
    };
  }, [isTenantAdmin]);

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
    } catch {
      toast.error('Organizasyon bilgileri yüklenemedi');
    } finally {
      setLoading(false);
    }
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

      updateOrganization({
        name: data.name,
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        logo: data.logo,
        plan: data.plan,
      });

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

  const toggleMenuKey = (key: string) => {
    setMenuSelections((prev) => {
      const cur = new Set(prev[menuTab]);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      return { ...prev, [menuTab]: Array.from(cur) };
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
      window.dispatchEvent(new Event('crm-menu-visibility-changed'));
      toast.success('Menü görünürlüğü kaydedildi');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Menü ayarları kaydedilemedi');
    } finally {
      setMenuSaving(false);
    }
  };

  const planInfo = PLAN_LABELS[plan] || PLAN_LABELS.FREE;

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
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-whatsapp transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {backLabel}
        </Link>
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

      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Fatura Bilgileri</h2>
        </div>
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

      {isTenantAdmin ? (
        <div className="bg-white border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-gray-400" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Menü görünürlüğü</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Rol başına hangi ana menü modüllerinin görüneceğini seçin. Boş liste göndermek varsayılanlara döner.
              </p>
            </div>
          </div>
          {menuCfgLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-whatsapp" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {(['AGENT', 'ACCOUNTANT', 'ADMIN'] as MenuTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMenuTab(t)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      menuTab === t ? 'bg-whatsapp text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {t === 'AGENT' ? 'Temsilci' : t === 'ACCOUNTANT' ? 'Muhasebe' : 'Yönetici'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-gray-100 rounded-lg p-3">
                {MENU_KEYS.filter((k) => k !== 'superadmin').map((key) => {
                  const checked = menuSelections[menuTab].includes(key);
                  return (
                    <label
                      key={`${menuTab}-${key}`}
                      className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMenuKey(key)}
                        className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp"
                      />
                      <span>{MENU_KEY_LABELS[key] || key}</span>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void saveMenuVisibility()}
                disabled={menuSaving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                {menuSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Menü ayarlarını kaydet
              </button>
            </>
          )}
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
