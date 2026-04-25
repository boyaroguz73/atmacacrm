'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { ToggleLeft, ToggleRight, SlidersHorizontal } from 'lucide-react';

interface SystemSettingItem {
  key: string;
  value: string;
}

interface IntegrationCatalogResponse {
  categories?: Array<{
    integrations?: Array<{
      key: string;
      isEnabled?: boolean;
    }>;
  }>;
}

export default function SettingsSystemPage() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SystemSettingItem[]>([]);
  const [internalChatEnabled, setInternalChatEnabled] = useState(false);
  const [tsoftEnabled, setTsoftEnabled] = useState(false);

  const fetchSettings = async () => {
    try {
      const [{ data }, integrationsRes] = await Promise.all([
        api.get<SystemSettingItem[]>('/system-settings'),
        api
          .get<IntegrationCatalogResponse>('/integrations')
          .catch(() => ({ data: {} as IntegrationCatalogResponse })),
      ]);
      setSettings(data);
      const ic = data.find((s) => s.key === 'internal_chat_enabled');
      setInternalChatEnabled(ic?.value === 'true');
      const tsoft =
        integrationsRes.data?.categories
          ?.flatMap((c) => c.integrations || [])
          .find((i) => i.key === 'tsoft') || null;
      setTsoftEnabled(Boolean(tsoft?.isEnabled));
    } catch {
      toast.error('Ayarlar yüklenemedi');
    }
  };

  useEffect(() => {
    fetchSettings().finally(() => setLoading(false));
  }, []);

  const toggleInternalChat = async () => {
    const newVal = !internalChatEnabled;
    try {
      await api.patch('/system-settings', {
        key: 'internal_chat_enabled',
        value: newVal ? 'true' : 'false',
      });
      setInternalChatEnabled(newVal);
      toast.success(newVal ? 'Dahili mesajlaşma açıldı' : 'Dahili mesajlaşma kapatıldı');
    } catch {
      toast.error('Ayar güncellenemedi');
    }
  };

  const isSettingEnabled = (key: string, fallback = true) => {
    const row = settings.find((s) => s.key === key);
    if (!row) return fallback;
    return row.value !== 'false';
  };

  const autoTaskRules = [
    {
      key: 'auto_task_lead_followup',
      label: 'Lead durum değişiminde takip görevi',
      description: 'İletişim kuruldu / İlgileniyor / Teklif gönderildi statülerinde görev açar.',
      integrationKey: null as string | null,
    },
    {
      key: 'auto_task_quote_deposit_balance',
      label: 'Teslim öncesi kalan tahsilat görevi',
      description: '%50 ön ödemeli siparişlerde teslimden 1 gün önce görev açar.',
      integrationKey: null as string | null,
    },
    {
      key: 'auto_task_tsoft_order_sync',
      label: 'T-Soft sipariş senkronunda görev',
      description: 'Site siparişi içeri alındığında sorumlu kullanıcıya görev açar.',
      integrationKey: 'tsoft',
    },
    {
      key: 'auto_task_tsoft_cart_abandon',
      label: 'T-Soft sepet terk görevi',
      description: 'Sepet terk (AWAITING_CHECKOUT) siparişlerinde hatırlatma görevi açar.',
      integrationKey: 'tsoft',
    },
  ].filter((rule) => {
    if (!rule.integrationKey) return true;
    if (rule.integrationKey === 'tsoft') return tsoftEnabled;
    return true;
  });

  const updateBooleanSetting = async (key: string, enabled: boolean, successText: string) => {
    await api.patch('/system-settings', { key, value: enabled ? 'true' : 'false' });
    setSettings((prev) => {
      const next = prev.filter((s) => s.key !== key);
      next.push({ key, value: enabled ? 'true' : 'false' });
      return next;
    });
    toast.success(successText);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-whatsapp border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sistem Ayarları</h1>
        <p className="text-gray-500 text-sm mt-1">Sistem davranışlarını ve varsayılan ayarları buradan yönetin.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5">
          <SlidersHorizontal className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-semibold text-gray-900">Genel Sistem Ayarları</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
            <div>
              <p className="font-medium text-sm text-gray-900">Dahili Takım Mesajlaşması</p>
              <p className="text-xs text-gray-400 mt-0.5">Temsilcilerin kendi aralarında konuşması için not sistemi</p>
            </div>
            <button onClick={toggleInternalChat} className="text-gray-400 hover:text-gray-600">
              {internalChatEnabled ? (
                <ToggleRight className="w-10 h-6 text-whatsapp" />
              ) : (
                <ToggleLeft className="w-10 h-6" />
              )}
            </button>
          </div>

          <div className="p-4 bg-gray-50 rounded-xl space-y-3">
            <p className="font-medium text-sm text-gray-900">Otomatik Görev Kuralları</p>
            <p className="text-xs text-gray-400">Sistem tarafından otomatik açılan görevleri buradan açıp kapatabilirsiniz.</p>
            {autoTaskRules.map((item) => {
              const enabled = isSettingEnabled(item.key, true);
              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 bg-white px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{item.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await updateBooleanSetting(
                          item.key,
                          !enabled,
                          !enabled ? 'Otomatik görev açıldı' : 'Otomatik görev kapatıldı',
                        );
                      } catch {
                        toast.error('Ayar güncellenemedi');
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      enabled ? 'bg-whatsapp' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="p-4 bg-gray-50 rounded-xl space-y-2">
            <p className="font-medium text-sm text-gray-900">Teklif Varsayılan KDV Oranı</p>
            <p className="text-xs text-gray-400">Teklifte &quot;Boş satır&quot; eklendiğinde otomatik gelecek KDV yüzdesi.</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                defaultValue={settings.find((s) => s.key === 'quote_default_vat_rate')?.value || '20'}
                onBlur={async (e) => {
                  const next = String(Math.max(0, Math.min(100, Number(e.target.value) || 20)));
                  e.target.value = next;
                  try {
                    await api.patch('/system-settings', { key: 'quote_default_vat_rate', value: next });
                    setSettings((prev) => [
                      ...prev.filter((s) => s.key !== 'quote_default_vat_rate'),
                      { key: 'quote_default_vat_rate', value: next },
                    ]);
                    toast.success('Varsayılan KDV oranı güncellendi');
                  } catch {
                    toast.error('Ayar güncellenemedi');
                  }
                }}
                className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-whatsapp"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
