/** Backend [backend/src/common/menu-visibility.ts] ile aynı anahtarlar */
export const MENU_KEYS = [
  'dashboard',
  'inbox',
  'groups',
  'contacts',
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
  'superadmin',
] as const;

export const MENU_KEY_LABELS: Record<string, string> = {
  dashboard: 'Gösterge Paneli',
  inbox: 'Mesajlar',
  groups: 'Gruplar',
  contacts: 'Kişiler',
  leads: 'Potansiyel Müşteriler',
  products: 'Ürünler',
  quotes: 'Teklifler',
  orders: 'Siparişler',
  accounting: 'Muhasebe',
  tasks: 'Görevler',
  calendar: 'Takvim',
  admin: 'Yönetim',
  reports: 'Raporlar',
  integrations: 'Entegrasyonlar',
  settings: 'Ayarlar',
  support: 'Destek',
  ecommerce: 'E-Ticaret',
  superadmin: 'SaaS Panel',
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
  superadmin: [
    { key: 'sa_overview', label: 'Genel Bakış' },
    { key: 'sa_users', label: 'Kullanıcılar' },
    { key: 'sa_plans', label: 'Paketler' },
    { key: 'sa_tickets', label: 'Destek Talepleri' },
    { key: 'sa_system', label: 'Sistem Sağlığı' },
  ],
};
