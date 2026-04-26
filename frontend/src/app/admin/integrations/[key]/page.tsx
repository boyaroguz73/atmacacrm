'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api, { getApiErrorMessage } from '@/lib/api';
import {
  ArrowLeft,
  Wifi, WifiOff, Plus, RefreshCw, RotateCcw, QrCode,
  Play, Square, Trash2, X, Loader2, ImageIcon,
  MessageSquareMore, Globe, Save, ToggleLeft, ToggleRight,
  Key, ExternalLink, Bug, Settings,
} from 'lucide-react';
import toast from 'react-hot-toast';

const AVATAR_REFRESH_FORCE_KEY = 'crm_settings_avatar_refresh_force';

const PAGE_META: Record<string, { label: string; description: string }> = {
  whatsapp: { label: 'WhatsApp', description: 'Oturum ve mesaj akışı yönetimi' },
  tsoft:    { label: 'T-Soft',   description: 'Sipariş, ürün ve müşteri senkronizasyonu' },
};

interface Integration {
  key: string;
  name: string;
  description: string;
  category: string;
  isEnabled: boolean;
  available: boolean;
  addonPrice: number;
  comingSoon: boolean;
  config: any;
}

interface Session {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  wahaStatus: string | null;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  WORKING:       { label: 'Bağlı',          color: 'text-green-700 bg-green-50' },
  SCAN_QR:       { label: 'QR Bekliyor',    color: 'text-yellow-700 bg-yellow-50' },
  SCAN_QR_CODE:  { label: 'QR Bekliyor',    color: 'text-yellow-700 bg-yellow-50' },
  STARTING:      { label: 'Başlatılıyor',   color: 'text-blue-700 bg-blue-50' },
  STOPPED:       { label: 'Durduruldu',     color: 'text-gray-600 bg-gray-100' },
  FAILED:        { label: 'Hata',           color: 'text-red-700 bg-red-50' },
};

function integrationOrgParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (user?.organizationId) return {};
    const org = JSON.parse(localStorage.getItem('organization') || 'null');
    if (org?.id) return { organizationId: String(org.id) };
  } catch { /* ignore */ }
  return {};
}

