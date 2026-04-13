export interface PlanConfig {
  name: string;
  nameEn: string;
  price: number;
  currency: string;
  maxSessions: number;
  maxUsers: number;
  features: string[];
  featureFlags: {
    ai: boolean;
    flow: boolean;
    ecommerce: boolean;
    email: boolean;
    sms: boolean;
    api: boolean;
    customBranding: boolean;
    prioritySupport: boolean;
    whatsapp: boolean;
    instagram: boolean;
    facebook: boolean;
    telegram: boolean;
    chatbot: boolean;
    tsoft: boolean;
    ticimax: boolean;
    ikas: boolean;
    shopify: boolean;
    ideasoft: boolean;
  };
}

export const PLAN_CONFIGS: Record<string, PlanConfig> = {
  FREE: {
    name: 'Deneme',
    nameEn: 'Trial',
    price: 0,
    currency: 'TRY',
    maxSessions: 1,
    maxUsers: 2,
    features: [
      '1 WhatsApp Hesabı',
      '2 Kullanıcı',
      '14 Gün Deneme',
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
      whatsapp: true,
      instagram: false,
      facebook: false,
      telegram: false,
      chatbot: false,
      tsoft: false,
      ticimax: false,
      ikas: false,
      shopify: false,
      ideasoft: false,
    },
  },
  STARTER: {
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
      whatsapp: true,
      instagram: false,
      facebook: false,
      telegram: false,
      chatbot: false,
      tsoft: false,
      ticimax: false,
      ikas: false,
      shopify: false,
      ideasoft: false,
    },
  },
  PROFESSIONAL: {
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
      'AI Asistan & Chatbot',
      'Instagram & Facebook Entegrasyonu',
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
      whatsapp: true,
      instagram: true,
      facebook: true,
      telegram: false,
      chatbot: true,
      tsoft: false,
      ticimax: false,
      ikas: false,
      shopify: false,
      ideasoft: false,
    },
  },
  ENTERPRISE: {
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
      'Telegram Entegrasyonu',
      'Tüm E-Ticaret Entegrasyonları',
      'E-posta & SMS Entegrasyonu',
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
      whatsapp: true,
      instagram: true,
      facebook: true,
      telegram: true,
      chatbot: true,
      tsoft: true,
      ticimax: true,
      ikas: true,
      shopify: true,
      ideasoft: true,
    },
  },
};

export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIGS[plan] || PLAN_CONFIGS.FREE;
}
