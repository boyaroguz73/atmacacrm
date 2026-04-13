'use client';

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
} from 'lucide-react';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3002';

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  FREE: { label: 'Deneme', color: 'bg-gray-100 text-gray-700' },
  STARTER: { label: 'Başlangıç', color: 'bg-blue-100 text-blue-700' },
  PROFESSIONAL: { label: 'Profesyonel', color: 'bg-purple-100 text-purple-700' },
  ENTERPRISE: { label: 'Kurumsal', color: 'bg-amber-100 text-amber-800' },
};

export default function OrganizationPage() {
  const { updateOrganization } = useAuthStore();
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

  useEffect(() => {
    fetchOrg();
  }, []);

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
      toast.error('Dosya boyutu 5MB\'dan küçük olmalıdır');
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organizasyon Ayarları</h1>
        <p className="text-sm text-gray-500 mt-1">
          Organizasyonunuzun adını, logosunu, marka renklerini ve fatura bilgilerini yönetin.
        </p>
      </div>

      {/* Current Plan Badge */}
      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <Crown className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Mevcut Plan</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${planInfo.color}`}>
                  {planInfo.label}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Logo Section */}
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

      {/* Branding Section */}
      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Marka Bilgileri</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organizasyon Adı *
            </label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ana Renk (Vurgu)
              </label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                İkincil Renk (Sidebar)
              </label>
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
          {/* Color Preview */}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-xs text-gray-500">Önizleme:</span>
            <div
              className="h-8 w-20 rounded-lg shadow-sm border"
              style={{ backgroundColor: primaryColor }}
            />
            <div
              className="h-8 w-20 rounded-lg shadow-sm border"
              style={{ backgroundColor: secondaryColor }}
            />
            <div
              className="h-8 flex-1 rounded-lg shadow-sm border"
              style={{
                background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Billing Section */}
      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Fatura Bilgileri</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fatura E-posta
            </label>
            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="fatura@sirket.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fatura Adı / Ünvanı
            </label>
            <input
              type="text"
              value={billingName}
              onChange={(e) => setBillingName(e.target.value)}
              placeholder="Şirket Ünvanı A.Ş."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fatura Adresi
            </label>
            <textarea
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              rows={2}
              placeholder="Fatura adresi"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp/20 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vergi Numarası
            </label>
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

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-whatsapp text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-all font-medium"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
        </button>
      </div>
    </div>
  );
}