/* ─── WhatsApp Detail ─── */
function WhatsAppDetail({ integration }: { integration: Integration }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingMessages, setSyncingMessages] = useState(false);
  const [syncingAvatars, setSyncingAvatars] = useState(false);
  const [resettingAvatars, setResettingAvatars] = useState(false);
  const [avatarRefreshForce, setAvatarRefreshForce] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [qrData, setQrData] = useState<Record<string, string>>({});
  const [qrLoading, setQrLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      if (localStorage.getItem(AVATAR_REFRESH_FORCE_KEY) === '1') setAvatarRefreshForce(true);
    } catch { /* ignore */ }
  }, []);

  const persistAvatarForce = (v: boolean) => {
    setAvatarRefreshForce(v);
    try {
      if (v) localStorage.setItem(AVATAR_REFRESH_FORCE_KEY, '1');
      else localStorage.removeItem(AVATAR_REFRESH_FORCE_KEY);
    } catch { /* ignore */ }
  };

  const fetchSessions = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions');
      setSessions(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const syncFromWaha = async () => {
    setSyncing(true);
    try {
      await api.post('/sessions/sync');
      await fetchSessions();
      toast.success('Oturumlar senkronize edildi');
    } catch { toast.error('Bir sorun oluştu, lütfen tekrar deneyin'); }
    finally { setSyncing(false); }
  };

  const startSession = async (name: string) => {
    try {
      await api.post('/sessions/start', { name });
      toast.success(`${name} oturumu başlatıldı`);
      setTimeout(fetchSessions, 2000);
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
  };

  const stopSession = async (name: string) => {
    try {
      await api.post('/sessions/stop', { name });
      toast.success(`${name} oturumu durduruldu`);
      fetchSessions();
    } catch { toast.error('Bir sorun oluştu, lütfen tekrar deneyin'); }
  };

  const fetchQr = async (session: Session) => {
    const { name } = session;
    setQrLoading((p) => ({ ...p, [name]: true }));
    try {
      const tryOnce = async () => {
        const { data } = await api.get(`/sessions/${encodeURIComponent(name)}/qr`);
        return data?.qr as string | undefined;
      };
      let qr = await tryOnce().catch(() => undefined);
      if (qr) { setQrData((p) => ({ ...p, [name]: qr! })); return; }

      const eff = session.wahaStatus || session.status;
      if (eff === 'STOPPED' || eff === 'FAILED') {
        try {
          await api.post('/sessions/start', { name });
          toast.success('Oturum başlatıldı, QR hazırlanıyor…');
          await new Promise((r) => setTimeout(r, 2800));
          await fetchSessions();
          qr = await tryOnce().catch(() => undefined);
          if (qr) { setQrData((p) => ({ ...p, [name]: qr! })); return; }
        } catch (err: any) {
          toast.error(err?.response?.data?.message || 'Oturum başlatılamadı');
          return;
        }
      }
      toast.error('QR alınamadı, birkaç saniye sonra tekrar deneyin');
    } finally { setQrLoading((p) => ({ ...p, [name]: false })); }
  };

  const removeSession = async (name: string) => {
    if (!confirm(`"${name}" oturumu silinecek. Emin misiniz?`)) return;
    try {
      await api.delete(`/sessions/${encodeURIComponent(name)}`);
      setQrData((p) => { const n = { ...p }; delete n[name]; return n; });
      toast.success('Oturum silindi');
      await fetchSessions();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Bir sorun oluştu, lütfen tekrar deneyin');
    }
  };

  const handleNewSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;
    await startSession(newSessionName.trim());
    setNewSessionName('');
  };

  const syncMessages = async () => {
    setSyncingMessages(true);
    try {
      const { data } = await api.post('/conversations/sync-all');
      toast.success(data?.message || `${data?.totalSynced ?? 0} mesaj senkronize edildi`);
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setSyncingMessages(false); }
  };

  const syncAvatars = async () => {
    setSyncingAvatars(true);
    try {
      const { data } = await api.post('/contacts/refresh-all-avatars', { force: !!avatarRefreshForce });
      toast.success(data?.message || 'Profil fotoğrafı güncelleme başlatıldı');
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setSyncingAvatars(false); }
  };

  const resetAvatars = async () => {
    if (!confirm('Tüm profil fotoğrafları sıfırlanacak ve yeniden indirilecek. Devam edilsin mi?')) return;
    setResettingAvatars(true);
    try {
      await api.post('/contacts/reset-all-avatars', {});
      const { data } = await api.post('/contacts/refresh-all-avatars', { force: true });
      toast.success(data?.message || 'Fotoğraflar sıfırlandı ve güncelleme başlatıldı');
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setResettingAvatars(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="w-6 h-6 animate-spin text-green-500" />
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Yeni oturum */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5">
        <p className="text-sm font-semibold text-gray-900 mb-4">Yeni Oturum</p>
        <form onSubmit={handleNewSession} className="flex gap-3">
          <input
            type="text"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value.replace(/\s+/g, '-').toLowerCase())}
            placeholder="ornek-oturum"
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-100"
          />
          <button type="submit" className="flex items-center gap-2 px-4 py-2.5 bg-green-500 text-white rounded-xl text-sm font-medium hover:bg-green-600 transition-colors">
            <Plus className="w-4 h-4" /> Başlat
          </button>
        </form>
      </section>

      {/* Oturum listesi */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-900">Oturumlar <span className="text-gray-400 font-normal">({sessions.length})</span></p>
          <div className="flex items-center gap-2">
            <button onClick={syncFromWaha} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50">
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Senkronize et
            </button>
            <button onClick={fetchSessions}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Yenile
            </button>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 bg-white rounded-2xl border border-gray-100">
            <WifiOff className="w-8 h-8 text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">Henüz oturum yok</p>
            <p className="text-xs text-gray-300 mt-1">Yukarıdan yeni bir oturum oluşturun</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => {
              const eff = session.wahaStatus || session.status;
              const sc = statusConfig[eff] || statusConfig.STOPPED;
              const isConnected = eff === 'WORKING';
              const isStopped = eff === 'STOPPED' || eff === 'FAILED';
              return (
                <div key={session.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isConnected ? 'bg-green-50' : 'bg-gray-50'}`}>
                      {isConnected
                        ? <Wifi className="w-5 h-5 text-green-600" />
                        : <WifiOff className="w-5 h-5 text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{session.name}</p>
                      <p className="text-xs text-gray-400">{session.phone ? `+${session.phone}` : 'Telefon bağlı değil'}</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${sc.color}`}>{sc.label}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                    {!isConnected && (
                      <button disabled={!!qrLoading[session.name]} onClick={() => fetchQr(session)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors">
                        {qrLoading[session.name] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                        QR Göster
                      </button>
                    )}
                    {isStopped && (
                      <button onClick={() => startSession(session.name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 transition-colors">
                        <Play className="w-3.5 h-3.5" /> Başlat
                      </button>
                    )}
                    {isConnected && (
                      <button onClick={() => stopSession(session.name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors">
                        <Square className="w-3.5 h-3.5" /> Durdur
                      </button>
                    )}
                    <button onClick={() => removeSession(session.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-red-50 hover:text-red-700 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" /> Sil
                    </button>
                  </div>

                  {qrData[session.name] && (
                    <div className="mt-3 p-4 bg-gray-50 rounded-xl text-center relative">
                      <button onClick={() => setQrData((p) => { const n = { ...p }; delete n[session.name]; return n; })}
                        className="absolute top-2 right-2 p-1 rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                      <p className="text-xs font-medium text-gray-600 mb-3">WhatsApp ile tarayın</p>
                      <img src={`data:image/png;base64,${qrData[session.name]}`} alt="WhatsApp QR" className="mx-auto w-48 h-48" />
                      <p className="text-[11px] text-gray-400 mt-2">WhatsApp → Bağlı Cihazlar → Cihaz Ekle</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Veri senkronizasyonu */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Veri Senkronizasyonu</p>

        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
          <div>
            <p className="text-sm font-medium text-gray-900">Mesajları senkronize et</p>
            <p className="text-xs text-gray-400 mt-0.5">Aktif oturumlar için eksik mesajları WAHA'dan çeker.</p>
          </div>
          <button onClick={syncMessages} disabled={syncingMessages}
            className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-100 transition-colors disabled:opacity-50 shrink-0 ml-4">
            {syncingMessages ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquareMore className="w-4 h-4" />}
            Senkronize Et
          </button>
        </div>

        <div className="flex items-start justify-between p-4 bg-gray-50 rounded-xl gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Profil fotoğraflarını güncelle</p>
            <p className="text-xs text-gray-400 mt-0.5">Fotoğrafı olmayan kişiler için güncelleme yapar.</p>
            <label className="flex items-center gap-2 mt-2 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={avatarRefreshForce} onChange={(e) => persistAvatarForce(e.target.checked)}
                className="rounded border-gray-300 text-green-500 focus:ring-green-400" />
              Mevcut fotoğrafları da güncelle
            </label>
          </div>
          <button onClick={syncAvatars} disabled={syncingAvatars}
            className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors disabled:opacity-50 shrink-0">
            {syncingAvatars ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            Güncelle
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-100 gap-4">
          <div>
            <p className="text-sm font-medium text-amber-900">Tüm fotoğrafları sıfırla ve yeniden indir</p>
            <p className="text-xs text-amber-600 mt-0.5">Tüm fotoğrafları temizler ve yeniden indirir.</p>
          </div>
          <button onClick={resetAvatars} disabled={resettingAvatars}
            className="flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-200 transition-colors disabled:opacity-50 shrink-0">
            {resettingAvatars ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            Sıfırla ve Güncelle
          </button>
        </div>
      </section>
    </div>
  );
}

/* ─── T-Soft Detail ─── */
type TsoftSyncFlags = {
  products: boolean; variants: boolean; orders: boolean;
  customers: boolean; images: boolean; push: boolean; cartAbandonTasks: boolean;
};

function readFlags(config: any): TsoftSyncFlags {
  const s = (config?.sync || {}) as Record<string, unknown>;
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    products: b(s.products, true), variants: b(s.variants, true),
    orders: b(s.orders, true), customers: b(s.customers, true),
    images: b(s.images, true), push: b(s.push, true),
    cartAbandonTasks: b(s.cartAbandonTasks, true),
  };
}

function FlagChip({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
        checked ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
      }`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${checked ? 'bg-orange-500' : 'bg-gray-300'}`} />
      {label}
    </button>
  );
}

function TsoftDetail({ integration }: { integration: Integration }) {
  const ic = integration.config || {};
  const [baseUrl, setBaseUrl] = useState(String(ic.baseUrl || ic.storeUrl || ''));
  const [apiEmail, setApiEmail] = useState(String(ic.apiEmail || ic.username || ''));
  const [apiPassword, setApiPassword] = useState('');
  const [flags, setFlags] = useState<TsoftSyncFlags>(readFlags(integration.config));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnoseOut, setDiagnoseOut] = useState<string | null>(null);

  const configSnapshot = JSON.stringify(ic);
  useEffect(() => {
    const c = integration.config || {};
    setBaseUrl(String(c.baseUrl || c.storeUrl || ''));
    setApiEmail(String(c.apiEmail || c.username || ''));
    setApiPassword('');
    setFlags(readFlags(c));
  }, [integration.key, configSnapshot]);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await api.post(`/integrations/${integration.key}/config`,
        { baseUrl: baseUrl.trim(), apiEmail: apiEmail.trim(), apiPassword, sync: flags },
        { params: integrationOrgParams() });
      toast.success('Yapılandırma kaydedildi');
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await api.post('/ecommerce/tsoft/test');
      toast.success('Bağlantı başarılı');
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setTesting(false); }
  };

  const handleSyncCustomers = async () => {
    setSyncingCustomers(true);
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-customers');
      toast.success(`Eşleşen müşteri: ${data.matched ?? 0}`);
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setSyncingCustomers(false); }
  };

  const handleSyncProducts = async () => {
    setSyncingProducts(true);
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-products', { period: 'all' }, { timeout: 300_000 });
      toast.success(`Ürün: ${data?.upsertedProducts ?? 0} · Varyant: ${data?.upsertedVariants ?? 0}`);
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setSyncingProducts(false); }
  };

  const handleSyncOrders = async () => {
    setSyncingOrders(true);
    try {
      const { data } = await api.post('/ecommerce/tsoft/sync-orders', {}, { timeout: 180_000 });
      toast.success(`Oluşturulan: ${data?.created ?? 0} · Güncellenen: ${data?.updated ?? 0}`);
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setSyncingOrders(false); }
  };

  const handleDiagnose = async () => {
    setDiagnosing(true);
    setDiagnoseOut(null);
    try {
      const { data } = await api.post('/ecommerce/tsoft/diagnose', {}, { timeout: 120_000 });
      setDiagnoseOut(JSON.stringify(data, null, 2));
      toast.success('Teşhis hazır');
    } catch (err) { toast.error(getApiErrorMessage(err, 'Bir sorun oluştu, lütfen tekrar deneyin')); }
    finally { setDiagnosing(false); }
  };

  return (
    <div className="space-y-6">

      {/* Bağlantı bilgileri */}
      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-900">Bağlantı Bilgileri</p>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Site adresi</label>
          <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://magazam.com"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Kullanıcı adı</label>
            <input type="text" value={apiEmail} onChange={(e) => setApiEmail(e.target.value)}
              placeholder="kullaniciadi"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Şifre</label>
            <input type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)}
              placeholder="Değiştirmek için girin"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100" />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Kaydet
          </button>
          <button type="button" onClick={handleTest} disabled={testing}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            Bağlantıyı Test Et
          </button>
        </div>
      </form>

      {/* Senkron kapsamı */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5">
        <p className="text-sm font-semibold text-gray-900 mb-1">Senkronizasyon Kapsamı</p>
        <p className="text-xs text-gray-400 mb-4">Hangi verilerin güncelleneceğini seçin.</p>
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'orders', label: 'Siparişler' },
            { key: 'products', label: 'Ürünler' },
            { key: 'customers', label: 'Müşteriler' },
            { key: 'images', label: 'Görseller' },
          ] as const).map(({ key, label }) => (
            <FlagChip key={key} label={label} checked={flags[key]}
              onToggle={() => setFlags((p) => ({ ...p, [key]: !p[key] }))} />
          ))}
        </div>
      </section>

      {/* Manuel senkronizasyon */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Manuel Senkronizasyon</p>

        {[
          { label: 'Müşterileri senkronize et', handler: handleSyncCustomers, loading: syncingCustomers },
          { label: 'Ürünleri senkronize et', handler: handleSyncProducts, loading: syncingProducts },
          { label: 'Siparişleri senkronize et', handler: handleSyncOrders, loading: syncingOrders },
        ].map(({ label, handler, loading }) => (
          <div key={label} className="flex items-center justify-between py-2">
            <p className="text-sm text-gray-700">{label}</p>
            <button onClick={handler} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors disabled:opacity-50">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Çalıştır
            </button>
          </div>
        ))}
      </section>

      {/* Teşhis */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Teşhis</p>
            <p className="text-xs text-gray-400 mt-0.5">Bağlantı ve veri sorunlarını analiz eder.</p>
          </div>
          <button onClick={handleDiagnose} disabled={diagnosing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50">
            {diagnosing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bug className="w-3.5 h-3.5" />}
            Teşhis Çalıştır
          </button>
        </div>
        {diagnoseOut && (
          <pre className="mt-3 p-3 bg-gray-50 rounded-xl text-[11px] text-gray-700 overflow-x-auto whitespace-pre-wrap border border-gray-100">
            {diagnoseOut}
          </pre>
        )}
      </section>
    </div>
  );
}

/* ─── Page ─── */
export default function IntegrationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const key = typeof params?.key === 'string' ? params.key : '';
  const meta = PAGE_META[key];

  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!key) return;
    api.get('/integrations', { params: integrationOrgParams() })
      .then(({ data }) => {
        const all: Integration[] = (data?.categories || []).flatMap((c: any) => c.integrations || []);
        const found = all.find((i: Integration) => i.key === key) ?? null;
        setIntegration(found);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [key]);

  if (!meta) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-gray-400 text-sm">Sayfa bulunamadı.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <button onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Geri
          </button>
          <div className="flex items-center gap-4">
            <img src={`/module-logos/${key}.png`} alt={meta.label}
              className="w-12 h-12 rounded-2xl border border-gray-100 object-contain p-1.5 bg-white" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{meta.label}</h1>
              <p className="text-sm text-gray-400 mt-0.5">{meta.description}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
          </div>
        ) : (
          key === 'whatsapp' ? (
            <WhatsAppDetail integration={integration || { key, name: 'WhatsApp', description: '', category: 'messaging', isEnabled: false, available: true, addonPrice: 0, comingSoon: false, config: {} }} />
          ) : key === 'tsoft' ? (
            <TsoftDetail integration={integration || { key, name: 'T-Soft', description: '', category: 'ecommerce', isEnabled: false, available: true, addonPrice: 0, comingSoon: false, config: {} }} />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <p className="text-sm text-gray-500">Bu sayfa için içerik henüz hazırlanmadı.</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
