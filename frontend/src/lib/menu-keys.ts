/** Backend [backend/src/common/menu-visibility.ts] ile aynı anahtarlar */
export const MENU_KEYS = [
  'dashboard',
  'inbox',
  'contacts',
  'kartelas',
  'leads',
  'products',
  'quotes',
  'orders',
  'accounting',
  'tasks',
  'calendar',
  'admin',
  'reports',
  'integrations',
  'settings',
  'support',
  'ecommerce',
] as const;

export type MenuKey = (typeof MENU_KEYS)[number];

export const MENU_KEY_LABELS: Record<string, string> = {
  dashboard: 'Gösterge Paneli',
  inbox: 'Mesajlar',
  contacts: 'Kişiler',
  kartelas: 'Kartelalar',
  leads: 'Potansiyel Müşteriler',
  products: 'Ürünler',
  quotes: 'Teklifler',
  orders: 'Siparişler',
  accounting: 'Muhasebe',
  tasks: 'Görevler',
  calendar: 'Takvim',
  admin: 'Yönetim',
  reports: 'Raporlar',
  integrations: 'Modüller',
  settings: 'Ayarlar',
  support: 'Destek',
  ecommerce: 'E-Ticaret',
};

export const MENU_KEY_DESCRIPTIONS: Record<string, string> = {
  dashboard: 'İstatistikler, KPI ve genel bakış',
  inbox: 'WhatsApp mesajlaşma ve sohbet',
  contacts: 'Müşteri rehberi',
  kartelas: 'Chat için hazır kartela medyaları',
  leads: 'Satış hunisi ve potansiyel müşteriler',
  products: 'Ürün kataloğu ve varyantlar',
  quotes: 'Teklif oluşturma ve yönetimi',
  orders: 'Sipariş takibi',
  accounting: 'Fatura, kasa ve muhasebe',
  tasks: 'Görev ve yapılacaklar',
  calendar: 'Takvim ve randevu',
  admin: 'Şablonlar, otomatik yanıt, log',
  reports: 'Performans ve satış raporları',
  integrations: 'Modül yönetimi ve entegrasyonlar',
  settings: 'Sistem ve organizasyon ayarları',
  support: 'Destek talebi oluşturma',
  ecommerce: 'E-ticaret ürün ve siparişleri',
};

/**
 * Menünün hangi rollere varsayılan olarak kısıtlı olduğu.
 * Boş dizi = herkes görebilir, ['ADMIN'] = sadece admin varsayılan.
 * Bu sadece UI göstergesi; asıl filtre Sidebar.tsx'teki role flag'lerden gelir.
 */
export const MENU_KEY_DEFAULT_ROLES: Record<string, string[]> = {
  dashboard: ['ADMIN'],
  inbox: [],
  contacts: [],
  kartelas: [],
  leads: [],
  products: ['ADMIN'],
  quotes: [],
  orders: [],
  accounting: ['ADMIN', 'ACCOUNTANT'],
  tasks: [],
  calendar: [],
  admin: ['ADMIN'],
  reports: ['ADMIN'],
  integrations: ['ADMIN'],
  settings: ['ADMIN'],
  support: ['ADMIN'],
  ecommerce: ['ADMIN'],
};

export const MENU_CHILD_KEYS: Record<string, { key: string; label: string }[]> = {
  inbox: [
    { key: 'inbox_main', label: 'Gelen kutusu' },
    { key: 'groups', label: 'Gruplar' },
    { key: 'unanswered', label: 'Cevapsızlar' },
    { key: 'answered', label: 'Cevaplananlar' },
    { key: 'followup', label: 'Takiptekiler' },
  ],
  quotes: [
    { key: 'quotes_list', label: 'Teklif Listesi' },
    { key: 'quotes_new', label: 'Yeni Teklif' },
  ],
  accounting: [
    { key: 'accounting_invoices', label: 'Faturalar' },
  ],
  admin: [
    { key: 'unassigned', label: 'Atanmamış' },
    { key: 'lost_leads', label: 'Kaçırılan Müşteriler' },
    { key: 'admin_history', label: 'Konuşma Geçmişi' },
    { key: 'admin_templates', label: 'Mesaj Şablonları' },
    { key: 'admin_auto_reply', label: 'Otomatik Yanıt' },
    { key: 'admin_audit_log', label: 'Aktivite Logu' },
  ],
  ecommerce: [
    { key: 'ecom_products', label: 'Ürünler' },
    { key: 'ecom_orders', label: 'Siparişler' },
  ],
};
