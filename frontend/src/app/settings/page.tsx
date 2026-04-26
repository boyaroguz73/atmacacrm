'use client';

import Link from 'next/link';
import {
  Users,
  SlidersHorizontal,
  Building2,
  ChevronRight,
} from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="p-6 space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ayarlar</h1>
        <p className="text-gray-500 text-sm mt-1">
          Kullanıcı yönetimi, organizasyon ve sistem ayarları
        </p>
      </div>

      <Link
        href="/settings/organization"
        className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-100 bg-white shadow-sm hover:border-whatsapp/30 hover:bg-whatsapp/5 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-whatsapp">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Organizasyon</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Şirket adı, logo, marka renkleri ve fatura bilgileri
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-whatsapp shrink-0" />
      </Link>

      <Link
        href="/settings/users"
        className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-100 bg-white shadow-sm hover:border-whatsapp/30 hover:bg-whatsapp/5 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Kullanıcı Yönetimi</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Kullanıcı ekleme, rol düzenleme ve şifre işlemlerini buradan yönetin.
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-whatsapp shrink-0" />
      </Link>


      <Link
        href="/settings/system"
        className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-100 bg-white shadow-sm hover:border-whatsapp/30 hover:bg-whatsapp/5 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Sistem Ayarları</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Dahili mesajlaşma, otomatik görevler ve varsayılan KDV ayarları.
            </p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-whatsapp shrink-0" />
      </Link>

    </div>
  );
}
