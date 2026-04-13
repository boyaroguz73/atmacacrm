'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageSquare, ArrowLeft, Mail } from 'lucide-react';
import api from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const [networkError, setNetworkError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setNetworkError(false);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err: any) {
      if (!err?.response) {
        setNetworkError(true);
      } else {
        setSent(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-whatsapp/10 rounded-2xl mb-4">
              {sent ? (
                <Mail className="w-8 h-8 text-whatsapp" />
              ) : (
                <MessageSquare className="w-8 h-8 text-whatsapp" />
              )}
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              {sent ? 'E-postanızı Kontrol Edin' : 'Şifremi Unuttum'}
            </h1>
            <p className="text-gray-500 mt-1">
              {sent
                ? 'Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.'
                : 'E-posta adresinizi girin, size şifre sıfırlama bağlantısı gönderelim.'}
            </p>
          </div>

          {sent ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
                Eğer bu e-posta kayıtlıysa, birkaç dakika içinde bir e-posta alacaksınız.
                Spam klasörünü de kontrol etmeyi unutmayın.
              </div>
              <Link
                href="/login"
                className="flex items-center justify-center gap-2 w-full py-3 bg-whatsapp text-white rounded-xl font-semibold hover:bg-green-600 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Giriş Sayfasına Dön
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {networkError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                  Bağlantı hatası. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  E-posta
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-whatsapp focus:ring-2 focus:ring-whatsapp/20 outline-none transition-all"
                  placeholder="ornek@mail.com"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-whatsapp text-white rounded-xl font-semibold hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Gönderiliyor...' : 'Sıfırlama Bağlantısı Gönder'}
              </button>
            </form>
          )}

          {!sent && (
            <p className="text-center text-sm text-gray-600 mt-6">
              <Link href="/login" className="text-whatsapp font-semibold hover:underline inline-flex items-center gap-1">
                <ArrowLeft className="w-3.5 h-3.5" />
                Giriş sayfasına dön
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
