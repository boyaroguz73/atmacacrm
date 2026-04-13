import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',
});

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
      localStorage.removeItem('token');
      localStorage.removeItem('user');
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
  if (e.code === 'ECONNREFUSED' || e.code === 'ERR_NETWORK') {
    return 'Sunucuya bağlanılamadı. Backend’in çalıştığından ve .env.local içindeki NEXT_PUBLIC_API_URL’nin doğru olduğundan emin olun.';
  }
  if (!e.response && typeof e.message === 'string' && e.message) {
    return `${fallback} (${e.message})`;
  }
  return fallback;
}

export default api;
