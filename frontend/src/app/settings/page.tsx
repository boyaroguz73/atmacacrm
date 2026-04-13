'use client';

import { useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import {
  Users,
  Loader2,
  Plus,
  Pencil,
  Key,
  Shield,
  UserCheck,
  UserX,
  X,
  Settings2,
  ToggleLeft,
  ToggleRight,
  Database,
  ImageIcon,
  MessageSquareMore,
} from 'lucide-react';
import toast from 'react-hot-toast';

const AVATAR_REFRESH_FORCE_KEY = 'crm_settings_avatar_refresh_force';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface SystemSettingItem {
  key: string;
  value: string;
}

const roleLabels: Record<string, string> = {
  SUPERADMIN: 'Yönetici',
  ADMIN: 'Yönetici',
  AGENT: 'Temsilci',
  ACCOUNTANT: 'Muhasebeci',
};

export default function SettingsPage() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserItem | null>(null);

  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('AGENT');
  const [newPassword, setNewPassword] = useState('');

  const [settings, setSettings] = useState<SystemSettingItem[]>([]);
  const [internalChatEnabled, setInternalChatEnabled] = useState(false);
  /** Toplu avatar: true ise zaten fotoğrafı olan kişiler de WAHA'dan yeniden çekilir */
  const [avatarRefreshForce, setAvatarRefreshForce] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(AVATAR_REFRESH_FORCE_KEY) === '1') {
        setAvatarRefreshForce(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setAvatarRefreshForcePersist = (value: boolean) => {
    setAvatarRefreshForce(value);
    try {
      if (value) localStorage.setItem(AVATAR_REFRESH_FORCE_KEY, '1');
      else localStorage.removeItem(AVATAR_REFRESH_FORCE_KEY);
    } catch {
      /* ignore */
    }
  };

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Kullanıcılar yüklenemedi');
    }
  };

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/system-settings');
      setSettings(data);
      const ic = data.find((s: SystemSettingItem) => s.key === 'internal_chat_enabled');
      setInternalChatEnabled(ic?.value === 'true');
    } catch {
      toast.error('Ayarlar yüklenemedi');
    }
  };

  useEffect(() => {
    Promise.all([fetchUsers(), fetchSettings()]).finally(() =>
      setLoading(false),
    );
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/users', {
        name: formName,
        email: formEmail,
        password: formPassword,
        role: formRole,
      });
      toast.success('Kullanıcı eklendi');
      setShowAddUser(false);
      resetForm();
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Kullanıcı eklenemedi');
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await api.patch(`/users/${editingUser.id}`, {
        name: formName,
        email: formEmail,
        role: formRole,
      });
      toast.success('Kullanıcı güncellendi');
      setEditingUser(null);
      resetForm();
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Güncellenemedi');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordUser) return;
    try {
      await api.patch(`/users/${passwordUser.id}/password`, {
        password: newPassword,
      });
      toast.success('Şifre güncellendi');
      setPasswordUser(null);
      setNewPassword('');
    } catch {
      toast.error('Şifre güncellenemedi');
    }
  };

  const handleDeactivate = async (user: UserItem) => {
    if (!confirm(`${user.name} kullanıcısı pasif yapılacak. Emin misiniz?`))
      return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.success('Kullanıcı pasif yapıldı');
      fetchUsers();
    } catch {
      toast.error('İşlem başarısız');
    }
  };

  const handleActivate = async (user: UserItem) => {
    try {
      await api.patch(`/users/${user.id}/activate`);
      toast.success('Kullanıcı aktif yapıldı');
      fetchUsers();
    } catch {
      toast.error('İşlem başarısız');
    }
  };

  const toggleInternalChat = async () => {
    const newVal = !internalChatEnabled;
    try {
      await api.patch('/system-settings', {
        key: 'internal_chat_enabled',
        value: newVal ? 'true' : 'false',
      });
      setInternalChatEnabled(newVal);
      toast.success(
        newVal ? 'Dahili mesajlaşma açıldı' : 'Dahili mesajlaşma kapatıldı',
      );
    } catch {
      toast.error('Ayar güncellenemedi');
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('AGENT');
  };

  const openEdit = (user: UserItem) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormRole(user.role);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-whatsapp border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ayarlar</h1>
        <p className="text-gray-500 text-sm mt-1">
          Kullanıcı yönetimi ve sistem ayarları
        </p>
      </div>

      {/* Agent Management */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-900">
              Kullanıcı Yönetimi
            </h2>
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowAddUser(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Yeni Kullanıcı
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-3 font-medium">Kullanıcı</th>
                <th className="pb-3 font-medium">Rol</th>
                <th className="pb-3 font-medium">Durum</th>
                <th className="pb-3 font-medium text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((user) => (
                <tr key={user.id} className="group">
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{user.name}</p>
                        <p className="text-xs text-gray-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                      {(user.role === 'SUPERADMIN' || user.role === 'ADMIN') ? (
                        <Shield className="w-3 h-3" />
                      ) : null}
                      {roleLabels[user.role] || user.role}
                    </span>
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        user.isActive
                          ? 'bg-green-50 text-green-700'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {user.isActive ? (
                        <>
                          <UserCheck className="w-3 h-3" /> Aktif
                        </>
                      ) : (
                        <>
                          <UserX className="w-3 h-3" /> Pasif
                        </>
                      )}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(user)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Düzenle"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setPasswordUser(user);
                          setNewPassword('');
                        }}
                        className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg"
                        title="Şifre Değiştir"
                      >
                        <Key className="w-3.5 h-3.5" />
                      </button>
                      {user.isActive ? (
                        <button
                          onClick={() => handleDeactivate(user)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Pasif Yap"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleActivate(user)}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                          title="Aktif Yap"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* System Settings */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Settings2 className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-semibold text-gray-900">
            Sistem Ayarları
          </h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
            <div>
              <p className="font-medium text-sm text-gray-900">
                Dahili Takım Mesajlaşması
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Temsilcilerin kendi aralarında konuşması için not sistemi
              </p>
            </div>
            <button
              onClick={toggleInternalChat}
              className="text-gray-400 hover:text-gray-600"
            >
              {internalChatEnabled ? (
                <ToggleRight className="w-10 h-6 text-whatsapp" />
              ) : (
                <ToggleLeft className="w-10 h-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Data Sync */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <Database className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-semibold text-gray-900">
            Veri Senkronizasyonu
          </h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
            <div>
              <p className="font-medium text-sm text-gray-900">
                Mesajları Senkronize Et
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Bu organizasyona ait çalışan oturumlar ve konuşmalar için WAHA&apos;dan
                eksik mesajları çeker
              </p>
            </div>
            <button
              onClick={async () => {
                const btn = document.getElementById('sync-msgs-btn');
                if (btn) btn.setAttribute('disabled', 'true');
                try {
                  const { data } = await api.post('/conversations/sync-all');
                  toast.success(data.message || `${data.totalSynced} mesaj senkronize edildi`);
                } catch {
                  toast.error('Mesaj senkronizasyonu başarısız');
                } finally {
                  if (btn) btn.removeAttribute('disabled');
                }
              }}
              id="sync-msgs-btn"
              className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-100 transition-colors disabled:opacity-50"
            >
              <MessageSquareMore className="w-4 h-4" />
              Senkronize Et
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
            <div>
              <p className="font-medium text-sm text-gray-900">
                Profil Fotoğraflarını Güncelle
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Bu organizasyondaki kişiler için, org oturumları üzerinden profil
                fotoğraflarını yeniler. Varsayılan yalnızca <strong>fotoğrafı olmayan</strong>{' '}
                kişileri işler; mevcutları da yenilemek için aşağıdaki kutuyu işaretleyin.
              </p>
              <label className="flex items-center gap-2 mt-2 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={avatarRefreshForce}
                  onChange={(e) => setAvatarRefreshForcePersist(e.target.checked)}
                  className="rounded border-gray-300 text-whatsapp focus:ring-whatsapp"
                />
                Mevcut profil fotoğraflarını da WAHA&apos;dan yeniden indir (daha yavaş)
              </label>
              <p className="text-[10px] text-gray-400 mt-1">
                Bu kutu tarayıcıda hatırlanır; asıl yenileme <strong>Güncelle</strong> ile çalışır.
              </p>
            </div>
            <button
              onClick={async () => {
                const btn = document.getElementById('sync-avatars-btn');
                if (btn) btn.setAttribute('disabled', 'true');
                try {
                  const { data } = await api.post('/contacts/refresh-all-avatars', {
                    force: !!avatarRefreshForce,
                  });
                  toast.success(data.message || `${data.updated} fotoğraf güncellendi`);
                } catch (err) {
                  toast.error(getApiErrorMessage(err, 'Fotoğraf güncelleme başarısız'));
                } finally {
                  if (btn) btn.removeAttribute('disabled');
                }
              }}
              id="sync-avatars-btn"
              className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors disabled:opacity-50"
            >
              <ImageIcon className="w-4 h-4" />
              Güncelle
            </button>
          </div>
        </div>

        {/* PDF Şablon Ayarları */}
        {(currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPERADMIN') && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">PDF Şablon Ayarları</h2>
              <p className="text-xs text-gray-400 mt-1">Teklif ve fatura PDF belgelerinde kullanılacak firma bilgileri</p>
            </div>

            {/* Firma Bilgileri */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Firma Bilgileri</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { key: 'pdf_company_name', label: 'Firma Adı *', type: 'text' },
                  { key: 'pdf_company_phone', label: 'Telefon', type: 'text' },
                  { key: 'pdf_company_email', label: 'E-posta', type: 'text' },
                  { key: 'pdf_company_website', label: 'Web Sitesi', type: 'text' },
                  { key: 'pdf_company_tax_office', label: 'Vergi Dairesi', type: 'text' },
                  { key: 'pdf_company_tax_number', label: 'Vergi No', type: 'text' },
                  { key: 'pdf_company_mersis_no', label: 'Mersis No', type: 'text' },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                    <input
                      type="text"
                      defaultValue={settings.find((s) => s.key === field.key)?.value || ''}
                      onBlur={async (e) => {
                        try {
                          await api.patch('/system-settings', { key: field.key, value: e.target.value });
                          toast.success(`${field.label} güncellendi`);
                        } catch { toast.error('Güncellenemedi'); }
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                    />
                  </div>
                ))}
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Firma Adresi</label>
                  <textarea
                    defaultValue={settings.find((s) => s.key === 'pdf_company_address')?.value || ''}
                    onBlur={async (e) => {
                      try {
                        await api.patch('/system-settings', { key: 'pdf_company_address', value: e.target.value });
                        toast.success('Adres güncellendi');
                      } catch { toast.error('Güncellenemedi'); }
                    }}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp resize-y"
                  />
                </div>
              </div>
            </div>

            {/* Logo */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Logo</p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Logo URL (https://... veya /uploads/...)</label>
                <input
                  type="text"
                  defaultValue={settings.find((s) => s.key === 'pdf_logo_url')?.value || ''}
                  onBlur={async (e) => {
                    try {
                      await api.patch('/system-settings', { key: 'pdf_logo_url', value: e.target.value });
                      toast.success('Logo URL güncellendi');
                    } catch { toast.error('Güncellenemedi'); }
                  }}
                  placeholder="https://example.com/logo.png"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                />
                <p className="text-xs text-gray-400 mt-1">Logo PNG/JPG formatında olmalı. Tarayıcıdan erişilebilir bir URL girin.</p>
              </div>
              {settings.find((s) => s.key === 'pdf_logo_url')?.value && (
                <div className="mt-2">
                  <img
                    src={settings.find((s) => s.key === 'pdf_logo_url')?.value}
                    alt="Logo önizleme"
                    className="h-12 object-contain border border-gray-100 rounded-lg p-1"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
            </div>

            {/* Banka Bilgileri */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Banka Bilgileri</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { key: 'pdf_bank_info', label: 'Banka 1 (IBAN, Hesap No vb.)' },
                  { key: 'pdf_bank2_info', label: 'Banka 2 (opsiyonel)' },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                    <textarea
                      defaultValue={settings.find((s) => s.key === field.key)?.value || ''}
                      onBlur={async (e) => {
                        try {
                          await api.patch('/system-settings', { key: field.key, value: e.target.value });
                          toast.success('Banka bilgisi güncellendi');
                        } catch { toast.error('Güncellenemedi'); }
                      }}
                      rows={3}
                      placeholder="Banka Adı: ...\nIBAN: TR..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp resize-y font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Koşullar & Notlar */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Koşullar & Notlar</p>
              <div className="space-y-4">
                {[
                  { key: 'pdf_terms', label: 'Ödeme Koşulları', rows: 3 },
                  { key: 'pdf_footer_note', label: 'Alt Not (PDF footer)', rows: 2 },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>
                    <textarea
                      defaultValue={settings.find((s) => s.key === field.key)?.value || ''}
                      onBlur={async (e) => {
                        try {
                          await api.patch('/system-settings', { key: field.key, value: e.target.value });
                          toast.success(`${field.label} güncellendi`);
                        } catch { toast.error('Güncellenemedi'); }
                      }}
                      rows={field.rows}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp resize-y"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Görünüm */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Görünüm</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ana Renk (HEX)</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      defaultValue={settings.find((s) => s.key === 'pdf_primary_color')?.value || '#1a7a4a'}
                      onBlur={async (e) => {
                        try {
                          await api.patch('/system-settings', { key: 'pdf_primary_color', value: e.target.value });
                          toast.success('Renk güncellendi');
                        } catch { toast.error('Güncellenemedi'); }
                      }}
                      className="h-9 w-16 rounded border border-gray-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      defaultValue={settings.find((s) => s.key === 'pdf_primary_color')?.value || '#1a7a4a'}
                      onBlur={async (e) => {
                        try {
                          await api.patch('/system-settings', { key: 'pdf_primary_color', value: e.target.value });
                          toast.success('Renk güncellendi');
                        } catch { toast.error('Güncellenemedi'); }
                      }}
                      placeholder="#1a7a4a"
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Para Birimi Konumu</label>
                  <select
                    defaultValue={settings.find((s) => s.key === 'pdf_currency_position')?.value || 'after'}
                    onChange={async (e) => {
                      try {
                        await api.patch('/system-settings', { key: 'pdf_currency_position', value: e.target.value });
                        toast.success('Güncellendi');
                      } catch { toast.error('Güncellenemedi'); }
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
                  >
                    <option value="after">Sonra (1.000,00 TL)</option>
                    <option value="before">Önce (TL 1.000,00)</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-gray-600">İmza Alanı Göster</label>
                  <button
                    onClick={async () => {
                      const current = settings.find((s) => s.key === 'pdf_show_signature')?.value !== 'false';
                      try {
                        await api.patch('/system-settings', { key: 'pdf_show_signature', value: current ? 'false' : 'true' });
                        toast.success('Güncellendi');
                        window.location.reload();
                      } catch { toast.error('Güncellenemedi'); }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings.find((s) => s.key === 'pdf_show_signature')?.value !== 'false' ? 'bg-whatsapp' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.find((s) => s.key === 'pdf_show_signature')?.value !== 'false' ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Yeni Kullanıcı Ekle</h3>
              <button
                onClick={() => setShowAddUser(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ad Soyad
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-posta
                </label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Şifre
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rol
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="AGENT">Temsilci</option>
                  <option value="ADMIN">Yönetici</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddUser(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"
                >
                  Kullanıcı Ekle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Kullanıcı Düzenle</h3>
              <button
                onClick={() => setEditingUser(null)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ad Soyad
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-posta
                </label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rol
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="AGENT">Temsilci</option>
                  <option value="ACCOUNTANT">Muhasebeci</option>
                  <option value="ADMIN">Yönetici</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"
                >
                  Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Modal */}
      {passwordUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">
                Şifre Değiştir — {passwordUser.name}
              </h3>
              <button
                onClick={() => setPasswordUser(null)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Yeni Şifre
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                  placeholder="En az 6 karakter"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPasswordUser(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-yellow-500 text-white rounded-xl text-sm font-medium hover:bg-yellow-600"
                >
                  Şifreyi Değiştir
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
