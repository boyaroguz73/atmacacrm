'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Building2,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  Package,
} from 'lucide-react';

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  maxUsers: number;
  maxSessions: number;
  createdAt: string;
  _count?: { users: number; sessions: number; contacts: number };
  users?: { id: string; name: string; email: string; role: string }[];
}

const PLAN_BADGES: Record<string, string> = {
  FREE: 'bg-gray-100 text-gray-700',
  STARTER: 'bg-blue-100 text-blue-700',
  PROFESSIONAL: 'bg-green-100 text-green-700',
  ENTERPRISE: 'bg-purple-100 text-purple-700',
};

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Deneme',
  STARTER: 'Başlangıç',
  PROFESSIONAL: 'Profesyonel',
  ENTERPRISE: 'Kurumsal',
};

/** Backend ile aynı: daha büyük değerler tarih taşması → 500 hatası üretir */
const MAX_ASSIGN_PLAN_DAYS = 36_500;

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [orgDetail, setOrgDetail] = useState<Org | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [newOrg, setNewOrg] = useState({
    name: '',
    slug: '',
    plan: 'STARTER',
    maxUsers: 5,
    maxSessions: 1,
  });
  const [assignForm, setAssignForm] = useState({
    plan: 'STARTER',
    durationDays: 30,
    notes: '',
  });

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/organizations');
      setOrgs(res.data);
    } catch {
      toast.error('Organizasyonlar yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const handleExpand = async (orgId: string) => {
    if (expandedOrg === orgId) {
      setExpandedOrg(null);
      setOrgDetail(null);
      return;
    }
    setExpandedOrg(orgId);
    setDetailLoading(true);
    try {
      const res = await api.get(`/organizations/${orgId}`);
      setOrgDetail(res.data);
    } catch {
      toast.error('Detay yüklenemedi');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newOrg.name.trim() || !newOrg.slug.trim()) {
      toast.error('İsim ve slug zorunludur');
      return;
    }
    setCreating(true);
    try {
      await api.post('/organizations', newOrg);
      toast.success('Organizasyon oluşturuldu');
      setShowCreate(false);
      setNewOrg({ name: '', slug: '', plan: 'STARTER', maxUsers: 5, maxSessions: 1 });
      fetchOrgs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Hata oluştu');
    } finally {
      setCreating(false);
    }
  };

  const handleAssignPlan = async () => {
    if (!showAssign) return;
    if (assignForm.durationDays > MAX_ASSIGN_PLAN_DAYS) {
      toast.error(
        `Süre en fazla ${MAX_ASSIGN_PLAN_DAYS.toLocaleString('tr-TR')} gün olabilir (~100 yıl, fiilen süresiz).`,
      );
      return;
    }
    setAssigning(true);
    try {
      await api.post('/billing/assign', {
        organizationId: showAssign,
        plan: assignForm.plan,
        durationDays: assignForm.durationDays,
        notes: assignForm.notes,
      });
      toast.success('Paket başarıyla atandı');
      setShowAssign(null);
      setAssignForm({ plan: 'STARTER', durationDays: 30, notes: '' });
      fetchOrgs();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Hata oluştu');
    } finally {
      setAssigning(false);
    }
  };

  const filtered = orgs.filter((o) => {
    const matchSearch =
      !search ||
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      o.slug.toLowerCase().includes(search.toLowerCase());
    const matchPlan = !planFilter || o.plan === planFilter;
    return matchSearch && matchPlan;
  });

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organizasyonlar</h1>
          <p className="text-gray-500 text-sm mt-1">{orgs.length} organizasyon kayıtlı</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchOrgs}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
          >
            <Plus className="w-4 h-4" />
            Yeni Organizasyon
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Organizasyon ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="">Tüm Planlar</option>
          <option value="FREE">Deneme</option>
          <option value="STARTER">Başlangıç</option>
          <option value="PROFESSIONAL">Profesyonel</option>
          <option value="ENTERPRISE">Kurumsal</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-3 font-medium">Organizasyon</th>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 font-medium text-center">Kullanıcılar</th>
                  <th className="px-6 py-3 font-medium text-center">Oturumlar</th>
                  <th className="px-6 py-3 font-medium">Durum</th>
                  <th className="px-6 py-3 font-medium">Kayıt</th>
                  <th className="px-6 py-3 font-medium text-center">İşlem</th>
                  <th className="px-6 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((org) => (
                  <OrgRow
                    key={org.id}
                    org={org}
                    expanded={expandedOrg === org.id}
                    detail={expandedOrg === org.id ? orgDetail : null}
                    detailLoading={expandedOrg === org.id && detailLoading}
                    onToggle={() => handleExpand(org.id)}
                    onAssign={() => {
                      setShowAssign(org.id);
                      setAssignForm({ plan: org.plan, durationDays: 30, notes: '' });
                    }}
                  />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-gray-400">
                      Organizasyon bulunamadı
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal title="Yeni Organizasyon" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <Field
              label="Ad"
              value={newOrg.name}
              onChange={(v) => setNewOrg((p) => ({ ...p, name: v }))}
              placeholder="Şirket A.Ş."
            />
            <Field
              label="Slug"
              value={newOrg.slug}
              onChange={(v) =>
                setNewOrg((p) => ({
                  ...p,
                  slug: v.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                }))
              }
              placeholder="sirket-as"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
              <select
                value={newOrg.plan}
                onChange={(e) => setNewOrg((p) => ({ ...p, plan: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="FREE">Deneme</option>
                <option value="STARTER">Başlangıç</option>
                <option value="PROFESSIONAL">Profesyonel</option>
                <option value="ENTERPRISE">Kurumsal</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label="Maks. Kullanıcı"
                value={newOrg.maxUsers}
                onChange={(v) => setNewOrg((p) => ({ ...p, maxUsers: v }))}
              />
              <NumField
                label="Maks. Oturum"
                value={newOrg.maxSessions}
                onChange={(v) => setNewOrg((p) => ({ ...p, maxSessions: v }))}
              />
            </div>
          </div>
          <ModalFooter
            onCancel={() => setShowCreate(false)}
            onConfirm={handleCreate}
            loading={creating}
            label="Oluştur"
          />
        </Modal>
      )}

      {/* Assign Plan Modal */}
      {showAssign && (
        <Modal title="Paket Ata" onClose={() => setShowAssign(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
              <select
                value={assignForm.plan}
                onChange={(e) => setAssignForm((p) => ({ ...p, plan: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="FREE">Deneme</option>
                <option value="STARTER">Başlangıç</option>
                <option value="PROFESSIONAL">Profesyonel</option>
                <option value="ENTERPRISE">Kurumsal</option>
              </select>
            </div>
            <NumField
              label="Süre (Gün)"
              value={assignForm.durationDays}
              max={MAX_ASSIGN_PLAN_DAYS}
              onChange={(v) => setAssignForm((p) => ({ ...p, durationDays: v }))}
              hint={`En fazla ${MAX_ASSIGN_PLAN_DAYS.toLocaleString('tr-TR')} gün (yaklaşık 100 yıl).`}
            />
            <Field
              label="Not (opsiyonel)"
              value={assignForm.notes}
              onChange={(v) => setAssignForm((p) => ({ ...p, notes: v }))}
              placeholder="Hediye, kampanya vb."
            />
          </div>
          <ModalFooter
            onCancel={() => setShowAssign(null)}
            onConfirm={handleAssignPlan}
            loading={assigning}
            label="Paket Ata"
          />
        </Modal>
      )}
    </div>
  );
}

function OrgRow({
  org,
  expanded,
  detail,
  detailLoading,
  onToggle,
  onAssign,
}: {
  org: Org;
  expanded: boolean;
  detail: Org | null;
  detailLoading: boolean;
  onToggle: () => void;
  onAssign: () => void;
}) {
  const counts = org._count || { users: 0, sessions: 0, contacts: 0 };
  return (
    <>
      <tr onClick={onToggle} className="hover:bg-gray-50/60 cursor-pointer transition-colors">
        <td className="px-6 py-3">
          <div>
            <p className="font-medium text-gray-900">{org.name}</p>
            <p className="text-xs text-gray-400 font-mono">{org.slug}</p>
          </div>
        </td>
        <td className="px-6 py-3">
          <span
            className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${PLAN_BADGES[org.plan] || PLAN_BADGES.FREE}`}
          >
            {PLAN_LABELS[org.plan] || org.plan}
          </span>
        </td>
        <td className="px-6 py-3 text-center text-gray-700">
          {counts.users}/{org.maxUsers}
        </td>
        <td className="px-6 py-3 text-center text-gray-700">
          {counts.sessions}/{org.maxSessions}
        </td>
        <td className="px-6 py-3">
          {org.isActive ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Aktif
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              Pasif
            </span>
          )}
        </td>
        <td className="px-6 py-3 text-gray-500 text-xs">
          {new Date(org.createdAt).toLocaleDateString('tr-TR')}
        </td>
        <td className="px-6 py-3 text-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAssign();
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition"
          >
            <Package className="w-3 h-3" />
            Paket Ata
          </button>
        </td>
        <td className="px-6 py-3">
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-gray-50 px-6 py-4">
            {detailLoading ? (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : detail ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Detaylar</h4>
                  <div className="text-sm space-y-1 text-gray-700">
                    <p><span className="text-gray-400">Plan:</span> {PLAN_LABELS[detail.plan]}</p>
                    <p><span className="text-gray-400">Maks. Kullanıcı:</span> {detail.maxUsers}</p>
                    <p><span className="text-gray-400">Maks. Oturum:</span> {detail.maxSessions}</p>
                    <p><span className="text-gray-400">Kayıt:</span> {new Date(detail.createdAt).toLocaleString('tr-TR')}</p>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Kullanıcılar</h4>
                  {detail.users && detail.users.length > 0 ? (
                    <div className="space-y-1.5">
                      {detail.users.map((u) => (
                        <div key={u.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 text-sm">
                          <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold">
                            {u.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{u.name}</p>
                            <p className="text-xs text-gray-400 truncate">{u.email}</p>
                          </div>
                          <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">{u.role}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Kullanıcı bulunamadı</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center">Detay yüklenemedi</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({
  onCancel,
  onConfirm,
  loading,
  label,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-3 mt-6">
      <button
        onClick={onCancel}
        className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
      >
        İptal
      </button>
      <button
        onClick={onConfirm}
        disabled={loading}
        className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
      >
        {loading ? 'İşleniyor...' : label}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(e) => {
          const raw = parseInt(e.target.value, 10);
          const n = Number.isFinite(raw) ? raw : 1;
          const capped = max != null ? Math.min(max, Math.max(1, n)) : Math.max(1, n);
          onChange(capped);
        }}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
