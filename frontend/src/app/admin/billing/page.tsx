'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Check,
  X,
  Crown,
  Zap,
  Building2,
  CreditCard,
  FileText,
  Loader2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PlanFeatureFlags {
  ai: boolean;
  flow: boolean;
  ecommerce: boolean;
  email: boolean;
  sms: boolean;
  api: boolean;
  customBranding: boolean;
  prioritySupport: boolean;
}

interface Plan {
  key: string;
  name: string;
  nameEn: string;
  price: number;
  currency: string;
  maxSessions: number;
  maxUsers: number;
  features: string[];
  featureFlags: PlanFeatureFlags;
}

/** Prisma Subscription satırı (API iç içe döner) */
interface SubscriptionRow {
  id: string;
  plan: string;
  status: string;
  currentPeriodEnd?: string | null;
  currentPeriodStart?: string | null;
  trialEndsAt?: string | null;
  cancelledAt?: string | null;
}

interface PlanConfigSummary {
  name: string;
  nameEn: string;
  price: number;
  currency?: string;
  maxSessions: number;
  maxUsers: number;
  features: string[];
  featureFlags: PlanFeatureFlags;
}

/** GET /billing/subscription gövdesi */
interface BillingSubscriptionPayload {
  subscription: SubscriptionRow | null;
  currentPlan: string;
  planConfig?: PlanConfigSummary | null;
  limits?: { maxUsers?: number; maxSessions?: number };
}

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  pdfUrl?: string;
}

/* ------------------------------------------------------------------ */
/*  Fallback plans (mirrors backend plan-config)                       */
/* ------------------------------------------------------------------ */

const FALLBACK_PLANS: Plan[] = [
  {
    key: 'FREE',
    name: 'Deneme',
    nameEn: 'Trial',
    price: 0,
    currency: 'TRY',
    maxSessions: 1,
    maxUsers: 2,
    features: ['1 WhatsApp Hesabı', '2 Kullanıcı', '14 Gün Deneme'],
    featureFlags: {
      ai: false,
      flow: false,
      ecommerce: false,
      email: false,
      sms: false,
      api: false,
      customBranding: false,
      prioritySupport: false,
    },
  },
  {
    key: 'STARTER',
    name: 'Başlangıç',
    nameEn: 'Starter',
    price: 799,
    currency: 'TRY',
    maxSessions: 1,
    maxUsers: 5,
    features: [
      '1 WhatsApp Hesabı',
      '5 Kullanıcı',
      'Sınırsız Mesaj',
      'Sınırsız Kişi',
      'CRM & Görev Yönetimi',
      'Şablon Mesajlar',
      'Otomatik Yanıt (Basit)',
      'Raporlama',
      'E-posta Desteği',
    ],
    featureFlags: {
      ai: false,
      flow: false,
      ecommerce: false,
      email: false,
      sms: false,
      api: false,
      customBranding: false,
      prioritySupport: false,
    },
  },
  {
    key: 'PROFESSIONAL',
    name: 'Profesyonel',
    nameEn: 'Professional',
    price: 1799,
    currency: 'TRY',
    maxSessions: 3,
    maxUsers: 15,
    features: [
      '3 WhatsApp Hesabı',
      '15 Kullanıcı',
      'Sınırsız Mesaj & Kişi',
      'Tüm Başlangıç Özellikleri',
      'AI Asistan',
      'Gelişmiş Akış (Flow Builder)',
      'API Erişimi',
      'Özel Logo & Renkler',
      'Öncelikli Destek',
    ],
    featureFlags: {
      ai: true,
      flow: true,
      ecommerce: false,
      email: false,
      sms: false,
      api: true,
      customBranding: true,
      prioritySupport: true,
    },
  },
  {
    key: 'ENTERPRISE',
    name: 'Kurumsal',
    nameEn: 'Enterprise',
    price: 3499,
    currency: 'TRY',
    maxSessions: 10,
    maxUsers: 50,
    features: [
      '10 WhatsApp Hesabı',
      '50 Kullanıcı',
      'Sınırsız Her Şey',
      'Tüm Profesyonel Özellikleri',
      'E-Ticaret Entegrasyonu',
      'E-posta Entegrasyonu',
      'NetGSM SMS Entegrasyonu',
      'Özel API & Webhook',
      'Beyaz Etiket (White-Label)',
      'Özel Destek Yöneticisi',
    ],
    featureFlags: {
      ai: true,
      flow: true,
      ecommerce: true,
      email: true,
      sms: true,
      api: true,
      customBranding: true,
      prioritySupport: true,
    },
  },
];

