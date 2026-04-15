/** Sidebar üst seviye anahtarları — [frontend/src/components/layout/Sidebar.tsx] ile uyumlu */
export const MENU_KEYS = [
  'dashboard',
  'inbox',
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

export type MenuKey = (typeof MENU_KEYS)[number];

export type MenuVisibilityOverrides = Partial<
  Record<'AGENT' | 'ACCOUNTANT' | 'ADMIN' | 'SUPERADMIN', string[]>
>;

const SET_ALL = new Set<string>(MENU_KEYS);

/** Org ayarı yokken rol bazlı varsayılan görünür menü anahtarları */
export function defaultAllowedMenuKeys(role: string | undefined): Set<string> {
  const r = role ?? 'AGENT';
  if (r === 'SUPERADMIN') return new Set(SET_ALL);
  if (r === 'ADMIN') return new Set(MENU_KEYS.filter((k) => k !== 'superadmin'));
  if (r === 'ACCOUNTANT') {
    return new Set([
      'inbox',
      'contacts',
      'leads',
      'quotes',
      'orders',
      'accounting',
      'tasks',
      'calendar',
    ]);
  }
  // AGENT
  return new Set(['inbox', 'contacts', 'leads', 'quotes', 'orders', 'tasks', 'calendar']);
}

export function sanitizeMenuKeys(input: string[] | undefined): string[] {
  if (!input?.length) return [];
  const allowed = new Set(MENU_KEYS);
  return [...new Set(input.filter((k) => allowed.has(k as MenuKey)))];
}

export function effectiveMenuKeys(
  role: string | undefined,
  overrides: MenuVisibilityOverrides | null | undefined,
): string[] {
  const base = defaultAllowedMenuKeys(role);
  const r = (role ?? 'AGENT') as keyof MenuVisibilityOverrides;
  const custom = overrides?.[r];
  if (custom && custom.length > 0) {
    const sanitized = sanitizeMenuKeys(custom);
    if (sanitized.length > 0) return sanitized;
  }
  return [...base];
}
