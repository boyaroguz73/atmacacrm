'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import toast from 'react-hot-toast';
import { MessageSquare } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuthStore();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      toast.success('Giriş başarılı');
      const stored = localStorage.getItem('user');
      const user = stored ? JSON.parse(stored) : null;
      if (user?.role === 'SUPERADMIN') {
        router.push('/superadmin');
      } else {
        router.push('/dashboard');
      }
    } catch {
      toast.error('Geçersiz e-posta veya şifre');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-whatsapp/10 rounded-2xl mb-4">
              <MessageSquare className="w-8 h-8 text-whatsapp" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">WhatsApp CRM</h1>
            <p className="text-gray-500 mt-1">Hesabınıza giriş yapın</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                E-posta
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-whatsapp focus:ring-2 focus:ring-whatsapp/20 outline-none transition-all"
                placeholder="admin@crm.com"
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
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-whatsapp text-white rounded-xl font-semibold hover:bg-green-600 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </button>
          </form>

          <div className="text-center mt-4">
            <Link href="/forgot-password" className="text-sm text-gray-500 hover:text-whatsapp transition-colors">
              Şifremi unuttum
            </Link>
          </div>

          <p className="text-center text-sm text-gray-600 mt-4">
            Hesabınız yok mu?{' '}
            <Link href="/register" className="text-whatsapp font-semibold hover:underline">
              Ücretsiz kayıt ol
            </Link>
          </p>
          <p className="text-center text-xs text-gray-400 mt-3">
            WhatsApp CRM Platform
          </p>
        </div>
      </div>
    </div>
  );
}