const ALL_FLAG_LABELS: { key: keyof PlanFeatureFlags; label: string }[] = [
  { key: 'ai', label: 'AI Asistan' },
  { key: 'flow', label: 'Akış Oluşturucu' },
  { key: 'api', label: 'API Erişimi' },
  { key: 'ecommerce', label: 'E-Ticaret Entegrasyonu' },
  { key: 'email', label: 'E-posta Entegrasyonu' },
  { key: 'sms', label: 'SMS Entegrasyonu' },
  { key: 'customBranding', label: 'Özel Marka' },
  { key: 'prioritySupport', label: 'Öncelikli Destek' },
];

const PLAN_ICONS: Record<string, React.ReactNode> = {
  FREE: <Zap className="w-6 h-6" />,
  STARTER: <CreditCard className="w-6 h-6" />,
  PROFESSIONAL: <Crown className="w-6 h-6" />,
  ENTERPRISE: <Building2 className="w-6 h-6" />,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPrice(price: number): string {
  return price.toLocaleString('tr-TR');
}

function normalizeSubscriptionStatus(status: string): string {
  return status.toLowerCase().replace(/-/g, '_');
}

function statusBadge(status: string) {
  const key = normalizeSubscriptionStatus(status);
  const map: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: 'bg-green-50', text: 'text-green-700', label: 'Aktif' },
    trialing: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      label: '14 gün deneme (Başlangıç)',
    },
    canceled: { bg: 'bg-red-50', text: 'text-red-700', label: 'İptal Edildi' },
    cancelled: { bg: 'bg-red-50', text: 'text-red-700', label: 'İptal Edildi' },
    expired: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Süresi doldu' },
    past_due: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Gecikmiş' },
    paid: { bg: 'bg-green-50', text: 'text-green-700', label: 'Ödendi' },
    pending: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Beklemede' },
    failed: { bg: 'bg-red-50', text: 'text-red-700', label: 'Başarısız' },
  };
  const s = map[key] ?? { bg: 'bg-gray-50', text: 'text-gray-600', label: status };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Payment Modal                                                      */
/* ------------------------------------------------------------------ */

