export const LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: 'Yeni',
  CONTACTED: 'İletişime Geçildi',
  INTERESTED: 'İlgileniyor',
  OFFER_SENT: 'Teklif Gönderildi',
  WON: 'Kazanıldı',
  LOST: 'Kaybedildi',
};

export const LEAD_STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  CONTACTED: 'bg-yellow-100 text-yellow-700',
  INTERESTED: 'bg-purple-100 text-purple-700',
  OFFER_SENT: 'bg-orange-100 text-orange-700',
  WON: 'bg-green-100 text-green-700',
  LOST: 'bg-red-100 text-red-700',
};

export const LEAD_STATUSES = [
  { value: 'NEW', label: 'Yeni', color: 'bg-blue-100 text-blue-700' },
  { value: 'CONTACTED', label: 'İletişime Geçildi', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'INTERESTED', label: 'İlgileniyor', color: 'bg-purple-100 text-purple-700' },
  { value: 'OFFER_SENT', label: 'Teklif Gönderildi', color: 'bg-orange-100 text-orange-700' },
  { value: 'WON', label: 'Kazanıldı', color: 'bg-green-100 text-green-700' },
  { value: 'LOST', label: 'Kaybedildi', color: 'bg-red-100 text-red-700' },
];

export const SOURCES = [
  { value: 'WhatsApp', label: 'WhatsApp' },
  { value: 'Web Sitesi', label: 'Web Sitesi' },
  { value: 'Referans', label: 'Referans' },
  { value: 'Sosyal Medya', label: 'Sosyal Medya' },
  { value: 'Eski Müşteri', label: 'Eski Müşteri' },
  { value: 'Mağaza Müşterisi', label: 'Mağaza Müşterisi' },
  { value: 'Diğer', label: 'Diğer' },
];

export const PLAN_FEATURES: Record<string, Record<string, boolean>> = {
  FREE: {
    ai: false, flow: false, ecommerce: false, email: false, sms: false,
    api: false, customBranding: false, prioritySupport: false,
    whatsapp: true, instagram: false, facebook: false, telegram: false,
    chatbot: false, tsoft: false, ticimax: false, ikas: false, shopify: false, ideasoft: false,
  },
  STARTER: {
    ai: false, flow: false, ecommerce: false, email: false, sms: false,
    api: false, customBranding: false, prioritySupport: false,
    whatsapp: true, instagram: false, facebook: false, telegram: false,
    chatbot: false, tsoft: false, ticimax: false, ikas: false, shopify: false, ideasoft: false,
  },
  PROFESSIONAL: {
    ai: true, flow: true, ecommerce: false, email: false, sms: false,
    api: true, customBranding: true, prioritySupport: true,
    whatsapp: true, instagram: true, facebook: true, telegram: false,
    chatbot: true, tsoft: false, ticimax: false, ikas: false, shopify: false, ideasoft: false,
  },
  ENTERPRISE: {
    ai: true, flow: true, ecommerce: true, email: true, sms: true,
    api: true, customBranding: true, prioritySupport: true,
    whatsapp: true, instagram: true, facebook: true, telegram: true,
    chatbot: true, tsoft: true, ticimax: true, ikas: true, shopify: true, ideasoft: true,
  },
};

export function hasFeature(plan: string, feature: string): boolean {
  return PLAN_FEATURES[plan]?.[feature] ?? false;
}

export const PLAN_LABELS: Record<string, string> = {
  FREE: 'Deneme',
  STARTER: 'Başlangıç',
  PROFESSIONAL: 'Profesyonel',
  ENTERPRISE: 'Kurumsal',
};

export const PLAN_COLORS: Record<string, string> = {
  FREE: 'bg-gray-100 text-gray-600',
  STARTER: 'bg-blue-100 text-blue-700',
  PROFESSIONAL: 'bg-green-100 text-green-700',
  ENTERPRISE: 'bg-purple-100 text-purple-700',
};
