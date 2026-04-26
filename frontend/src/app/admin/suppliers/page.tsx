'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Loader2,
  Plus,
  Search,
  Pencil,
  Trash2,
  Warehouse,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

const emptyForm = () => ({
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  isActive: true,
});

export default function AdminSuppliersPage() {
  return <SuppliersManager />;
}

function SuppliersManager({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/suppliers', {
        params: {
          search: search.trim() || undefined,
          page,
          limit: 30,
        },
      });
      setRows(data.suppliers || []);
      setTotalPages(Math.max(1, Number(data.totalPages) || 1));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Liste yüklenemedi'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (s: SupplierRow) => {
    setEditing(s);
    setForm({
      name: s.name,
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      notes: s.notes || '',
      isActive: s.isActive,
    });
    setModalOpen(true);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error('Tedarikçi adı gerekli');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/suppliers/${editing.id}`, {
          name,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          notes: form.notes.trim() || undefined,
          isActive: form.isActive,
        });
        toast.success('Tedarikçi güncellendi');
      } else {
        await api.post('/suppliers', {
          name,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          notes: form.notes.trim() || undefined,
          isActive: form.isActive,
        });
        toast.success('Tedarikçi oluşturuldu');
      }
      setModalOpen(false);
      setEditing(null);
      void fetchList();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kayıt başarısız'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: SupplierRow) => {
    if (!confirm(`${s.name} silinsin mi? Bağlı sipariş kalemleri varsa silinemeyebilir.`)) return;
    try {
      await api.delete(`/suppliers/${s.id}`);
      toast.success('Tedarikçi silindi');
      void fetchList();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  const toggleActive = async (s: SupplierRow) => {
    try {
      await api.patch(`/suppliers/${s.id}`, { isActive: !s.isActive });
      toast.success(s.isActive ? 'Pasifleştirildi' : 'Aktifleştirildi');
      void fetchList();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Güncellenemedi'));
    }
  };

  return (
    <div className={embedded ? 'space-y-6 p-0' : 'max-w-5xl mx-auto space-y-6 p-4 md:p-6'}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Warehouse className="w-8 h-8 text-whatsapp" />
            Tedarikçiler
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Sipariş ve teklif dönüşümlerinde kullanılacak tedarikçi kayıtları
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-semibold shadow-sm hover:opacity-95"
        >
          <Plus className="w-4 h-4" />
          Yeni tedarikçi
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Ad, telefon veya e-posta ara…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-whatsapp"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-whatsapp" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-gray-500 py-12 text-sm">Kayıt bulunamadı.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/90 text-gray-500 text-left text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 font-semibold">Ad</th>
                  <th className="px-4 py-3 font-semibold">Telefon</th>
                  <th className="px-4 py-3 font-semibold">E-posta</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 font-semibold w-40">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-4 py-3 text-gray-600 tabular-nums">{s.phone || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.email || '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void toggleActive(s)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-gray-700"
                      >
                        {s.isActive ? (
                          <>
                            <ToggleRight className="w-5 h-5 text-whatsapp" />
                            Aktif
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="w-5 h-5 text-gray-400" />
                            Pasif
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                          title="Düzenle"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(s)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"
                          title="Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="flex justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40"
          >
            Önceki
          </button>
          <span className="text-sm text-gray-600 py-1.5">
            Sayfa {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40"
          >
            Sonraki
          </button>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900">
              {editing ? 'Tedarikçiyi düzenle' : 'Yeni tedarikçi'}
            </h2>
            <label className="block">
              <span className="text-xs text-gray-500">Ad *</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Telefon</span>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">E-posta</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Adres</span>
              <textarea
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                rows={2}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-y"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Notlar</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-y"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="rounded border-gray-300 text-whatsapp"
              />
              Aktif
            </label>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setEditing(null);
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 hover:bg-gray-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-whatsapp text-white hover:opacity-95 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Kaydet
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