function PaymentModal({
  plan,
  onClose,
  onSuccess,
}: {
  plan: Plan;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    cardHolder: '',
    cardNumber: '',
    expMonth: '',
    expYear: '',
    cvc: '',
    buyerName: '',
    buyerSurname: '',
    buyerEmail: '',
    buyerPhone: '',
    buyerCity: '',
    buyerAddress: '',
  });

  const set = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const formatCardNumber = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/billing/subscribe', {
        plan: plan.key,
        card: {
          cardHolderName: form.cardHolder,
          cardNumber: form.cardNumber.replace(/\s/g, ''),
          expireMonth: form.expMonth,
          expireYear: form.expYear,
          cvc: form.cvc,
        },
        buyer: {
          name: form.buyerName,
          surname: form.buyerSurname,
          email: form.buyerEmail,
          gsmNumber: form.buyerPhone,
          city: form.buyerCity,
          registrationAddress: form.buyerAddress,
        },
      });
      toast.success('Abonelik başarıyla başlatıldı!');
      onSuccess();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Ödeme işlemi başarısız oldu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white rounded-t-2xl border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Ödeme Bilgileri</h3>
            <p className="text-sm text-gray-500">
              {plan.name} — {formatPrice(plan.price)} ₺/ay
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Kart Bilgileri */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Kart Bilgileri
            </h4>
            <input
              required
              placeholder="Kart Üzerindeki İsim"
              value={form.cardHolder}
              onChange={(e) => set('cardHolder', e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
            />
            <input
              required
              placeholder="Kart Numarası"
              value={formatCardNumber(form.cardNumber)}
              onChange={(e) => set('cardNumber', e.target.value)}
              maxLength={19}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20 font-mono tracking-wider"
            />
            <div className="grid grid-cols-3 gap-3">
              <select
                required
                value={form.expMonth}
                onChange={(e) => set('expMonth', e.target.value)}
                className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
              >
                <option value="">Ay</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1).padStart(2, '0')}>
                    {String(i + 1).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <select
                required
                value={form.expYear}
                onChange={(e) => set('expYear', e.target.value)}
                className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
              >
                <option value="">Yıl</option>
                {Array.from({ length: 10 }, (_, i) => {
                  const y = new Date().getFullYear() + i;
                  return (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  );
                })}
              </select>
              <input
                required
                placeholder="CVC"
                value={form.cvc}
                onChange={(e) => set('cvc', e.target.value.replace(/\D/g, '').slice(0, 4))}
                maxLength={4}
                className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-center focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20 font-mono"
              />
            </div>
          </div>

          {/* Alıcı Bilgileri */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-700">Alıcı Bilgileri</h4>
            <div className="grid grid-cols-2 gap-3">
              <input
                required
                placeholder="Ad"
                value={form.buyerName}
                onChange={(e) => set('buyerName', e.target.value)}
                className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
              />
              <input
                required
                placeholder="Soyad"
                value={form.buyerSurname}
                onChange={(e) => set('buyerSurname', e.target.value)}
                className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
              />
            </div>
            <input
              required
              type="email"
              placeholder="E-posta"
              value={form.buyerEmail}
              onChange={(e) => set('buyerEmail', e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
            />
            <input
              required
              placeholder="Telefon (+90...)"
              value={form.buyerPhone}
              onChange={(e) => set('buyerPhone', e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
            />
            <input
              required
              placeholder="Şehir"
              value={form.buyerCity}
              onChange={(e) => set('buyerCity', e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
            />
            <textarea
              required
              placeholder="Adres"
              rows={2}
              value={form.buyerAddress}
              onChange={(e) => set('buyerAddress', e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                İşleniyor...
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4" />
                {formatPrice(plan.price)} ₺ Öde
              </>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Ödeme altyapısı iyzico tarafından güvenli şekilde sağlanmaktadır.
          </p>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function BillingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>(FALLBACK_PLANS);
  const [billingOverview, setBillingOverview] =
    useState<BillingSubscriptionPayload | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.role === 'AGENT') {
          router.replace('/inbox');
          return;
        }
      }
    } catch {}
  }, [router]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [plansRes, subRes, invRes] = await Promise.allSettled([
        api.get('/billing/plans'),
        api.get('/billing/subscription'),
        api.get('/billing/invoices'),
      ]);

      if (plansRes.status === 'fulfilled' && Array.isArray(plansRes.value.data)) {
        setPlans(
          plansRes.value.data.map((p: Plan & { id?: string }) => ({
            ...p,
            key: p.key || p.id || '',
          })),
        );
      }
      if (subRes.status === 'fulfilled') {
        setBillingOverview(subRes.value.data as BillingSubscriptionPayload);
      }
      if (invRes.status === 'fulfilled') {
        setInvoices(invRes.value.data?.invoices || invRes.value.data || []);
      }
    } catch {
      // keep fallback data
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const subRow = billingOverview?.subscription;
  const currentPlanKey = (
    billingOverview?.currentPlan ||
    subRow?.plan ||
    'FREE'
  ).toUpperCase();
  const planConfigFromApi = billingOverview?.planConfig ?? null;
  const currentPlan =
    plans.find((p) => p.key === currentPlanKey) || plans[0];
  const heroPlanName = planConfigFromApi?.name || currentPlan.name;
  const lim = billingOverview?.limits;
  const heroSessions =
    lim?.maxSessions ??
    planConfigFromApi?.maxSessions ??
    currentPlan.maxSessions;
  const heroUsers =
    lim?.maxUsers ?? planConfigFromApi?.maxUsers ?? currentPlan.maxUsers;

  const subStatusNorm = subRow?.status
    ? normalizeSubscriptionStatus(subRow.status)
    : '';

  const periodEndMs = subRow?.currentPeriodEnd
    ? new Date(subRow.currentPeriodEnd).getTime()
    : NaN;
  const daysRemaining = Number.isFinite(periodEndMs)
    ? Math.max(
        0,
        Math.ceil((periodEndMs - Date.now()) / 86_400_000),
      )
    : null;

  const handleCancel = async () => {
    if (!confirm('Aboneliğinizi iptal etmek istediğinize emin misiniz?')) return;
    setCancelLoading(true);
    try {
      await api.post('/billing/cancel');
      toast.success('Abonelik iptal edildi.');
      fetchAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'İptal işlemi başarısız.');
    } finally {
      setCancelLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-10 max-w-7xl mx-auto">
      {/* ---- Hero: Current Plan ---- */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-600 via-green-700 to-emerald-800 p-8 text-white">
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/5" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-white/5" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="text-green-200 text-sm font-medium mb-1">Mevcut Planınız</p>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              {PLAN_ICONS[currentPlanKey] ?? PLAN_ICONS.FREE}
              {heroPlanName}
            </h1>
            <p className="text-green-100 mt-2 text-sm">
              {heroSessions} WhatsApp hesabı · {heroUsers} kullanıcı
              {planConfigFromApi?.nameEn ? (
                <span className="opacity-80"> · {planConfigFromApi.nameEn}</span>
              ) : null}
            </p>
            {subRow?.currentPeriodStart && (
              <p className="text-green-200/90 text-xs mt-1.5">
                Dönem başlangıcı:{' '}
                {new Date(subRow.currentPeriodStart).toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            )}
            {subRow?.currentPeriodEnd && (
              <p className="text-green-200 text-xs mt-1">
                Bitiş / yenileme:{' '}
                {new Date(subRow.currentPeriodEnd).toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                {daysRemaining != null && daysRemaining > 0 && (
                  <span className="ml-1 opacity-90">
                    (~{daysRemaining.toLocaleString('tr-TR')} gün kaldı)
                  </span>
                )}
              </p>
            )}
            {!subRow && currentPlanKey !== 'FREE' && (
              <p className="text-amber-200 text-xs mt-2">
                Paket organizasyon kaydınıza göre güncel; ayrıntılı abonelik satırı
                bulunamadı.
              </p>
            )}
            {subRow?.status && (
              <div className="mt-3">{statusBadge(subRow.status)}</div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            {currentPlanKey !== 'ENTERPRISE' && (
              <a
                href="#plans"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-green-700 font-semibold rounded-xl hover:bg-green-50 transition-colors text-sm"
              >
                <Zap className="w-4 h-4" />
                Planı Yükselt
              </a>
            )}
            {subStatusNorm === 'active' && currentPlanKey !== 'FREE' && (
              <button
                onClick={handleCancel}
                disabled={cancelLoading}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/10 text-white font-medium rounded-xl hover:bg-white/20 transition-colors text-sm border border-white/20"
              >
                {cancelLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Aboneliği İptal Et'
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---- Pricing Grid ---- */}
      <section id="plans">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Planlar & Fiyatlandırma</h2>
          <p className="text-gray-500 mt-2 text-sm">
            İşletmenize en uygun planı seçin. İstediğiniz zaman yükseltin veya düşürün.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {plans.map((plan) => {
            const isPopular = plan.key === 'PROFESSIONAL';
            const isCurrent = plan.key === currentPlanKey;

            return (
              <div
                key={plan.key}
                className={`relative flex flex-col bg-white rounded-2xl border-2 transition-shadow hover:shadow-lg ${
                  isPopular
                    ? 'border-green-500 shadow-green-100 shadow-lg'
                    : 'border-gray-100 shadow-sm'
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 px-4 py-1 bg-green-600 text-white text-xs font-bold rounded-full shadow-md">
                      <Crown className="w-3 h-3" />
                      Popüler
                    </span>
                  </div>
                )}

                <div className="p-6 pb-4">
                  <div className="flex items-center gap-2 text-gray-500 mb-3">
                    {PLAN_ICONS[plan.key]}
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      {plan.nameEn}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    {plan.price === 0 ? (
                      <span className="text-3xl font-extrabold text-gray-900">Ücretsiz</span>
                    ) : (
                      <>
                        <span className="text-3xl font-extrabold text-gray-900">
                          {formatPrice(plan.price)} ₺
                        </span>
                        <span className="text-gray-400 text-sm">/ay</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {plan.maxSessions} WP hesabı · {plan.maxUsers} kullanıcı
                  </p>
                </div>

                <div className="flex-1 px-6 pb-2">
                  <div className="border-t border-gray-100 pt-4 space-y-2.5">
                    {plan.features.map((f) => (
                      <div key={f} className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-gray-600">{f}</span>
                      </div>
                    ))}
                    {ALL_FLAG_LABELS.map(({ key, label }) => {
                      const has = plan.featureFlags[key];
                      if (has) return null;
                      return (
                        <div key={key} className="flex items-start gap-2">
                          <X className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0" />
                          <span className="text-sm text-gray-300 line-through">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-6 pt-4">
                  {isCurrent ? (
                    <div className="w-full py-3 text-center text-sm font-semibold text-green-700 bg-green-50 rounded-xl border border-green-200">
                      Mevcut Plan
                    </div>
                  ) : plan.key === 'FREE' ? (
                    <div className="w-full py-3 text-center text-sm font-medium text-gray-400 bg-gray-50 rounded-xl">
                      Ücretsiz Deneme
                    </div>
                  ) : (
                    <button
                      onClick={() => setSelectedPlan(plan)}
                      className={`w-full py-3 text-sm font-semibold rounded-xl transition-colors ${
                        isPopular
                          ? 'bg-green-600 hover:bg-green-700 text-white shadow-md shadow-green-200'
                          : 'bg-gray-900 hover:bg-gray-800 text-white'
                      }`}
                    >
                      Plan Seç
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Invoice History ---- */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-gray-400" />
          <h2 className="text-xl font-bold text-gray-900">Fatura Geçmişi</h2>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase">
                  Fatura No
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase">
                  Tarih
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase">
                  Tutar
                </th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase">
                  Durum
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400 text-sm">
                    Henüz fatura bulunmuyor
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-5 py-3.5 text-sm font-mono text-gray-700">
                      #{inv.id.slice(-8).toUpperCase()}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">
                      {new Date(inv.createdAt).toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-gray-900">
                      {formatPrice(inv.amount)} ₺
                    </td>
                    <td className="px-5 py-3.5">{statusBadge(inv.status)}</td>
                    <td className="px-3 py-3.5">
                      {inv.pdfUrl && (
                        <a
                          href={inv.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-600 hover:text-green-700 text-xs font-medium"
                        >
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Payment Modal ---- */}
      {selectedPlan && (
        <PaymentModal
          plan={selectedPlan}
          onClose={() => setSelectedPlan(null)}
          onSuccess={() => {
            setSelectedPlan(null);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}
