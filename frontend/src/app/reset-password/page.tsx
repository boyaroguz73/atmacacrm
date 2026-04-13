'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { MessageSquare, ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
import api from '@/lib/api';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [errorMessage, setErrorMessage] = useState('');

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-red-50 rounded-2xl mb-2">
          <XCircle className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Geçersiz Bağlantı</h1>
        <p className="text-gray-500">Bu şifre sıfırlama bağlantısı geçersiz veya eksik.</p>
        <Link
          href="/forgot-password"
          className="inline-flex items-center gap-2 text-whatsapp font-semibold hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Yeni bağlantı talep et
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setErrorMessage('Şifreler eşleşmiyor');
      return;
    }

    if (newPassword.length < 6) {
      setErrorMessage('Şifre en az 6 karakter olmalıdır');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      await api.post('/auth/reset-password', { token, newPassword });
      setStatus('success');
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Bir hata oluştu';
      setErrorMessage(msg);
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  if (status === 'success') {
    return (
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-50 rounded-2xl mb-2">
          <CheckCircle className="w-8 h-8 text-whatsapp" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Şifreniz Güncellendi</h1>
        <p className="text-gray-500">Yeni şifrenizle giriş yapabilirsiniz.</p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 w-full py-3 bg-whatsapp text-white rounded-xl font-semibold hover:bg-green-600 transition-colors"
        >
          Giriş Yap
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-whatsapp/10 rounded-2xl mb-4">
          <MessageSquare className="w-8 h-8 text-whatsapp" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Yeni Şifre Belirle</h1>
        <p className="text-gray-500 mt-1">Hesabınız için yeni bir şifre girin.</p>
      </div>

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 mb-4">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Yeni Şifre
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-whatsapp focus:ring-2 focus:ring-whatsapp/20 outline-none transition-all"
            placeholder="En az 6 karakter"
            required
            minLength={6}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Şifreyi Tekrarla
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-whatsapp focus:ring-2 focus:ring-whatsapp/20 outline-none transition-all"
            placeholder="Aynı şifreyi tekrar girin"
            required
            minLength={6}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 bg-whatsapp text-white rounded-xl font-semibold hover:bg-green-600 transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Güncelleniyor...' : 'Şifremi Güncelle'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-600 mt-6">
        <Link href="/login" className="text-whatsapp font-semibold hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          Giriş sayfasına dön
        </Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <Suspense
            fallback={
              <div className="text-center py-8 text-gray-400">Yükleniyor...</div>
            }
          >
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
