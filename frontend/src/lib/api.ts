import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',
  timeout: 30_000,
});

/** Giriş/kayıt 401 — yanlış şifre; tam sayfa yenileme yapma (toast / konsol kaybolmasın) */
function isPublicAuthRequest(config: { baseURL?: string; url?: string } | undefined): boolean {
  if (!config) return false;
  const merged = [config.baseURL || '', config.url || ''].join('');
  const path = (merged || config.url || '').split('?')[0].toLowerCase();
  return path.includes('/auth/login') || path.includes('/auth/register');
}

function isAuthPagePathname(): boolean {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname;
  return (
    p === '/login' ||
    p === '/register' ||
    p === '/forgot-password' ||
    p.startsWith('/reset-password')
  );
}

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // Giriş/kayıt isteği veya hâlâ auth sayfasındayız → yönlendirme yok (konsol / toast kalır)
      if (isPublicAuthRequest(error.config) || isAuthPagePathname()) {
        return Promise.reject(error);
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('organization');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

/** Axios / ağ hatalarından okunabilir mesaj (Nest `message` dizisi dahil) */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const e = err as {
    response?: { data?: { message?: unknown } };
    code?: string;
    message?: string;
  };
  const m = e.response?.data?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m)) {
    const parts = m.filter((x): x is string => typeof x === 'string');
    if (parts.length) return parts.join(', ');
  }
  if (
    e.code === 'ECONNREFUSED' ||
    e.code === 'ERR_NETWORK' ||
    (typeof e.message === 'string' && e.message === 'Network Error')
  ) {
    return 'Sunucuya bağlanılamadı (CORS veya API adresi). Sunucuda kök .env içindeki NEXT_PUBLIC_API_URL / FRONTEND_URL değerlerini kontrol edin; frontend imajını yeniden build edin (docker compose build --no-cache frontend).';
  }
  if (!e.response && typeof e.message === 'string' && e.message) {
    return `${fallback} (${e.message})`;
  }
  return fallback;
}

export default api;
