export type IntegrationCategory = 'messaging' | 'ecommerce' | 'ai';

export interface IntegrationDef {
  key: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  featureFlag: string;
  icon: string;
  addonPrice: number;
  comingSoon?: boolean;
}

export const INTEGRATION_CATALOG: IntegrationDef[] = [
  // Mesajlaşma
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    description: 'WhatsApp Business API ile müşterilerinizle iletişim kurun. QR kod ile hızlı bağlantı.',
    category: 'messaging',
    featureFlag: 'whatsapp',
    icon: 'whatsapp',
    addonPrice: 0,
  },
  {
    key: 'instagram',
    name: 'Instagram',
    description: 'Instagram Direct mesajlarınızı CRM üzerinden yönetin. Otomatik yanıt ve etiketleme.',
    category: 'messaging',
    featureFlag: 'instagram',
    icon: 'instagram',
    addonPrice: 499,
    comingSoon: true,
  },
  {
    key: 'facebook',
    name: 'Facebook Messenger',
    description: 'Facebook sayfanıza gelen mesajları tek panelden yanıtlayın.',
    category: 'messaging',
    featureFlag: 'facebook',
    icon: 'facebook',
    addonPrice: 499,
    comingSoon: true,
  },
  {
    key: 'telegram',
    name: 'Telegram',
    description: 'Telegram bot entegrasyonu ile müşteri iletişiminizi genişletin.',
    category: 'messaging',
    featureFlag: 'telegram',
    icon: 'telegram',
    addonPrice: 299,
    comingSoon: true,
  },

  // Yapay Zeka
  {
    key: 'chatbot',
    name: 'AI Chatbot',
    description: 'Yapay zeka destekli chatbot ile müşteri sorularını otomatik yanıtlayın. GPT tabanlı akıllı cevaplar.',
    category: 'ai',
    featureFlag: 'chatbot',
    icon: 'bot',
    addonPrice: 699,
  },

  // E-Ticaret
  {
    key: 'tsoft',
    name: 'T-Soft',
    description: 'T-Soft e-ticaret altyapınızı entegre edin. Sipariş bildirimleri ve müşteri senkronizasyonu.',
    category: 'ecommerce',
    featureFlag: 'tsoft',
    icon: 'tsoft',
    addonPrice: 599,
  },
  {
    key: 'ticimax',
    name: 'Ticimax',
    description: 'Ticimax mağazanızı bağlayın. Otomatik sipariş takibi ve müşteri mesajları.',
    category: 'ecommerce',
    featureFlag: 'ticimax',
    icon: 'ticimax',
    addonPrice: 599,
  },
  {
    key: 'ikas',
    name: 'ikas',
    description: 'ikas e-ticaret platformunu entegre edin. Sipariş durumu ve kargo bildirimleri.',
    category: 'ecommerce',
    featureFlag: 'ikas',
    icon: 'ikas',
    addonPrice: 599,
  },
  {
    key: 'shopify',
    name: 'Shopify',
    description: 'Shopify mağazanızı bağlayarak sipariş ve müşteri verilerinizi senkronize edin.',
    category: 'ecommerce',
    featureFlag: 'shopify',
    icon: 'shopify',
    addonPrice: 599,
  },
  {
    key: 'ideasoft',
    name: 'IdeaSoft',
    description: 'IdeaSoft altyapınızla entegre olun. Sipariş bildirimleri ve stok güncellemeleri.',
    category: 'ecommerce',
    featureFlag: 'ideasoft',
    icon: 'ideasoft',
    addonPrice: 599,
  },
];

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  messaging: 'Mesajlaşma Kanalları',
  ai: 'Yapay Zeka',
  ecommerce: 'E-Ticaret Entegrasyonları',
};

export function getIntegration(key: string): IntegrationDef | undefined {
  return INTEGRATION_CATALOG.find((i) => i.key === key);
}
