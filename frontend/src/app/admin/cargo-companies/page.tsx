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
  Truck,
  ToggleLeft,
  ToggleRight,
  Warehouse,
  X,
} from 'lucide-react';

interface CargoCompanyRow {
  id: string;
  name: string;
  isAmbar: boolean;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

const emptyForm = () => ({
  name: '',
  isAmbar: false,
  phone: '',
  notes: '',
  isActive: true,
});

export default function AdminCargoCompaniesPage() {
  return <CargoCompaniesManager />;
}

export function CargoCompaniesManager({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<CargoCompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CargoCompanyRow | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/cargo-companies', {
        params: {
          search: search.trim() || undefined,
          page,
          limit: 30,
        },
      });
      setRows(data.cargoCompanies || []);
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

  const openEdit = (c: CargoCompanyRow) => {
    setEditing(c);
    setForm({
      name: c.name,
      isAmbar: c.isAmbar,
      phone: c.phone || '',
      notes: c.notes || '',
      isActive: c.isActive,
    });
    setModalOpen(true);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error('Kargo firması adı gerekli');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/cargo-companies/${editing.id}`, {
          name,
          isAmbar: form.isAmbar,
          phone: form.phone.trim() || undefined,
          notes: form.notes.trim() || undefined,
          isActive: form.isActive,
        });
        toast.success('Kargo firması güncellendi');
      } else {
        await api.post('/cargo-companies', {
          name,
          isAmbar: form.isAmbar,
          phone: form.phone.trim() || undefined,
          notes: form.notes.trim() || undefined,
          isActive: form.isActive,
        });
        toast.success('Kargo firması oluşturuldu');
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

  const remove = async (c: CargoCompanyRow) => {
    if (!confirm(`${c.name} silinsin mi?`)) return;
    try {
      await api.delete(`/cargo-companies/${c.id}`);
      toast.success('Kargo firması silindi');
      void fetchList();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Silinemedi'));
    }
  };

  const toggleActive = async (c: CargoCompanyRow) => {
    try {
      await api.patch(`/cargo-companies/${c.id}`, { isActive: !c.isActive });
      toast.success(c.isActive ? 'Pasifleştirildi' : 'Aktifleştirildi');
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
            <Truck className="w-8 h-8 text-whatsapp" />
            Kargo Firmaları
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Sipariş kargo bildirimlerinde kullanılacak kargo firması kayıtları
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-whatsapp text-white text-sm font-semibold shadow-sm hover:opacity-95"
        >
          <Plus className="w-4 h-4" />
          Yeni kargo firması
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
            placeholder="Ad veya telefon ara…"
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
                  <th className="px-4 py-3 font-semibold">Tür</th>
                  <th className="px-4 py-3 font-semibold">Telefon</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 font-semibold w-32">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3">
                      {c.isAmbar ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          <Warehouse className="w-3 h-3" />
                          Ambar
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          <Truck className="w-3 h-3" />
                          Kargo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 tabular-nums">{c.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void toggleActive(c)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-gray-700"
                      >
                        {c.isActive ? (
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
                          onClick={() => openEdit(c)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                          title="Düzenle"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(c)}
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
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                {editing ? 'Kargo firmasını düzenle' : 'Yeni kargo firması'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Ad *</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                placeholder="Örn. Yurtiçi Kargo"
              />
            </label>

            <div>
              <span className="text-xs font-semibold text-gray-600 block mb-2">Teslimat türü</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, isAmbar: false }))}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    !form.isAmbar
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Truck className="w-4 h-4" />
                  Kargo (takip kodu ile)
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, isAmbar: true }))}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    form.isAmbar
                      ? 'bg-amber-50 border-amber-300 text-amber-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Warehouse className="w-4 h-4" />
                  Ambar (takip kodsuz)
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {form.isAmbar
                  ? 'Ambar seçildiğinde kargo takip kodu girilmez; müşteriye ambar bildirim mesajı gönderilir.'
                  : 'Kargo seçildiğinde takip kodu girişi yapılır ve müşteriye takip koduyla birlikte bildirim gönderilir.'}
              </p>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Telefon</span>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                placeholder="İsteğe bağlı"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Notlar</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                placeholder="İsteğe bağlı"
              />
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Aktif</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-whatsapp text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
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
