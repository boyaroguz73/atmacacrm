'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Users, Search, RefreshCw, ChevronDown, ChevronRight, Building2 } from 'lucide-react';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  avatar: string | null;
  createdAt: string;
}

interface OrgGroup {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  maxUsers: number;
  maxSessions: number;
  createdAt: string;
  users: UserItem[];
}

interface GroupedData {
  organizations: OrgGroup[];
  unassigned: UserItem[];
  totalUsers: number;
}

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Deneme',
  STARTER: 'Başlangıç',
  PROFESSIONAL: 'Profesyonel',
  ENTERPRISE: 'Kurumsal',
};

const PLAN_BADGES: Record<string, string> = {
  FREE: 'bg-gray-100 text-gray-700',
  STARTER: 'bg-blue-100 text-blue-700',
  PROFESSIONAL: 'bg-green-100 text-green-700',
  ENTERPRISE: 'bg-purple-100 text-purple-700',
};

const ROLE_BADGES: Record<string, string> = {
  SUPERADMIN: 'bg-red-100 text-red-700',
  ADMIN: 'bg-amber-100 text-amber-700',
  AGENT: 'bg-blue-100 text-blue-700',
};

export default function UsersPage() {
  const [data, setData] = useState<GroupedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/users/all-grouped');
      setData(res.data);
      const allIds = new Set<string>(res.data.organizations.map((o: OrgGroup) => o.id));
      if (res.data.unassigned.length > 0) allIds.add('__unassigned__');
      setExpandedOrgs(allIds);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data
              ?.message
          : undefined;
      toast.error(msg || 'Kullanıcılar yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleOrg = (id: string) => {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      if (isActive) {
        await api.delete(`/users/${userId}`);
      } else {
        await api.patch(`/users/${userId}/activate`);
      }
      toast.success(isActive ? 'Kullanıcı pasif yapıldı' : 'Kullanıcı aktif yapıldı');
      fetchData();
    } catch {
      toast.error('İşlem başarısız');
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await api.patch(`/users/${userId}`, { role: newRole });
      toast.success('Rol güncellendi');
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Hata oluştu');
    }
  };

  const filterUsers = (users: UserItem[]) => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    );
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
          <h1 className="text-2xl font-bold text-gray-900">Kullanıcılar</h1>
          <p className="text-gray-500 text-sm mt-1">
            {data?.totalUsers || 0} kullanıcı, {data?.organizations?.length || 0} organizasyon
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Yenile
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Kullanıcı ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      <div className="space-y-4">
        {data?.organizations?.map((org) => {
          const filteredUsers = filterUsers(org.users);
          if (search && filteredUsers.length === 0) return null;

          return (
            <div key={org.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => toggleOrg(org.id)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{org.name}</h3>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${PLAN_BADGES[org.plan]}`}>
                        {PLAN_LABELS[org.plan]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {org.users.length} kullanıcı / {org.maxUsers} limit
                    </p>
                  </div>
                </div>
                {expandedOrgs.has(org.id) ? (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {expandedOrgs.has(org.id) && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {filteredUsers.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      onToggleActive={() => handleToggleActive(user.id, user.isActive)}
                      onRoleChange={(role) => handleRoleChange(user.id, role)}
                    />
                  ))}
                  {filteredUsers.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">Kullanıcı bulunamadı</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Unassigned users */}
        {data?.unassigned && data.unassigned.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <button
              onClick={() => toggleOrg('__unassigned__')}
              className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold text-gray-900">Organizasyonsuz</h3>
                  <p className="text-xs text-gray-400">{data.unassigned.length} kullanıcı</p>
                </div>
              </div>
              {expandedOrgs.has('__unassigned__') ? (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {expandedOrgs.has('__unassigned__') && (
              <div className="border-t border-gray-100 divide-y divide-gray-50">
                {filterUsers(data.unassigned).map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onToggleActive={() => handleToggleActive(user.id, user.isActive)}
                    onRoleChange={(role) => handleRoleChange(user.id, role)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UserRow({
  user,
  onToggleActive,
  onRoleChange,
}: {
  user: UserItem;
  onToggleActive: () => void;
  onRoleChange: (role: string) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50/50">
      <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
        {user.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-gray-900 truncate">{user.name}</p>
        <p className="text-xs text-gray-400 truncate">{user.email}</p>
      </div>
      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${ROLE_BADGES[user.role] || 'bg-gray-100 text-gray-700'}`}>
        {user.role}
      </span>
      <select
        value={user.role}
        onChange={(e) => onRoleChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500"
      >
        <option value="AGENT">Agent</option>
        <option value="ADMIN">Admin</option>
      </select>
      <button
        onClick={onToggleActive}
        className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${
          user.isActive
            ? 'text-red-700 bg-red-50 hover:bg-red-100'
            : 'text-green-700 bg-green-50 hover:bg-green-100'
        }`}
      >
        {user.isActive ? 'Pasif Yap' : 'Aktif Yap'}
      </button>
      <span className="text-xs text-gray-400">
        {new Date(user.createdAt).toLocaleDateString('tr-TR')}
      </span>
    </div>
  );
}
