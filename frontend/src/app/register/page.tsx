'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import toast from 'react-hot-toast';
import { MessageSquare } from 'lucide-react';

function apiMessage(err: unknown): string {
  const d = err && typeof err === 'object' && 'response' in err
    ? (err as { response?: { data?: { message?: unknown } } }).response?.data
        ?.message
    : undefined;
  if (Array.isArray(d)) return d.join(', ');
  if (typeof d === 'string') return d;
  return 'Kayıt tamamlanamadı';
}

export default function RegisterPage() {
  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { register, isLoading } = useAuthStore();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Şifre en az 8 karakter olmalıdır');
      return;
    }
    try {
      await register({
        organizationName: organizationName.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
      });
      toast.success('Hesabınız oluşturuldu — 14 gün Başlangıç planı denemesi başladı');
      router.push('/dashboard');
    } catch (err) {
      toast.error(apiMessage(err));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-white to-emerald-50 py-10 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-whatsapp/10 rounded-2xl mb-4">
              <MessageSquare className="w-8 h-8 text-whatsapp" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Hesap oluştur</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Şirketiniz için organizasyon + yönetici hesabı. Kart gerekmez;{' '}
              <strong>Başlangıç</strong> planında 14 gün deneme.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Şirket / organizasyon adı
              </label>
              <input
                type="text"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-whatsapp focus:ring-2 focus:ring-whatsapp/20 outline-none transition-all"
                placeholder="Örn. Atmaca Ofis"
                required
                minLength={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Adınız soyadınız
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-whatsapp focus:ring-2 focus:ring-whatsapp/20 outline-none transition-all"
                placeholder="Yönetici adı"
                required
                minLength={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                E-posta
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-whatsapp focus:ring-2 focus:ring-whatsapp/20 outline-none transition-all"
                placeholder="siz@sirket.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Şifre
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-whatsapp focus:ring-2 focus:ring-whatsapp/20 outline-none transition-all"
                placeholder="En az 8 karakter"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-whatsapp text-white rounded-xl font-semibold hover:bg-green-600 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Kaydediliyor...' : 'Kayıt ol'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-600 mt-6">
            Zaten hesabınız var mı?{' '}
            <Link href="/login" className="text-whatsapp font-semibold hover:underline">
              Giriş yap
            </Link>
          </p>

          <p className="text-center text-xs text-gray-400 mt-4">
            Kayıt olarak Başlangıç planı ve 14 günlük deneme koşullarını kabul etmiş olursunuz.
          </p>
        </div>
      </div>
    </div>
  );
}
