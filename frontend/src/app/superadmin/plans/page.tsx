'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Package, Edit3, X, Check, RefreshCw, Save } from 'lucide-react';

interface PlanConfig {
  id: string;
  name: string;
  nameEn: string;
  price: number;
  currency: string;
  maxSessions: number;
  maxUsers: number;
  features: string[];
  featureFlags: Record<string, boolean>;
}

const PLAN_COLORS: Record<string, string> = {
  FREE: 'border-gray-200 bg-gray-50',
  STARTER: 'border-blue-200 bg-blue-50',
  PROFESSIONAL: 'border-green-200 bg-green-50',
  ENTERPRISE: 'border-purple-200 bg-purple-50',
};

const PLAN_ACCENT: Record<string, string> = {
  FREE: 'text-gray-700',
  STARTER: 'text-blue-700',
  PROFESSIONAL: 'text-green-700',
  ENTERPRISE: 'text-purple-700',
};

const FLAG_LABELS: Record<string, string> = {
  ai: 'AI Asistan',
  flow: 'Akış Oluşturucu',
  ecommerce: 'E-Ticaret',
  email: 'E-posta',
  sms: 'SMS',
  api: 'API Erişimi',
  customBranding: 'Özel Marka',
  prioritySupport: 'Öncelikli Destek',
};

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PlanConfig>>({});
  const [saving, setSaving] = useState(false);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/billing/plan-configs');
      setPlans(res.data);
    } catch {
      toast.error('Plan bilgileri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const startEdit = (plan: PlanConfig) => {
    setEditing(plan.id);
    setEditForm({
      name: plan.name,
      price: plan.price,
      maxUsers: plan.maxUsers,
      maxSessions: plan.maxSessions,
      features: [...plan.features],
      featureFlags: { ...plan.featureFlags },
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.patch(`/billing/plan-configs/${editing}`, editForm);
      toast.success('Plan güncellendi');
      setEditing(null);
      fetchPlans();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Hata oluştu');
    } finally {
      setSaving(false);
    }
  };

  const toggleFlag = (flag: string) => {
    setEditForm((prev) => ({
      ...prev,
      featureFlags: {
        ...prev.featureFlags,
        [flag]: !prev.featureFlags?.[flag],
      },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Paket Yönetimi</h1>
          <p className="text-gray-500 text-sm mt-1">
            Plan fiyatlarını, limitleri ve özelliklerini düzenleyin
          </p>
        </div>
        <button
          onClick={fetchPlans}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {plans.map((plan) => {
          const isEditing = editing === plan.id;
          const form = isEditing ? editForm : plan;

          return (
            <div
              key={plan.id}
              className={`rounded-xl border-2 shadow-sm overflow-hidden transition-all ${
                isEditing ? 'border-purple-400 ring-2 ring-purple-100' : PLAN_COLORS[plan.id] || 'border-gray-200 bg-white'
              }`}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package className={`w-5 h-5 ${PLAN_ACCENT[plan.id]}`} />
                    {isEditing ? (
                      <input
                        type="text"
                        value={form.name || ''}
                        onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                        className="font-bold text-lg text-gray-900 border-b border-purple-300 focus:outline-none bg-transparent w-32"
                      />
                    ) : (
                      <h3 className="font-bold text-lg text-gray-900">{plan.name}</h3>
                    )}
                  </div>
                  {!isEditing ? (
                    <button
                      onClick={() => startEdit(plan)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditing(null)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Price */}
                <div className="mb-4">
                  {isEditing ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-gray-500">₺</span>
                      <input
                        type="number"
                        value={form.price ?? 0}
                        onChange={(e) => setEditForm((p) => ({ ...p, price: Number(e.target.value) }))}
                        className="text-3xl font-bold text-gray-900 border-b border-purple-300 focus:outline-none bg-transparent w-24"
                      />
                      <span className="text-gray-400 text-sm">/ay</span>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-gray-900">
                        ₺{plan.price.toLocaleString('tr-TR')}
                      </span>
                      <span className="text-gray-400 text-sm">/ay</span>
                    </div>
                  )}
                </div>

                {/* Limits */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-white/80 rounded-lg p-2.5 text-center border border-gray-100">
                    {isEditing ? (
                      <input
                        type="number"
                        min={1}
                        value={form.maxUsers ?? 0}
                        onChange={(e) => setEditForm((p) => ({ ...p, maxUsers: Number(e.target.value) }))}
                        className="text-xl font-bold text-gray-900 text-center w-full bg-transparent border-b border-purple-300 focus:outline-none"
                      />
                    ) : (
                      <p className="text-xl font-bold text-gray-900">{plan.maxUsers}</p>
                    )}
                    <p className="text-[11px] text-gray-500">Kullanıcı</p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-2.5 text-center border border-gray-100">
                    {isEditing ? (
                      <input
                        type="number"
                        min={1}
                        value={form.maxSessions ?? 0}
                        onChange={(e) => setEditForm((p) => ({ ...p, maxSessions: Number(e.target.value) }))}
                        className="text-xl font-bold text-gray-900 text-center w-full bg-transparent border-b border-purple-300 focus:outline-none"
                      />
                    ) : (
                      <p className="text-xl font-bold text-gray-900">{plan.maxSessions}</p>
                    )}
                    <p className="text-[11px] text-gray-500">Oturum</p>
                  </div>
                </div>

                {/* Feature Flags */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Özellikler
                  </p>
                  {Object.entries(FLAG_LABELS).map(([key, label]) => {
                    const enabled = form.featureFlags?.[key] ?? false;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between text-sm py-1"
                      >
                        <span className="text-gray-600">{label}</span>
                        {isEditing ? (
                          <button
                            onClick={() => toggleFlag(key)}
                            className={`w-8 h-5 rounded-full transition-colors relative ${
                              enabled ? 'bg-green-500' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                                enabled ? 'left-3.5' : 'left-0.5'
                              }`}
                            />
                          </button>
                        ) : enabled ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <X className="w-4 h-4 text-gray-300" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Features List */}
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Dahil Olanlar
                  </p>
                  <ul className="space-y-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                        <Check className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
